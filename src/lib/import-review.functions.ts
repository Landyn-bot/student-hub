/**
 * Review-before-commit for imported courses.
 *
 * The import-epub edge function stages what the model extracted in `import_batches` and
 * `import_staged_items`. This module is the student's side of that: read a batch, edit, add and
 * remove records, and finally confirm. Only `confirmImportBatch` writes to the tables the
 * dashboard reads, so nothing unverified ever reaches the planner.
 *
 * Every query is scoped to the signed-in student, and row-level security backs that up.
 */
import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import {
  persistCourseImport,
  type SaveCourseImportInput,
  type SaveCourseImportResult,
} from "@/lib/semester-import.functions";

type Db = SupabaseClient<Database>;
type ItemInput = NonNullable<SaveCourseImportInput["extraction"]["assignments"]>[number];
type BatchRow = Database["public"]["Tables"]["import_batches"]["Row"];
type StagedRow = Database["public"]["Tables"]["import_staged_items"]["Row"];

export type StagedKind = "deadline" | "exam" | "class_meeting" | "policy";
export type BatchStatus = "processing" | "ready" | "partial" | "failed" | "confirmed" | "discarded";

export type ImportBatchSummary = {
  id: string;
  filename: string;
  status: BatchStatus;
  chunksTotal: number;
  chunksDone: number;
  chunksFailed: number;
  errorCode: string | null;
  errorMessage: string | null;
  warnings: string[];
  model: string | null;
  course: {
    code: string | null;
    name: string | null;
    instructor: string | null;
    term: string | null;
  };
  createdAt: string;
  /** True when a "processing" batch has stopped reporting progress and can be resumed. */
  stalled: boolean;
};

export type StagedItem = {
  id: string;
  kind: StagedKind;
  subtype: string;
  title: string;
  description: string | null;
  date: string | null;
  startTime: string | null;
  endTime: string | null;
  weekdays: number[] | null;
  location: string | null;
  points: number | null;
  weight: number | null;
  parameters: Record<string, string | number | boolean> | null;
  confidence: number | null;
  needsReview: boolean;
  reviewReason: string | null;
  sourceQuote: string | null;
  sourceSection: string | null;
  removed: boolean;
  edited: boolean;
  addedByUser: boolean;
};

export type ImportBatchDetail = { batch: ImportBatchSummary; items: StagedItem[] };

const STALE_MS = 3 * 60_000;

function toSummary(row: BatchRow): ImportBatchSummary {
  const warnings = Array.isArray(row.warnings)
    ? row.warnings.filter((w): w is string => typeof w === "string")
    : [];
  return {
    id: row.id,
    filename: row.filename,
    status: row.status as BatchStatus,
    chunksTotal: row.chunks_total,
    chunksDone: row.chunks_done,
    chunksFailed: row.chunks_failed,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    warnings,
    model: row.model,
    course: {
      code: row.course_code,
      name: row.course_name,
      instructor: row.course_instructor,
      term: row.course_term,
    },
    createdAt: row.created_at,
    stalled:
      row.status === "processing" && Date.now() - new Date(row.heartbeat_at).getTime() > STALE_MS,
  };
}

const hhmm = (value: string | null) => (value ? value.slice(0, 5) : null);

function toItem(row: StagedRow): StagedItem {
  const parameters =
    row.parameters && typeof row.parameters === "object" && !Array.isArray(row.parameters)
      ? (row.parameters as Record<string, string | number | boolean>)
      : null;
  return {
    id: row.id,
    kind: row.kind as StagedKind,
    subtype: row.subtype,
    title: row.title,
    description: row.description,
    date: row.item_date,
    startTime: hhmm(row.start_time),
    endTime: hhmm(row.end_time),
    weekdays: row.weekdays,
    location: row.location,
    points: row.points,
    weight: row.weight,
    parameters,
    confidence: row.confidence,
    needsReview: row.needs_review,
    reviewReason: row.review_reason,
    sourceQuote: row.source_quote,
    sourceSection: row.source_section,
    removed: row.user_status === "removed",
    edited: row.user_status === "edited",
    addedByUser: row.added_by_user,
  };
}

async function loadBatch(supabase: Db, userId: string, batchId: string): Promise<BatchRow | null> {
  const { data } = await supabase
    .from("import_batches")
    .select("*")
    .eq("id", batchId)
    .eq("user_id", userId)
    .maybeSingle();
  return data;
}

const idInput = z.object({ batchId: z.string().uuid() });

/** One batch and, once reading has stopped, its staged records. Polled while processing. */
export const getImportBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => idInput.parse(input))
  .handler(async ({ data, context }): Promise<ImportBatchDetail | null> => {
    const { supabase, userId } = context;
    // The stored chunk text is large and not needed here.
    const { data: row } = await supabase
      .from("import_batches")
      .select(
        "id, user_id, filename, file_hash, file_size, source_kind, status, stage, chunks_total, chunks_done, chunks_failed, done_chunk_ids, error_code, error_message, model, course_code, course_name, course_instructor, course_term, warnings, heartbeat_at, confirmed_at, confirmed_course_id, created_at, updated_at",
      )
      .eq("id", data.batchId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!row) return null;

    const batch = toSummary({ ...row, ir: null });
    if (batch.status === "processing") return { batch, items: [] };

    const { data: items } = await supabase
      .from("import_staged_items")
      .select("*")
      .eq("batch_id", data.batchId)
      .eq("user_id", userId)
      .order("created_at", { ascending: true });
    return { batch, items: (items ?? []).map(toItem) };
  });

/** Batches the student has not finished with, so a review can be picked up again. */
export const listOpenImportBatches = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ImportBatchSummary[]> => {
    const { supabase, userId } = context;
    const { data } = await supabase
      .from("import_batches")
      .select(
        "id, user_id, filename, file_hash, file_size, source_kind, status, stage, chunks_total, chunks_done, chunks_failed, done_chunk_ids, error_code, error_message, model, course_code, course_name, course_instructor, course_term, warnings, heartbeat_at, confirmed_at, confirmed_course_id, created_at, updated_at",
      )
      .eq("user_id", userId)
      .in("status", ["processing", "ready", "partial"])
      .order("created_at", { ascending: false })
      .limit(20);
    return (data ?? []).map((row) => toSummary({ ...row, ir: null }));
  });

/* ------------------------------------------------------------------ */
/* Editing                                                             */
/* ------------------------------------------------------------------ */

const dateField = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const [y, m, d] = value.split("-").map(Number);
    const probe = new Date(Date.UTC(y!, m! - 1, d));
    return probe.getUTCMonth() === m! - 1 && probe.getUTCDate() === d;
  }, "Not a real date")
  .nullable();
const timeField = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
  .nullable();

const editable = z.object({
  title: z.string().trim().min(1).max(300),
  description: z.string().trim().max(2000).nullable(),
  subtype: z.string().trim().min(1).max(40),
  date: dateField,
  startTime: timeField,
  endTime: timeField,
  weekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7).nullable(),
  location: z.string().trim().max(200).nullable(),
  points: z.number().min(0).max(100_000).nullable(),
  weight: z.number().min(0).max(100).nullable(),
});

const editablePartial = editable.partial();

const columns = (patch: z.infer<typeof editablePartial>) => ({
  ...(patch.title !== undefined ? { title: patch.title } : {}),
  ...(patch.description !== undefined ? { description: patch.description || null } : {}),
  ...(patch.subtype !== undefined ? { subtype: patch.subtype } : {}),
  ...(patch.date !== undefined ? { item_date: patch.date } : {}),
  ...(patch.startTime !== undefined ? { start_time: patch.startTime } : {}),
  ...(patch.endTime !== undefined ? { end_time: patch.endTime } : {}),
  ...(patch.weekdays !== undefined ? { weekdays: patch.weekdays } : {}),
  ...(patch.location !== undefined ? { location: patch.location || null } : {}),
  ...(patch.points !== undefined ? { points: patch.points } : {}),
  ...(patch.weight !== undefined ? { weight: patch.weight } : {}),
});

const updateInput = z.object({
  id: z.string().uuid(),
  patch: editablePartial,
});

/** Change a staged record. Editing counts as the student having looked at it. */
export const updateStagedItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => updateInput.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: boolean }> => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("import_staged_items")
      .update({
        ...columns(data.patch),
        user_status: "edited",
        needs_review: false,
      })
      .eq("id", data.id)
      .eq("user_id", userId);
    return { ok: !error };
  });

const removeInput = z.object({ id: z.string().uuid(), removed: z.boolean() });

/** Remove a record from the commit (or bring it back). Nothing is deleted until confirm. */
export const setStagedItemRemoved = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => removeInput.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: boolean }> => {
    const { supabase, userId } = context;
    const { data: row } = await supabase
      .from("import_staged_items")
      .select("added_by_user")
      .eq("id", data.id)
      .eq("user_id", userId)
      .maybeSingle();
    if (!row) return { ok: false };
    const { error } = await supabase
      .from("import_staged_items")
      .update({ user_status: data.removed ? "removed" : row.added_by_user ? "edited" : "pending" })
      .eq("id", data.id)
      .eq("user_id", userId);
    return { ok: !error };
  });

const acknowledgeInput = z.object({ ids: z.array(z.string().uuid()).min(1).max(500) });

/** "This looks right": clears the doubt flag without changing the record. */
export const acknowledgeStagedItems = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => acknowledgeInput.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: boolean }> => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("import_staged_items")
      .update({ needs_review: false })
      .in("id", data.ids)
      .eq("user_id", userId);
    return { ok: !error };
  });

const addInput = z.object({
  batchId: z.string().uuid(),
  kind: z.enum(["deadline", "exam", "class_meeting", "policy"]),
  fields: editablePartial,
});

/** A record the student adds by hand. Also the way forward when reading failed. */
export const addStagedItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => addInput.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: boolean; item?: StagedItem }> => {
    const { supabase, userId } = context;
    const batch = await loadBatch(supabase, userId, data.batchId);
    if (!batch || !["ready", "partial", "failed"].includes(batch.status)) return { ok: false };

    const title = data.fields.title ?? "";
    if (title.trim().length === 0) return { ok: false };
    if (data.kind === "class_meeting" && !(data.fields.weekdays && data.fields.weekdays.length)) {
      return { ok: false };
    }

    const { data: inserted, error } = await supabase
      .from("import_staged_items")
      .insert({
        batch_id: data.batchId,
        user_id: userId,
        kind: data.kind,
        subtype:
          data.fields.subtype ??
          (data.kind === "exam"
            ? "exam"
            : data.kind === "policy"
              ? "other"
              : data.kind === "class_meeting"
                ? "class"
                : "assignment"),
        title,
        confidence: 1,
        needs_review: false,
        user_status: "edited",
        added_by_user: true,
        ...columns(data.fields),
      })
      .select("*")
      .single();
    if (error || !inserted) return { ok: false };
    return { ok: true, item: toItem(inserted) };
  });

const courseInput = z.object({
  batchId: z.string().uuid(),
  name: z.string().trim().min(1).max(200),
  code: z.string().trim().max(40).nullable(),
  instructor: z.string().trim().max(120).nullable(),
  term: z.string().trim().max(60).nullable(),
});

export const updateBatchCourse = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => courseInput.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: boolean }> => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("import_batches")
      .update({
        course_name: data.name,
        course_code: data.code || null,
        course_instructor: data.instructor || null,
        course_term: data.term || null,
      })
      .eq("id", data.batchId)
      .eq("user_id", userId)
      .in("status", ["ready", "partial", "failed"]);
    return { ok: !error };
  });

/** Throw the import away. The staged records and the stored text go with it. */
export const discardImportBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => idInput.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: boolean }> => {
    const { supabase, userId } = context;
    await supabase
      .from("import_staged_items")
      .delete()
      .eq("batch_id", data.batchId)
      .eq("user_id", userId);
    const { error } = await supabase
      .from("import_batches")
      .update({ status: "discarded", ir: null })
      .eq("id", data.batchId)
      .eq("user_id", userId)
      .neq("status", "confirmed");
    return { ok: !error };
  });

/** When reading failed, carry on by hand: the batch becomes an empty, editable review. */
export const continueManually = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => idInput.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: boolean }> => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("import_batches")
      .update({ status: "ready" })
      .eq("id", data.batchId)
      .eq("user_id", userId)
      .eq("status", "failed");
    return { ok: !error };
  });

/* ------------------------------------------------------------------ */
/* Confirm                                                             */
/* ------------------------------------------------------------------ */

export type ConfirmResult =
  | {
      ok: true;
      courseName: string;
      itemsSaved: number;
      examsSaved: number;
      classMeetingsSaved: number;
      merged: number;
      autoResolved: number;
      needsAttention: number;
    }
  | { ok: false; error: string };

function sourceFor(row: StagedRow, filename: string) {
  return {
    sourceName: filename,
    chapterIndex: 0,
    chapterTitle: row.source_section ?? "",
    chapterPath: "",
    chunkId: row.source_chunk_id ?? "",
    part: 1,
    totalParts: 1,
    sourceText: row.source_quote ?? "",
    ...(row.source_section ? { section: row.source_section } : {}),
  };
}

/**
 * Turns the student's reviewed records into the extraction the existing save path understands,
 * then saves through it, so conflict detection against what is already stored still applies.
 */
export const confirmImportBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => idInput.parse(input))
  .handler(async ({ data, context }): Promise<ConfirmResult> => {
    const { supabase, userId } = context;
    const batch = await loadBatch(supabase, userId, data.batchId);
    if (!batch) return { ok: false, error: "That import could not be found." };
    if (batch.status === "confirmed") return { ok: false, error: "This import is already saved." };
    if (!["ready", "partial", "failed"].includes(batch.status)) {
      return { ok: false, error: "This import is not ready to save yet." };
    }

    const { data: rows } = await supabase
      .from("import_staged_items")
      .select("*")
      .eq("batch_id", batch.id)
      .eq("user_id", userId)
      .neq("user_status", "removed")
      .order("created_at", { ascending: true });
    const staged = rows ?? [];
    if (staged.length === 0) return { ok: false, error: "There is nothing to save yet." };

    const courseName = (batch.course_name ?? "").trim() || batch.filename.replace(/\.[^.]+$/, "");

    const empty = (): ItemInput[] => [];
    const extraction = {
      course: {
        course_code: batch.course_code,
        course_name: courseName,
        instructor: batch.course_instructor,
        semester: batch.course_term,
      },
      assignments: empty(),
      exams: empty(),
      quizzes: empty(),
      projects: empty(),
      readings: empty(),
      important_dates: empty(),
      grading: empty(),
      policies: empty(),
      other_important_information: empty(),
    };
    const classMeetings: {
      title: string;
      weekdays: number[];
      start_time: string | null;
      end_time: string | null;
      location: string | null;
      confidence?: number;
      source: ReturnType<typeof sourceFor>;
      edited: boolean;
      userAdded: boolean;
    }[] = [];

    for (const row of staged) {
      const common = {
        title: row.title,
        description: row.description,
        date: row.item_date,
        due_date: row.item_date,
        weight: row.weight === null ? null : `${row.weight}%`,
        ...(row.confidence === null ? {} : { confidence: row.confidence }),
        source: sourceFor(row, batch.filename),
        time: hhmm(row.start_time),
        end_time: hhmm(row.end_time),
        location: row.location,
        points: row.points,
        subtype: row.subtype,
        parameters:
          row.parameters && typeof row.parameters === "object" && !Array.isArray(row.parameters)
            ? (row.parameters as Record<string, string | number | boolean>)
            : null,
        edited: row.user_status === "edited" && !row.added_by_user,
        userAdded: row.added_by_user,
      };

      if (row.kind === "deadline") {
        const list =
          row.subtype === "quiz"
            ? extraction.quizzes
            : row.subtype === "project"
              ? extraction.projects
              : row.subtype === "reading"
                ? extraction.readings
                : extraction.assignments;
        list.push(common);
      } else if (row.kind === "exam") {
        extraction.exams.push(common);
      } else if (row.kind === "policy") {
        extraction.policies.push(common);
      } else if (row.kind === "class_meeting" && row.weekdays && row.weekdays.length > 0) {
        classMeetings.push({
          title: row.title,
          weekdays: row.weekdays,
          start_time: hhmm(row.start_time),
          end_time: hhmm(row.end_time),
          location: row.location,
          ...(row.confidence === null ? {} : { confidence: row.confidence }),
          source: sourceFor(row, batch.filename),
          edited: common.edited,
          userAdded: common.userAdded,
        });
      }
    }

    const chunks =
      batch.ir && typeof batch.ir === "object" && "chunks" in batch.ir
        ? ((batch.ir as { chunks?: { text?: string }[] }).chunks ?? [])
        : [];
    const documentText = chunks
      .map((chunk) => chunk.text ?? "")
      .join("\n\n")
      .slice(0, 400_000);
    const metadata =
      batch.ir && typeof batch.ir === "object" && "metadata" in batch.ir
        ? ((batch.ir as { metadata?: { title?: string | null } }).metadata ?? null)
        : null;

    const saved: SaveCourseImportResult = await persistCourseImport(supabase, userId, {
      importId: `imp_${batch.id}`,
      sourceName: batch.filename,
      documentText,
      documentTitle: metadata?.title ?? null,
      courseNameOverride: courseName,
      reviewed: true,
      classMeetings,
      extraction,
    });
    if (!saved.ok) return { ok: false, error: saved.error };

    await supabase
      .from("import_batches")
      .update({
        status: "confirmed",
        confirmed_at: new Date().toISOString(),
        confirmed_course_id: saved.courseId,
        ir: null,
      })
      .eq("id", batch.id)
      .eq("user_id", userId);

    return {
      ok: true,
      courseName: saved.courseName,
      itemsSaved: saved.itemsSaved,
      examsSaved: saved.examsSaved,
      classMeetingsSaved: saved.classMeetingsSaved,
      merged: saved.merged,
      autoResolved: saved.autoResolved,
      needsAttention: saved.needsAttention,
    };
  });
