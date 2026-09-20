// Assistant endpoint for students using Syllo without an account.
// Their planner lives in their own browser, so the page sends a short, capped
// summary of it along with the question. Nothing is stored on our side, and the
// model key stays server-side exactly as it does for signed-in students.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import type { AssistantAnswer } from "@/lib/assistant.functions";

const guestAskInput = z.object({
  question: z.string().trim().min(1).max(600),
  /** Plain-text summary of the guest's own planner data, built in the browser. */
  context: z.string().max(12_000),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(2_000),
      }),
    )
    .max(8)
    .default([]),
});

export const askAssistantGuest = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => guestAskInput.parse(input))
  .handler(async ({ data }): Promise<AssistantAnswer> => {
    const today = new Date().toISOString().slice(0, 10);
    const system = [
      "You are Syllo, a study assistant for one college student.",
      "Answer ONLY from the academic data provided below — never invent dates, deadlines, grades or policies.",
      "If the answer is not in the data, say plainly that you could not find it in their planner.",
      `Today is ${today}. Use it to resolve words like "this week", "Friday" or "tonight".`,
      "Be concise and warm. Name the course when you mention an item. Quote dates exactly as given.",
    ].join(" ");

    const user = [
      data.history.length > 0
        ? `RECENT CONVERSATION\n${data.history
            .map((m) => `${m.role === "user" ? "Student" : "Syllo"}: ${m.content}`)
            .join("\n")}`
        : null,
      `ACADEMIC DATA\n${data.context || "(nothing added yet)"}`,
      `STUDENT'S QUESTION\n${data.question}`,
    ]
      .filter((part) => part !== null)
      .join("\n\n");

    try {
      const { runNemotron, stripModelThinking } = await import("@/lib/nemotron.server");
      const result = await runNemotron({ system, user, maxTokens: 800 });
      return {
        ok: true,
        answer: {
          id: `guest-${Date.now()}`,
          role: "assistant",
          content: stripModelThinking(result.text).trim(),
          createdAt: new Date().toISOString(),
        },
      };
    } catch (error) {
      const { NemotronError } = await import("@/lib/nemotron.server");
      return {
        ok: false,
        error:
          error instanceof NemotronError
            ? error.message
            : "Something went wrong while answering. Please try again.",
      };
    }
  });
