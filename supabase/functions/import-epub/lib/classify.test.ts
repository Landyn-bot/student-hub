// Regression tests for a real Canvas export (CMPINF 0010) that imported with 0 deadlines and
// 0 exams: every dated row of the weekly schedule table came back as a "class_meeting", and a
// class_meeting carries only weekdays, so the date was silently thrown away.
import assert from "node:assert/strict";

import type { IrChunk } from "./ir.ts";
import { extractBlocks, stripCanvasNoise } from "./normalize.ts";
import { validateModelOutput } from "./schema.ts";

function chunkOf(text: string): IrChunk {
  return {
    id: "3-1",
    documentIndex: 3,
    documentTitle: "Schedule and Readings",
    documentPath: "s.xhtml",
    section: "Schedule and Readings › Weekly Schedule",
    sections: [{ offset: 0, section: "Schedule and Readings › Weekly Schedule" }],
    part: 1,
    totalParts: 1,
    text,
  };
}

const SCHEDULE = chunkOf(
  "Week | Date | Day | Topic\n" +
    "8 | 9/17 | Thursday | Synthesis Exercise: Comparing ICTs\n" +
    "7 | 9/15 | Tuesday | Communication\n" +
    "6 | 9/10 | Thursday | AREA TALK: Innovation and History of Computing",
);

const SYLLABUS = chunkOf(
  "Meeting Times\nLecture (21904): TuTh 1:00PM - 2:15PM 324 Cathedral of Learning Classroom\n" +
    "1020 | W | 1:00 PM-2:50 PM | 501 Information Sciences Build | Kyu Han",
);

Deno.test("a dated schedule row sent back as a class_meeting becomes a dated deadline", () => {
  const result = validateModelOutput(
    {
      records: [
        {
          type: "class_meeting",
          title: "Synthesis Exercise: Comparing ICTs",
          weekdays: ["thu"],
          location: "324 Cathedral of Learning",
          confidence: 0.9,
          source_quote: "8 | 9/17 | Thursday | Synthesis Exercise: Comparing ICTs",
        },
      ],
    },
    { chunk: SCHEDULE, referenceYear: 2026 },
  );

  assert.ok(result.ok);
  const record = result.records[0]!;
  assert.equal(record.kind, "deadline", "a dated session is not a weekly meeting");
  assert.equal(record.date, "2026-09-17", "the date from the row survives");
  assert.equal(record.weekdays, null);
  assert.equal(record.location, "324 Cathedral of Learning", "where it happens is kept");
  assert.equal(record.needs_review, false);
});

Deno.test("a genuinely weekly meeting is still a class_meeting", () => {
  const result = validateModelOutput(
    {
      records: [
        {
          type: "class_meeting",
          title: "Lecture",
          weekdays: ["tue", "thu"],
          start_time: "13:00",
          end_time: "14:15",
          location: "324 Cathedral of Learning",
          confidence: 0.9,
          source_quote: "Lecture (21904): TuTh 1:00PM - 2:15PM 324 Cathedral of Learning Classroom",
        },
        {
          type: "class_meeting",
          title: "Lab Section 1020",
          weekdays: ["wed"],
          start_time: "13:00",
          confidence: 0.9,
          source_quote: "1020 | W | 1:00 PM-2:50 PM | 501 Information Sciences Build | Kyu Han",
        },
      ],
    },
    { chunk: SYLLABUS, referenceYear: 2026 },
  );

  assert.ok(result.ok);
  assert.equal(result.records.length, 2);
  assert.ok(result.records.every((r) => r.kind === "class_meeting"));
  assert.deepEqual(result.records[0]!.weekdays, [2, 4]);
  assert.equal(result.records[0]!.date, null);
  assert.deepEqual(result.records[1]!.weekdays, [3]);
});

Deno.test("a weekly pattern that merely mentions a room number is not mistaken for a date", () => {
  const result = validateModelOutput(
    {
      records: [
        {
          type: "class_meeting",
          title: "Lab Section 1030",
          weekdays: ["wed"],
          start_time: "15:00",
          location: "5313 Sennott Square",
          confidence: 0.9,
          source_quote: "1030 | W | 3:00 PM-4:50 PM | 5313 Sennott Square | Abigail Huang",
        },
      ],
    },
    { chunk: chunkOf("1030 | W | 3:00 PM-4:50 PM | 5313 Sennott Square | Abigail Huang"), referenceYear: 2026 },
  );
  assert.ok(result.ok);
  assert.equal(result.records[0]!.kind, "class_meeting");
});

Deno.test("Canvas's missing-file notice is stripped out of titles and text", () => {
  const raw =
    "Communication [Readings] [File 04-communication-FALL 2026.pptx could not be included in the ePub document. Please see separate zip file for access.]";
  assert.equal(stripCanvasNoise(raw), "Communication [Readings]");

  const page = extractBlocks(
    "<html><body><h1>Readings</h1>" +
      "<ul><li>File Gleick-The-Information.pdf could not be included in the ePub document. Please see separate zip file for access.</li>" +
      "<li>Information (Wikipedia)</li></ul></body></html>",
  );
  const texts = page.blocks.map((b) => b.text);
  assert.ok(!texts.some((t) => t.includes("could not be included")));
  assert.ok(texts.includes("Information (Wikipedia)"));
  assert.equal(texts.filter((t) => t === "").length, 0, "emptied blocks are dropped");
});
