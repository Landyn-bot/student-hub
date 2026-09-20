/**
 * Persistence boundary. The handler talks to this interface only; production wires it to
 * Supabase with the *student's own* access token, so row-level security applies to every read
 * and write. The function never holds a service-role key.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { IrChunk, IrMetadata } from "./ir.ts";
import type { CourseInfo, StagedRecord } from "./schema.ts";

export type BatchStatus = "processing" | "ready" | "partial" | "failed" | "confirmed" | "discarded";

/** What is kept of the normalised course so a failed or partial import can be resumed. */
export interface StoredIr {
  metadata: IrMetadata;
  chunks: IrChunk[];
}

export interface BatchRow {
  id: string;
  user_id: string;
  filename: string;
  file_hash: string;
  file_size: number;
  source_kind: "epub" | "text";
  status: BatchStatus;
  stage: string;
  chunks_total: number;
  chunks_done: number;
  chunks_failed: number;
  done_chunk_ids: string[];
  error_code: string | null;
  error_message: string | null;
  model: string | null;
  course_code: string | null;
  course_name: string | null;
  course_instructor: string | null;
  course_term: string | null;
  ir: StoredIr | null;
  warnings: string[];
  heartbeat_at: string;
}

export type NewBatch = Pick<
  BatchRow,
  "filename" | "file_hash" | "file_size" | "source_kind" | "chunks_total" | "warnings" | "ir"
> & { course_name: string | null };

export type BatchPatch = Partial<
  Omit<BatchRow, "id" | "user_id" | "filename" | "file_hash" | "file_size" | "source_kind">
>;

export interface TermRow {
  name: string;
  starts_on: string | null;
  ends_on: string | null;
}

export interface Store {
  /** A batch for this file that is still being read or awaiting review. */
  findOpenBatchByHash(hash: string): Promise<BatchRow | null>;
  countProcessingSince(sinceIso: string): Promise<number>;
  createBatch(input: NewBatch): Promise<BatchRow>;
  getBatch(id: string): Promise<BatchRow | null>;
  /** False once the student has discarded or confirmed the batch, so background work can stop. */
  isOpen(id: string): Promise<boolean>;
  updateBatch(id: string, patch: BatchPatch): Promise<void>;
  insertItems(batchId: string, records: StagedRecord[]): Promise<void>;
  listItems(batchId: string): Promise<StagedRecord[]>;
  currentTerm(): Promise<TermRow | null>;
}

const OPEN: BatchStatus[] = ["processing", "ready", "partial"];

export function courseToPatch(course: CourseInfo): BatchPatch {
  return {
    ...(course.code ? { course_code: course.code } : {}),
    ...(course.name ? { course_name: course.name } : {}),
    ...(course.instructor ? { course_instructor: course.instructor } : {}),
    ...(course.term ? { course_term: course.term } : {}),
  };
}

// deno-lint-ignore no-explicit-any
type Db = SupabaseClient<any, "public", any>;

function fail(op: string, error: { message: string } | null): never {
  throw new Error(`${op}: ${error?.message ?? "unknown error"}`);
}

export function createSupabaseStore(db: Db, userId: string): Store {
  return {
    async findOpenBatchByHash(hash) {
      const { data, error } = await db
        .from("import_batches")
        .select("*")
        .eq("user_id", userId)
        .eq("file_hash", hash)
        .in("status", OPEN)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) fail("findOpenBatchByHash", error);
      return (data as BatchRow | null) ?? null;
    },

    async countProcessingSince(sinceIso) {
      const { count, error } = await db
        .from("import_batches")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("status", "processing")
        .gte("heartbeat_at", sinceIso);
      if (error) fail("countProcessingSince", error);
      return count ?? 0;
    },

    async createBatch(input) {
      const { data, error } = await db
        .from("import_batches")
        .insert({ ...input, user_id: userId, status: "processing", stage: "extracting" })
        .select("*")
        .single();
      if (error || !data) fail("createBatch", error);
      return data as BatchRow;
    },

    async getBatch(id) {
      const { data, error } = await db
        .from("import_batches")
        .select("*")
        .eq("id", id)
        .eq("user_id", userId)
        .maybeSingle();
      if (error) fail("getBatch", error);
      return (data as BatchRow | null) ?? null;
    },

    async isOpen(id) {
      const { data, error } = await db
        .from("import_batches")
        .select("status")
        .eq("id", id)
        .eq("user_id", userId)
        .maybeSingle();
      if (error) fail("isOpen", error);
      const status = (data as { status: BatchStatus } | null)?.status;
      return status !== undefined && status !== "discarded" && status !== "confirmed";
    },

    async updateBatch(id, patch) {
      const { error } = await db
        .from("import_batches")
        .update(patch)
        .eq("id", id)
        .eq("user_id", userId);
      if (error) fail("updateBatch", error);
    },

    async insertItems(batchId, records) {
      if (records.length === 0) return;
      const rows = records.map((r) => ({
        batch_id: batchId,
        user_id: userId,
        kind: r.kind,
        subtype: r.subtype,
        title: r.title,
        description: r.description,
        item_date: r.date,
        start_time: r.start_time,
        end_time: r.end_time,
        weekdays: r.weekdays,
        location: r.location,
        points: r.points,
        weight: r.weight,
        parameters: r.parameters,
        confidence: r.confidence,
        needs_review: r.needs_review,
        review_reason: r.review_reason,
        source_quote: r.source_quote,
        source_section: r.source_section,
        source_chunk_id: r.source_chunk_id,
      }));
      const { error } = await db.from("import_staged_items").insert(rows);
      if (error) fail("insertItems", error);
    },

    async listItems(batchId) {
      const { data, error } = await db
        .from("import_staged_items")
        .select("*")
        .eq("batch_id", batchId)
        .eq("user_id", userId);
      if (error) fail("listItems", error);
      // deno-lint-ignore no-explicit-any
      return ((data ?? []) as any[]).map((row) => ({
        kind: row.kind,
        subtype: row.subtype,
        title: row.title,
        description: row.description,
        date: row.item_date,
        // Postgres returns TIME as HH:MM:SS; records carry HH:MM, and dedupe compares them.
        start_time: row.start_time ? String(row.start_time).slice(0, 5) : null,
        end_time: row.end_time ? String(row.end_time).slice(0, 5) : null,
        weekdays: row.weekdays,
        location: row.location,
        points: row.points === null ? null : Number(row.points),
        weight: row.weight === null ? null : Number(row.weight),
        parameters: row.parameters,
        confidence: Number(row.confidence ?? 0),
        needs_review: row.needs_review,
        review_reason: row.review_reason,
        source_quote: row.source_quote ?? "",
        source_section: row.source_section ?? "",
        source_chunk_id: row.source_chunk_id ?? "",
      }));
    },

    async currentTerm() {
      const { data } = await db
        .from("terms")
        .select("name, starts_on, ends_on")
        .eq("user_id", userId)
        .eq("is_current", true)
        .limit(1)
        .maybeSingle();
      return (data as TermRow | null) ?? null;
    },
  };
}
