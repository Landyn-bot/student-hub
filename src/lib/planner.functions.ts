import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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
            "id, title, description, due_date, due_time, course_id, source_text, ai_generated, courses(name), course_documents:source_document_id(filename)",
          )
          .eq("user_id", userId)
          .eq("review_status", "approved")
          .neq("status", "done"),
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
