// Developer view: shows how the pipeline actually works on the most recent import —
// deterministic parser output (source text) -> semantic interpretation -> stored result.
// Reachable only from the import summary; it holds nothing beyond the browser session.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";

import { PageHeader } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/app-button";
import { Panel, PanelHeader } from "@/components/ui/panel-surface";
import { listImportRuns } from "@/lib/import-store";

export const Route = createFileRoute("/_authenticated/import-debug")({
  head: () => ({
    meta: [
      { title: "Import pipeline — Syllo" },
      {
        name: "description",
        content:
          "Developer view of a Syllo import: the parsed source text, the model's interpretation and the structured result that was stored.",
      },
      { property: "og:title", content: "Import pipeline — Syllo" },
      {
        property: "og:description",
        content:
          "Developer view of a Syllo import: parsed source text, model interpretation and stored structured result.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ImportDebugPage,
});

const actionLabel: Record<string, string> = {
  insert: "saved as new",
  merge: "merged with an existing item",
  supersede: "replaced an earlier value",
  attention: "left for the student to settle",
};

function ImportDebugPage() {
  const runs = listImportRuns();
  const [runId, setRunId] = useState<string | null>(runs[0]?.importId ?? null);
  const run = runs.find((entry) => entry.importId === runId) ?? runs[0] ?? null;
  const [chunkId, setChunkId] = useState<string | null>(null);

  const chunk = run ? (run.trace.find((entry) => entry.chunkId === chunkId) ?? run.trace[0]) : null;

  return (
    <>
      <PageHeader
        eyebrow="Developer"
        title="How an import is interpreted."
        action={
          <Link to="/import">
            <Button variant="soft">Back to import</Button>
          </Link>
        }
      />

      {run === null ? (
        <Panel>
          <p className="text-sm text-foreground/60">
            Nothing to show yet. Run an import in this session, then open this view.
          </p>
        </Panel>
      ) : (
        <div className="grid gap-4">
          <Panel>
            <PanelHeader
              title={run.sourceName}
              aside={`${run.chapters} sections · ${run.chunks} passages`}
            />
            <p className="text-sm text-foreground/60">
              Parser reads the file and produces passages. The model only interprets those
              passages — it never touches the file itself.
            </p>
            {runs.length > 1 ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {runs.map((entry) => (
                  <Button
                    key={entry.importId}
                    variant={entry.importId === run.importId ? "brand" : "soft"}
                    onClick={() => {
                      setRunId(entry.importId);
                      setChunkId(null);
                    }}
                  >
                    {entry.sourceName}
                  </Button>
                ))}
              </div>
            ) : null}
          </Panel>

          <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
            <Panel>
              <PanelHeader title="Passages" />
              <ul className="space-y-1">
                {run.trace.map((entry) => (
                  <li key={entry.chunkId}>
                    <button
                      type="button"
                      onClick={() => setChunkId(entry.chunkId)}
                      className={`w-full rounded-lg px-2 py-1.5 text-left text-sm transition-colors ${
                        chunk?.chunkId === entry.chunkId
                          ? "bg-brand/10 text-foreground"
                          : "text-foreground/65 hover:bg-foreground/5"
                      }`}
                    >
                      <span className="block truncate">{entry.chapterTitle}</span>
                      <span className="block text-xs text-foreground/45">
                        part {entry.part}/{entry.totalParts} · {entry.status} · {entry.latencyMs}ms
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </Panel>

            <div className="grid gap-4">
              <Panel>
                <PanelHeader title="1 · Source text" aside="from the deterministic parser" />
                <pre className="max-h-72 overflow-auto rounded-xl bg-foreground/5 p-3 text-xs whitespace-pre-wrap text-foreground/75">
                  {chunk?.sourceText ?? "—"}
                </pre>
              </Panel>

              <Panel>
                <PanelHeader title="2 · Nemotron interpretation" aside="raw model reply" />
                <pre className="max-h-72 overflow-auto rounded-xl bg-foreground/5 p-3 text-xs whitespace-pre-wrap text-foreground/75">
                  {chunk?.modelReply?.trim() || "—"}
                </pre>
                {chunk?.error ? (
                  <p className="mt-2 text-xs text-destructive">{chunk.error}</p>
                ) : null}
                <div className="mt-3 space-y-1 text-sm">
                  {(chunk?.categories ?? []).length === 0 ? (
                    <p className="text-foreground/55">No categories found in this passage.</p>
                  ) : (
                    chunk?.categories.map((category) => (
                      <p key={category.key} className="text-foreground/75">
                        <span className="text-foreground">{category.key.replace(/_/g, " ")}</span>:{" "}
                        {category.titles.join(", ")}
                      </p>
                    ))
                  )}
                </div>
              </Panel>

              <Panel>
                <PanelHeader title="3 · Final structured result" aside="after validation" />
                {run.decisions.length === 0 ? (
                  <p className="text-sm text-foreground/55">Nothing was stored for this file.</p>
                ) : (
                  <ul className="space-y-2 text-sm">
                    {run.decisions.map((decision, index) => (
                      <li
                        key={`${decision.kind}-${decision.title}-${index}`}
                        className="rounded-xl border border-border p-3"
                      >
                        <p className="text-foreground">{decision.title}</p>
                        <p className="text-xs text-foreground/55">
                          {decision.kind} · {decision.date ?? "no date stated"} ·{" "}
                          {actionLabel[decision.action] ?? decision.action}
                        </p>
                        <p className="mt-1 text-xs text-foreground/55">{decision.detail}</p>
                        {decision.sourceText ? (
                          <p className="mt-1 text-xs text-foreground/45">“{decision.sourceText}”</p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
