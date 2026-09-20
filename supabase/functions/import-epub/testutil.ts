/** Test helpers: build valid and deliberately hostile zip / EPUB files in memory. */
import { crc32 } from "./lib/zip.ts";

export interface TestEntry {
  /** Written to the archive exactly as given (so traversal names can be tested). */
  name: string;
  data: string | Uint8Array;
  method?: 0 | 8;
  /** Overrides written to the central directory to simulate lying headers. */
  declaredSize?: number;
  declaredCompressedSize?: number;
  flags?: number;
}

const enc = new TextEncoder();

export async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart])
    .stream()
    .pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function buildZip(entries: TestEntry[]): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const raw = typeof entry.data === "string" ? enc.encode(entry.data) : entry.data;
    const method = entry.method ?? 8;
    const body = method === 8 ? await deflateRaw(raw) : raw;
    const name = enc.encode(entry.name);
    const flags = entry.flags ?? 0x0800;

    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, flags, true);
    lv.setUint16(8, method, true);
    lv.setUint32(14, crc32(raw), true);
    lv.setUint32(18, body.length, true);
    lv.setUint32(22, raw.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);

    const cen = new Uint8Array(46 + name.length);
    const cv = new DataView(cen.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, flags, true);
    cv.setUint16(10, method, true);
    cv.setUint32(16, crc32(raw), true);
    cv.setUint32(20, entry.declaredCompressedSize ?? body.length, true);
    cv.setUint32(24, entry.declaredSize ?? raw.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    cen.set(name, 46);

    chunks.push(local, body);
    central.push(cen);
    offset += local.length + body.length;
  }

  const cdSize = central.reduce((n, c) => n + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);

  const all = [...chunks, ...central, eocd];
  const out = new Uint8Array(all.reduce((n, c) => n + c.length, 0));
  let p = 0;
  for (const c of all) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}

export interface TestPage {
  file: string;
  title?: string;
  body: string;
}

const CONTAINER = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`;

export function xhtml(body: string, title = "Page"): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>${title}</title></head><body>${body}</body></html>`;
}

/** A small Canvas-style course export: one syllabus page, one schedule page. */
export const SAMPLE_PAGES: TestPage[] = [
  {
    file: "syllabus.xhtml",
    title: "Course Syllabus",
    body: `<h1>PSYC 1010: Intro to Psychology</h1>
<p>Instructor: Dr. Adeyemi. Term: Fall 2026.</p>
<h2>Late Work</h2>
<p>Late assignments lose 10% per day, up to 5 days. After 5 days no credit is given.</p>
<h2>Attendance</h2>
<p>You may miss 2 classes without penalty.</p>
<h2>Class Meetings</h2>
<p>Lecture meets Monday and Wednesday, 10:00 AM to 10:50 AM in Hall 204.</p>`,
  },
  {
    file: "schedule.xhtml",
    title: "Weekly Schedule",
    body: `<h1>Weekly Schedule</h1>
<table>
<thead><tr><th>Week</th><th>Due</th><th>Item</th></tr></thead>
<tbody>
<tr><td>1</td><td>September 8</td><td>Reading Response 1</td></tr>
<tr><td>2</td><td>September 15</td><td>Lab Report 1</td></tr>
<tr><td>7</td><td>October 13</td><td>Midterm Exam</td></tr>
</tbody></table>
<ul><li>Final Exam: December 15, 2026 at 9:00 AM</li></ul>`,
  },
];

export async function buildEpub(
  pages: TestPage[] = SAMPLE_PAGES,
  extra: TestEntry[] = [],
  opts: { encryption?: string; spineOrder?: number[] } = {},
): Promise<Uint8Array> {
  const manifest = pages
    .map((p, i) => `<item id="p${i}" href="${p.file}" media-type="application/xhtml+xml"/>`)
    .join("");
  const order = opts.spineOrder ?? pages.map((_, i) => i);
  const spine = order.map((i) => `<itemref idref="p${i}"/>`).join("");
  const opf = `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>PSYC_1010_SEC01</dc:title><dc:creator>Dr. Adeyemi</dc:creator><dc:language>en</dc:language></metadata>
<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>${manifest}</manifest>
<spine>${spine}</spine></package>`;
  const nav = xhtml(
    `<nav epub:type="toc"><ol>${pages
      .map((p) => `<li><a href="${p.file}">${p.title ?? p.file}</a></li>`)
      .join("")}</ol></nav>`,
    "Nav",
  );

  const entries: TestEntry[] = [
    { name: "mimetype", data: "application/epub+zip", method: 0 },
    { name: "META-INF/container.xml", data: CONTAINER },
    { name: "OEBPS/content.opf", data: opf },
    { name: "OEBPS/nav.xhtml", data: nav },
    ...pages.map((p) => ({ name: `OEBPS/${p.file}`, data: xhtml(p.body, p.title) })),
    ...extra,
  ];
  if (opts.encryption) entries.push({ name: "META-INF/encryption.xml", data: opts.encryption });
  return await buildZip(entries);
}

/* ------------------------------------------------------------------ */
/* In-memory store and scripted model for handler tests                */
/* ------------------------------------------------------------------ */

import type { CompletionRequest, LlmClient } from "./lib/nemotron.ts";
import type { StagedRecord } from "./lib/schema.ts";
import type { BatchPatch, BatchRow, NewBatch, Store } from "./lib/store.ts";

export class MemoryStore implements Store {
  batches = new Map<string, BatchRow>();
  items = new Map<string, StagedRecord[]>();
  private seq = 0;
  constructor(
    public userId = "user-1",
    public term: { name: string; starts_on: string | null; ends_on: string | null } | null = null,
  ) {}

  findOpenBatchByHash(hash: string) {
    const found = [...this.batches.values()].find(
      (b) => b.file_hash === hash && ["processing", "ready", "partial"].includes(b.status),
    );
    return Promise.resolve(found ?? null);
  }
  countProcessingSince(sinceIso: string) {
    const n = [...this.batches.values()].filter(
      (b) => b.status === "processing" && b.heartbeat_at >= sinceIso,
    ).length;
    return Promise.resolve(n);
  }
  createBatch(input: NewBatch) {
    const row: BatchRow = {
      id: crypto.randomUUID(),
      user_id: this.userId,
      status: "processing",
      stage: "extracting",
      chunks_done: 0,
      chunks_failed: 0,
      done_chunk_ids: [],
      error_code: null,
      error_message: null,
      model: null,
      course_code: null,
      course_instructor: null,
      course_term: null,
      heartbeat_at: new Date().toISOString(),
      ...input,
    };
    this.seq++;
    this.batches.set(row.id, row);
    this.items.set(row.id, []);
    return Promise.resolve(row);
  }
  getBatch(id: string) {
    const b = this.batches.get(id);
    return Promise.resolve(b ? structuredClone(b) : null);
  }
  isOpen(id: string) {
    const b = this.batches.get(id);
    return Promise.resolve(!!b && b.status !== "discarded" && b.status !== "confirmed");
  }
  updateBatch(id: string, patch: BatchPatch) {
    const b = this.batches.get(id);
    if (!b) throw new Error("no batch");
    Object.assign(b, patch);
    return Promise.resolve();
  }
  insertItems(batchId: string, records: StagedRecord[]) {
    this.items.get(batchId)!.push(...structuredClone(records));
    return Promise.resolve();
  }
  listItems(batchId: string) {
    return Promise.resolve(structuredClone(this.items.get(batchId) ?? []));
  }
  currentTerm() {
    return Promise.resolve(this.term);
  }
}

export type Script = (user: string, request: CompletionRequest) => string | Error;

/** A model that answers from a script keyed on the excerpt it is shown. */
export class ScriptedLlm implements LlmClient {
  calls: CompletionRequest[] = [];
  constructor(private script: Script) {}
  complete(request: CompletionRequest) {
    this.calls.push(request);
    const user = request.messages.find((m) => m.role === "user")!.content;
    const result = this.script(user, request);
    if (result instanceof Error) return Promise.reject(result);
    return Promise.resolve({ model: "test-model", text: result, latencyMs: 1 });
  }
}

export const SYLLABUS_REPLY = JSON.stringify({
  course: {
    code: "PSYC 1010",
    name: "Intro to Psychology",
    instructor: "Dr. Adeyemi",
    term: "Fall 2026",
  },
  records: [
    {
      type: "policy",
      category: "late_work",
      title: "Late work penalty",
      rule_text: "Late assignments lose 10% per day, up to 5 days.",
      parameters: { penalty_percent_per_day: 10, max_late_days: 5 },
      confidence: 0.95,
      source_quote: "Late assignments lose 10% per day, up to 5 days.",
    },
    {
      type: "policy",
      category: "attendance",
      title: "Attendance",
      rule_text: "You may miss 2 classes without penalty.",
      parameters: { grace_absences: 2 },
      confidence: 0.9,
      source_quote: "You may miss 2 classes without penalty.",
    },
    {
      type: "class_meeting",
      title: "Lecture",
      weekdays: ["mon", "wed"],
      start_time: "10:00",
      end_time: "10:50",
      location: "Hall 204",
      confidence: 0.92,
      source_quote: "Lecture meets Monday and Wednesday, 10:00 AM to 10:50 AM in Hall 204.",
    },
  ],
});

export const SCHEDULE_REPLY = JSON.stringify({
  course: { code: null, name: null, instructor: null, term: null },
  records: [
    {
      type: "deadline",
      subtype: "reading",
      title: "Reading Response 1",
      date: "2026-09-08",
      time: null,
      description: null,
      points: null,
      weight_percent: null,
      confidence: 0.9,
      source_quote: "1 | September 8 | Reading Response 1",
    },
    {
      type: "deadline",
      subtype: "lab",
      title: "Lab Report 1",
      date: "2026-09-15",
      confidence: 0.9,
      source_quote: "2 | September 15 | Lab Report 1",
    },
    {
      type: "exam",
      subtype: "midterm",
      title: "Midterm Exam",
      date: "2026-10-13",
      confidence: 0.93,
      source_quote: "7 | October 13 | Midterm Exam",
    },
    {
      type: "exam",
      subtype: "final",
      title: "Final Exam",
      date: "2026-12-15",
      start_time: "9:00 AM",
      confidence: 0.95,
      source_quote: "Final Exam: December 15, 2026 at 9:00 AM",
    },
  ],
});

export const sampleScript: Script = (user) =>
  user.includes("Late Work") || user.includes("Class Meetings") ? SYLLABUS_REPLY : SCHEDULE_REPLY;
