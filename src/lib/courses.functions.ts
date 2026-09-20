import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type Course = {
  id: string;
  name: string;
  course_code: string | null;
  instructor: string | null;
  credits: number | null;
  source: string;
};

export const listCourses = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<Course[]> => {
    // The user filter complements database access rules and makes ownership explicit.
    const { data, error } = await context.supabase
      .from("courses")
      .select("id, name, course_code, instructor, credits, source")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: true });

    if (error) {
      throw error;
    }
    return data ?? [];
  });

/** Fields a student can set on a class they manage by hand. */
export type CourseInput = {
  name: string;
  courseCode?: string | null;
  instructor?: string | null;
};

/** Cleans and validates the hand-entered course fields. Returns null-safe values. */
function cleanCourseInput(data: CourseInput) {
  const name = data.name.trim();
  if (!name || name.length > 160) throw new Error("Give the class a name.");
  const courseCode = data.courseCode?.trim() ? data.courseCode.trim() : null;
  const instructor = data.instructor?.trim() ? data.instructor.trim() : null;
  return { name, courseCode, instructor };
}

/**
 * Adds a class by hand, so a student does not need to import a file to have
 * a course on their shelf. Owned by the signed-in user and marked manual.
 */
export const addCourse = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: CourseInput) => input)
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { supabase, userId } = context;
    const { name, courseCode, instructor } = cleanCourseInput(data);

    // Reuse the same-named class if the student already has one.
    const existing = await supabase
      .from("courses")
      .select("id")
      .eq("user_id", userId)
      .ilike("name", name)
      .maybeSingle();
    if (existing.data) return { ok: true };

    const insert = await supabase
      .from("courses")
      .insert({ user_id: userId, name, course_code: courseCode, instructor, source: "manual" });
    if (insert.error) throw new Error("We could not save that class.");
    return { ok: true };
  });

/** Updates a class's name, code and instructor. Only the owner's own rows match. */
export const updateCourse = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: CourseInput & { id: string }) => input)
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { supabase, userId } = context;
    const { name, courseCode, instructor } = cleanCourseInput(data);

    const update = await supabase
      .from("courses")
      .update({ name, course_code: courseCode, instructor })
      .eq("user_id", userId)
      .eq("id", data.id);
    if (update.error) throw new Error("We could not update that class.");
    return { ok: true };
  });
