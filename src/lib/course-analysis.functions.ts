import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Shape the future EPUB pipeline will post: parser -> normalized text -> here.
const AnalyzeCourseContentInput = z.object({
  course_id: z.string().uuid().nullable().optional(),
  source_name: z.string().min(1).max(200),
  content: z.string().min(1).max(200_000),
});

export type AnalyzeCourseContentInput = z.infer<typeof AnalyzeCourseContentInput>;

export type AnalyzeCourseContentResult =
  | {
      ok: true;
      model: string;
      text: string;
      latencyMs: number;
      usage: { promptTokens: number | null; completionTokens: number | null } | null;
    }
  | { ok: false; kind: string; error: string; latencyMs: number };

const SYSTEM_PROMPT = [
  "You analyse college course material for a student planner.",
  "Extract only facts that are literally present in the supplied text.",
  "Report assignments, exams, deadlines, grading weights and course policies.",
  "For each item, quote the exact source sentence it came from.",
  "If the text contains none of these, say so plainly instead of inventing anything.",
].join(" ");

/**
 * analyze-course-content: the single entry point for Nemotron analysis of course text.
 * Accepts manually pasted text today and parsed EPUB text later — the contract is the same.
 */
export const analyzeCourseContent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => AnalyzeCourseContentInput.parse(input))
  .handler(async ({ data, context }): Promise<AnalyzeCourseContentResult> => {
    const startedAt = Date.now();
    // Server-only import keeps the NVIDIA service out of any client bundle.
    const { runNemotron, NemotronError } = await import("./nemotron.server");

    console.log("[analyze-course-content] request", {
      userId: context.userId,
      courseId: data.course_id ?? null,
      sourceName: data.source_name,
      contentChars: data.content.length,
    });

    try {
      const result = await runNemotron({
        system: SYSTEM_PROMPT,
        user: `Source: ${data.source_name}\n\n${data.content}`,
      });
      return {
        ok: true,
        model: result.model,
        text: result.text,
        latencyMs: result.latencyMs,
        usage: result.usage,
      };
    } catch (error) {
      const latencyMs = Date.now() - startedAt;
      if (error instanceof NemotronError) {
        return { ok: false, kind: error.kind, error: error.message, latencyMs };
      }
      console.error("[analyze-course-content] unexpected failure", {
        reason: error instanceof Error ? error.message : String(error),
      });
      return { ok: false, kind: "unknown", error: "Unexpected server error.", latencyMs };
    }
  });
