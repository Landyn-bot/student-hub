// Import Semester: the front door of the ingestion pipeline.
//
// A Canvas course export (.epub) is uploaded to the import-epub edge function, which validates,
// parses and reads it on the server. Nothing is saved to the planner from this page: the
// extracted records are staged and the student confirms them on the review screen first.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  ChevronDown,
  Download,
  FileText,
  Loader2,
  Settings,
  UserRound,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";

import { PageHeader } from "@/components/app/PageHeader";
import { ErrorNote } from "@/components/app/StatusNote";
import { Button } from "@/components/ui/app-button";
import { Panel, PanelHeader } from "@/components/ui/panel-surface";
import { readDocumentText } from "@/lib/document-intake.functions";
import { resumeImport, uploadEpub, uploadText, type StartImportResult } from "@/lib/import-client";
import {
  continueManually,
  getImportBatch,
  listOpenImportBatches,
  type ImportBatchSummary,
} from "@/lib/import-review.functions";
import {
  bulkApproveItems,
  listAttentionItems,
  reviewImportedItem,
  type AttentionItem,
} from "@/lib/semester-import.functions";

export const Route = createFileRoute("/_authenticated/import")({
  head: () => ({
    meta: [
      { title: "Import Semester — Syllo" },
      {
        name: "description",
        content:
          "Drop in a Canvas course export and Syllo reads it, then lets you review everything before it reaches your planner.",
      },
      { property: "og:title", content: "Import Semester — Syllo" },
      {
        property: "og:description",
        content:
          "Drop in a Canvas course export and Syllo reads it, then lets you review everything before it reaches your planner.",
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

/** A file is only "ready" once the server has finished reading it and staged the records. */
type ImportStatus = "uploading" | "reading" | "review" | "failed";

type ImportFailure = { code: string; message: string };

/** Where the text comes from. Only EPUBs are read on the server end to end. */
type SourceKind = "epub" | "document" | "text";

type CourseImport = {
  importId: string;
  kind: SourceKind;
  /** Null for text pasted straight into the page. */
  file: File | null;
  pastedText: string | null;
  fileName: string;
  fileSize: number;
  status: ImportStatus;
  batchId: string | null;
  batch: ImportBatchSummary | null;
  error: ImportFailure | null;
};

const statusLabel: Record<ImportStatus, string> = {
  uploading: "Uploading",
  reading: "Reading",
  review: "Ready to review",
  failed: "Failed",
};

const statusTone: Record<ImportStatus, string> = {
  uploading: "border-border text-foreground/60",
  reading: "border-border text-foreground/70",
  review: "border-brand/40 bg-brand/5 text-foreground",
  failed: "border-destructive/40 bg-destructive/5 text-destructive",
};

const POLL_MS = 2_000;
const MAX_WAIT_MS = 15 * 60_000;
/** Upper bound on pasted or file text sent for reading. */
const MAX_TEXT_CHARS = 1_400_000;
/** Largest single PDF or image we send off to be read. */
const MAX_DOCUMENT_BYTES = 15 * 1024 * 1024;
const MAX_EPUB_BYTES = 30 * 1024 * 1024;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Decides how a chosen file will be turned into text. */
function kindForFile(file: File): SourceKind | null {
  const name = file.name.toLowerCase();
  if (name.endsWith(".epub")) return "epub";
  if (name.endsWith(".txt") || name.endsWith(".md")) return "text";
  if (name.endsWith(".pdf") || file.type.startsWith("image/")) return "document";
  if (/\.(png|jpe?g|webp|heic|gif)$/.test(name)) return "document";
  return null;
}

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function blankEntry(
  overrides: Partial<CourseImport> & Pick<CourseImport, "kind" | "fileName" | "fileSize">,
): CourseImport {
  return {
    importId: newId(),
    file: null,
    pastedText: null,
    status: "uploading",
    batchId: null,
    batch: null,
    error: null,
    ...overrides,
  };
}

function newEntry(file: File, kind: SourceKind): CourseImport {
  return blankEntry({ kind, file, fileName: file.name, fileSize: file.size });
}

/** An entry for text the student pasted in rather than uploaded. */
function newPastedEntry(text: string): CourseImport {
  const stamp = new Date().toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return blankEntry({
    kind: "text",
    pastedText: text,
    fileName: `Pasted text (${stamp})`,
    fileSize: text.length,
  });
}

/* ------------------------------------------------------------------ */
/* Canvas export tutorial                                              */
/* ------------------------------------------------------------------ */

/**
 * A collapsible, step-by-step guide for exporting a Canvas course as an EPUB.
 * Shown by default so first-time students find it; collapses to one line
 * once they have the hang of it.
 */
function CanvasTutorial() {
  const [open, setOpen] = useState(true);

  const steps: { icon: typeof UserRound; title: string; body: string }[] = [
    {
      icon: UserRound,
      title: "Open Canvas and click your profile",
      body: "Sign in to your school's Canvas site. In the left navigation rail, click the Account (profile) icon at the very bottom.",
    },
    {
      icon: Settings,
      title: "Open Settings",
      body: "From the Account menu, choose Settings.",
    },
    {
      icon: Download,
      title: "Click “Download Course Content”",
      body: "On the right side of the Settings page, under the heading “Download Course Content”, choose the course you want and click the Generate button. Canvas builds the EPUB for that course.",
    },
    {
      icon: FileText,
      title: "Download the .epub file",
      body: "When Canvas finishes generating, click the download link to save the .epub file to your computer. Repeat the steps above for each class you want to bring into Syllo — one file per course.",
    },
  ];

  return (
    <Panel>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-3 text-left"
        aria-expanded={open}
      >
        <div className="flex items-center gap-2">
          <FileText className="size-4 text-brand" aria-hidden />
          <span className="font-display text-lg font-semibold text-foreground">
            How to get your course files from Canvas
          </span>
        </div>
        <ChevronDown
          className={`size-5 shrink-0 text-foreground/50 transition-transform ${
            open ? "rotate-180" : ""
          }`}
          aria-hidden
        />
      </button>

      {open ? (
        <div className="mt-5">
          <p className="mb-4 max-w-[60ch] text-pretty text-sm text-foreground/60">
            Syllo reads the EPUB export Canvas builds for each of your courses. Here is how to grab
            one — you only do this once per course, and each class needs its own file.
          </p>
          <ol className="grid gap-4 sm:grid-cols-2">
            {steps.map((step, index) => (
              <li
                key={step.title}
                className="flex gap-3 rounded-xl border border-border bg-surface/60 p-4"
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand/10 font-display text-sm font-semibold text-brand">
                  {index + 1}
                </span>
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 font-medium text-foreground">
                    <step.icon className="size-4 text-foreground/50" aria-hidden />
                    {step.title}
                  </p>
                  <p className="mt-1 text-pretty text-sm text-foreground/60">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
          <p className="mt-4 text-sm text-foreground/55">
            Once you have a .epub for each class, drop them in the box below — Syllo takes it from
            there. No Canvas export? A syllabus PDF, a screenshot of a schedule or pasted text works
            just as well.
          </p>
        </div>
      ) : null}
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

/** Reads a file into a data URL so it can be posted to Syllo's own reading endpoint. */
function toDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("The file could not be read."));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}

function ImportSemesterPage() {
  const readDocument = useServerFn(readDocumentText);
  const fetchBatch = useServerFn(getImportBatch);
  const queryClient = useQueryClient();

  const [imports, setImports] = useState<CourseImport[]>([]);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const patch = useCallback((importId: string, next: Partial<CourseImport>) => {
    setImports((prev) =>
      prev.map((item) => (item.importId === importId ? { ...item, ...next } : item)),
    );
  }, []);

  const fail = useCallback(
    (importId: string, error: ImportFailure) => patch(importId, { status: "failed", error }),
    [patch],
  );

  /** Follow a batch while the server reads it, until it can be reviewed or has failed. */
  const follow = useCallback(
    async (importId: string, batchId: string) => {
      patch(importId, { status: "reading", batchId, error: null });
      const startedAt = Date.now();

      while (mounted.current && Date.now() - startedAt < MAX_WAIT_MS) {
        let detail: Awaited<ReturnType<typeof fetchBatch>>;
        try {
          detail = await fetchBatch({ data: { batchId } });
        } catch {
          // A dropped request is not a failed import; keep asking.
          await sleep(POLL_MS * 2);
          continue;
        }
        if (!detail) {
          fail(importId, { code: "not_found", message: "That import could not be found." });
          return;
        }
        patch(importId, { batch: detail.batch });
        const { status } = detail.batch;

        if (status === "ready" || status === "partial") {
          patch(importId, { status: "review" });
          void queryClient.invalidateQueries({ queryKey: ["import-batches-open"] });
          return;
        }
        if (status === "failed") {
          fail(importId, {
            code: detail.batch.errorCode ?? "internal",
            message: detail.batch.errorMessage ?? "This file could not be read.",
          });
          return;
        }
        if (status === "confirmed" || status === "discarded") {
          fail(importId, { code: "finished", message: "This import is already finished." });
          return;
        }
        if (detail.batch.stalled) {
          fail(importId, {
            code: "stalled",
            message: "Reading stopped before it finished. Try again to pick up where it left off.",
          });
          return;
        }
        await sleep(POLL_MS);
      }
      if (mounted.current) {
        fail(importId, { code: "timeout", message: "Reading is taking longer than expected." });
      }
    },
    [fail, fetchBatch, patch, queryClient],
  );

  /** Send the file (or its text) to the server, then follow the batch it creates. */
  const runImport = useCallback(
    async (entry: CourseImport) => {
      patch(entry.importId, { status: "uploading", error: null });

      let started: StartImportResult;
      try {
        if (entry.kind === "epub") {
          if (entry.file!.size > MAX_EPUB_BYTES) {
            fail(entry.importId, {
              code: "file_too_large",
              message: "That file is larger than 30 MB. Try exporting fewer courses at once.",
            });
            return;
          }
          started = await uploadEpub(entry.file!);
        } else {
          // PDFs and screenshots are read to text first; text and pasted text need no reading.
          let text: string;
          if (entry.kind === "text") {
            text = entry.pastedText ?? (await entry.file!.text());
          } else {
            if (entry.file!.size > MAX_DOCUMENT_BYTES) {
              fail(entry.importId, {
                code: "file_too_large",
                message: "That file is larger than 15 MB. Try splitting it up.",
              });
              return;
            }
            const read = await readDocument({
              data: {
                fileName: entry.fileName,
                mimeType: entry.file!.type || "application/pdf",
                dataUrl: await toDataUrl(entry.file!),
              },
            });
            if (!read.ok) {
              fail(entry.importId, { code: read.kind, message: read.error });
              return;
            }
            text = read.text;
          }
          if (text.trim().length < 20) {
            fail(entry.importId, {
              code: "no_readable_content",
              message: "No readable text was found in this file.",
            });
            return;
          }
          started = await uploadText(entry.fileName, text.slice(0, MAX_TEXT_CHARS));
        }
      } catch (error) {
        fail(entry.importId, {
          code: "unknown",
          message: error instanceof Error ? error.message : "The file could not be read.",
        });
        return;
      }

      if (!started.ok) {
        fail(entry.importId, { code: started.code, message: started.message });
        return;
      }
      await follow(entry.importId, started.batchId);
    },
    [fail, follow, patch, readDocument],
  );

  /** Failed after upload: ask the server to read the missing sections again. */
  const retry = useCallback(
    async (entry: CourseImport) => {
      if (!entry.batchId) return runImport(entry);
      patch(entry.importId, { status: "reading", error: null });
      const resumed = await resumeImport(entry.batchId);
      if (!resumed.ok) {
        fail(entry.importId, { code: resumed.code, message: resumed.message });
        return;
      }
      await follow(entry.importId, entry.batchId);
    },
    [fail, follow, patch, runImport],
  );

  /** Run a set of files with bounded concurrency; each one succeeds or fails on its own. */
  const runAll = useCallback(
    async (entries: CourseImport[]) => {
      const queue = [...entries];
      const workers = Array.from({ length: Math.min(2, queue.length) }, () =>
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
      const entries = Array.from(fileList)
        .map((file) => {
          const kind = kindForFile(file);
          return kind ? newEntry(file, kind) : null;
        })
        .filter((entry): entry is CourseImport => entry !== null);
      if (entries.length === 0) return;
      setImports((prev) => [...prev, ...entries]);
      void runAll(entries);
    },
    [runAll],
  );

  /** Text typed or pasted straight into the page follows the identical pipeline. */
  const addPastedText = useCallback(
    (text: string) => {
      const entry = newPastedEntry(text);
      setImports((prev) => [...prev, entry]);
      void runAll([entry]);
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
      uploading: by("uploading"),
      reading: by("reading"),
      review: by("review"),
      failed: by("failed"),
    };
  }, [imports]);

  const working = summary.uploading + summary.reading > 0;
  const inSession = useMemo(
    () => new Set(imports.map((item) => item.batchId).filter((id): id is string => id !== null)),
    [imports],
  );

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

      <div className="grid gap-5">
        <OpenBatchesPanel skip={inSession} />

        <CanvasTutorial />

        <Panel>
          <PanelHeader title="Course files" aside="EPUB · PDF · image · text" />
          <ol className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-foreground/50">
            {["Upload", "Read", "Review", "Save"].map((step, index) => (
              <li key={step} className="flex items-center gap-2">
                {index > 0 ? <span aria-hidden>→</span> : null}
                <span>{step}</span>
              </li>
            ))}
          </ol>
          <div
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={`rounded-2xl border-2 border-dashed p-6 text-center transition-colors sm:p-8 ${
              dragging ? "border-brand bg-brand/5" : "border-border"
            }`}
          >
            <p className="font-display text-base text-foreground sm:text-lg">
              Drop your course files here
            </p>
            <p className="mx-auto mt-1 max-w-[46ch] text-pretty text-sm text-foreground/55">
              Canvas exports, syllabus PDFs, screenshots or photos of a schedule. Syllo reads each
              one, then shows you everything it found to check before anything is saved.
            </p>
            <div className="mt-4">
              <Button
                variant="brand"
                className="w-full sm:w-auto"
                onClick={() => fileInputRef.current?.click()}
              >
                Choose files
              </Button>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".epub,.pdf,.txt,.md,.png,.jpg,.jpeg,.webp,application/epub+zip,application/pdf,image/*,text/plain"
              className="hidden"
              onChange={(event) => {
                if (event.target.files) addFiles(event.target.files);
                event.target.value = "";
              }}
            />
          </div>

          {imports.length > 0 ? <ProgressSummary summary={summary} /> : null}
        </Panel>

        <PasteTextPanel onSubmit={(text) => addPastedText(text)} />

        {imports.map((item) => (
          <ImportCard key={item.importId} item={item} onRetry={() => void retry(item)} />
        ))}

        {summary.review > 0 && !working ? <ReadySummary imports={imports} /> : null}

        <AttentionPanel />
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Pieces                                                              */
/* ------------------------------------------------------------------ */

/** A small box for pasting syllabus text or an email straight from Canvas. */
function PasteTextPanel({ onSubmit }: { onSubmit: (text: string) => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");

  if (!open) {
    return (
      <Panel>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-left font-display text-base text-foreground underline-offset-4 hover:underline"
        >
          Or paste course text instead
        </button>
        <p className="mt-1 text-sm text-foreground/60">
          Copy a syllabus, schedule or email and Syllo will pull the dates out of it.
        </p>
      </Panel>
    );
  }

  return (
    <Panel>
      <PanelHeader title="Paste course text" aside="Syllabus, schedule or email" />
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        rows={8}
        placeholder="Paste the text here — assignment names, due dates, exam dates, policies…"
        className="w-full resize-y rounded-xl border border-border bg-background p-3 text-sm text-foreground outline-none focus:border-brand"
      />
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          variant="brand"
          disabled={text.trim().length < 20}
          onClick={() => {
            onSubmit(text.trim());
            setText("");
            setOpen(false);
          }}
        >
          Add this text
        </Button>
        <Button variant="soft" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </Panel>
  );
}

type Summary = {
  total: number;
  uploading: number;
  reading: number;
  review: number;
  failed: number;
};

function ProgressSummary({ summary }: { summary: Summary }) {
  const done = summary.review + summary.failed;
  const percent = summary.total === 0 ? 0 : Math.round((done / summary.total) * 100);

  const lines = [
    `${summary.total} file${summary.total === 1 ? "" : "s"} selected`,
    summary.uploading > 0 ? `${summary.uploading} uploading` : null,
    summary.reading > 0 ? `${summary.reading} reading` : null,
    summary.review > 0 ? `${summary.review} ready to review` : null,
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

/** Reading is done: nothing is saved until the student has looked at what was found. */
function ReadySummary({ imports }: { imports: CourseImport[] }) {
  const ready = imports.filter((item) => item.status === "review" && item.batchId !== null);
  return (
    <Panel className="border-brand/40">
      <div className="flex items-start gap-3">
        <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-brand" aria-hidden />
        <div className="min-w-0">
          <h2 className="font-display text-lg font-semibold text-foreground">
            Ready for your review.
          </h2>
          <p className="mt-1 text-sm text-foreground/60">
            Nothing is in your planner yet. Check what Syllo found, fix anything that is off, then
            confirm.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {ready.map((item) => (
              <Button key={item.importId} variant="brand" asChild>
                <Link to="/import-review" search={{ batch: item.batchId! }}>
                  Review {item.batch?.course.name ?? item.fileName}
                </Link>
              </Button>
            ))}
          </div>
        </div>
      </div>
    </Panel>
  );
}

/** Imports from an earlier visit that are still waiting for review. */
function OpenBatchesPanel({ skip }: { skip: Set<string> }) {
  const fetchOpen = useServerFn(listOpenImportBatches);
  const { data } = useQuery({
    queryKey: ["import-batches-open"],
    queryFn: () => fetchOpen(),
  });
  const batches = (data ?? []).filter((batch) => !skip.has(batch.id));
  if (batches.length === 0) return null;

  return (
    <Panel>
      <PanelHeader title="Pick up where you left off" aside={`${batches.length}`} />
      <div className="space-y-2">
        {batches.map((batch) => (
          <div
            key={batch.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border p-3"
          >
            <div className="min-w-0">
              <p className="truncate font-medium text-foreground">
                {batch.course.name ?? batch.filename}
              </p>
              <p className="text-xs text-foreground/50">
                {batch.status === "processing"
                  ? batch.stalled
                    ? "Reading stopped before it finished"
                    : `Reading · ${batch.chunksDone} of ${batch.chunksTotal} sections`
                  : batch.status === "partial"
                    ? "Some sections could not be read"
                    : "Ready to review"}
              </p>
            </div>
            <Button variant="soft" asChild>
              <Link to="/import-review" search={{ batch: batch.id }}>
                {batch.status === "processing" && !batch.stalled ? "Watch progress" : "Review"}
              </Link>
            </Button>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function ImportCard({ item, onRetry }: { item: CourseImport; onRetry: () => void }) {
  const busy = item.status === "uploading" || item.status === "reading";
  const batch = item.batch;
  const continueFn = useServerFn(continueManually);
  const [opening, setOpening] = useState(false);

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

      {batch ? (
        <div className="mt-4 space-y-1 text-sm">
          {batch.course.name ? (
            <p className="font-display text-base text-foreground">{batch.course.name}</p>
          ) : null}
          <p className="text-foreground/60">
            {item.status === "reading"
              ? `Reading section ${Math.min(batch.chunksDone + 1, batch.chunksTotal)} of ${batch.chunksTotal}`
              : `${batch.chunksDone} of ${batch.chunksTotal} sections read`}
          </p>
          {batch.warnings.map((warning) => (
            <p key={warning} className="text-xs text-foreground/50">
              ⚠ {warning}
            </p>
          ))}
        </div>
      ) : null}

      {item.status === "failed" ? (
        <div className="mt-4 space-y-3">
          <ErrorNote
            title="This file could not be imported"
            description={item.error?.message ?? "Something went wrong while processing this file."}
            onRetry={onRetry}
            retrying={busy}
          />
          {item.batchId && item.error?.code !== "not_found" ? (
            <Button
              variant="soft"
              loading={opening}
              onClick={async () => {
                setOpening(true);
                try {
                  await continueFn({ data: { batchId: item.batchId! } });
                } finally {
                  setOpening(false);
                }
                window.location.assign(`/import-review?batch=${item.batchId}`);
              }}
            >
              Enter the items by hand instead
            </Button>
          ) : null}
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
        <Button onClick={() => void runBulk("high_confidence_assignments")} loading={pending}>
          Approve all high-confidence assignments
        </Button>
        <Button onClick={() => void runBulk("reviewed_items")} loading={pending}>
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
          loading={busy}
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
