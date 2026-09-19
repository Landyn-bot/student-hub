// Temporary developer page: upload one or more course .epub files, inspect exactly what the
// parser produces, then send the normalized import to our own server endpoint for analysis.
//
// Parsing and normalization run entirely in the browser. The only network call is to Syllo's
// own endpoint -- the browser never talks to any model provider and holds no API keys.
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, type ChangeEvent } from "react";

import { analyzeCourseContentStructured } from "@/lib/course-analysis.functions";
import type { AnalyzeCourseContentResponse, CourseContentPayload } from "@/lib/course-content";
import {
  CourseImportError,
  createImportId,
  importErrorMessages,
  normalizeEpubImport,
  toAnalysisPayload,
  toImportErrorCode,
  type ImportErrorCode,
  type NormalizedCourseImport,
} from "@/lib/course-import";
import { chunkEpub, EpubParseError, parseEpub } from "@/lib/epub";

export const Route = createFileRoute("/epub-test")({
  component: EpubTestPage,
});

/** Processing states for a single file. No persistence -- local React state only. */
type DocStatus = "uploaded" | "parsing" | "parsed" | "analyzing" | "completed" | "failed";

type DocFailure = { code: ImportErrorCode; message: string };

type DocState = {
  /** Filename only. It is shown separately from metadata: the filename is NOT course identity. */
  sourceName: string;
  importId: string;
  status: DocStatus;
  file: File;
  normalized: NormalizedCourseImport | null;
  payload: CourseContentPayload | null;
  analysis: AnalyzeCourseContentResponse | null;
  error: DocFailure | null;
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

/** Turn any thrown client-side value into one of the predictable error categories. */
function toFailure(error: unknown): DocFailure {
  if (error instanceof CourseImportError) return { code: error.code, message: error.message };
  if (error instanceof EpubParseError) {
    return { code: "invalid_epub", message: error.message };
  }
  return {
    code: "parser_failure",
    message: error instanceof Error ? error.message : importErrorMessages.parser_failure,
  };
}

function EpubTestPage() {
  const [docs, setDocs] = useState<DocState[]>([]);
  const [maxChars, setMaxChars] = useState(MAX_CHARS_DEFAULT);
  const analyze = useServerFn(analyzeCourseContentStructured);

  function update(importId: string, patch: Partial<DocState>) {
    setDocs((prev) => prev.map((doc) => (doc.importId === importId ? { ...doc, ...patch } : doc)));
  }

  /** Each file is parsed independently so courses never get merged into one text blob. */
  async function onFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) return;

    const fresh: DocState[] = files.map((file) => ({
      sourceName: file.name,
      importId: createImportId(),
      status: "uploaded",
      file,
      normalized: null,
      payload: null,
      analysis: null,
      error: null,
    }));
    setDocs(fresh);

    for (const doc of fresh) {
      update(doc.importId, { status: "parsing" });
      try {
        const parsed = await parseEpub(await doc.file.arrayBuffer());
        const chunks = chunkEpub(parsed, { maxChars });
        const normalized = normalizeEpubImport(doc.sourceName, parsed, chunks, doc.importId);
        update(doc.importId, {
          status: "parsed",
          normalized,
          payload: toAnalysisPayload(normalized),
        });
      } catch (err) {
        update(doc.importId, { status: "failed", error: toFailure(err) });
      }
    }
  }

  async function onAnalyze(doc: DocState) {
    if (!doc.payload) return;
    update(doc.importId, { status: "analyzing", analysis: null, error: null });
    try {
      const result = await analyze({ data: doc.payload });
      update(doc.importId, {
        status: result.ok ? "completed" : "failed",
        analysis: result,
        error: result.ok ? null : { code: toImportErrorCode(result.kind), message: result.error },
      });
    } catch (err) {
      update(doc.importId, {
        status: "failed",
        error: { code: "unknown", message: importErrorMessages.unknown },
      });
      console.error("[epub-test] analysis request failed", err);
    }
  }

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">EPUB → Nemotron pipeline test</h1>
        <p className="text-muted-foreground text-sm">
          Parse course .epub files in the browser, normalize them, then send the normalized
          content to Syllo&apos;s own analysis endpoint. Nothing is uploaded or saved.
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
        <DocumentPanel key={doc.importId} doc={doc} onAnalyze={() => onAnalyze(doc)} />
      ))}
    </main>
  );
}

function DocumentPanel({ doc, onAnalyze }: { doc: DocState; onAnalyze: () => void }) {
  const normalized = doc.normalized;

  return (
    <section className="space-y-4 rounded border p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-medium">{doc.sourceName}</p>
          <p className="text-muted-foreground text-xs">
            File name (not course identity) · {doc.importId}
          </p>
        </div>
        <span className="rounded border px-2 py-1 text-xs">{statusLabel[doc.status]}</span>
      </div>

      {doc.error && (
        <div className="border-destructive text-destructive rounded border p-3 text-sm">
          <p>{doc.error.message}</p>
          <p className="mt-1 text-xs opacity-80">Category: {doc.error.code}</p>
        </div>
      )}

      {normalized && (
        <>
          <div className="space-y-1 text-sm">
            <p className="font-medium">{normalized.metadata.title ?? "(untitled document)"}</p>
            <p className="text-muted-foreground">
              {normalized.metadata.authors.join(", ") || "Unknown author"} ·{" "}
              {normalized.chapters.length} chapters · {normalized.chunks.length} chunks ·{" "}
              {normalized.chapters.reduce((n, c) => n + c.wordCount, 0).toLocaleString()} words
            </p>
            <p className="text-muted-foreground text-xs">
              {normalized.metadata.language ?? "no language"} ·{" "}
              {normalized.metadata.publisher ?? "no publisher"} ·{" "}
              {normalized.metadata.published ?? "no date"}
            </p>
            {normalized.warnings.map((warning) => (
              <p key={warning} className="text-amber-600">
                ⚠ {warning}
              </p>
            ))}
          </div>

          <details className="rounded border p-3">
            <summary className="cursor-pointer text-sm font-medium">
              Chapters ({normalized.chapters.length})
            </summary>
            <ul className="mt-2 space-y-1 text-sm">
              {normalized.chapters.map((chapter) => (
                <li key={chapter.chapterId} className="text-muted-foreground">
                  {chapter.chapterIndex + 1}. {chapter.chapterTitle}{" "}
                  <span className="text-xs">
                    ({chapter.wordCount} words · {chapter.sourcePath})
                  </span>
                </li>
              ))}
            </ul>
          </details>

          <details className="rounded border p-3">
            <summary className="cursor-pointer text-sm font-medium">
              Chunks ({normalized.chunks.length})
            </summary>
            <div className="mt-2 space-y-2">
              {normalized.chunks.map((chunk) => (
                <details key={chunk.chunkKey} className="rounded border p-2">
                  <summary className="cursor-pointer text-xs">
                    {chunk.localChunkId} · {chunk.chapterTitle} · part {chunk.part}/
                    {chunk.totalParts} · {chunk.text.length} chars
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
              ? `Analyzing ${normalized.chunks.length} chunks…`
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
