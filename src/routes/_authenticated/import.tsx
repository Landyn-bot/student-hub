// Import Semester: the production-facing workflow for bringing a semester of Canvas course
// exports into Syllo. Each .epub is parsed and analysed independently, so one bad file never
// blocks the rest. Nothing is written to the database here -- the next step is review.
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useMemo, useRef, useState, type DragEvent } from "react";

import { PageHeader } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/app-button";
import { Panel, PanelHeader } from "@/components/ui/panel-surface";
import { analyzeCourseContentStructured } from "@/lib/course-analysis.functions";
import { extractionListKeys, type CourseExtraction } from "@/lib/course-content";
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

export const Route = createFileRoute("/_authenticated/import")({
  head: () => ({
    meta: [
      { title: "Import Semester — Syllo" },
      {
        name: "description",
        content:
          "Bring a whole semester of Canvas course exports into Syllo and review what was found before anything is saved.",
      },
      { property: "og:title", content: "Import Semester — Syllo" },
      {
        property: "og:description",
        content:
          "Bring a whole semester of Canvas course exports into Syllo and review what was found before anything is saved.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ImportSemesterPage,
});

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */

/**
 * Parsing and semantic extraction are separate stages: a file is never "imported"
 * just because the parser succeeded.
 */
type ImportStatus =
  | "selected"
  | "parsing"
  | "parsed"
  | "analyzing"
  | "ready_for_review"
  | "completed"
  | "failed";

type ImportFailure = { code: ImportErrorCode; message: string };

type CourseImport = {
  /** Namespaces every chunk key, and keys this card in React. */
  importId: string;
  file: File;
  fileName: string;
  fileSize: number;
  status: ImportStatus;
  normalized: NormalizedCourseImport | null;
  extraction: CourseExtraction | null;
  chunksAnalyzed: number;
  chunksFailed: number;
  analysisMs: number | null;
  error: ImportFailure | null;
};

const statusLabel: Record<ImportStatus, string> = {
  selected: "Selected",
  parsing: "Reading file…",
  parsed: "Parsed",
  analyzing: "Finding your coursework…",
  ready_for_review: "Ready for review",
  completed: "Reviewed",
  failed: "Failed",
};

const statusTone: Record<ImportStatus, string> = {
  selected: "border-border text-foreground/60",
  parsing: "border-border text-foreground/60",
  parsed: "border-border text-foreground/70",
  analyzing: "border-border text-foreground/70",
  ready_for_review: "border-brand/40 bg-brand/5 text-foreground",
  completed: "border-brand/40 bg-brand/5 text-foreground",
  failed: "border-destructive/40 bg-destructive/5 text-destructive",
};

const MAX_CHARS_PER_CHUNK = 12000;
/** How many files run their model analysis at the same time. */
const ANALYSIS_CONCURRENCY = 2;

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Turn anything thrown during parsing/normalizing into a predictable category. */
function toFailure(error: unknown): ImportFailure {
  if (error instanceof CourseImportError) return { code: error.code, message: error.message };
  if (error instanceof EpubParseError) return { code: "invalid_epub", message: error.message };
  return {
    code: "parser_failure",
    message: error instanceof Error ? error.message : importErrorMessages.parser_failure,
  };
}

function countItems(extraction: CourseExtraction): number {
  return extractionListKeys.reduce((total, key) => total + extraction[key].length, 0);
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

function ImportSemesterPage() {
  const analyze = useServerFn(analyzeCourseContentStructured);
  const [imports, setImports] = useState<CourseImport[]>([]);
  const [dragging, setDragging] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const patch = useCallback((importId: string, next: Partial<CourseImport>) => {
    setImports((prev) =>
      prev.map((item) => (item.importId === importId ? { ...item, ...next } : item)),
    );
  }, []);

  /** Parse one file in the browser, then ask our own endpoint to extract the coursework. */
  const runImport = useCallback(
    async (entry: CourseImport) => {
      patch(entry.importId, { status: "parsing", error: null });

      let normalized: NormalizedCourseImport;
      try {
        const parsed = await parseEpub(await entry.file.arrayBuffer());
        const chunks = chunkEpub(parsed, { maxChars: MAX_CHARS_PER_CHUNK });
        normalized = normalizeEpubImport(entry.fileName, parsed, chunks, entry.importId);
        patch(entry.importId, { status: "parsed", normalized });
      } catch (error) {
        patch(entry.importId, { status: "failed", error: toFailure(error) });
        return;
      }

      patch(entry.importId, { status: "analyzing" });
      try {
        const result = await analyze({ data: toAnalysisPayload(normalized) });
        if (!result.ok) {
          patch(entry.importId, {
            status: "failed",
            error: { code: toImportErrorCode(result.kind), message: result.error },
          });
          return;
        }
        // Extraction succeeded: hold the structured result in state for review.
        patch(entry.importId, {
          status: "ready_for_review",
          extraction: result.extraction,
          chunksAnalyzed: result.chunksAnalyzed,
          chunksFailed: result.chunksFailed,
          analysisMs: result.latencyMs,
        });
      } catch (error) {
        console.error("[import] analysis request failed", error);
        patch(entry.importId, {
          status: "failed",
          error: { code: "unknown", message: importErrorMessages.unknown },
        });
      }
    },
    [analyze, patch],
  );

  /** Run a set of files with bounded concurrency; each one succeeds or fails on its own. */
  const runAll = useCallback(
    async (entries: CourseImport[]) => {
      const queue = [...entries];
      const workers = Array.from({ length: Math.min(ANALYSIS_CONCURRENCY, queue.length) }, () =>
        (async () => {
          for (let next = queue.shift(); next; next = queue.shift()) {
            await runImport(next);
          }
        })(),
      );
      await Promise.all(workers);
    },
    [runImport],
  );

  const addFiles = useCallback(
    (fileList: FileList | File[]) => {
      const files = Array.from(fileList).filter((file) => file.name.toLowerCase().endsWith(".epub"));
      if (files.length === 0) return;

      const entries: CourseImport[] = files.map((file) => ({
        importId: createImportId(),
        file,
        fileName: file.name,
        fileSize: file.size,
        status: "selected",
        normalized: null,
        extraction: null,
        chunksAnalyzed: 0,
        chunksFailed: 0,
        analysisMs: null,
        error: null,
      }));

      setShowReview(false);
      setImports((prev) => [...prev, ...entries]);
      void runAll(entries);
    },
    [runAll],
  );

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    addFiles(event.dataTransfer.files);
  }

  const summary = useMemo(() => {
    const by = (status: ImportStatus) => imports.filter((item) => item.status === status).length;
    return {
      total: imports.length,
      working: by("selected") + by("parsing") + by("parsed"),
      analyzing: by("analyzing"),
      ready: by("ready_for_review"),
      completed: by("completed"),
      failed: by("failed"),
    };
  }, [imports]);

  const reviewable = imports.filter(
    (item) => item.status === "ready_for_review" || item.status === "completed",
  );

  function onReview() {
    setImports((prev) =>
      prev.map((item) =>
        item.status === "ready_for_review" ? { ...item, status: "completed" } : item,
      ),
    );
    setShowReview(true);
  }

  return (
    <>
      <PageHeader
        eyebrow="Import"
        title="Bring in your semester."
        action={
          <Button
            variant="brand"
            onClick={onReview}
            disabled={summary.ready === 0 && reviewable.length === 0}
          >
            Review Imported Courses
          </Button>
        }
      />

      <div className="grid gap-4">
        <Panel>
          <PanelHeader title="Course files" aside="One file per course" />
          <div
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={`rounded-2xl border-2 border-dashed p-8 text-center transition-colors ${
              dragging ? "border-brand bg-brand/5" : "border-border"
            }`}
          >
            <p className="font-display text-lg text-foreground">
              Drop your course exports here
            </p>
            <p className="mt-1 text-sm text-foreground/55">
              Select as many .epub course files as you like — each one is handled separately.
            </p>
            <div className="mt-4">
              <Button variant="brand" onClick={() => fileInputRef.current?.click()}>
                Choose files
              </Button>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".epub,application/epub+zip"
              className="hidden"
              onChange={(event) => {
                if (event.target.files) addFiles(event.target.files);
                event.target.value = "";
              }}
            />
          </div>

          {imports.length > 0 ? <ProgressSummary summary={summary} /> : null}
        </Panel>

        {imports.map((item) => (
          <ImportCard key={item.importId} item={item} onRetry={() => void runImport(item)} />
        ))}

        {showReview && reviewable.length > 0 ? <ReviewPanel items={reviewable} /> : null}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Pieces                                                              */
/* ------------------------------------------------------------------ */

type Summary = {
  total: number;
  working: number;
  analyzing: number;
  ready: number;
  completed: number;
  failed: number;
};

function ProgressSummary({ summary }: { summary: Summary }) {
  const done = summary.ready + summary.completed + summary.failed;
  const percent = summary.total === 0 ? 0 : Math.round((done / summary.total) * 100);

  const lines = [
    `${summary.total} course${summary.total === 1 ? "" : "s"} selected`,
    summary.working > 0 ? `${summary.working} reading` : null,
    summary.analyzing > 0 ? `${summary.analyzing} analyzing` : null,
    summary.ready > 0 ? `${summary.ready} ready for review` : null,
    summary.completed > 0 ? `${summary.completed} reviewed` : null,
    summary.failed > 0 ? `${summary.failed} failed` : null,
  ].filter((line): line is string => line !== null);

  return (
    <div className="mt-5">
      <div className="h-2 w-full overflow-hidden rounded-full bg-foreground/10">
        <div
          className="h-full rounded-full bg-brand transition-all"
          style={{ width: `${percent}%` }}
        />
      </div>
      <p className="mt-2 text-sm text-foreground/60">{lines.join(" · ")}</p>
    </div>
  );
}

function ImportCard({ item, onRetry }: { item: CourseImport; onRetry: () => void }) {
  const busy = item.status === "parsing" || item.status === "analyzing";
  const normalized = item.normalized;

  return (
    <Panel>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium text-foreground">{item.fileName}</p>
          <p className="text-xs text-foreground/45">
            {formatSize(item.fileSize)} · file name, not course identity
          </p>
        </div>
        <span className={`rounded-full border px-3 py-1 text-xs ${statusTone[item.status]}`}>
          {statusLabel[item.status]}
        </span>
      </div>

      {normalized ? (
        <div className="mt-4 space-y-1 text-sm">
          <p className="font-display text-base text-foreground">
            {normalized.metadata.title ?? "Course title not stated in the file"}
          </p>
          <p className="text-foreground/60">
            {normalized.chapters.length} sections · {normalized.chunks.length} passages
            {item.extraction ? ` · ${countItems(item.extraction)} items found` : ""}
            {item.analysisMs !== null ? ` · ${(item.analysisMs / 1000).toFixed(1)}s` : ""}
          </p>
          {item.chunksFailed > 0 ? (
            <p className="text-xs text-foreground/50">
              {item.chunksAnalyzed} of {item.chunksAnalyzed + item.chunksFailed} passages analysed
            </p>
          ) : null}
          {normalized.warnings.map((warning) => (
            <p key={warning} className="text-xs text-foreground/50">
              ⚠ {warning}
            </p>
          ))}
        </div>
      ) : null}

      {item.error ? (
        <div className="mt-4 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm">
          <p className="text-foreground">{item.error.message}</p>
          <p className="mt-1 text-xs text-foreground/50">Reason: {item.error.code}</p>
        </div>
      ) : null}

      {item.status === "failed" ? (
        <div className="mt-4">
          <Button onClick={onRetry} disabled={busy}>
            Try this file again
          </Button>
        </div>
      ) : null}
    </Panel>
  );
}

/** Review step: what was found, with the exact source sentence behind each item. */
function ReviewPanel({ items }: { items: CourseImport[] }) {
  return (
    <Panel>
      <PanelHeader title="Review what we found" aside="Nothing saved yet" />
      <p className="mb-4 text-sm text-foreground/60">
        Check each item against the sentence it came from. Anything not stated in your files is
        left blank rather than guessed.
      </p>

      <div className="space-y-6">
        {items.map((item) => {
          const extraction = item.extraction;
          if (!extraction) return null;
          return (
            <div key={item.importId} className="rounded-2xl border border-border p-4">
              <p className="font-display text-base text-foreground">
                {extraction.course.course_name ??
                  item.normalized?.metadata.title ??
                  item.fileName}
              </p>
              <p className="text-xs text-foreground/50">
                {extraction.course.course_code ?? "no course code"} ·{" "}
                {extraction.course.instructor ?? "no instructor"} ·{" "}
                {extraction.course.semester ?? "no semester"}
              </p>

              <div className="mt-3 space-y-3">
                {extractionListKeys.map((key) => {
                  const list = extraction[key];
                  if (list.length === 0) return null;
                  return (
                    <div key={key}>
                      <p className="text-xs font-medium uppercase tracking-wide text-foreground/45">
                        {key.replace(/_/g, " ")} ({list.length})
                      </p>
                      <ul className="mt-1 space-y-1.5">
                        {list.map((entry, index) => (
                          <li
                            key={`${key}-${index}`}
                            className="rounded-xl bg-foreground/[0.03] p-2.5 text-sm"
                          >
                            <p className="text-foreground">{entry.title}</p>
                            {entry.due_date ?? entry.date ? (
                              <p className="text-xs text-foreground/55">
                                {entry.due_date ?? entry.date}
                              </p>
                            ) : null}
                            {entry.weight ? (
                              <p className="text-xs text-foreground/55">{entry.weight}</p>
                            ) : null}
                            <p className="mt-1 text-xs text-foreground/45">
                              {entry.source.chapterTitle} · “{entry.source.sourceText}”
                            </p>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}
