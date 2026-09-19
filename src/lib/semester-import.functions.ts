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
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { parseItemDate } from "@/lib/import-dates";

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
});

const itemSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().nullable().optional(),
  date: z.string().nullable().optional(),
  due_date: z.string().nullable().optional(),
  weight: z.string().nullable().optional(),
  confidence: z.number().min(0).max(1).optional(),
  source: sourceSchema,
});

const itemList = z.array(itemSchema).default([]);

const saveInputSchema = z.object({
  importId: z.string().min(1).max(200),
  sourceName: z.string().min(1).max(300),
  /** Concatenated document text, stored so the source survives any later edit or rejection. */
  documentText: z.string().max(400_000),
  documentTitle: z.string().nullable().optional(),
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

export type SaveCourseImportResult =
  | {
      ok: true;
      courseId: string;
      courseName: string;
      documentId: string;
      itemsSaved: number;
      examsSaved: number;
      needsAttention: number;
    }
  | { ok: false; error: string };

type Item = z.infer<typeof itemSchema>;

/** Low-confidence or unreadable timing is surfaced to the student instead of silently kept. */
const LOW_CONFIDENCE = 0.5;

function reviewFor(
  item: Item,
  ambiguousDate: boolean,
): {
  review_status: "approved" | "needs_attention";
  needs_attention_reason: string | null;
} {
  if (ambiguousDate) {
    return { review_status: "needs_attention", needs_attention_reason: "Date could not be read" };
  }
  if (item.confidence !== undefined && item.confidence < LOW_CONFIDENCE) {
    return { review_status: "needs_attention", needs_attention_reason: "Low confidence" };
  }
  return { review_status: "approved", needs_attention_reason: null };
}

/**
 * The date for an item: what the model reported, or failing that the date literally written
 * in the sentence the item was quoted from. Nothing is inferred beyond what the text says.
 */
function dateFor(item: Item, year: number, preferDue: boolean) {
  const stated = preferDue ? (item.due_date ?? item.date) : (item.date ?? item.due_date);
  const parsed = parseItemDate(stated, year);
  if (parsed.date !== null) return parsed;
  if ((stated ?? "").trim().length > 0) return parsed;
  return parseItemDate(item.source.sourceText, year);
}

function referenceYearFrom(semester: string | null): number {
  const match = /(20\d{2})/.exec(semester ?? "");
  return match ? Number(match[1]) : new Date().getUTCFullYear();
}

/* ------------------------------------------------------------------ */
/* Save                                                                */
/* ------------------------------------------------------------------ */

export const saveCourseImport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => saveInputSchema.parse(input))
  .handler(async ({ data, context }): Promise<SaveCourseImportResult> => {
    const { supabase, userId } = context;
    const extraction = data.extraction;
    const year = referenceYearFrom(extraction.course.semester);

    try {
      // Current semester, if the student set one during onboarding.
      const { data: term } = await supabase
        .from("terms")
        .select("id")
        .eq("user_id", userId)
        .eq("is_current", true)
        .limit(1)
        .maybeSingle();

      const courseName =
        extraction.course.course_name ??
        data.documentTitle ??
        data.sourceName.replace(/\.epub$/i, "");

      // One course per upload; re-running the same upload updates it instead of duplicating.
      const { data: existing } = await supabase
        .from("courses")
        .select("id")
        .eq("user_id", userId)
        .eq("external_id", data.importId)
        .maybeSingle();

      let courseId = existing?.id ?? null;
      if (courseId) {
        await supabase
          .from("courses")
          .update({
            name: courseName,
            course_code: extraction.course.course_code,
            instructor: extraction.course.instructor,
          })
          .eq("id", courseId)
          .eq("user_id", userId);
      } else {
        const { data: inserted, error } = await supabase
          .from("courses")
          .insert({
            user_id: userId,
            term_id: term?.id ?? null,
            name: courseName,
            course_code: extraction.course.course_code,
            instructor: extraction.course.instructor,
            source: "epub_import",
            external_id: data.importId,
          })
          .select("id")
          .single();
        if (error || !inserted) throw error ?? new Error("Course could not be created");
        courseId = inserted.id;
      }

      // The imported document itself, kept whole so rejecting an item never loses its source.
      const { data: document, error: documentError } = await supabase
        .from("course_documents")
        .insert({
          user_id: userId,
          course_id: courseId,
          filename: data.sourceName,
          file_type: "application/epub+zip",
          processing_status: "completed",
          raw_text: data.documentText,
        })
        .select("id")
        .single();
      if (documentError || !document) throw documentError ?? new Error("Document not stored");

      // Replace any rows from a previous run of this same upload.
      for (const table of ["assignments", "exams", "calendar_events", "course_policies"] as const) {
        await supabase.from(table).delete().eq("user_id", userId).eq("course_id", courseId);
      }

      let needsAttention = 0;
      const common = (item: Item, ambiguous: boolean) => {
        const review = reviewFor(item, ambiguous);
        if (review.review_status === "needs_attention") needsAttention += 1;
        return {
          user_id: userId,
          course_id: courseId,
          title: item.title,
          source_document_id: document.id,
          source_text: item.source.sourceText,
          source_chunk_key: item.source.chunkId,
          ai_generated: true,
          ai_confidence: item.confidence ?? null,
          ...review,
        };
      };

      // assignments / quizzes / projects -> assignments
      const assignmentRows = [
        ...extraction.assignments,
        ...extraction.quizzes,
        ...extraction.projects,
      ].map((item) => {
        const parsed = dateFor(item, year, true);
        return {
          ...common(item, parsed.date === null && parsed.ambiguous),
          description: item.description ?? null,
          due_date: parsed.date,
        };
      });

      const examRows = extraction.exams.map((item) => {
        const parsed = dateFor(item, year, false);
        return {
          ...common(item, parsed.date === null && parsed.ambiguous),
          description: item.description ?? null,
          exam_date: parsed.date,
        };
      });

      const eventRows = [...extraction.important_dates, ...extraction.readings].map((item) => {
        const parsed = dateFor(item, year, false);
        return {
          ...common(item, parsed.date === null && parsed.ambiguous),
          description: item.description ?? null,
          event_type: "event",
          all_day: true,
          starts_at: parsed.date ? `${parsed.date}T00:00:00Z` : null,
        };
      });

      const policyRows = [
        ...extraction.grading.map((item) => ({ item, type: "grading" })),
        ...extraction.policies.map((item) => ({ item, type: "general" })),
        ...extraction.other_important_information.map((item) => ({ item, type: "other" })),
      ].map(({ item, type }) => ({
        ...common(item, false),
        policy_type: type,
        content: [item.description, item.weight].filter(Boolean).join(" · ") || null,
      }));

      if (assignmentRows.length > 0) {
        const { error } = await supabase.from("assignments").insert(assignmentRows);
        if (error) throw error;
      }
      if (examRows.length > 0) {
        const { error } = await supabase.from("exams").insert(examRows);
        if (error) throw error;
      }
      if (eventRows.length > 0) {
        const { error } = await supabase.from("calendar_events").insert(eventRows);
        if (error) throw error;
      }
      if (policyRows.length > 0) {
        const { error } = await supabase.from("course_policies").insert(policyRows);
        if (error) throw error;
      }

      const itemsSaved =
        assignmentRows.length + examRows.length + eventRows.length + policyRows.length;

      console.log("[semester-import] saved", {
        userId,
        courseId,
        itemsSaved,
        needsAttention,
      });

      return {
        ok: true,
        courseId,
        courseName,
        documentId: document.id,
        itemsSaved,
        examsSaved: examRows.length,
        needsAttention,
      };
    } catch (error) {
      console.error("[semester-import] save failed", {
        reason: error instanceof Error ? error.message : String(error),
      });
      return { ok: false, error: "Your courses could not be saved. Try that file again." };
    }
  });

/* ------------------------------------------------------------------ */
/* Review of the few items that need attention                          */
/* ------------------------------------------------------------------ */

export const reviewKinds = ["assignment", "exam", "event", "policy"] as const;
export type ReviewKind = (typeof reviewKinds)[number];

const tableFor: Record<
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
