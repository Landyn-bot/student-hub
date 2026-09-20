// Moves a guest's browser-kept planner into their brand new account.
// Everything arrives from the browser as hand-entered data, so it is saved as
// manual (never AI generated) and always owned by the signed-in student.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const guestPayload = z.object({
  courses: z
    .array(
      z.object({
        id: z.string().max(64),
        name: z.string().trim().min(1).max(160),
        courseCode: z.string().trim().max(60).nullable(),
        instructor: z.string().trim().max(160).nullable(),
      }),
    )
    .max(50),
  items: z
    .array(
      z.object({
        kind: z.enum(["assignment", "exam"]),
        type: z.string().max(40),
        title: z.string().trim().min(1).max(300),
        description: z.string().max(2_000).nullable(),
        courseId: z.string().max(64).nullable(),
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .nullable(),
        time: z.string().max(8).nullable(),
        done: z.boolean(),
      }),
    )
    .max(500),
  transactions: z
    .array(
      z.object({
        direction: z.enum(["income", "expense"]),
        category: z.string().max(40),
        description: z.string().trim().min(1).max(160),
        occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        amount: z.number().positive().max(1_000_000),
      }),
    )
    .max(500),
});

export type GuestMigrationResult = {
  courses: number;
  items: number;
  transactions: number;
};

export const importGuestData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => guestPayload.parse(input))
  .handler(async ({ data, context }): Promise<GuestMigrationResult> => {
    const { supabase, userId } = context;

    // Browser ids mean nothing in the account, so map them to the saved rows.
    const courseIdByLocalId = new Map<string, string>();

    for (const course of data.courses) {
      const existing = await supabase
        .from("courses")
        .select("id")
        .eq("user_id", userId)
        .ilike("name", course.name)
        .maybeSingle();

      if (existing.data) {
        courseIdByLocalId.set(course.id, existing.data.id);
        continue;
      }
      const created = await supabase
        .from("courses")
        .insert({
          user_id: userId,
          name: course.name,
          course_code: course.courseCode,
          instructor: course.instructor,
          source: "manual",
        })
        .select("id")
        .single();
      if (created.data) courseIdByLocalId.set(course.id, created.data.id);
    }

    const assignments = data.items
      .filter((item) => item.kind === "assignment")
      .map((item) => ({
        user_id: userId,
        course_id: item.courseId ? (courseIdByLocalId.get(item.courseId) ?? null) : null,
        title: item.title,
        description: item.description,
        due_date: item.date,
        due_time: item.time,
        status: item.done ? "done" : "todo",
        completed_at: item.done ? new Date().toISOString() : null,
        priority: "medium",
        ai_generated: false,
        review_status: "approved",
      }));

    const exams = data.items
      .filter((item) => item.kind === "exam")
      .map((item) => ({
        user_id: userId,
        course_id: item.courseId ? (courseIdByLocalId.get(item.courseId) ?? null) : null,
        title: item.title,
        description: item.description,
        exam_date: item.date,
        start_time: item.time,
        exam_type: item.type === "quiz" ? "quiz" : "exam",
        ai_generated: false,
        review_status: "approved",
      }));

    if (assignments.length > 0) await supabase.from("assignments").insert(assignments);
    if (exams.length > 0) await supabase.from("exams").insert(exams);

    if (data.transactions.length > 0) {
      await supabase.from("financial_transactions").insert(
        data.transactions.map((row) => ({
          user_id: userId,
          direction: row.direction,
          category: row.category,
          description: row.description,
          occurred_on: row.occurredOn,
          amount: row.amount,
          currency: "USD",
        })),
      );
    }

    return {
      courses: courseIdByLocalId.size,
      items: data.items.length,
      transactions: data.transactions.length,
    };
  });
