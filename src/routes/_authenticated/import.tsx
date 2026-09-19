// Import Semester: the production-facing workflow for bringing a semester of Canvas course
// exports into Syllo. Each .epub is uploaded, parsed, analysed, organized and saved end to
// end, without asking the student to approve every extracted item. Only genuinely unresolved
// items (unreadable dates, low confidence) are surfaced afterwards.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2 } from "lucide-react";
import { useCallback, useMemo, useRef, useState, type DragEvent } from "react";

import { PageHeader } from "@/components/app/PageHeader";
import { ErrorNote } from "@/components/app/StatusNote";
import { Button } from "@/components/ui/app-button";
import { Panel, PanelHeader } from "@/components/ui/panel-surface";
import { analyzeCourseContentStructured } from "@/lib/course-analysis.functions";
import type { ChunkTrace, CourseExtraction } from "@/lib/course-content";
import { recordImportRun } from "@/lib/import-store";
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
import {
  bulkApproveItems,
  listAttentionItems,
  reviewImportedItem,
  saveCourseImport,
  type AttentionItem,
} from "@/lib/semester-import.functions";
import { chunkEpub, EpubParseError, parseEpub } from "@/lib/epub";

export const Route = createFileRoute("/_authenticated/import")({
  head: () => ({
    meta: [
      { title: "Import Semester — Syllo" },
      {
        name: "description",
        content:
          "Drop in a semester of Canvas course exports and Syllo reads, organizes and saves your coursework automatically.",
      },
      { property: "og:title", content: "Import Semester — Syllo" },
      {
        property: "og:description",
        content:
          "Drop in a semester of Canvas course exports and Syllo reads, organizes and saves your coursework automatically.",
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

/** Each stage is distinct: a file is only "complete" once its coursework is saved. */
type ImportStatus = "uploading" | "parsing" | "analyzing" | "organizing" | "complete" | "failed";

type ImportFailure = { code: ImportErrorCode; message: string };

type CourseImport = {
  importId: string;
  file: File;
  fileName: string;
  fileSize: number;
  status: ImportStatus;
  normalized: NormalizedCourseImport | null;
  extraction: CourseExtraction | null;
  courseName: string | null;
  itemsSaved: number;
  examsSaved: number;
  needsAttention: number;
  error: ImportFailure | null;
};

const statusLabel: Record<ImportStatus, string> = {
  uploading: "Uploading",
  parsing: "Parsing",
  analyzing: "Analyzing",
  organizing: "Organizing",
  complete: "Complete",
  failed: "Failed",
};

const statusTone: Record<ImportStatus, string> = {
  uploading: "border-border text-foreground/60",
  parsing: "border-border text-foreground/60",
  analyzing: "border-border text-foreground/70",
  organizing: "border-border text-foreground/70",
  complete: "border-brand/40 bg-brand/5 text-foreground",
  failed: "border-destructive/40 bg-destructive/5 text-destructive",
};

const MAX_CHARS_PER_CHUNK = 12000;
/** How many files run through analysis at the same time. */
const ANALYSIS_CONCURRENCY = 2;
/** Upper bound on the stored copy of the document text. */
const MAX_DOCUMENT_CHARS = 400_000;

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

function newEntry(file: File): CourseImport {
  return {
    importId: createImportId(),
    file,
    fileName: file.name,
    fileSize: file.size,
    status: "uploading",
    normalized: null,
    extraction: null,
    courseName: null,
    itemsSaved: 0,
    examsSaved: 0,
    needsAttention: 0,
    error: null,
  };
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

function ImportSemesterPage() {
  const analyze = useServerFn(analyzeCourseContentStructured);
  const save = useServerFn(saveCourseImport);
  const queryClient = useQueryClient();

  const [imports, setImports] = useState<CourseImport[]>([]);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const patch = useCallback((importId: string, next: Partial<CourseImport>) => {
    setImports((prev) =>
      prev.map((item) => (item.importId === importId ? { ...item, ...next } : item)),
    );
  }, []);

  /** Parse in the browser, analyse on our own endpoint, then organize and save. */
  const runImport = useCallback(
    async (entry: CourseImport) => {
      patch(entry.importId, { status: "parsing", error: null });

      let normalized: NormalizedCourseImport;
      try {
        const parsed = await parseEpub(await entry.file.arrayBuffer());
        const chunks = chunkEpub(parsed, { maxChars: MAX_CHARS_PER_CHUNK });
        normalized = normalizeEpubImport(entry.fileName, parsed, chunks, entry.importId);
        patch(entry.importId, { normalized });
      } catch (error) {
        patch(entry.importId, { status: "failed", error: toFailure(error) });
        return;
      }

      patch(entry.importId, { status: "analyzing" });
      let extraction: CourseExtraction;
      let trace: ChunkTrace[] = [];
      try {
        const result = await analyze({ data: toAnalysisPayload(normalized) });
        if (!result.ok) {
          patch(entry.importId, {
            status: "failed",
            error: { code: toImportErrorCode(result.kind), message: result.error },
          });
          return;
        }
        extraction = result.extraction;
        trace = result.trace;
        patch(entry.importId, { extraction });
      } catch (error) {
        console.error("[import] analysis request failed", error);
        patch(entry.importId, {
          status: "failed",
          error: { code: "unknown", message: importErrorMessages.unknown },
        });
        return;
      }

      // Organizing: group the extracted facts under their course and write them to the
      // student's own semester data. Provenance travels with every row.
      patch(entry.importId, { status: "organizing" });
      try {
        const documentText = normalized.chunks
          .map((chunk) => chunk.text)
          .join("\n\n")
          .slice(0, MAX_DOCUMENT_CHARS);

        const saved = await save({
          data: {
            importId: entry.importId,
            sourceName: entry.fileName,
            documentText,
            documentTitle: normalized.metadata.title,
            extraction,
          },
        });

        if (!saved.ok) {
          patch(entry.importId, {
            status: "failed",
            error: { code: "unknown", message: saved.error },
          });
          return;
        }

        patch(entry.importId, {
          status: "complete",
          courseName: saved.courseName,
          itemsSaved: saved.itemsSaved,
          examsSaved: saved.examsSaved,
          needsAttention: saved.needsAttention,
        });
        // Keep the pipeline trace for the developer view (session memory only).
        recordImportRun({
          importId: entry.importId,
          sourceName: entry.fileName,
          courseName: saved.courseName,
          finishedAt: Date.now(),
          chapters: normalized.chapters.length,
          chunks: normalized.chunks.length,
          trace,
          extraction,
          decisions: saved.decisions,
        });
        void queryClient.invalidateQueries({ queryKey: ["attention-items"] });
        void queryClient.invalidateQueries({ queryKey: ["courses"] });
        void queryClient.invalidateQueries({ queryKey: ["planner"] });
        void queryClient.invalidateQueries({ queryKey: ["focus"] });
      } catch (error) {
        console.error("[import] saving failed", error);
        patch(entry.importId, {
          status: "failed",
          error: { code: "unknown", message: importErrorMessages.unknown },
        });
      }
    },
    [analyze, patch, queryClient, save],
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
      const files = Array.from(fileList).filter((file) =>
        file.name.toLowerCase().endsWith(".epub"),
      );
      if (files.length === 0) return;

      const entries = files.map(newEntry);
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
    const complete = imports.filter((item) => item.status === "complete");
    return {
      total: imports.length,
      working: by("uploading") + by("parsing"),
      analyzing: by("analyzing"),
      organizing: by("organizing"),
      complete: complete.length,
      failed: by("failed"),
      items: complete.reduce((sum, item) => sum + item.itemsSaved, 0),
      exams: complete.reduce((sum, item) => sum + item.examsSaved, 0),
    };
  }, [imports]);

  const working = summary.working + summary.analyzing + summary.organizing > 0;

  return (
    <>
      <PageHeader
        eyebrow="Import"
        title="Bring in your semester."
        action={
          <Button variant="brand" onClick={() => fileInputRef.current?.click()}>
            Choose files
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
            <p className="font-display text-lg text-foreground">Drop your course exports here</p>
            <p className="mt-1 text-sm text-foreground/55">
              Everything after that is automatic: each file is read, understood and added to your
              semester.
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

        {summary.complete > 0 && !working ? <FinishedSummary summary={summary} /> : null}

        {summary.complete > 0 ? <AttentionPanel /> : null}
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
  organizing: number;
  complete: number;
  failed: number;
  items: number;
  exams: number;
};

function ProgressSummary({ summary }: { summary: Summary }) {
  const done = summary.complete + summary.failed;
  const percent = summary.total === 0 ? 0 : Math.round((done / summary.total) * 100);

  const lines = [
    `${summary.total} course${summary.total === 1 ? "" : "s"} selected`,
    summary.working > 0 ? `${summary.working} reading` : null,
    summary.analyzing > 0 ? `${summary.analyzing} analyzing` : null,
    summary.organizing > 0 ? `${summary.organizing} organizing` : null,
    summary.complete > 0 ? `${summary.complete} complete` : null,
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

/** The plain-language result once every file has finished. */
function FinishedSummary({ summary }: { summary: Summary }) {
  const { data: attention, isPending } = useQuery({
    queryKey: ["attention-items"],
    queryFn: () => listAttentionItems(),
  });

  const facts = [
    `${summary.complete} course${summary.complete === 1 ? "" : "s"} imported`,
    `${summary.items} academic item${summary.items === 1 ? "" : "s"} added to your planner`,
    `${summary.exams} exam${summary.exams === 1 ? "" : "s"} found`,
  ];

  return (
    <Panel className="border-brand/40">
      <div className="flex items-start gap-3">
        <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-brand" aria-hidden />
        <div className="min-w-0">
          <h2 className="font-display text-lg font-semibold text-foreground">
            All done — your semester is in Syllo.
          </h2>
          <p className="mt-1 text-sm text-foreground/60">{facts.join(" · ")}</p>
          {/* Counted only once the list has loaded, so it never briefly reads zero. */}
          {!isPending && attention && attention.length > 0 ? (
            <p className="mt-1 text-sm text-foreground/60">
              {attention.length} item{attention.length === 1 ? "" : "s"} still need a quick look
              below.
            </p>
          ) : null}
          {summary.failed > 0 ? (
            <p className="mt-1 text-sm text-foreground/60">
              {summary.failed} file{summary.failed === 1 ? "" : "s"} could not be read — use “Try
              this file again” above.
            </p>
          ) : null}
          <div className="mt-4">
            <Button variant="brand" asChild>
              <Link to="/dashboard">Go to my dashboard</Link>
            </Button>
          </div>
        </div>
      </div>
    </Panel>
  );
}

function ImportCard({ item, onRetry }: { item: CourseImport; onRetry: () => void }) {
  const busy =
    item.status === "parsing" || item.status === "analyzing" || item.status === "organizing";
  const normalized = item.normalized;

  return (
    <Panel>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium text-foreground">{item.fileName}</p>
          <p className="text-xs text-foreground/45">{formatSize(item.fileSize)}</p>
        </div>
        <span
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs ${statusTone[item.status]}`}
        >
          {busy ? <Loader2 className="size-3 animate-spin" aria-hidden /> : null}
          {statusLabel[item.status]}
        </span>
      </div>

      {normalized ? (
        <div className="mt-4 space-y-1 text-sm">
          <p className="font-display text-base text-foreground">
            {item.courseName ?? normalized.metadata.title ?? "Course title not stated in the file"}
          </p>
          <p className="text-foreground/60">
            {normalized.chapters.length} sections · {normalized.chunks.length} passages
            {item.status === "complete" ? ` · ${item.itemsSaved} items saved` : ""}
            {item.status === "complete" && item.needsAttention > 0
              ? ` · ${item.needsAttention} need attention`
              : ""}
          </p>
          {normalized.warnings.map((warning) => (
            <p key={warning} className="text-xs text-foreground/50">
              ⚠ {warning}
            </p>
          ))}
        </div>
      ) : null}

      {item.status === "failed" ? (
        <div className="mt-4">
          <ErrorNote
            title="This file could not be imported"
            description={item.error?.message ?? importErrorMessages.unknown}
            onRetry={onRetry}
            retrying={busy}
          />
        </div>
      ) : null}
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* Items that still need the student                                   */
/* ------------------------------------------------------------------ */

function AttentionPanel() {
  const queryClient = useQueryClient();
  const review = useServerFn(reviewImportedItem);
  const bulk = useServerFn(bulkApproveItems);
  const [pending, setPending] = useState(false);
  const [open, setOpen] = useState(false);

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["attention-items"],
    queryFn: () => listAttentionItems(),
  });

  // Resolving an item changes the planner too, so both views refresh together.
  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ["attention-items"] });
    await queryClient.invalidateQueries({ queryKey: ["planner"] });
    await queryClient.invalidateQueries({ queryKey: ["focus"] });
  }, [queryClient]);

  async function runBulk(scope: "high_confidence_assignments" | "reviewed_items") {
    setPending(true);
    try {
      await bulk({ data: { scope } });
      await refresh();
    } finally {
      setPending(false);
    }
  }

  // Nothing unresolved means nothing to show — ordinary imported work is never
  // put in front of the student for approval.
  if (isLoading || items.length === 0) return null;

  // Normal extracted data never asks for approval. Only unresolved conflicts surface here, and
  // they stay folded away behind a single line until the student opens them.
  if (!open) {
    return (
      <Panel>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="w-full text-left font-display text-base text-foreground underline-offset-4 hover:underline"
        >
          {items.length} item{items.length === 1 ? "" : "s"} need your attention
        </button>
        <p className="mt-1 text-sm text-foreground/60">
          Everything else was added to your planner automatically.
        </p>
      </Panel>
    );
  }

  return (
    <Panel>
      <PanelHeader
        title="Needs attention"
        aside={`${items.length} item${items.length === 1 ? "" : "s"}`}
      />
      <p className="mb-4 text-sm text-foreground/60">
        These are the only items we could not settle on our own. Everything else is already in your
        planner.
      </p>

      <div className="mb-4 flex flex-wrap gap-2">
        <Button onClick={() => void runBulk("high_confidence_assignments")} disabled={pending}>
          Approve all high-confidence assignments
        </Button>
        <Button onClick={() => void runBulk("reviewed_items")} disabled={pending}>
          Approve all reviewed items
        </Button>
      </div>

      <div className="space-y-3">
        {items.map((item) => (
          <AttentionRow
            key={`${item.kind}-${item.id}`}
            item={item}
            onDone={() => void refresh()}
            review={review}
          />
        ))}
      </div>
    </Panel>
  );
}

type ReviewCall = (args: {
  data: {
    kind: AttentionItem["kind"];
    id: string;
    action: "approve" | "reject" | "edit";
    title?: string;
    date?: string | null;
  };
}) => Promise<{ ok: boolean; error?: string }>;

function AttentionRow({
  item,
  onDone,
  review,
}: {
  item: AttentionItem;
  onDone: () => void;
  review: ReviewCall;
}) {
  const [title, setTitle] = useState(item.title);
  const [date, setDate] = useState(item.date ?? "");
  const [busy, setBusy] = useState(false);

  const supportsDate = item.kind !== "policy";
  const edited = title !== item.title || (item.date ?? "") !== date;

  async function submit(action: "approve" | "reject" | "edit") {
    setBusy(true);
    try {
      await review({
        data: {
          kind: item.kind,
          id: item.id,
          action,
          ...(action !== "reject" && edited
            ? { title, ...(supportsDate ? { date: date === "" ? null : date } : {}) }
            : {}),
        },
      });
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs uppercase tracking-wide text-foreground/45">
          {item.kind} · {item.courseName ?? "course"}
          {item.editedByUser ? " · edited by you" : ""}
        </p>
        <p className="text-xs text-foreground/45">{item.reason ?? "Needs a check"}</p>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          className="w-full rounded-xl border border-border bg-transparent px-3 py-2 text-sm text-foreground"
        />
        {supportsDate ? (
          <input
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            className="rounded-xl border border-border bg-transparent px-3 py-2 text-sm text-foreground"
          />
        ) : null}
      </div>

      {item.sourceText ? (
        <p className="mt-2 text-xs text-foreground/45">From your file: “{item.sourceText}”</p>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          variant="brand"
          onClick={() => void submit(edited ? "edit" : "approve")}
          disabled={busy}
        >
          {edited ? "Save and approve" : "Approve"}
        </Button>
        <Button onClick={() => void submit("reject")} disabled={busy}>
          Reject
        </Button>
      </div>
    </div>
  );
}
