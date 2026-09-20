/**
 * Semester import persistence.
 *
 * Extraction results arrive here already structured and already carrying provenance. This
 * layer organizes them by course and writes them into the student's own semester data:
 *
 *   normalized content -> analysis -> (here) organize + save -> planner
 *
 * Rules that must hold:
 *  - every saved row keeps the document, chunk and verbatim sentence it came from;
 *  - anything the document does not state stays null, never guessed;
 *  - rejected rows stay in the database but never enter active planner queries;
 *  - a student edit is recorded on the row without touching the stored source text.
 */
import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { Database } from "@/integrations/supabase/types";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { parseItemDate } from "@/lib/import-dates";
// Mirrors ExistingItem in the server-only reconciliation engine, which is loaded
// inside the handler so no server module is referenced from this client-reachable file.
type ExistingItem = {
  id: string;
  title: string;
  date: string | null;
  sourceText: string | null;
  documentId: string | null;
};

/* ------------------------------------------------------------------ */
/* Contract                                                            */
/* ------------------------------------------------------------------ */

const sourceSchema = z.object({
  sourceName: z.string(),
  chapterIndex: z.number().int().min(0),
  chapterTitle: z.string(),
  chapterPath: z.string(),
  chunkId: z.string(),
  part: z.number().int().min(1),
  totalParts: z.number().int().min(1),
  sourceText: z.string(),
  /** Heading breadcrumb the fact sits under, e.g. "Syllabus › Late Work". */
  section: z.string().max(600).optional(),
});

const itemSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().nullable().optional(),
  date: z.string().nullable().optional(),
  due_date: z.string().nullable().optional(),
  weight: z.string().nullable().optional(),
  confidence: z.number().min(0).max(1).optional(),
  source: sourceSchema,
  /** Fields carried by records that were reviewed on the review screen. */
  time: z.string().nullable().optional(),
  end_time: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  points: z.number().nullable().optional(),
  subtype: z.string().max(40).optional(),
  parameters: z
    .record(z.union([z.string(), z.number(), z.boolean()]))
    .nullable()
    .optional(),
  edited: z.boolean().optional(),
  userAdded: z.boolean().optional(),
});

const itemList = z.array(itemSchema).default([]);

const meetingSchema = z.object({
  title: z.string().min(1).max(200),
  weekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7),
  start_time: z.string().nullable().optional(),
  end_time: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  confidence: z.number().min(0).max(1).optional(),
  source: sourceSchema,
  edited: z.boolean().optional(),
  userAdded: z.boolean().optional(),
});

const saveInputSchema = z.object({
  importId: z.string().min(1).max(200),
  sourceName: z.string().min(1).max(300),
  /** Concatenated document text, stored so the source survives any later edit or rejection. */
  documentText: z.string().max(400_000),
  documentTitle: z.string().nullable().optional(),
  /** The name the student confirmed for the course; wins over anything extracted. */
  courseNameOverride: z.string().trim().min(1).max(200).optional(),
  /**
   * True when the student has already reviewed every item (the review screen). Reviewed items
   * are saved as approved instead of being re-flagged for low confidence or unreadable dates.
   */
  reviewed: z.boolean().default(false),
  classMeetings: z.array(meetingSchema).default([]),
  extraction: z.object({
    course: z.object({
      course_code: z.string().nullable(),
      course_name: z.string().nullable(),
      instructor: z.string().nullable(),
      semester: z.string().nullable(),
    }),
    assignments: itemList,
    exams: itemList,
    quizzes: itemList,
    projects: itemList,
    readings: itemList,
    important_dates: itemList,
    grading: itemList,
    policies: itemList,
    other_important_information: itemList,
  }),
});

export type SaveCourseImportInput = z.input<typeof saveInputSchema>;

/**
 * What happened to one extracted item once it met the data already stored. Returned so the
 * developer debug view can show the final structured result beside the interpretation.
 */
export type SaveDecision = {
  kind: ReviewKind;
  title: string;
  action: "insert" | "merge" | "supersede" | "attention";
  date: string | null;
  detail: string;
  sourceText: string;
};

export type SaveCourseImportResult =
  | {
      ok: true;
      courseId: string;
      courseName: string;
      documentId: string;
      itemsSaved: number;
      examsSaved: number;
      classMeetingsSaved: number;
      /** Repeats of something already stored, folded into the existing item. */
      merged: number;
      /** Disagreements the system settled on its own from the source wording. */
      autoResolved: number;
      needsAttention: number;
      decisions: SaveDecision[];
    }
  | { ok: false; error: string };

/** The parsed save input and one item of it, shared with the server-only writer. */
export type SaveCourseImportData = z.infer<typeof saveInputSchema>;
export type SaveCourseImportItem = z.infer<typeof itemSchema>;

/* ------------------------------------------------------------------ */
/* Save                                                                */
/* ------------------------------------------------------------------ */

export const saveCourseImport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => saveInputSchema.parse(input))
  .handler(async ({ data, context }): Promise<SaveCourseImportResult> => {
    // Server-only import: the writer reaches into conflict reconciliation, which must never
    // be pulled into a client bundle.
    const { persistCourseImport } = await import("@/lib/server/course-import.server");
    return persistCourseImport(context.supabase, context.userId, data);
  });

/* ------------------------------------------------------------------ */
/* Review of the few items that need attention                          */
/* ------------------------------------------------------------------ */

export const reviewKinds = ["assignment", "exam", "event", "policy"] as const;
export type ReviewKind = (typeof reviewKinds)[number];

export const tableFor: Record<
  ReviewKind,
  "assignments" | "exams" | "calendar_events" | "course_policies"
> = {
  assignment: "assignments",
  exam: "exams",
  event: "calendar_events",
  policy: "course_policies",
};

export type AttentionItem = {
  id: string;
  kind: ReviewKind;
  courseId: string | null;
  courseName: string | null;
  title: string;
  date: string | null;
  reason: string | null;
  confidence: number | null;
  sourceText: string | null;
  editedByUser: boolean;
};

/** Items the student still has to settle. Rejected rows are never returned. */
export const listAttentionItems = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AttentionItem[]> => {
    const { supabase, userId } = context;

    const [assignments, exams, events, policies] = await Promise.all([
      supabase
        .from("assignments")
        .select(
          "id, title, due_date, needs_attention_reason, ai_confidence, source_text, edited_by_user, course_id, courses(name)",
        )
        .eq("user_id", userId)
        .eq("review_status", "needs_attention"),
      supabase
        .from("exams")
        .select(
          "id, title, exam_date, needs_attention_reason, ai_confidence, source_text, edited_by_user, course_id, courses(name)",
        )
        .eq("user_id", userId)
        .eq("review_status", "needs_attention"),
      supabase
        .from("calendar_events")
        .select(
          "id, title, starts_at, needs_attention_reason, ai_confidence, source_text, edited_by_user, course_id, courses(name)",
        )
        .eq("user_id", userId)
        .eq("review_status", "needs_attention"),
      supabase
        .from("course_policies")
        .select(
          "id, title, needs_attention_reason, ai_confidence, source_text, edited_by_user, course_id, courses(name)",
        )
        .eq("user_id", userId)
        .eq("review_status", "needs_attention"),
    ]);

    const courseName = (row: { courses?: { name: string } | null }): string | null =>
      row.courses?.name ?? null;

    const items: AttentionItem[] = [];
    for (const row of assignments.data ?? []) {
      items.push({
        id: row.id,
        kind: "assignment",
        courseId: row.course_id,
        courseName: courseName(row),
        title: row.title,
        date: row.due_date,
        reason: row.needs_attention_reason,
        confidence: row.ai_confidence,
        sourceText: row.source_text,
        editedByUser: row.edited_by_user,
      });
    }
    for (const row of exams.data ?? []) {
      items.push({
        id: row.id,
        kind: "exam",
        courseId: row.course_id,
        courseName: courseName(row),
        title: row.title,
        date: row.exam_date,
        reason: row.needs_attention_reason,
        confidence: row.ai_confidence,
        sourceText: row.source_text,
        editedByUser: row.edited_by_user,
      });
    }
    for (const row of events.data ?? []) {
      items.push({
        id: row.id,
        kind: "event",
        courseId: row.course_id,
        courseName: courseName(row),
        title: row.title,
        date: row.starts_at ? row.starts_at.slice(0, 10) : null,
        reason: row.needs_attention_reason,
        confidence: row.ai_confidence,
        sourceText: row.source_text,
        editedByUser: row.edited_by_user,
      });
    }
    for (const row of policies.data ?? []) {
      items.push({
        id: row.id,
        kind: "policy",
        courseId: row.course_id,
        courseName: courseName(row),
        title: row.title,
        date: null,
        reason: row.needs_attention_reason,
        confidence: row.ai_confidence,
        sourceText: row.source_text,
        editedByUser: row.edited_by_user,
      });
    }
    return items;
  });

const reviewInputSchema = z.object({
  kind: z.enum(reviewKinds),
  id: z.string().uuid(),
  action: z.enum(["approve", "reject", "edit"]),
  title: z.string().min(1).max(500).optional(),
  /** ISO yyyy-mm-dd, or null to say the date is genuinely unknown. */
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
});

/**
 * Approve, edit or reject one imported item. Editing records that the student changed it and
 * leaves `source_text` and the stored document untouched.
 */
export const reviewImportedItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => reviewInputSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: boolean; error?: string }> => {
    const { supabase, userId } = context;
    const table = tableFor[data.kind];

    const patch: Record<string, unknown> = {};
    if (data.action === "reject") {
      // The row stays, with its source text, but is now invisible to the planner.
      patch["review_status"] = "rejected";
    } else {
      patch["review_status"] = "approved";
      patch["needs_attention_reason"] = null;
    }

    if (data.title !== undefined || data.date !== undefined) {
      patch["edited_by_user"] = true;
      patch["edited_at"] = new Date().toISOString();
      if (data.title !== undefined) patch["title"] = data.title;
      if (data.date !== undefined) {
        if (data.kind === "assignment") patch["due_date"] = data.date;
        if (data.kind === "exam") patch["exam_date"] = data.date;
        if (data.kind === "event") patch["starts_at"] = data.date ? `${data.date}T00:00:00Z` : null;
      }
    }

    const { error } = await supabase
      .from(table)
      // The patch is built from a validated union above; the table varies by item kind.
      .update(patch as never)
      .eq("id", data.id)
      .eq("user_id", userId);

    if (error) {
      console.error("[semester-import] review failed", { reason: error.message });
      return { ok: false, error: "That change could not be saved." };
    }
    return { ok: true };
  });

const bulkInputSchema = z.object({
  /** "high_confidence_assignments" keeps uncertain items visible; nothing is hidden. */
  scope: z.enum(["high_confidence_assignments", "reviewed_items"]),
});

/** Bulk approvals that are safe: they never clear items whose timing is still unreadable. */
export const bulkApproveItems = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => bulkInputSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: boolean; approved: number }> => {
    const { supabase, userId } = context;
    let approved = 0;

    if (data.scope === "high_confidence_assignments") {
      const { data: rows } = await supabase
        .from("assignments")
        .update({ review_status: "approved", needs_attention_reason: null })
        .eq("user_id", userId)
        .eq("review_status", "needs_attention")
        .not("due_date", "is", null)
        .gte("ai_confidence", 0.8)
        .select("id");
      approved = rows?.length ?? 0;
    } else {
      // Items the student already edited: they have looked at these, so approving is safe.
      for (const table of ["assignments", "exams", "calendar_events", "course_policies"] as const) {
        const { data: rows } = await supabase
          .from(table)
          .update({ review_status: "approved", needs_attention_reason: null })
          .eq("user_id", userId)
          .eq("review_status", "needs_attention")
          .eq("edited_by_user", true)
          .select("id");
        approved += rows?.length ?? 0;
      }
    }

    return { ok: true, approved };
  });
