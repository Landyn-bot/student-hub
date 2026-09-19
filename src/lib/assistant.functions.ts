import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * The Syllo assistant: one ongoing conversation per student, grounded in that
 * student's own imported academic data. Whose data is read comes only from the
 * authenticated session — the client never supplies a user id. The model is
 * reached exclusively through the existing server-side Nemotron service.
 */

export type AssistantMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
};

export type AssistantChat = {
  conversationId: string;
  messages: AssistantMessage[];
};

export type AssistantAnswer = { ok: true; answer: AssistantMessage } | { ok: false; error: string };

/** How many recent turns are replayed to the model for follow-up questions. */
const HISTORY_TURNS = 8;
/** Cap on how many academic items are sent, so the whole database never ships. */
const MAX_CONTEXT_ITEMS = 80;

type ConversationRow = { id: string; title: string };

/** Finds the student's single ongoing conversation, creating it on first use. */
async function getOrCreateConversation(supabase: any, userId: string): Promise<ConversationRow> {
  const existing = await supabase
    .from("chat_conversations")
    .select("id, title")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (existing.data) return existing.data as ConversationRow;

  const created = await supabase
    .from("chat_conversations")
    .insert({ user_id: userId, title: "Syllo assistant" })
    .select("id, title")
    .single();

  if (created.error || !created.data) {
    throw new Error("Could not start a conversation.");
  }
  return created.data as ConversationRow;
}

export const getAssistantChat = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AssistantChat> => {
    const { supabase, userId } = context;
    const conversation = await getOrCreateConversation(supabase, userId);

    const { data } = await supabase
      .from("chat_messages")
      .select("id, role, content, created_at")
      .eq("user_id", userId)
      .eq("conversation_id", conversation.id)
      .order("created_at", { ascending: true });

    const messages: AssistantMessage[] = (data ?? [])
      .filter((row: any) => row.role === "user" || row.role === "assistant")
      .map((row: any) => ({
        id: row.id as string,
        role: row.role as "user" | "assistant",
        content: row.content as string,
        createdAt: row.created_at as string,
      }));

    return { conversationId: conversation.id, messages };
  });

/** Formats one academic item as a single grounded line for the model. */
function itemLine(parts: Array<string | null | undefined>): string {
  return `- ${parts.filter((p) => p && p.trim().length > 0).join(" · ")}`;
}

/**
 * Collects only what a question could plausibly need: the student's courses,
 * approved upcoming work, dated events and course policies. Rejected or
 * unresolved imports are excluded, and everything is scoped to the session user.
 */
async function loadAcademicContext(supabase: any, userId: string): Promise<string> {
  const [courses, assignments, exams, events, policies] = await Promise.all([
    supabase.from("courses").select("name, course_code, instructor").eq("user_id", userId),
    supabase
      .from("assignments")
      .select("title, description, due_date, due_time, courses(name)")
      .eq("user_id", userId)
      .eq("review_status", "approved")
      .neq("status", "done")
      .order("due_date", { ascending: true, nullsFirst: false })
      .limit(MAX_CONTEXT_ITEMS),
    supabase
      .from("exams")
      .select("title, description, exam_date, start_time, location, exam_type, courses(name)")
      .eq("user_id", userId)
      .eq("review_status", "approved")
      .order("exam_date", { ascending: true, nullsFirst: false })
      .limit(MAX_CONTEXT_ITEMS),
    supabase
      .from("calendar_events")
      .select("title, description, starts_at, all_day, location, event_type, courses(name)")
      .eq("user_id", userId)
      .eq("review_status", "approved")
      .order("starts_at", { ascending: true, nullsFirst: false })
      .limit(MAX_CONTEXT_ITEMS),
    supabase
      .from("course_policies")
      .select("title, policy_type, content, courses(name)")
      .eq("user_id", userId)
      .eq("review_status", "approved")
      .limit(MAX_CONTEXT_ITEMS),
  ]);

  const sections: string[] = [];

  const courseLines = (courses.data ?? []).map((c: any) =>
    itemLine([c.name, c.course_code ? `code ${c.course_code}` : null, c.instructor]),
  );
  sections.push(
    courseLines.length > 0 ? `COURSES\n${courseLines.join("\n")}` : "COURSES\n(none imported yet)",
  );

  const assignmentLines = (assignments.data ?? []).map((a: any) =>
    itemLine([
      "assignment",
      a.title,
      a.courses?.name ?? null,
      a.due_date ? `due ${a.due_date}` : "no due date stated",
      a.due_time ? `at ${String(a.due_time).slice(0, 5)}` : null,
      a.description,
    ]),
  );
  sections.push(
    assignmentLines.length > 0
      ? `ASSIGNMENTS AND OTHER COURSEWORK\n${assignmentLines.join("\n")}`
      : "ASSIGNMENTS AND OTHER COURSEWORK\n(none imported yet)",
  );

  const examLines = (exams.data ?? []).map((e: any) =>
    itemLine([
      e.exam_type ?? "exam",
      e.title,
      e.courses?.name ?? null,
      e.exam_date ? `on ${e.exam_date}` : "no date stated",
      e.start_time ? `at ${String(e.start_time).slice(0, 5)}` : null,
      e.location,
      e.description,
    ]),
  );
  sections.push(
    examLines.length > 0
      ? `EXAMS AND QUIZZES\n${examLines.join("\n")}`
      : "EXAMS AND QUIZZES\n(none imported yet)",
  );

  const eventLines = (events.data ?? []).map((e: any) => {
    const starts = e.starts_at ? new Date(e.starts_at) : null;
    return itemLine([
      e.event_type ?? "event",
      e.title,
      e.courses?.name ?? null,
      starts ? `on ${starts.toISOString().slice(0, 10)}` : "no date stated",
      starts && !e.all_day ? `at ${starts.toISOString().slice(11, 16)}` : null,
      e.location,
      e.description,
    ]);
  });
  if (eventLines.length > 0) sections.push(`IMPORTANT DATES AND EVENTS\n${eventLines.join("\n")}`);

  const policyLines = (policies.data ?? []).map((p: any) =>
    itemLine([p.policy_type, p.title, p.courses?.name ?? null, p.content]),
  );
  if (policyLines.length > 0) sections.push(`COURSE POLICIES\n${policyLines.join("\n")}`);

  return sections.join("\n\n");
}

const AskInput = z.object({ question: z.string().trim().min(1).max(2000) });

export const askAssistant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => AskInput.parse(input))
  .handler(async ({ data, context }): Promise<AssistantAnswer> => {
    const { supabase, userId } = context;
    const conversation = await getOrCreateConversation(supabase, userId);

    // Save the student's message first so it survives even if the model fails.
    const userInsert = await supabase
      .from("chat_messages")
      .insert({
        user_id: userId,
        conversation_id: conversation.id,
        role: "user",
        content: data.question,
      })
      .select("id, created_at")
      .single();
    if (userInsert.error) return { ok: false, error: "Could not save your message." };

    const [history, academicContext] = await Promise.all([
      supabase
        .from("chat_messages")
        .select("role, content")
        .eq("user_id", userId)
        .eq("conversation_id", conversation.id)
        .order("created_at", { ascending: false })
        .limit(HISTORY_TURNS * 2),
      loadAcademicContext(supabase, userId),
    ]);

    const recent = ((history.data ?? []) as Array<{ role: string; content: string }>)
      .reverse()
      .slice(0, -1); // the question just asked is restated below

    const today = new Date().toISOString().slice(0, 10);
    const system = [
      "You are Syllo, a study assistant for one college student.",
      "Answer ONLY from the academic data provided below — never invent dates, deadlines, grades or policies.",
      "If the answer is not in the data, say plainly that you could not find it in their imported course information and suggest importing the relevant file.",
      `Today is ${today}. Use it to resolve words like "this week", "Friday" or "tonight".`,
      "Be concise and warm. Name the course when you mention an item. Quote dates exactly as given.",
    ].join(" ");

    const user = [
      recent.length > 0
        ? `RECENT CONVERSATION\n${recent.map((m) => `${m.role === "user" ? "Student" : "Syllo"}: ${m.content}`).join("\n")}`
        : null,
      `ACADEMIC DATA\n${academicContext}`,
      `STUDENT'S QUESTION\n${data.question}`,
    ]
      .filter((part) => part !== null)
      .join("\n\n");

    let text: string;
    let model: string | null = null;
    let tokens: number | null = null;
    try {
      // Server-only service: the NVIDIA key never leaves the server.
      const { runNemotron, NemotronError } = await import("@/lib/nemotron.server");
      const result = await runNemotron({ system, user, maxTokens: 800 });
      text = result.text.trim();
      model = result.model;
      tokens = result.usage
        ? result.usage.promptTokens! + (result.usage.completionTokens ?? 0)
        : null;
    } catch (error) {
      // NemotronError messages are already safe to show; anything else is generic.
      const { NemotronError } = await import("@/lib/nemotron.server");
      const message =
        error instanceof NemotronError
          ? error.message
          : "Something went wrong while answering. Please try again.";
      return { ok: false, error: message };
    }

    const assistantInsert = await supabase
      .from("chat_messages")
      .insert({
        user_id: userId,
        conversation_id: conversation.id,
        role: "assistant",
        content: text,
        model,
        token_count: tokens,
      })
      .select("id, created_at")
      .single();

    await supabase
      .from("chat_conversations")
      .update({ last_message_at: new Date().toISOString(), model })
      .eq("id", conversation.id)
      .eq("user_id", userId);

    if (assistantInsert.error || !assistantInsert.data) {
      return { ok: false, error: "The answer was generated but could not be saved." };
    }

    return {
      ok: true,
      answer: {
        id: assistantInsert.data.id as string,
        role: "assistant",
        content: text,
        createdAt: assistantInsert.data.created_at as string,
      },
    };
  });
