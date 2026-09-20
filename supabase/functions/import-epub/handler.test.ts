import assert from "node:assert/strict";

import { handleRequest, type HandlerDeps } from "./handler.ts";
import { ImportError } from "./lib/errors.ts";
import { createNemotronClient } from "./lib/nemotron.ts";
import {
  MemoryStore,
  SCHEDULE_REPLY,
  SYLLABUS_REPLY,
  ScriptedLlm,
  buildEpub,
  buildZip,
  sampleScript,
  type Script,
} from "./testutil.ts";

function setup(script: Script = sampleScript, over: Partial<HandlerDeps> = {}) {
  const store = new MemoryStore();
  const llm = new ScriptedLlm(script);
  const pending: Promise<unknown>[] = [];
  const logs: string[] = [];
  const deps: HandlerDeps = {
    llm,
    authenticate: (req) => {
      if (!req.headers.get("authorization")) return Promise.reject(new Error("no auth"));
      return Promise.resolve({ userId: store.userId, store });
    },
    waitUntil: (p) => void pending.push(p),
    log: (event, data) => logs.push(`${event} ${JSON.stringify(data)}`),
    ...over,
  };
  const settle = async () => void (await Promise.all(pending.splice(0)));
  return { store, llm, deps, settle, logs };
}

function epubRequest(bytes: Uint8Array, headers: Record<string, string> = {}) {
  return new Request("http://local/import-epub", {
    method: "POST",
    headers: {
      authorization: "Bearer token",
      "content-type": "application/epub+zip",
      "x-filename": encodeURIComponent("PSYC 1010.epub"),
      ...headers,
    },
    body: bytes as BodyInit,
  });
}

function jsonRequest(body: unknown) {
  return new Request("http://local/import-epub", {
    method: "POST",
    headers: { authorization: "Bearer token", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

Deno.test("EPUB upload is parsed, extracted, validated and staged for review", async () => {
  const { store, llm, deps, settle } = setup();
  const res = await handleRequest(epubRequest(await buildEpub()), deps);
  assert.equal(res.status, 202);
  const { batchId } = await res.json();
  await settle();

  const batch = store.batches.get(batchId)!;
  assert.equal(batch.status, "ready");
  assert.equal(batch.filename, "PSYC 1010.epub");
  assert.equal(batch.chunks_total, 2);
  assert.equal(batch.chunks_done, 2);
  assert.equal(batch.course_code, "PSYC 1010");
  assert.equal(batch.course_name, "Intro to Psychology");
  assert.equal(batch.course_instructor, "Dr. Adeyemi");
  assert.equal(batch.model, "test-model");

  const items = store.items.get(batchId)!;
  assert.equal(items.filter((i) => i.kind === "deadline").length, 2);
  assert.equal(items.filter((i) => i.kind === "exam").length, 2);
  assert.equal(items.filter((i) => i.kind === "policy").length, 2);
  assert.equal(items.filter((i) => i.kind === "class_meeting").length, 1);
  const final = items.find((i) => i.title === "Final Exam")!;
  assert.equal(final.start_time, "09:00");
  assert.equal(final.needs_review, false);
  const late = items.find((i) => i.subtype === "late_work")!;
  assert.deepEqual(late.parameters, { penalty_percent_per_day: 10, max_late_days: 5 });
  assert.equal(late.source_section, "Course Syllabus › PSYC 1010: Intro to Psychology › Late Work");

  // Only normalised text reaches the model: no markup, no zip bytes, no container paths.
  for (const call of llm.calls) {
    const sent = call.messages.map((m) => m.content).join("\n");
    assert.ok(!sent.includes("<html") && !sent.includes("META-INF") && !sent.includes("OEBPS"));
  }
});

Deno.test("requests without a session are refused before any work happens", async () => {
  const { store, deps } = setup();
  const req = new Request("http://local/x", { method: "POST", body: new Uint8Array([1]) });
  const res = await handleRequest(req, deps);
  assert.equal(res.status, 401);
  assert.equal(store.batches.size, 0);
});

Deno.test("CORS preflight and wrong methods", async () => {
  const { deps } = setup();
  const pre = await handleRequest(new Request("http://local/x", { method: "OPTIONS" }), deps);
  assert.equal(pre.status, 204);
  assert.match(pre.headers.get("access-control-allow-headers") ?? "", /x-filename/);
  const get = await handleRequest(new Request("http://local/x", { method: "GET" }), deps);
  assert.equal(get.status, 405);
});

Deno.test("hostile and malformed files are rejected up front and create no batch", async () => {
  const { store, deps } = setup();
  const cases: [Uint8Array, string, number][] = [
    [new TextEncoder().encode("plain text, not a zip"), "not_zip", 415],
    [await buildZip([{ name: "../evil", data: "x" }]), "unsafe_archive", 422],
    [await buildZip([{ name: "readme.txt", data: "x" }]), "invalid_epub", 422],
    [new Uint8Array(0), "invalid_request", 400],
  ];
  for (const [bytes, code, status] of cases) {
    const res = await handleRequest(epubRequest(bytes), deps);
    const body = await res.json();
    assert.equal(body.code, code);
    assert.equal(res.status, status);
    assert.equal(body.ok, false);
  }
  assert.equal(store.batches.size, 0);
});

Deno.test("an oversize upload is refused from the declared length", async () => {
  const { deps } = setup();
  const res = await handleRequest(
    epubRequest(new Uint8Array(10), { "content-length": String(500 * 1024 * 1024) }),
    deps,
  );
  assert.equal(res.status, 413);
  assert.equal((await res.json()).code, "file_too_large");
});

Deno.test("uploading the same file twice reuses the open batch", async () => {
  const { store, deps, settle } = setup();
  const bytes = await buildEpub();
  const a = await (await handleRequest(epubRequest(bytes), deps)).json();
  await settle();
  const res = await handleRequest(epubRequest(bytes), deps);
  const b = await res.json();
  assert.equal(res.status, 200);
  assert.equal(b.reused, true);
  assert.equal(b.batchId, a.batchId);
  assert.equal(store.batches.size, 1);
});

Deno.test("a student cannot pile up imports", async () => {
  // A model that never answers keeps the first batch in the 'processing' state.
  const stuck = { complete: () => new Promise<never>(() => {}) };
  const { deps } = setup(sampleScript, { llm: stuck, maxProcessingBatches: 1 });
  const first = await handleRequest(epubRequest(await buildEpub()), deps);
  assert.equal(first.status, 202);
  const other = await buildEpub([
    { file: "x.xhtml", title: "X", body: "<h1>Other course</h1><p>Quiz Sept 9</p>" },
  ]);
  const res = await handleRequest(epubRequest(other), deps);
  assert.equal(res.status, 429);
  assert.equal((await res.json()).code, "too_many_imports");
});

Deno.test("a model outage fails the batch with a safe message and no secrets", async () => {
  const secret = "nvapi-SECRET-KEY-123";
  const llm = createNemotronClient({
    apiKey: secret,
    sleep: () => Promise.resolve(),
    fetchImpl: () =>
      Promise.resolve(new Response(`{"detail":"bad key ${secret}"}`, { status: 401 })),
  });
  const { store, deps, settle, logs } = setup(sampleScript, { llm });
  const res = await handleRequest(epubRequest(await buildEpub()), deps);
  const { batchId } = await res.json();
  await settle();
  const batch = store.batches.get(batchId)!;
  assert.equal(batch.status, "failed");
  assert.equal(batch.error_code, "provider_auth");
  assert.ok(!JSON.stringify(batch).includes(secret));
  assert.ok(!logs.join("\n").includes(secret));
});

Deno.test("a missing API key is reported plainly", async () => {
  const llm = createNemotronClient({ apiKey: undefined });
  const { store, deps, settle } = setup(sampleScript, { llm });
  const { batchId } = await (await handleRequest(epubRequest(await buildEpub()), deps)).json();
  await settle();
  assert.equal(store.batches.get(batchId)!.error_code, "provider_not_configured");
});

Deno.test("invalid JSON gets one repair attempt, then the chunk is marked failed", async () => {
  let attempts = 0;
  const flaky: Script = (user, request) => {
    if (!user.includes("Late Work") && !user.includes("Class Meetings")) return SCHEDULE_REPLY;
    const isRepair = request.messages.some((m) => m.role === "assistant");
    attempts++;
    return isRepair ? SYLLABUS_REPLY : "Sorry, here you go: not json";
  };
  const a = setup(flaky);
  const { batchId } = await (await handleRequest(epubRequest(await buildEpub()), a.deps)).json();
  await a.settle();
  assert.equal(attempts, 2);
  assert.equal(a.store.batches.get(batchId)!.status, "ready");
  assert.equal(a.store.items.get(batchId)!.length, 7);

  const broken: Script = (user) => (user.includes("Late Work") ? "still not json" : SCHEDULE_REPLY);
  const b = setup(broken);
  const res = await (await handleRequest(epubRequest(await buildEpub()), b.deps)).json();
  await b.settle();
  const batch = b.store.batches.get(res.batchId)!;
  assert.equal(batch.status, "partial");
  assert.equal(batch.chunks_failed, 1);
  assert.equal(batch.chunks_done, 1);
  assert.match(batch.warnings.join(" "), /1 of 2 sections/);
});

Deno.test("resume reads only the missing sections and does not duplicate records", async () => {
  let failSyllabus = true;
  const script: Script = (user) => {
    if (user.includes("Late Work")) {
      return failSyllabus ? new ImportError("provider_unavailable", "down") : SYLLABUS_REPLY;
    }
    return SCHEDULE_REPLY;
  };
  const { store, deps, settle, llm } = setup(script, {});
  const created = await (await handleRequest(epubRequest(await buildEpub()), deps)).json();
  await settle();
  assert.equal(store.batches.get(created.batchId)!.status, "partial");
  assert.equal(store.items.get(created.batchId)!.length, 4);

  failSyllabus = false;
  llm.calls.length = 0;
  store.batches.get(created.batchId)!.heartbeat_at = new Date(
    Date.now() - 10 * 60_000,
  ).toISOString();
  const res = await handleRequest(
    jsonRequest({ action: "resume", batchId: created.batchId }),
    deps,
  );
  assert.equal(res.status, 202);
  await settle();

  assert.equal(llm.calls.length, 1, "only the unread section is sent again");
  assert.equal(store.batches.get(created.batchId)!.status, "ready");
  assert.equal(store.items.get(created.batchId)!.length, 7);
  assert.deepEqual(store.batches.get(created.batchId)!.warnings, [], "stale warning is cleared");
});

Deno.test("a discarded import is not brought back to life by the background job", async () => {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => (release = resolve));
  const slow: Script = () => SCHEDULE_REPLY;
  const { store, deps, settle } = setup(slow, {});
  const inner = deps.llm;
  deps.llm = {
    complete: async (request) => {
      await gate;
      return inner.complete(request);
    },
  };
  const { batchId } = await (await handleRequest(epubRequest(await buildEpub()), deps)).json();
  store.batches.get(batchId)!.status = "discarded";
  release();
  await settle();
  assert.equal(store.batches.get(batchId)!.status, "discarded");
  assert.equal(store.items.get(batchId)!.length, 0);
});

Deno.test(
  "resume on a batch that is actively running does nothing; unknown batch is 404",
  async () => {
    const { store, deps } = setup();
    const created = await store.createBatch({
      filename: "a.epub",
      file_hash: "h",
      file_size: 1,
      source_kind: "epub",
      chunks_total: 1,
      warnings: [],
      ir: { metadata: {} as never, chunks: [] },
      course_name: null,
    });
    const res = await handleRequest(jsonRequest({ action: "resume", batchId: created.id }), deps);
    assert.equal((await res.json()).alreadyRunning, true);
    const missing = await handleRequest(
      jsonRequest({ action: "resume", batchId: crypto.randomUUID() }),
      deps,
    );
    assert.equal(missing.status, 404);
  },
);

Deno.test("the time budget leaves a resumable partial import instead of a failure", async () => {
  let offset = 0;
  const slow: Script = (user) => {
    offset += 2000; // every model call "takes" two seconds
    return sampleScript(user, { messages: [] });
  };
  const { store, deps, settle } = setup(slow, {
    concurrency: 1,
    budgetMs: 1000,
    now: () => new Date(Date.now() + offset),
  });
  const { batchId } = await (await handleRequest(epubRequest(await buildEpub()), deps)).json();
  await settle();
  const batch = store.batches.get(batchId)!;
  assert.equal(batch.status, "partial");
  assert.equal(batch.chunks_done, 1);
  assert.match(batch.warnings.join(" "), /1 of 2 sections/);
});

Deno.test("text mode goes through the same pipeline; bad requests are rejected", async () => {
  const { store, deps, settle } = setup(sampleScript);
  const res = await handleRequest(
    jsonRequest({
      action: "text",
      filename: "syllabus.txt",
      text: "# Schedule\n\n1 | September 8 | Reading Response 1\n\nLate Work: 10% per day.",
    }),
    deps,
  );
  assert.equal(res.status, 202);
  await settle();
  const batch = [...store.batches.values()][0]!;
  assert.equal(batch.source_kind, "text");
  assert.equal(batch.status, "ready");

  for (const bad of [
    { action: "text", filename: "x", text: "short" },
    { action: "nope" },
    { action: "resume", batchId: "not-a-uuid" },
  ]) {
    const r = await handleRequest(jsonRequest(bad), deps);
    assert.equal(r.status, 400);
  }
  const notJson = await handleRequest(
    new Request("http://local/x", {
      method: "POST",
      headers: { authorization: "t", "content-type": "application/json" },
      body: "{oops",
    }),
    deps,
  );
  assert.equal(notJson.status, 400);
});

Deno.test(
  "term dates and the year are given to the model so relative dates can be resolved",
  async () => {
    const seen: string[] = [];
    const script: Script = (user) => {
      seen.push(user);
      return JSON.stringify({ course: {}, records: [] });
    };
    const { store, deps, settle } = setup(script);
    store.term = { name: "Fall 2026", starts_on: "2026-08-24", ends_on: "2026-12-11" };
    await handleRequest(epubRequest(await buildEpub()), deps);
    await settle();
    assert.ok(seen.length > 0);
    assert.ok(
      seen.every(
        (u) =>
          u.includes("Term starts: 2026-08-24") &&
          u.includes("Default year for dates without a year: 2026") &&
          u.includes("<<<COURSE TEXT>>>"),
      ),
    );
  },
);

Deno.test(
  "the model client retries rate limits, honours Retry-After, and drops JSON mode if rejected",
  async () => {
    const sleeps: number[] = [];
    const bodies: string[] = [];
    let n = 0;
    const client = createNemotronClient({
      apiKey: "k",
      sleep: (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
      fetchImpl: (_url, init) => {
        bodies.push(String(init?.body));
        n++;
        if (n === 1)
          return Promise.resolve(new Response("response_format is not supported", { status: 400 }));
        if (n === 2) {
          return Promise.resolve(
            new Response("slow down", { status: 429, headers: { "retry-after": "7" } }),
          );
        }
        return Promise.resolve(
          new Response(JSON.stringify({ model: "m", choices: [{ message: { content: "{}" } }] })),
        );
      },
    });
    const out = await client.complete({ messages: [{ role: "user", content: "hi" }] });
    assert.equal(out.text, "{}");
    assert.deepEqual(sleeps, [7000]);
    assert.ok(bodies[0]!.includes("response_format"));
    assert.ok(!bodies[1]!.includes("response_format"));
  },
);
