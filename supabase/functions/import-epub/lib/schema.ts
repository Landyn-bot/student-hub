/**
 * The contract for what Nemotron may return, and the server-side validation that stands
 * between its reply and the database.
 *
 * The model is asked for a fixed JSON shape. Whatever it returns is treated as untrusted:
 * every record is normalised, checked against a strict schema, and cross-checked against the
 * chunk it claims to come from. Records that fail are dropped and counted; records that pass
 * but look doubtful are kept and flagged for the student to look at.
 */
import { z } from "zod";

import { parseDate, parseTime, parseWeekday, quoteMentionsDate } from "./dates.ts";
import type { IrChunk } from "./ir.ts";
import { looseIncludes, sectionForQuote } from "./normalize.ts";

export const RECORD_KINDS = ["deadline", "exam", "class_meeting", "policy"] as const;
export type RecordKind = (typeof RECORD_KINDS)[number];

export const DEADLINE_SUBTYPES = [
  "assignment",
  "quiz",
  "project",
  "reading",
  "lab",
  "discussion",
  "other",
] as const;
export const EXAM_SUBTYPES = ["exam", "midterm", "final", "other"] as const;
export const POLICY_CATEGORIES = [
  "late_work",
  "attendance",
  "missed_exam",
  "academic_integrity",
  "grading",
  "other",
] as const;

export const LOW_CONFIDENCE = 0.6;
const MAX_QUOTE = 600;

/** Shown to the model verbatim, so what we ask for and what we validate cannot drift apart. */
export const OUTPUT_SHAPE = `{
  "course": { "code": string|null, "name": string|null, "instructor": string|null, "term": string|null },
  "records": [
    { "type": "deadline", "subtype": "assignment"|"quiz"|"project"|"reading"|"lab"|"discussion"|"other",
      "title": string, "date": "YYYY-MM-DD"|null, "time": "HH:MM"|null, "description": string|null,
      "points": number|null, "weight_percent": number|null, "confidence": number, "source_quote": string },
    { "type": "exam", "subtype": "exam"|"midterm"|"final"|"other", "title": string,
      "date": "YYYY-MM-DD"|null, "start_time": "HH:MM"|null, "end_time": "HH:MM"|null,
      "location": string|null, "description": string|null, "weight_percent": number|null,
      "confidence": number, "source_quote": string },
    { "type": "class_meeting", "title": string, "weekdays": ["mon"|"tue"|"wed"|"thu"|"fri"|"sat"|"sun"],
      "start_time": "HH:MM"|null, "end_time": "HH:MM"|null, "location": string|null,
      "confidence": number, "source_quote": string },
    { "type": "policy", "category": "late_work"|"attendance"|"missed_exam"|"academic_integrity"|"grading"|"other",
      "title": string, "rule_text": string, "parameters": { "<snake_case_name>": string|number|boolean },
      "confidence": number, "source_quote": string }
  ]
}`;

export interface CourseInfo {
  code: string | null;
  name: string | null;
  instructor: string | null;
  term: string | null;
}

export const EMPTY_COURSE: CourseInfo = { code: null, name: null, instructor: null, term: null };

export function mergeCourse(a: CourseInfo, b: CourseInfo): CourseInfo {
  return {
    code: a.code ?? b.code,
    name: a.name ?? b.name,
    instructor: a.instructor ?? b.instructor,
    term: a.term ?? b.term,
  };
}

const stagedSchema = z.object({
  kind: z.enum(RECORD_KINDS),
  subtype: z.string().min(1).max(40),
  title: z.string().trim().min(1).max(300),
  description: z.string().max(2000).nullable(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  start_time: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .nullable(),
  end_time: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .nullable(),
  weekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7).nullable(),
  location: z.string().max(200).nullable(),
  points: z.number().min(0).max(100_000).nullable(),
  weight: z.number().min(0).max(100).nullable(),
  parameters: z.record(z.union([z.string().max(200), z.number(), z.boolean()])).nullable(),
  confidence: z.number().min(0).max(1),
  needs_review: z.boolean(),
  review_reason: z.string().max(400).nullable(),
  source_quote: z.string().max(MAX_QUOTE),
  source_section: z.string().max(600),
  source_chunk_id: z.string().max(40),
});

export type StagedRecord = z.infer<typeof stagedSchema>;

export interface DroppedRecord {
  reason: string;
}

export type ValidationResult =
  | { ok: true; course: CourseInfo; records: StagedRecord[]; dropped: DroppedRecord[] }
  | { ok: false; error: string };

export interface ValidationContext {
  chunk: IrChunk;
  /** Year used to complete dates written without one ("October 12"). */
  referenceYear: number;
}

/** Pull a JSON object out of a reply that may be wrapped in fences, prose or <think> blocks. */
export function extractJsonObject(text: string): unknown {
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(cleaned);
  const candidate = fenced?.[1]?.trim() ?? cleaned;
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start === -1 || end <= start) return null;
    try {
      return JSON.parse(candidate.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

const str = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const t = v.replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : null;
};

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const m = /-?\d+(?:\.\d+)?/.exec(v.replace(/,/g, ""));
    if (m) return Number(m[0]);
  }
  return null;
}

function coerceConfidence(v: unknown): number | null {
  if (typeof v === "string") {
    const word = v.trim().toLowerCase();
    if (word === "high") return 0.9;
    if (word === "medium") return 0.6;
    if (word === "low") return 0.3;
  }
  const n = num(v);
  if (n === null) return null;
  if (n > 1 && n <= 100) return n / 100;
  return n >= 0 && n <= 1 ? n : null;
}

function coerceWeekdays(v: unknown): number[] {
  const tokens: string[] = [];
  if (Array.isArray(v)) {
    for (const item of v) if (typeof item === "string") tokens.push(item);
  } else if (typeof v === "string") {
    if (/^[MTWRFSU]+$/.test(v.trim())) {
      for (const ch of v.trim()) tokens.push(ch);
    } else {
      tokens.push(...v.split(/[\s,/&]+|\band\b/i));
    }
  }
  const letter: Record<string, number> = { M: 1, T: 2, W: 3, R: 4, F: 5, S: 6, U: 7 };
  const out = new Set<number>();
  for (const token of tokens) {
    const day = parseWeekday(token) ?? letter[token] ?? null;
    if (day) out.add(day);
  }
  return [...out].sort();
}

function coerceParameters(v: unknown): Record<string, string | number | boolean> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(v as Record<string, unknown>)) {
    if (Object.keys(out).length >= 12) break;
    const name = key
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40);
    if (!name) continue;
    if (typeof value === "number" && Number.isFinite(value)) out[name] = value;
    else if (typeof value === "boolean") out[name] = value;
    else if (typeof value === "string" && value.trim()) out[name] = value.trim().slice(0, 200);
  }
  return Object.keys(out).length > 0 ? out : null;
}

function pickEnum<T extends readonly string[]>(
  v: unknown,
  allowed: T,
  fallback: T[number],
): T[number] {
  const s =
    typeof v === "string"
      ? v
          .trim()
          .toLowerCase()
          .replace(/[\s-]+/g, "_")
      : "";
  return (allowed as readonly string[]).includes(s) ? (s as T[number]) : fallback;
}

/** Validate and normalise one model reply for one chunk. */
export function validateModelOutput(raw: unknown, ctx: ValidationContext): ValidationResult {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "The reply was not a JSON object." };
  }
  const top = raw as Record<string, unknown>;
  if (!Array.isArray(top["records"])) {
    return { ok: false, error: 'The reply has no "records" array.' };
  }

  const c = (top["course"] && typeof top["course"] === "object" ? top["course"] : {}) as Record<
    string,
    unknown
  >;
  const course: CourseInfo = {
    code: str(c["code"], 40),
    name: str(c["name"], 200),
    instructor: str(c["instructor"], 120),
    term: str(c["term"], 60),
  };

  const records: StagedRecord[] = [];
  const dropped: DroppedRecord[] = [];

  for (const item of top["records"]) {
    const result = normaliseRecord(item, ctx);
    if ("dropped" in result) dropped.push({ reason: result.dropped });
    else records.push(result.record);
  }
  return { ok: true, course, records, dropped };
}

function normaliseRecord(
  item: unknown,
  ctx: ValidationContext,
): { record: StagedRecord } | { dropped: string } {
  if (!item || typeof item !== "object" || Array.isArray(item)) return { dropped: "not an object" };
  const r = item as Record<string, unknown>;
  const type = typeof r["type"] === "string" ? r["type"].trim().toLowerCase() : "";
  if (!(RECORD_KINDS as readonly string[]).includes(type))
    return { dropped: "unknown record type" };
  let kind = type as RecordKind;

  const reasons: string[] = [];
  const quote = str(r["source_quote"], MAX_QUOTE) ?? "";
  const quoteFound = quote !== "" && looseIncludes(ctx.chunk.text, quote);

  // A "class meeting" whose own quote names a calendar date is a one-off session out of a
  // schedule table ("9/17 | Thursday | Synthesis Exercise"), not a weekly pattern. Left as a
  // meeting its date would be dropped, because meetings carry only weekdays, so it becomes a
  // dated item instead.
  let oneOffDate: string | null = null;
  if (kind === "class_meeting") {
    const quoted = parseDate(quote, ctx.referenceYear);
    if (quoted.date !== null) {
      kind = "deadline";
      oneOffDate = quoted.date;
    }
  }

  let confidence = coerceConfidence(r["confidence"]);
  if (confidence === null) {
    confidence = 0.5;
    reasons.push("The reader gave no confidence");
  }
  if (!quoteFound) {
    confidence = Math.min(confidence, 0.3);
    reasons.push(
      quote === "" ? "No source text was quoted" : "Quoted text was not found in the source",
    );
  }

  let title = str(r["title"], 300);
  let subtype = "other";
  let description = str(r["description"] ?? r["rule_text"], 2000);
  let date: string | null = null;
  let startTime: string | null = null;
  let endTime: string | null = null;
  let weekdays: number[] | null = null;
  let location: string | null = str(r["location"], 200);
  let points: number | null = null;
  let weight: number | null = null;
  let parameters: Record<string, string | number | boolean> | null = null;

  const readDate = (value: unknown) => {
    const text = typeof value === "string" ? value : "";
    if (!text.trim()) return null;
    const parsed = parseDate(text, ctx.referenceYear);
    if (parsed.date === null) {
      reasons.push("Date could not be read");
      return null;
    }
    if (Math.abs(Number(parsed.date.slice(0, 4)) - ctx.referenceYear) > 2) {
      reasons.push("Date is in an unusual year");
    }
    return parsed.date;
  };

  if (kind === "deadline") {
    subtype = pickEnum(r["subtype"], DEADLINE_SUBTYPES, "other");
    date = oneOffDate ?? readDate(r["date"] ?? r["due_date"]);
    startTime = parseTime(
      typeof r["time"] === "string"
        ? r["time"]
        : typeof r["start_time"] === "string"
          ? r["start_time"]
          : null,
    );
    points = clamp(num(r["points"]), 0, 100_000);
    weight = clamp(num(r["weight_percent"] ?? r["weight"]), 0, 100);
    // A reclassified session keeps where it happens; an ordinary deadline has no location.
    if (oneOffDate === null) location = null;
    if (date === null && !reasons.includes("Date could not be read"))
      reasons.push("No date stated");
  } else if (kind === "exam") {
    subtype = pickEnum(r["subtype"], EXAM_SUBTYPES, "exam");
    date = readDate(r["date"]);
    startTime = parseTime(typeof r["start_time"] === "string" ? r["start_time"] : null);
    endTime = parseTime(typeof r["end_time"] === "string" ? r["end_time"] : null);
    weight = clamp(num(r["weight_percent"] ?? r["weight"]), 0, 100);
    if (date === null && !reasons.includes("Date could not be read"))
      reasons.push("No date stated");
  } else if (kind === "class_meeting") {
    subtype = "class";
    title = title ?? "Class meeting";
    const days = coerceWeekdays(r["weekdays"] ?? r["days"]);
    if (days.length === 0) return { dropped: "class meeting without a weekday" };
    weekdays = days;
    startTime = parseTime(typeof r["start_time"] === "string" ? r["start_time"] : null);
    endTime = parseTime(typeof r["end_time"] === "string" ? r["end_time"] : null);
    description = null;
  } else {
    subtype = pickEnum(r["category"], POLICY_CATEGORIES, "other");
    parameters = coerceParameters(r["parameters"]);
    if (!description) return { dropped: "policy without rule text" };
    title = title ?? subtype.replace(/_/g, " ");
    location = null;
  }

  if (!title) return { dropped: "missing title" };

  if (date !== null && quoteFound && !quoteMentionsDate(quote, date)) {
    reasons.push("Date does not appear in the quoted text");
    confidence = Math.min(confidence, 0.5);
  }
  if (confidence < LOW_CONFIDENCE && !reasons.some((x) => /confidence|quoted|quote/i.test(x))) {
    reasons.push("Low confidence");
  }

  const candidate = {
    kind,
    subtype,
    title,
    description,
    date,
    start_time: startTime,
    end_time: endTime,
    weekdays,
    location,
    points,
    weight,
    parameters,
    confidence: Math.round(confidence * 100) / 100,
    needs_review: reasons.length > 0,
    review_reason: reasons.length > 0 ? reasons.join("; ").slice(0, 400) : null,
    source_quote: quote,
    source_section: sectionForQuote(ctx.chunk, quoteFound ? quote : ""),
    source_chunk_id: ctx.chunk.id,
  };

  const parsed = stagedSchema.safeParse(candidate);
  if (!parsed.success) {
    return { dropped: `failed validation: ${parsed.error.issues[0]?.path.join(".") ?? "record"}` };
  }
  return { record: parsed.data };
}

function clamp(v: number | null, min: number, max: number): number | null {
  return v !== null && v >= min && v <= max ? v : null;
}

/** Collapses the same fact reported twice (overlapping chunks, repeated in the syllabus). */
export function dedupeKey(r: StagedRecord): string {
  const title = r.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return [r.kind, title, r.date ?? "", (r.weekdays ?? []).join(""), r.start_time ?? ""].join("|");
}
