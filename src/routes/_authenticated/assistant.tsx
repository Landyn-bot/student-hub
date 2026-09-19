import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Bot, CircleAlert } from "lucide-react";

import { PageHeader } from "@/components/app/PageHeader";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
} from "@/components/ai-elements/prompt-input";
import { Shimmer } from "@/components/ai-elements/shimmer";
import {
  askAssistant,
  getAssistantChat,
  type AssistantMessage,
} from "@/lib/assistant.functions";

export const Route = createFileRoute("/_authenticated/assistant")({
  head: () => ({
    meta: [
      { title: "AI Assistant — Syllo" },
      {
        name: "description",
        content: "A study assistant that answers from your own imported course material.",
      },
      { property: "og:title", content: "AI Assistant — Syllo" },
      {
        property: "og:description",
        content: "A study assistant that answers from your own imported course material.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AssistantPage,
});

/** Starters that map to the academic data the assistant is grounded in. */
const SUGGESTIONS = [
  "What do I have due this week?",
  "When is my next exam?",
  "What is my late policy?",
  "What should I work on tonight?",
];

type ChatStatus = "ready" | "submitted" | "error";

function AssistantPage() {
  const loadChat = useServerFn(getAssistantChat);
  const ask = useServerFn(askAssistant);

  const chatQuery = useQuery({ queryKey: ["assistant-chat"], queryFn: () => loadChat() });

  // Optimistic copy of the saved conversation so replies appear instantly.
  const [pending, setPending] = useState<AssistantMessage[]>([]);
  const [status, setStatus] = useState<ChatStatus>("ready");
  const [error, setError] = useState<string | null>(null);

  const saved = chatQuery.data?.messages ?? [];
  const messages = [...saved, ...pending];

  async function send(text: string) {
    const question = text.trim();
    if (!question || status === "submitted") return;

    setError(null);
    setStatus("submitted");
    setPending((current) => [
      ...current,
      { id: `local-${Date.now()}`, role: "user", content: question, createdAt: new Date().toISOString() },
    ]);

    try {
      const result = await ask({ data: { question } });
      if (result.ok) {
        // Server saved both messages; reload replaces the optimistic user row.
        await chatQuery.refetch();
        setPending([]);
      } else {
        setError(result.error);
      }
    } catch {
      setError("Could not reach Syllo right now. Please try again.");
    } finally {
      setStatus("ready");
    }
  }

  return (
    <>
      <PageHeader eyebrow="AI Assistant" title="Ask about your own courses." />

      <div className="flex h-[calc(100vh-16rem)] min-h-96 flex-col gap-4">
        <Conversation className="flex-1 rounded-3xl border border-border bg-card">
          <ConversationContent>
            {messages.length === 0 && status !== "submitted" ? (
              <ConversationEmptyState
                icon={<Bot className="size-8 text-muted-foreground" />}
                title="Ask me anything about your semester"
                description="Due dates, exams, policies — I only answer from your imported course material."
              >
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  {SUGGESTIONS.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      onClick={() => void send(suggestion)}
                      className="rounded-full border border-border bg-background px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-secondary"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </ConversationEmptyState>
            ) : (
              <>
                {messages.map((message) => (
                  <Message key={message.id} from={message.role}>
                    <MessageContent>
                      {message.role === "assistant" ? (
                        <MessageResponse>{message.content}</MessageResponse>
                      ) : (
                        message.content
                      )}
                    </MessageContent>
                  </Message>
                ))}
                {status === "submitted" ? <Shimmer>Thinking through your courses…</Shimmer> : null}
                {error ? (
                  <div className="flex items-start gap-2 rounded-2xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                    <CircleAlert className="mt-0.5 size-4 shrink-0" />
                    <span>{error}</span>
                  </div>
                ) : null}
              </>
            )}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>

        <PromptInput
          onSubmit={({ text }) => void send(text)}
          className="rounded-3xl border border-border bg-card"
        >
          <PromptInputTextarea
            placeholder="Ask about due dates, exams, policies…"
            disabled={status === "submitted"}
          />
          <PromptInputFooter className="justify-end">
            <PromptInputSubmit status={status === "submitted" ? "submitted" : "ready"} />
          </PromptInputFooter>
        </PromptInput>
      </div>
    </>
  );
}
