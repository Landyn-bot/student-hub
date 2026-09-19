// Temporary developer page: upload one or more course .epub files, inspect exactly what the
// parser produces, then send the normalized payload to our own server endpoint for analysis.
//
// Parsing runs entirely in the browser. The only network call is to Syllo's own endpoint --
// the browser never talks to any model provider and holds no API keys.
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, type ChangeEvent } from "react";

import { analyzeCourseContentStructured } from "@/lib/course-analysis.functions";
import {
  toCourseContentPayload,
  type AnalyzeCourseContentResponse,
  type CourseContentPayload,
} from "@/lib/course-content";
import { chunkEpub, parseEpub, type EpubChunk, type ParsedEpub } from "@/lib/epub";

export const Route = createFileRoute("/epub-test")({
  component: EpubTestPage,
});

/** Processing states for a single file. No persistence -- local React state only. */
type DocStatus = "uploaded" | "parsing" | "parsed" | "analyzing" | "completed" | "failed";

type DocState = {
  /** Filename only. It is shown separately from metadata: the filename is NOT course identity. */
  sourceName: string;
  status: DocStatus;
  file: File;
  parsed: ParsedEpub | null;
  chunks: EpubChunk[];
  payload: CourseContentPayload | null;
  analysis: AnalyzeCourseContentResponse | null;
  error: string | null;
};

const statusLabel: Record<DocStatus, string> = {
  uploaded: "Uploaded",
  parsing: "Parsing…",
  parsed: "Parsed",
  analyzing: "Analyzing…",
  completed: "Completed",
  failed: "Failed",
};

const MAX_CHARS_DEFAULT = 12000;

function EpubTestPage() {
  const [docs, setDocs] = useState<DocState[]>([]);
  const [maxChars, setMaxChars] = useState(MAX_CHARS_DEFAULT);
  const analyze = useServerFn(analyzeCourseContentStructured);

  function update(sourceName: string, patch: Partial<DocState>) {
    setDocs((prev) =>
      prev.map((doc) => (doc.sourceName === sourceName ? { ...doc, ...patch } : doc)),
    );
  }

  /** Each file is parsed independently so courses never get merged into one text blob. */
  async function onFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) return;

    const fresh: DocState[] = files.map((file) => ({
      sourceName: file.name,
      status: "uploaded",
      file,
      parsed: null,
      chunks: [],
      payload: null,
      analysis: null,
      error: null,
    }));
    setDocs(fresh);

    for (const doc of fresh) {
      update(doc.sourceName, { status: "parsing" });
      try {
        const parsed = await parseEpub(await doc.file.arrayBuffer());
        const chunks = chunkEpub(parsed, { maxChars });
        update(doc.sourceName, {
          status: "parsed",
          parsed,
          chunks,
          payload: toCourseContentPayload(doc.sourceName, parsed, chunks),
        });
      } catch (err) {
        update(doc.sourceName, {
          status: "failed",
          error: err instanceof Error ? err.message : "Failed to parse EPUB",
        });
      }
    }
  }

  async function onAnalyze(doc: DocState) {
    if (!doc.payload) return;
    update(doc.sourceName, { status: "analyzing", analysis: null, error: null });
    try {
      const result = await analyze({ data: doc.payload });
      update(doc.sourceName, {
        status: result.ok ? "completed" : "failed",
        analysis: result,
        error: result.ok ? null : result.error,
      });
    } catch (err) {
      update(doc.sourceName, {
        status: "failed",
        error: err instanceof Error ? err.message : "The analysis request failed.",
      });
    }
  }

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">EPUB → Nemotron pipeline test</h1>
        <p className="text-muted-foreground text-sm">
          Parse course .epub files in the browser, then send the normalized content to Syllo&apos;s
          own analysis endpoint. Nothing is uploaded or saved.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-4">
        <input
          type="file"
          multiple
          accept=".epub,application/epub+zip"
          onChange={onFiles}
          className="text-sm"
        />
        <label className="flex items-center gap-2 text-sm">
          Max chars / chunk
          <input
            type="number"
            min={500}
            step={500}
            value={maxChars}
            onChange={(e) =>
              setMaxChars(Math.max(500, Number(e.target.value) || MAX_CHARS_DEFAULT))
            }
            className="bg-background w-24 rounded border px-2 py-1"
          />
        </label>
      </div>

      {docs.map((doc) => (
        <DocumentPanel key={doc.sourceName} doc={doc} onAnalyze={() => onAnalyze(doc)} />
      ))}
    </main>
  );
}

function DocumentPanel({ doc, onAnalyze }: { doc: DocState; onAnalyze: () => void }) {
  const { parsed, chunks } = doc;

  return (
    <section className="space-y-4 rounded border p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-medium">{doc.sourceName}</p>
          <p className="text-muted-foreground text-xs">File name (not course identity)</p>
        </div>
        <span className="rounded border px-2 py-1 text-xs">{statusLabel[doc.status]}</span>
      </div>

      {doc.error && (
        <p className="border-destructive text-destructive rounded border p-3 text-sm">
          {doc.error}
        </p>
      )}

      {parsed && (
        <>
          <div className="space-y-1 text-sm">
            <p className="font-medium">{parsed.metadata.title ?? "(untitled document)"}</p>
            <p className="text-muted-foreground">
              {parsed.metadata.authors.join(", ") || "Unknown author"} · {parsed.chapters.length}{" "}
              chapters · {chunks.length} chunks ·{" "}
              {parsed.chapters.reduce((n, c) => n + c.wordCount, 0).toLocaleString()} words
            </p>
            <p className="text-muted-foreground text-xs">
              {parsed.metadata.language ?? "no language"} ·{" "}
              {parsed.metadata.publisher ?? "no publisher"} ·{" "}
              {parsed.metadata.published ?? "no date"}
            </p>
            {parsed.warnings.map((warning) => (
              <p key={warning} className="text-amber-600">
                ⚠ {warning}
              </p>
            ))}
          </div>

          <details className="rounded border p-3">
            <summary className="cursor-pointer text-sm font-medium">
              Chapters ({parsed.chapters.length})
            </summary>
            <ul className="mt-2 space-y-1 text-sm">
              {parsed.chapters.map((chapter) => (
                <li key={chapter.id} className="text-muted-foreground">
                  {chapter.index + 1}. {chapter.title}{" "}
                  <span className="text-xs">({chapter.wordCount} words)</span>
                </li>
              ))}
            </ul>
          </details>

          <details className="rounded border p-3">
            <summary className="cursor-pointer text-sm font-medium">
              Chunks ({chunks.length})
            </summary>
            <div className="mt-2 space-y-2">
              {chunks.map((chunk) => (
                <details key={chunk.id} className="rounded border p-2">
                  <summary className="cursor-pointer text-xs">
                    {chunk.id} · {chunk.chapterTitle} · part {chunk.part}/{chunk.totalParts} ·{" "}
                    {chunk.text.length} chars
                  </summary>
                  <pre className="bg-muted mt-2 max-h-72 overflow-auto rounded p-2 text-xs whitespace-pre-wrap">
                    {chunk.text}
                  </pre>
                </details>
              ))}
            </div>
          </details>

          <button
            onClick={onAnalyze}
            disabled={doc.status === "analyzing" || !doc.payload}
            className="hover:bg-muted rounded border px-3 py-1.5 text-sm disabled:opacity-50"
          >
            {doc.status === "analyzing"
              ? `Analyzing ${chunks.length} chunks…`
              : "Analyze with Nemotron"}
          </button>
        </>
      )}

      {doc.analysis?.ok && (
        <p className="text-muted-foreground text-xs">
          {doc.analysis.chunksAnalyzed} of {doc.analysis.chunkResults.length} chunks analysed
          {doc.analysis.chunksFailed > 0 ? ` · ${doc.analysis.chunksFailed} failed` : ""} ·{" "}
          {(doc.analysis.latencyMs / 1000).toFixed(1)}s
        </p>
      )}

      {doc.analysis && (
        <details open className="rounded border p-3">
          <summary className="cursor-pointer text-sm font-medium">Structured JSON response</summary>
          <pre className="bg-muted mt-2 max-h-[32rem] overflow-auto rounded p-3 text-xs">
            {JSON.stringify(doc.analysis, null, 2)}
          </pre>
        </details>
      )}
    </section>
  );
}
