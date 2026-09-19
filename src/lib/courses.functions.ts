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
    const { data, error } = await context.supabase
      .from("courses")
      .select("id, name, course_code, instructor, credits, source")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: true });

    if (error) throw error;
    return data ?? [];
  });
