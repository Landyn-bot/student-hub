import assert from "node:assert/strict";

import { buildEpub } from "../testutil.ts";
import { parseEpub } from "./epub.ts";
import type { IrChunk } from "./ir.ts";
import { parseDate, parseTime, parseWeekday, quoteMentionsDate } from "./dates.ts";
import { extractJsonObject, validateModelOutput } from "./schema.ts";

const chunk: IrChunk = {
  id: "0-1",
  documentIndex: 0,
  documentTitle: "Syllabus",
  documentPath: "s.xhtml",
  section: "Syllabus › Late Work",
  sections: [
    { offset: 0, section: "Syllabus › Late Work" },
    { offset: 60, section: "Syllabus › Schedule" },
  ],
  part: 1,
  totalParts: 1,
  text:
    "Late assignments lose 10% per day, up to 5 days after the due date.\n\n" +
    "Quiz 1 is due on September 9 and the midterm is 10/13. Homework 2 is due Friday.",
};
const ctx = { chunk, referenceYear: 2026 };

function one(record: Record<string, unknown>) {
  const result = validateModelOutput({ course: {}, records: [record] }, ctx);
  assert.ok(result.ok);
  return { result, record: result.ok ? result.records[0] : undefined };
}

Deno.test("a well-supported deadline is kept unflagged, with its own section", () => {
  const { record } = one({
    type: "deadline",
    subtype: "quiz",
    title: "Quiz 1",
    date: "2026-09-09",
    confidence: 0.9,
    source_quote: "Quiz 1 is due on September 9",
  });
  assert.ok(record);
  assert.equal(record.needs_review, false);
  assert.equal(record.date, "2026-09-09");
  assert.equal(record.source_section, "Syllabus › Schedule");
  assert.equal(record.source_chunk_id, "0-1");
});

Deno.test("a quote that is not in the source is flagged and capped, never trusted", () => {
  const { record } = one({
    type: "deadline",
    title: "Essay",
    date: "2026-09-30",
    confidence: 0.99,
    source_quote: "The essay is due September 30",
  });
  assert.ok(record);
  assert.equal(record.needs_review, true);
  assert.ok(record.confidence <= 0.3);
  assert.match(record.review_reason ?? "", /not found/i);
});

Deno.test("a date the quote does not mention is flagged", () => {
  const { record } = one({
    type: "deadline",
    title: "Quiz 1",
    date: "2026-11-02",
    confidence: 0.9,
    source_quote: "Quiz 1 is due on September 9",
  });
  assert.ok(record?.needs_review);
  assert.match(record.review_reason ?? "", /does not appear/i);
});

Deno.test("loose dates are normalised; unreadable ones become null and flagged", () => {
  const ok = one({
    type: "exam",
    title: "Midterm",
    date: "Oct 13",
    start_time: "11:59 PM",
    confidence: 0.9,
    source_quote: "the midterm is 10/13",
  }).record;
  assert.equal(ok?.date, "2026-10-13");
  assert.equal(ok?.start_time, "23:59");

  const bad = one({
    type: "deadline",
    title: "Project",
    date: "sometime in week 4",
    confidence: 0.9,
    source_quote: "Homework 2 is due Friday.",
  }).record;
  assert.equal(bad?.date, null);
  assert.match(bad?.review_reason ?? "", /could not be read/i);
});

Deno.test("missing and out-of-range confidence are handled explicitly", () => {
  assert.equal(
    one({ type: "deadline", title: "A", source_quote: "Quiz 1 is due on September 9" }).record
      ?.confidence,
    0.5,
  );
  assert.equal(
    one({
      type: "deadline",
      title: "A",
      confidence: "high",
      source_quote: "Quiz 1 is due on September 9",
    }).record?.confidence,
    0.9,
  );
  assert.equal(
    one({
      type: "deadline",
      title: "A",
      confidence: 87,
      source_quote: "Quiz 1 is due on September 9",
    }).record?.confidence,
    0.87,
  );
});

Deno.test("low confidence is flagged", () => {
  const { record } = one({
    type: "deadline",
    title: "Quiz 1",
    date: "2026-09-09",
    confidence: 0.4,
    source_quote: "Quiz 1 is due on September 9",
  });
  assert.equal(record?.needs_review, true);
  assert.match(record?.review_reason ?? "", /confidence/i);
});

Deno.test("class meetings need a weekday; MWF style strings expand", () => {
  const mwf = one({
    type: "class_meeting",
    weekdays: "MWF",
    start_time: "10:00",
    confidence: 0.9,
    source_quote: "Late assignments lose 10% per day",
  }).record;
  assert.deepEqual(mwf?.weekdays, [1, 3, 5]);

  const none = validateModelOutput(
    { records: [{ type: "class_meeting", weekdays: [], confidence: 0.9, source_quote: "x" }] },
    ctx,
  );
  assert.ok(none.ok && none.records.length === 0 && none.dropped.length === 1);
});

Deno.test("policies keep structured parameters and drop empty rules", () => {
  const p = one({
    type: "policy",
    category: "Late Work",
    title: "Late",
    rule_text: "Late assignments lose 10% per day",
    parameters: { "Penalty %/day": 10, note: "x".repeat(500), nested: { a: 1 }, ok: true },
    confidence: 0.9,
    source_quote: "Late assignments lose 10% per day",
  }).record;
  assert.equal(p?.subtype, "late_work");
  assert.equal(p?.parameters?.["penalty_day"], 10);
  assert.equal((p?.parameters?.["note"] as string).length, 200);
  assert.equal(p?.parameters?.["ok"], true);
  assert.ok(!("nested" in (p?.parameters ?? {})));

  const empty = validateModelOutput(
    { records: [{ type: "policy", title: "x", confidence: 1, source_quote: "x" }] },
    ctx,
  );
  assert.ok(empty.ok && empty.records.length === 0);
});

Deno.test("bad records are dropped without losing good ones; bad envelopes are rejected", () => {
  const mixed = validateModelOutput(
    {
      records: [
        "nonsense",
        { type: "banana", title: "x" },
        { type: "deadline", title: "", confidence: 1, source_quote: "x" },
        {
          type: "deadline",
          title: "Quiz 1",
          date: "2026-09-09",
          confidence: 0.9,
          source_quote: "Quiz 1 is due on September 9",
        },
      ],
    },
    ctx,
  );
  assert.ok(mixed.ok);
  assert.equal(mixed.records.length, 1);
  assert.equal(mixed.dropped.length, 3);

  assert.equal(validateModelOutput(null, ctx).ok, false);
  assert.equal(validateModelOutput([], ctx).ok, false);
  assert.equal(validateModelOutput({ course: {} }, ctx).ok, false);
});

Deno.test("JSON is recovered from fences, prose and <think> blocks", () => {
  assert.deepEqual(extractJsonObject('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(extractJsonObject('Sure! Here it is: {"a":2} hope that helps'), { a: 2 });
  assert.deepEqual(extractJsonObject('<think>{"a":0}</think>{"a":3}'), { a: 3 });
  assert.equal(extractJsonObject("no json here"), null);
});

Deno.test("date helpers", () => {
  assert.equal(parseDate("October 12", 2026).date, "2026-10-12");
  assert.equal(parseDate("12 Oct 2027", 2026).date, "2027-10-12");
  assert.equal(parseDate("10/12/26", 2026).date, "2026-10-12");
  assert.equal(parseDate("Feb 30", 2026).date, null);
  assert.equal(parseDate("TBD", 2026).ambiguous, true);
  assert.equal(parseTime("9:05"), "09:05");
  assert.equal(parseTime("12 AM"), "00:00");
  assert.equal(parseTime("25:00"), null);
  assert.equal(parseWeekday("Thurs"), 4);
  assert.equal(quoteMentionsDate("due Oct 13", "2026-10-13"), true);
  assert.equal(quoteMentionsDate("due Oct 14", "2026-10-13"), false);
  assert.equal(quoteMentionsDate("due 10/13", "2026-10-13"), true);
});

Deno.test("chunks of a real parse validate against their own text", async () => {
  const ir = await parseEpub(await buildEpub(), { filename: "x.epub" });
  const sched = ir.chunks.find((c) => c.text.includes("Midterm Exam"))!;
  const r = validateModelOutput(
    {
      records: [
        {
          type: "exam",
          title: "Midterm Exam",
          date: "2026-10-13",
          confidence: 0.9,
          source_quote: "7 | October 13 | Midterm Exam",
        },
      ],
    },
    { chunk: sched, referenceYear: 2026 },
  );
  assert.ok(r.ok && !r.records[0]!.needs_review);
  assert.equal(r.records[0]!.source_section, "Weekly Schedule");
});
