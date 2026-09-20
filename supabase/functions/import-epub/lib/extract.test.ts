import assert from "node:assert/strict";

import { extractChunk, splitChunk, type TermContext } from "./extract.ts";
import type { IrChunk } from "./ir.ts";
import type { CompletionRequest, LlmClient } from "./nemotron.ts";

const term: TermContext = {
  today: "2026-09-20",
  referenceYear: 2026,
  termName: null,
  termStart: null,
  termEnd: null,
};

function bigChunk(): IrChunk {
  const lines = Array.from(
    { length: 60 },
    (_, i) =>
      `#### Topic ${i + 1} (September ${(i % 28) + 1})\n\n- Reading ${i + 1} about topic number ${i + 1} with some words`,
  );
  const text = lines.join("\n\n");
  const sections: IrChunk["sections"] = [];
  let offset = 0;
  for (let i = 0; i < lines.length; i++) {
    sections.push({ offset, section: `Schedule › Topic ${i + 1}` });
    offset += lines[i]!.length + 2;
  }
  return {
    id: "3-1",
    documentIndex: 3,
    documentTitle: "Schedule",
    documentPath: "s.xhtml",
    section: "Schedule › Topic 1",
    sections,
    part: 1,
    totalParts: 1,
    text,
  };
}

function reading(n: number) {
  const day = ((n - 1) % 28) + 1;
  return {
    type: "deadline",
    subtype: "reading",
    title: `Reading ${n}`,
    date: `2026-09-${String(day).padStart(2, "0")}`,
    confidence: 0.9,
    source_quote: `Topic ${n} (September ${day})`,
  };
}

Deno.test("a chunk splits into two halves that together cover the original text", () => {
  const chunk = bigChunk();
  const halves = splitChunk(chunk)!;
  assert.ok(halves);
  const [a, b] = halves;
  assert.equal(a.id, "3-1a");
  assert.equal(b.id, "3-1b");
  assert.ok(a.text.length > 500 && b.text.length > 500);
  assert.equal(`${a.text}\n\n${b.text}`, chunk.text);
  assert.equal(b.sections[0]!.offset, 0);
  assert.ok(b.sections.every((m) => m.offset >= 0 && m.offset <= b.text.length));
  assert.ok(splitChunk({ ...chunk, text: "short" }) === null);
});

Deno.test(
  "a reply cut off by the output limit is re-read as two halves, losing nothing",
  async () => {
    const chunk = bigChunk();
    const calls: string[] = [];
    const llm: LlmClient = {
      complete(request: CompletionRequest) {
        const user = request.messages[1]!.content;
        calls.push(user);
        const isWhole = user.includes("Topic 1 (September 1)") && user.includes("Topic 60 (");
        if (isWhole) {
          // Looks like JSON but is cut off mid-record, as a token limit would leave it.
          return Promise.resolve({
            model: "m",
            text: '{"course":{},"records":[{"type":"deadline","title":"Reading 1","date":"2026-09-02","con',
            latencyMs: 1,
            finishReason: "length",
          });
        }
        const records = [];
        for (let n = 1; n <= 60; n++) if (user.includes(`Topic ${n} (`)) records.push(reading(n));
        return Promise.resolve({
          model: "m",
          text: JSON.stringify({ course: {}, records }),
          latencyMs: 1,
          finishReason: "stop",
        });
      },
    };

    const outcome = await extractChunk(chunk, "x.epub", term, llm);
    assert.equal(outcome.ok, true);
    assert.equal(outcome.chunkId, "3-1");
    assert.equal(outcome.records.length, 60, "every topic in both halves is kept");
    assert.equal(calls.length, 3, "one truncated call, then one per half");
    assert.ok(outcome.records.every((r) => !r.needs_review));
    assert.match(outcome.records[59]!.source_section, /Topic 60/);
  },
);

Deno.test(
  "if a half cannot be read the chunk is reported failed, not silently emptied",
  async () => {
    const chunk = bigChunk();
    const llm: LlmClient = {
      complete(request) {
        const user = request.messages[1]!.content;
        const whole = user.includes("Topic 1 (September 1)") && user.includes("Topic 60 (");
        return Promise.resolve({
          model: "m",
          text: whole ? '{"records":[' : "not json at all",
          latencyMs: 1,
          finishReason: whole ? "length" : "stop",
        });
      },
    };
    const outcome = await extractChunk(chunk, "x.epub", term, llm);
    assert.equal(outcome.ok, false);
    assert.equal(outcome.error?.code, "malformed_model_response");
  },
);
