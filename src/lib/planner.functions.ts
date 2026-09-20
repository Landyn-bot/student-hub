import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";

/** A single academic obligation, normalized across assignments, exams and events. */
export type PlannerItem = {
  id: string;
  kind: "assignment" | "exam" | "event";
  /** Student-facing label: assignment, exam, quiz, project, reading, event. */
  type: string;
  title: string;
  description: string | null;
  courseId: string | null;
  courseName: string | null;
  /** ISO date (YYYY-MM-DD) when known. */
  date: string | null;
  /** Time of day (HH:MM) when known. */
  time: string | null;
  location: string | null;
  /** Exact sentence the item was extracted from, if it came from an import. */
  sourceText: string | null;
  sourceName: string | null;
  aiGenerated: boolean;
  /**
   * True only for work a student actually hands in. Quizzes, tests and exams are
   * sat on a fixed day rather than completed early, so they are never checkable.
   */
  completable: boolean;
  /** True once the student has checked the work off. Only assignments can be done. */
  done: boolean;
};

/** Quizzes, tests and exams are scheduled sittings, not to-dos. */
export function isSitting(type: string): boolean {
  return /quiz|exam|test|midterm|final/i.test(type);
}

export type PlannerCourse = {
  id: string;
  name: string;
  courseCode: string | null;
  instructor: string | null;
};

export type PlannerData = {
  courses: PlannerCourse[];
  items: PlannerItem[];
  attentionCount: number;
};

/** Infers the student-facing item type from the title when the source has no explicit type. */
function inferType(title: string, fallback: string): string {
  const text = title.toLowerCase();
  if (/\bquiz(zes)?\b/.test(text)) return "quiz";
  if (/\bproject\b/.test(text)) return "project";
  // "Final project" is a project, so the exam test runs after it.
  if (/\bexam\b|\bmidterm\b|\bfinal(s)?\b/.test(text)) return "exam";
  if (/\bread(ing)?\b|\bchapter\b/.test(text)) return "reading";
  if (/\blab\b/.test(text)) return "lab";
  return fallback;
}

/** Trims a time value like "23:59:00" down to "23:59". */
function shortTime(value: string | null): string | null {
  if (!value) return null;
  const match = /^(\d{2}:\d{2})/.exec(value);
  return match?.[1] ?? null;
}

/**
 * Everything the planner needs in one authenticated round trip.
 * Only rows the signed-in user owns are read, and rejected or unresolved
 * imports never enter the planner.
 */
export const getPlannerData = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PlannerData> => {
    const { supabase, userId } = context;

    const attentionCountFor = (table: "assignments" | "exams" | "calendar_events") =>
      supabase
        .from(table)
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("review_status", "needs_attention");

    const [courses, assignments, exams, events, attentionA, attentionE, attentionC] =
      await Promise.all([
        supabase
          .from("courses")
          .select("id, name, course_code, instructor")
          .eq("user_id", userId)
          .order("name", { ascending: true }),
        supabase
          .from("assignments")
          .select(
            "id, title, description, due_date, due_time, course_id, status, source_text, ai_generated, courses(name), course_documents:source_document_id(filename)",
          )
          .eq("user_id", userId)
          .eq("review_status", "approved"),
        supabase
          .from("exams")
          .select(
            "id, title, description, exam_date, start_time, location, exam_type, course_id, source_text, ai_generated, courses(name), course_documents:source_document_id(filename)",
          )
          .eq("user_id", userId)
          .eq("review_status", "approved"),
        supabase
          .from("calendar_events")
          .select(
            "id, title, description, starts_at, all_day, location, event_type, course_id, source_text, ai_generated, courses(name), course_documents:source_document_id(filename)",
          )
          .eq("user_id", userId)
          .eq("review_status", "approved"),
        attentionCountFor("assignments"),
        attentionCountFor("exams"),
        attentionCountFor("calendar_events"),
      ]);

    type Joined = {
      courses?: { name: string } | null;
      course_documents?: { filename: string } | null;
    };
    const courseName = (row: Joined) => row.courses?.name ?? null;
    const sourceName = (row: Joined) => row.course_documents?.filename ?? null;

    const items: PlannerItem[] = [];

    for (const row of assignments.data ?? []) {
      items.push({
        id: row.id,
        kind: "assignment",
        type: inferType(row.title, "assignment"),
        title: row.title,
        description: row.description,
        courseId: row.course_id,
        courseName: courseName(row),
        date: row.due_date,
        time: shortTime(row.due_time),
        location: null,
        sourceText: row.source_text,
        sourceName: sourceName(row),
        aiGenerated: row.ai_generated,
        completable: !isSitting(inferType(row.title, "assignment")),
        done: row.status === "done",
      });
    }

    for (const row of exams.data ?? []) {
      items.push({
        id: row.id,
        kind: "exam",
        type: row.exam_type ?? inferType(row.title, "exam"),
        title: row.title,
        description: row.description,
        courseId: row.course_id,
        courseName: courseName(row),
        date: row.exam_date,
        time: shortTime(row.start_time),
        location: row.location,
        sourceText: row.source_text,
        sourceName: sourceName(row),
        aiGenerated: row.ai_generated,
        completable: false,
        done: false,
      });
    }

    for (const row of events.data ?? []) {
      // calendar_events keeps a timestamp; split it into the date and time the planner shows.
      const starts = row.starts_at ? new Date(row.starts_at) : null;
      const date = starts ? starts.toISOString().slice(0, 10) : null;
      const time = starts && !row.all_day ? starts.toISOString().slice(11, 16) : null;
      items.push({
        id: row.id,
        kind: "event",
        type: row.event_type ?? inferType(row.title, "event"),
        title: row.title,
        description: row.description,
        courseId: row.course_id,
        courseName: courseName(row),
        date,
        time,
        location: row.location,
        sourceText: row.source_text,
        sourceName: sourceName(row),
        aiGenerated: row.ai_generated,
        completable: false,
        done: false,
      });
    }

    return {
      courses: (courses.data ?? []).map((row) => ({
        id: row.id,
        name: row.name,
        courseCode: row.course_code,
        instructor: row.instructor,
      })),
      items,
      attentionCount: (attentionA.count ?? 0) + (attentionE.count ?? 0) + (attentionC.count ?? 0),
    };
  });

/**
 * Checks an assignment off (or puts it back on the list). Scheduled sittings such as
 * quizzes and exams are rejected, since they are not work a student hands in.
 */
export const setAssignmentDone = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; done: boolean }) => input)
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { supabase, userId } = context;

    const existing = await supabase
      .from("assignments")
      .select("id, title")
      .eq("user_id", userId)
      .eq("id", data.id)
      .maybeSingle();

    if (!existing.data) throw new Error("That item could not be found.");
    if (isSitting(inferType(existing.data.title, "assignment"))) {
      throw new Error("Quizzes and exams cannot be checked off.");
    }

    const update = await supabase
      .from("assignments")
      .update({
        status: data.done ? "done" : "todo",
        completed_at: data.done ? new Date().toISOString() : null,
      })
      .eq("user_id", userId)
      .eq("id", data.id);

    if (update.error) throw new Error("We could not update that item.");
    return { ok: true };
  });

/** What a student can add by hand, without importing a file. */
export type ManualItemKind = "assignment" | "quiz" | "exam" | "project";

export type ManualItemInput = {
  kind: ManualItemKind;
  title: string;
  /** Existing course to attach to. */
  courseId?: string | null;
  /** New class name, used when no existing course was picked. */
  courseName?: string | null;
  /** ISO date (YYYY-MM-DD). */
  date: string;
  /** Optional HH:MM. */
  time?: string | null;
  notes?: string | null;
};

/**
 * Adds a single assignment, quiz, exam or project entered by hand.
 * Quizzes and exams are stored as sittings; assignments and projects as coursework.
 * Everything is owned by the signed-in user and never marked AI generated.
 */
export const addManualItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: ManualItemInput) => input)
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { supabase, userId } = context;

    const title = data.title.trim();
    if (!title) throw new Error("Give it a title.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data.date)) throw new Error("Pick a date.");
    const time = data.time?.trim() ? data.time.trim() : null;
    const notes = data.notes?.trim() ? data.notes.trim() : null;

    // Resolve the class: an existing one the student picked, or a new one they typed.
    let courseId: string | null = null;
    if (data.courseId) {
      const owned = await supabase
        .from("courses")
        .select("id")
        .eq("user_id", userId)
        .eq("id", data.courseId)
        .maybeSingle();
      if (!owned.data) throw new Error("That class could not be found.");
      courseId = owned.data.id;
    } else if (data.courseName?.trim()) {
      const name = data.courseName.trim();
      const existing = await supabase
        .from("courses")
        .select("id")
        .eq("user_id", userId)
        .ilike("name", name)
        .maybeSingle();
      if (existing.data) {
        courseId = existing.data.id;
      } else {
        const created = await supabase
          .from("courses")
          .insert({ user_id: userId, name, source: "manual" })
          .select("id")
          .single();
        if (created.error || !created.data) throw new Error("We could not save that class.");
        courseId = created.data.id;
      }
    }

    if (data.kind === "quiz" || data.kind === "exam") {
      const insert = await supabase.from("exams").insert({
        user_id: userId,
        course_id: courseId,
        title,
        description: notes,
        exam_date: data.date,
        start_time: time,
        exam_type: data.kind,
        ai_generated: false,
        review_status: "approved",
      });
      if (insert.error) throw new Error("We could not save that item.");
    } else {
      const insert = await supabase.from("assignments").insert({
        user_id: userId,
        course_id: courseId,
        title,
        description: notes,
        due_date: data.date,
        due_time: time,
        status: "todo",
        priority: "medium",
        ai_generated: false,
        review_status: "approved",
      });
      if (insert.error) throw new Error("We could not save that item.");
    }

    return { ok: true };
  });

/** Editable fields for an item the student added by hand. */
export type UpdateManualItemInput = {
  id: string;
  kind: ManualItemKind;
  title: string;
  courseId?: string | null;
  courseName?: string | null;
  date: string;
  time?: string | null;
  notes?: string | null;
};

/**
 * Resolves the class for a manual add/edit: an existing one the student picked,
 * or a new one they typed (reusing a same-named class when there is one).
 */
async function resolveCourse(
  supabase: SupabaseClient<Database>,
  userId: string,
  courseId: string | null | undefined,
  courseName: string | null | undefined,
): Promise<string | null> {
  if (courseId) {
    const owned = await supabase
      .from("courses")
      .select("id")
      .eq("user_id", userId)
      .eq("id", courseId)
      .maybeSingle();
    if (!owned.data) throw new Error("That class could not be found.");
    return owned.data.id;
  }
  const name = courseName?.trim();
  if (!name) return null;
  const existing = await supabase
    .from("courses")
    .select("id")
    .eq("user_id", userId)
    .ilike("name", name)
    .maybeSingle();
  if (existing.data) return existing.data.id;
  const created = await supabase
    .from("courses")
    .insert({ user_id: userId, name, source: "manual" })
    .select("id")
    .single();
  if (created.error || !created.data) throw new Error("We could not save that class.");
  return created.data.id;
}

/**
 * Updates one hand-entered item. Only rows that are not AI generated can be
 * edited here — imported rows keep their extracted source data intact.
 */
export const updateManualItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: UpdateManualItemInput) => input)
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { supabase, userId } = context;

    const title = data.title.trim();
    if (!title) throw new Error("Give it a title.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data.date)) throw new Error("Pick a date.");
    const time = data.time?.trim() ? data.time.trim() : null;
    const notes = data.notes?.trim() ? data.notes.trim() : null;
    const courseId = await resolveCourse(supabase, userId, data.courseId, data.courseName);

    if (data.kind === "quiz" || data.kind === "exam") {
      const update = await supabase
        .from("exams")
        .update({
          title,
          description: notes,
          exam_date: data.date,
          start_time: time,
          course_id: courseId,
          edited_by_user: true,
          edited_at: new Date().toISOString(),
        })
        .eq("user_id", userId)
        .eq("id", data.id)
        .eq("ai_generated", false);
      if (update.error) throw new Error("We could not update that item.");
    } else {
      const update = await supabase
        .from("assignments")
        .update({
          title,
          description: notes,
          due_date: data.date,
          due_time: time,
          course_id: courseId,
          edited_by_user: true,
          edited_at: new Date().toISOString(),
        })
        .eq("user_id", userId)
        .eq("id", data.id)
        .eq("ai_generated", false);
      if (update.error) throw new Error("We could not update that item.");
    }

    return { ok: true };
  });

/**
 * Deletes one hand-entered item. Imported (AI generated) rows are refused so a
 * delete here can never silently discard extracted source data.
 */
export const deleteManualItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; kind: ManualItemKind }) => input)
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { supabase, userId } = context;
    const table = data.kind === "quiz" || data.kind === "exam" ? "exams" : "assignments";
    const result = await supabase
      .from(table)
      .delete()
      .eq("user_id", userId)
      .eq("id", data.id)
      .eq("ai_generated", false);
    if (result.error) throw new Error("We could not delete that item.");
    return { ok: true };
  });
