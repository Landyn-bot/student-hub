import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";

import { PageHeader } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/app-button";
import { Panel, PanelHeader } from "@/components/ui/panel-surface";
import {
  analyzeCourseContent,
  type AnalyzeCourseContentResult,
} from "@/lib/course-analysis.functions";

export const Route = createFileRoute("/_authenticated/nemotron-test")({
  head: () => ({
    meta: [
      { title: "Nemotron Test — Syllo" },
      {
        name: "description",
        content: "Developer sandbox for running course text through Nemotron analysis.",
      },
      { property: "og:title", content: "Nemotron Test — Syllo" },
      {
        property: "og:description",
        content: "Developer sandbox for running course text through Nemotron analysis.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: NemotronTestPage,
});

type Status = "idle" | "running" | "done" | "failed";

function NemotronTestPage() {
  const analyze = useServerFn(analyzeCourseContent);

  const [sourceName, setSourceName] = useState("Pasted test text");
  const [content, setContent] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [result, setResult] = useState<AnalyzeCourseContentResult | null>(null);
  const [clientLatency, setClientLatency] = useState<number | null>(null);

  async function handleRun() {
    if (content.trim().length === 0) return;
    setStatus("running");
    setResult(null);
    const startedAt = performance.now();
    try {
      const response = await analyze({
        data: { source_name: sourceName.trim() || "Pasted test text", content },
      });
      setResult(response);
      setStatus(response.ok ? "done" : "failed");
    } catch (error) {
      setResult({
        ok: false,
        kind: "client",
        error: error instanceof Error ? error.message : "Request failed.",
        latencyMs: 0,
      });
      setStatus("failed");
    } finally {
      setClientLatency(Math.round(performance.now() - startedAt));
    }
  }

  return (
    <>
      <PageHeader eyebrow="Developer tools" title="Test Nemotron on course text." />

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <PanelHeader title="Input" aside="Manual text" />
          <label
            className="mb-1 block text-xs font-medium text-foreground/55"
            htmlFor="source-name"
          >
            Source name
          </label>
          <input
            id="source-name"
            value={sourceName}
            onChange={(event) => setSourceName(event.target.value)}
            className="mb-4 w-full rounded-xl border border-border bg-card px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />

          <label className="mb-1 block text-xs font-medium text-foreground/55" htmlFor="content">
            Course text
          </label>
          <textarea
            id="content"
            value={content}
            onChange={(event) => setContent(event.target.value)}
            rows={14}
            placeholder="Paste syllabus or reading text here…"
            className="w-full resize-y rounded-xl border border-border bg-card px-3 py-2 font-mono text-xs leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />

          <div className="mt-4 flex items-center gap-3">
            <Button
              variant="brand"
              onClick={handleRun}
              disabled={status === "running" || content.trim().length === 0}
            >
              {status === "running" ? "Running…" : "Test Nemotron"}
            </Button>
            <span className="text-xs text-foreground/45">{content.length} characters</span>
          </div>
        </Panel>

        <Panel>
          <PanelHeader
            title="Result"
            aside={result?.ok ? result.model : status === "running" ? "waiting" : undefined}
          />

          <dl className="mb-4 grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-xs text-foreground/45">Status</dt>
              <dd className="font-medium text-foreground">
                {status === "idle"
                  ? "Not run yet"
                  : status === "running"
                    ? "Request in flight"
                    : status === "done"
                      ? "Success"
                      : "Failed"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-foreground/45">Latency</dt>
              <dd className="font-medium text-foreground">
                {result ? `${result.latencyMs} ms model / ${clientLatency ?? "—"} ms total` : "—"}
              </dd>
            </div>
          </dl>

          {result && !result.ok ? (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-foreground">
              <p className="font-medium">{result.error}</p>
              <p className="mt-1 text-xs text-foreground/50">Error type: {result.kind}</p>
            </div>
          ) : null}

          {result?.ok ? (
            <>
              <pre className="max-h-[28rem] overflow-auto whitespace-pre-wrap rounded-xl bg-black/[0.03] p-3 font-mono text-xs leading-relaxed text-foreground">
                {result.text}
              </pre>
              {result.usage ? (
                <p className="mt-2 text-xs text-foreground/45">
                  {result.usage.promptTokens ?? "?"} prompt / {result.usage.completionTokens ?? "?"}{" "}
                  completion tokens
                </p>
              ) : null}
            </>
          ) : null}

          {status === "idle" ? (
            <p className="text-sm text-foreground/50">
              Paste text on the left and run it to see the model response here.
            </p>
          ) : null}
        </Panel>
      </div>
    </>
  );
}
