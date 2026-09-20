// Review screen: the student's checkpoint between "the model read my course" and "it is in my
// planner". Everything here comes from staging tables; nothing on this page has reached the
// dashboard yet, and nothing does until the student confirms.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import { PageHeader } from "@/components/app/PageHeader";
import { ErrorNote, LoadingRows } from "@/components/app/StatusNote";
import { Button } from "@/components/ui/app-button";
import { Panel, PanelHeader } from "@/components/ui/panel-surface";
import { resumeImport } from "@/lib/import-client";
import {
  acknowledgeStagedItems,
  addStagedItem,
  confirmImportBatch,
  continueManually,
  discardImportBatch,
  getImportBatch,
  setStagedItemRemoved,
  updateBatchCourse,
  updateStagedItem,
  type ConfirmResult,
  type ImportBatchDetail,
  type StagedItem,
  type StagedKind,
} from "@/lib/import-review.functions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/import-review")({
  validateSearch: (search: Record<string, unknown>): { batch: string } => ({
    batch: typeof search["batch"] === "string" ? search["batch"] : "",
  }),
  head: () => ({
    meta: [
      { title: "Review import — Syllo" },
      {
        name: "description",
        content: "Check what Syllo found in your course export before it reaches your planner.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ReviewPage,
});

const fieldClass =
  "w-full rounded-xl border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const SUBTYPES: Record<StagedKind, { value: string; label: string }[]> = {
  deadline: [
    { value: "assignment", label: "Assignment" },
    { value: "quiz", label: "Quiz" },
    { value: "project", label: "Project" },
    { value: "reading", label: "Reading" },
    { value: "lab", label: "Lab" },
    { value: "discussion", label: "Discussion" },
    { value: "other", label: "Other" },
  ],
  exam: [
    { value: "exam", label: "Exam" },
    { value: "midterm", label: "Midterm" },
    { value: "final", label: "Final" },
    { value: "other", label: "Other" },
  ],
  class_meeting: [{ value: "class", label: "Class" }],
  policy: [
    { value: "late_work", label: "Late work" },
    { value: "attendance", label: "Attendance" },
    { value: "missed_exam", label: "Missed exam" },
    { value: "academic_integrity", label: "Academic integrity" },
    { value: "grading", label: "Grading" },
    { value: "other", label: "Other" },
  ],
};

const GROUPS: { kind: StagedKind; title: string; noun: string; empty: string }[] = [
  { kind: "deadline", title: "Deadlines", noun: "deadline", empty: "No deadlines found." },
  { kind: "exam", title: "Exams", noun: "exam", empty: "No exams found." },
  {
    kind: "class_meeting",
    title: "Class meetings",
    noun: "class meeting",
    empty: "No weekly class times found.",
  },
  { kind: "policy", title: "Policies", noun: "policy", empty: "No policies found." },
];

function labelFor(kind: StagedKind, subtype: string): string {
  return SUBTYPES[kind].find((option) => option.value === subtype)?.label ?? subtype;
}

function formatDate(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatTime(time: string): string {
  const [h, m] = time.split(":").map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

/** One-line description of when something happens. */
function whenText(item: StagedItem): string {
  if (item.kind === "class_meeting") {
    const days = (item.weekdays ?? []).map((d) => WEEKDAYS[d - 1]).join(" / ");
    const times = item.startTime
      ? `${formatTime(item.startTime)}${item.endTime ? `–${formatTime(item.endTime)}` : ""}`
      : "";
    return [days, times].filter(Boolean).join(" · ");
  }
  if (item.kind === "policy") return "";
  const parts = [item.date ? formatDate(item.date) : "No date"];
  if (item.startTime) {
    parts.push(
      item.endTime
        ? `${formatTime(item.startTime)}–${formatTime(item.endTime)}`
        : formatTime(item.startTime),
    );
  }
  return parts.join(" · ");
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

function ReviewPage() {
  const { batch: batchId } = Route.useSearch();
  const queryClient = useQueryClient();
  const fetchBatch = useServerFn(getImportBatch);

  const [result, setResult] = useState<Extract<ConfirmResult, { ok: true }> | null>(null);

  const { data, isPending, isError, refetch, isRefetching } = useQuery({
    queryKey: ["import-batch", batchId],
    queryFn: () => fetchBatch({ data: { batchId } }),
    enabled: batchId !== "",
    refetchInterval: (query) => (query.state.data?.batch.status === "processing" ? 2_000 : false),
  });

  const reload = () => queryClient.invalidateQueries({ queryKey: ["import-batch", batchId] });

  if (batchId === "" || (!isPending && !isError && data === null)) {
    return (
      <>
        <PageHeader eyebrow="Review" title="We could not find that import." />
        <Panel>
          <p className="text-sm text-foreground/60">It may have been saved or discarded already.</p>
          <Button variant="brand" className="mt-4" asChild>
            <Link to="/import">Back to import</Link>
          </Button>
        </Panel>
      </>
    );
  }

  if (result) return <SavedPanel result={result} />;

  if (isPending) {
    return (
      <>
        <PageHeader eyebrow="Review" title="Opening your import…" />
        <LoadingRows rows={4} />
      </>
    );
  }

  if (isError || !data) {
    return (
      <>
        <PageHeader eyebrow="Review" title="Check what Syllo found." />
        <Panel>
          <ErrorNote onRetry={() => void refetch()} retrying={isRefetching} />
        </Panel>
      </>
    );
  }

  const { batch } = data;

  if (batch.status === "confirmed" || batch.status === "discarded") {
    return (
      <>
        <PageHeader eyebrow="Review" title="This import is finished." />
        <Panel>
          <p className="text-sm text-foreground/60">
            {batch.status === "confirmed"
              ? "Everything from this file is already in your planner."
              : "This import was discarded."}
          </p>
          <Button variant="brand" className="mt-4" asChild>
            <Link to="/import">Import another course</Link>
          </Button>
        </Panel>
      </>
    );
  }

  if (batch.status === "processing") return <ReadingPanel data={data} onChanged={reload} />;

  return <ReviewBoard data={data} onChanged={reload} onSaved={setResult} />;
}

/* ------------------------------------------------------------------ */
/* While the server is still reading                                   */
/* ------------------------------------------------------------------ */

function ReadingPanel({ data, onChanged }: { data: ImportBatchDetail; onChanged: () => void }) {
  const { batch } = data;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const percent =
    batch.chunksTotal === 0 ? 0 : Math.round((batch.chunksDone / batch.chunksTotal) * 100);

  return (
    <>
      <PageHeader eyebrow="Review" title="Reading your course…" />
      <Panel>
        <p className="font-medium text-foreground">{batch.course.name ?? batch.filename}</p>
        <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-foreground/10">
          <div
            className="h-full rounded-full bg-brand transition-all"
            style={{ width: `${percent}%` }}
          />
        </div>
        <p className="mt-2 flex items-center gap-2 text-sm text-foreground/60">
          {batch.stalled ? null : <Loader2 className="size-3.5 animate-spin" aria-hidden />}
          {batch.stalled
            ? "Reading stopped before it finished."
            : `Section ${Math.min(batch.chunksDone + 1, batch.chunksTotal)} of ${batch.chunksTotal}`}
        </p>
        {batch.stalled ? (
          <div className="mt-4">
            <Button
              variant="brand"
              loading={busy}
              onClick={async () => {
                setBusy(true);
                setError(null);
                const resumed = await resumeImport(batch.id);
                if (!resumed.ok) setError(resumed.message);
                setBusy(false);
                onChanged();
              }}
            >
              Pick up where it left off
            </Button>
          </div>
        ) : null}
        {error ? <p className="mt-3 text-sm text-accent">{error}</p> : null}
      </Panel>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Confirmation                                                        */
/* ------------------------------------------------------------------ */

function SavedPanel({ result }: { result: Extract<ConfirmResult, { ok: true }> }) {
  const parts = [
    `${result.itemsSaved} deadline${result.itemsSaved === 1 ? "" : "s"} and policies`,
    `${result.examsSaved} exam${result.examsSaved === 1 ? "" : "s"}`,
    `${result.classMeetingsSaved} class time${result.classMeetingsSaved === 1 ? "" : "s"}`,
  ];
  return (
    <>
      <PageHeader eyebrow="Review" title="Added to your planner." />
      <Panel className="border-brand/40">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-brand" aria-hidden />
          <div className="min-w-0">
            <h2 className="font-display text-lg font-semibold text-foreground">
              {result.courseName}
            </h2>
            <p className="mt-1 text-sm text-foreground/60">{parts.join(" · ")}</p>
            {result.merged > 0 || result.autoResolved > 0 ? (
              <p className="mt-1 text-sm text-foreground/60">
                {result.merged} matched something already in your planner
                {result.autoResolved > 0 ? `, ${result.autoResolved} updated to a newer date` : ""}.
              </p>
            ) : null}
            {result.needsAttention > 0 ? (
              <p className="mt-1 text-sm text-accent">
                {result.needsAttention} item{result.needsAttention === 1 ? "" : "s"} disagree with
                something already saved and need a quick look on the Import page.
              </p>
            ) : null}
            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant="brand" asChild>
                <Link to="/dashboard">Go to my dashboard</Link>
              </Button>
              <Button variant="soft" asChild>
                <Link to="/import">Import another course</Link>
              </Button>
            </div>
          </div>
        </div>
      </Panel>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* The review board                                                    */
/* ------------------------------------------------------------------ */

function ReviewBoard({
  data,
  onChanged,
  onSaved,
}: {
  data: ImportBatchDetail;
  onChanged: () => void;
  onSaved: (result: Extract<ConfirmResult, { ok: true }>) => void;
}) {
  const { batch, items } = data;
  const queryClient = useQueryClient();

  const acknowledge = useServerFn(acknowledgeStagedItems);
  const confirm = useServerFn(confirmImportBatch);
  const discard = useServerFn(discardImportBatch);
  const manual = useServerFn(continueManually);

  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resuming, setResuming] = useState(false);

  const active = items.filter((item) => !item.removed);
  const flagged = active.filter((item) => item.needsReview);
  const canConfirm = active.length > 0 && flagged.length === 0;

  const confirmMutation = useMutation({
    mutationFn: () => confirm({ data: { batchId: batch.id } }),
    onSuccess: async (result) => {
      if (!result.ok) {
        setError(result.error);
        return;
      }
      await Promise.all(
        ["planner", "focus", "courses", "attention-items", "import-batches-open"].map((key) =>
          queryClient.invalidateQueries({ queryKey: [key] }),
        ),
      );
      onSaved(result);
    },
    onError: () => setError("That could not be saved. Nothing was added — try again."),
  });

  const discardMutation = useMutation({
    mutationFn: () => discard({ data: { batchId: batch.id } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["import-batches-open"] });
      onChanged();
    },
  });

  const acknowledgeAll = useMutation({
    mutationFn: () => acknowledge({ data: { ids: flagged.map((item) => item.id) } }),
    onSuccess: onChanged,
  });

  return (
    <>
      <PageHeader eyebrow="Review import" title="Check what Syllo found." />

      <div className="grid gap-5 pb-28">
        <Panel>
          <p className="text-sm text-foreground/60">
            Nothing here is in your planner yet. Each item shows the exact words it came from, so
            you can check it in one glance. Fix what is off, remove what does not belong, then
            confirm.
          </p>
        </Panel>

        {batch.status === "failed" ? (
          <Panel>
            <ErrorNote
              title="This file could not be read automatically"
              description={batch.errorMessage ?? "Something went wrong while reading this file."}
              onRetry={async () => {
                setResuming(true);
                const resumed = await resumeImport(batch.id);
                if (!resumed.ok) setError(resumed.message);
                setResuming(false);
                onChanged();
              }}
              retrying={resuming}
              action={
                <Button
                  size="sm"
                  variant="soft"
                  onClick={async () => {
                    await manual({ data: { batchId: batch.id } });
                    onChanged();
                  }}
                >
                  Enter items by hand
                </Button>
              }
            />
          </Panel>
        ) : null}

        {batch.status === "partial" || batch.warnings.length > 0 ? (
          <Panel>
            {batch.warnings.map((warning) => (
              <p key={warning} className="text-sm text-foreground/60">
                ⚠ {warning}
              </p>
            ))}
            {batch.status === "partial" ? (
              <div className="mt-3">
                <Button
                  size="sm"
                  variant="soft"
                  loading={resuming}
                  onClick={async () => {
                    setResuming(true);
                    const resumed = await resumeImport(batch.id);
                    if (!resumed.ok) setError(resumed.message);
                    setResuming(false);
                    onChanged();
                  }}
                >
                  Read the missing sections again
                </Button>
              </div>
            ) : null}
          </Panel>
        ) : null}

        <CoursePanel batch={batch} onChanged={onChanged} />

        {flagged.length > 0 ? (
          <Panel className="border-accent/40">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-medium text-foreground">
                  {flagged.length} item{flagged.length === 1 ? "" : "s"} need a look
                </p>
                <p className="text-sm text-foreground/60">
                  Syllo was unsure about these. Fix them, mark them as correct, or remove them.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="soft" onClick={() => setOnlyFlagged((v) => !v)}>
                  {onlyFlagged ? "Show everything" : "Show only these"}
                </Button>
                <Button
                  size="sm"
                  variant="soft"
                  loading={acknowledgeAll.isPending}
                  onClick={() => acknowledgeAll.mutate()}
                >
                  All of these are correct
                </Button>
              </div>
            </div>
          </Panel>
        ) : null}

        {GROUPS.map((group) => (
          <Group
            key={group.kind}
            group={group}
            batchId={batch.id}
            items={items.filter((item) => item.kind === group.kind)}
            onlyFlagged={onlyFlagged}
            onChanged={onChanged}
          />
        ))}
      </div>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background/95 px-4 py-3 backdrop-blur sm:left-[var(--sidebar-width,0px)]">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-foreground/70">
            {active.length} item{active.length === 1 ? "" : "s"} will be added
            {flagged.length > 0 ? (
              <span className="text-accent"> · {flagged.length} still need a look</span>
            ) : null}
            {error ? <span className="block text-accent">{error}</span> : null}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              loading={discardMutation.isPending}
              onClick={() => {
                if (window.confirm("Discard this import? Nothing will be added to your planner.")) {
                  discardMutation.mutate();
                }
              }}
            >
              Discard
            </Button>
            <Button
              variant="brand"
              disabled={!canConfirm}
              loading={confirmMutation.isPending}
              onClick={() => {
                setError(null);
                confirmMutation.mutate();
              }}
            >
              Confirm and add to my planner
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Course details                                                      */
/* ------------------------------------------------------------------ */

function CoursePanel({
  batch,
  onChanged,
}: {
  batch: ImportBatchDetail["batch"];
  onChanged: () => void;
}) {
  const save = useServerFn(updateBatchCourse);
  const [name, setName] = useState(batch.course.name ?? batch.filename.replace(/\.[^.]+$/, ""));
  const [code, setCode] = useState(batch.course.code ?? "");
  const [instructor, setInstructor] = useState(batch.course.instructor ?? "");
  const [term, setTerm] = useState(batch.course.term ?? "");

  // Pick up values the reader found after this panel first rendered.
  useEffect(() => {
    setName((current) => batch.course.name ?? current);
    setCode((current) => batch.course.code ?? current);
    setInstructor((current) => batch.course.instructor ?? current);
    setTerm((current) => batch.course.term ?? current);
  }, [batch.course.name, batch.course.code, batch.course.instructor, batch.course.term]);

  const commit = async () => {
    if (name.trim() === "") return;
    await save({
      data: {
        batchId: batch.id,
        name: name.trim(),
        code: code.trim() || null,
        instructor: instructor.trim() || null,
        term: term.trim() || null,
      },
    });
    onChanged();
  };

  return (
    <Panel>
      <PanelHeader title="Course" aside={batch.filename} />
      <p className="mb-3 text-sm text-foreground/60">
        Canvas export titles are messy. This is the name that will show across Syllo.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-sm sm:col-span-2">
          <span className="text-muted-foreground">Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => void commit()}
            maxLength={200}
            className={fieldClass}
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-muted-foreground">Course code</span>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onBlur={() => void commit()}
            maxLength={40}
            className={fieldClass}
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-muted-foreground">Instructor</span>
          <input
            value={instructor}
            onChange={(e) => setInstructor(e.target.value)}
            onBlur={() => void commit()}
            maxLength={120}
            className={fieldClass}
          />
        </label>
        <label className="space-y-1 text-sm sm:col-span-2">
          <span className="text-muted-foreground">Term</span>
          <input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            onBlur={() => void commit()}
            maxLength={60}
            className={fieldClass}
          />
        </label>
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* One kind of record                                                  */
/* ------------------------------------------------------------------ */

function Group({
  group,
  batchId,
  items,
  onlyFlagged,
  onChanged,
}: {
  group: (typeof GROUPS)[number];
  batchId: string;
  items: StagedItem[];
  onlyFlagged: boolean;
  onChanged: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const add = useServerFn(addStagedItem);

  const visible = items.filter((item) => !onlyFlagged || (item.needsReview && !item.removed));
  const count = items.filter((item) => !item.removed).length;
  if (onlyFlagged && visible.length === 0) return null;

  return (
    <Panel>
      <PanelHeader
        title={group.title}
        aside={
          <Button size="sm" variant="ghost" onClick={() => setAdding((open) => !open)}>
            {adding ? "Cancel" : `+ Add ${group.noun}`}
          </Button>
        }
      />
      <p className="-mt-2 mb-3 text-xs text-foreground/45">{count} to be added</p>

      {adding ? (
        <div className="mb-3 rounded-2xl border border-border p-4">
          <ItemEditor
            kind={group.kind}
            item={null}
            submitLabel={`Add ${group.noun}`}
            onCancel={() => setAdding(false)}
            onSubmit={async (fields) => {
              const result = await add({ data: { batchId, kind: group.kind, fields } });
              if (result.ok) {
                setAdding(false);
                onChanged();
                return null;
              }
              return "That could not be added. Check the fields and try again.";
            }}
          />
        </div>
      ) : null}

      {visible.length === 0 && !adding ? (
        <p className="text-sm text-foreground/50">{group.empty}</p>
      ) : (
        <ul className="space-y-2">
          {visible.map((item) => (
            <ItemRow key={item.id} item={item} onChanged={onChanged} />
          ))}
        </ul>
      )}
    </Panel>
  );
}

function ItemRow({ item, onChanged }: { item: StagedItem; onChanged: () => void }) {
  const update = useServerFn(updateStagedItem);
  const remove = useServerFn(setStagedItemRemoved);
  const acknowledge = useServerFn(acknowledgeStagedItems);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  const confidence = item.confidence === null ? null : Math.round(item.confidence * 100);
  const when = whenText(item);

  return (
    <li
      className={cn(
        "rounded-2xl border p-4",
        item.removed
          ? "border-border/60 bg-foreground/[0.02]"
          : item.needsReview
            ? "border-accent/40"
            : "border-border",
      )}
    >
      {editing ? (
        <ItemEditor
          kind={item.kind}
          item={item}
          submitLabel="Save changes"
          onCancel={() => setEditing(false)}
          onSubmit={async (fields) => {
            const result = await update({ data: { id: item.id, patch: fields } });
            if (result.ok) {
              setEditing(false);
              onChanged();
              return null;
            }
            return "That could not be saved. Check the fields and try again.";
          }}
        />
      ) : (
        <>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p
                className={cn(
                  "font-medium text-foreground",
                  item.removed && "text-foreground/40 line-through",
                )}
              >
                {item.title}
              </p>
              <p className="mt-0.5 text-xs uppercase tracking-wide text-foreground/45">
                {labelFor(item.kind, item.subtype)}
                {when ? ` · ${when}` : ""}
                {item.location ? ` · ${item.location}` : ""}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2 text-xs">
              {item.addedByUser ? (
                <span className="rounded-full border border-border px-2 py-0.5 text-foreground/55">
                  Added by you
                </span>
              ) : item.edited ? (
                <span className="rounded-full border border-border px-2 py-0.5 text-foreground/55">
                  Edited
                </span>
              ) : null}
              {item.needsReview ? (
                <span className="rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-accent">
                  Check this
                </span>
              ) : confidence !== null && !item.addedByUser ? (
                <span className="text-foreground/40">{confidence}% sure</span>
              ) : null}
            </div>
          </div>

          {item.kind === "policy" && item.description ? (
            <p className="mt-2 text-sm text-foreground/70">{item.description}</p>
          ) : item.description ? (
            <p className="mt-2 text-sm text-foreground/60">{item.description}</p>
          ) : null}

          {item.parameters ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {Object.entries(item.parameters).map(([key, value]) => (
                <span
                  key={key}
                  className="rounded-full bg-foreground/5 px-2 py-0.5 text-xs text-foreground/60"
                >
                  {key.replace(/_/g, " ")}: {String(value)}
                </span>
              ))}
            </div>
          ) : null}

          {item.needsReview && item.reviewReason ? (
            <p className="mt-2 text-xs text-accent">{item.reviewReason}</p>
          ) : null}

          {item.sourceQuote || item.sourceSection ? (
            <details className="mt-2 text-xs text-foreground/55">
              <summary className="cursor-pointer select-none">Where this came from</summary>
              {item.sourceSection ? <p className="mt-1">{item.sourceSection}</p> : null}
              {item.sourceQuote ? (
                <blockquote className="mt-1 border-l-2 border-border pl-3">
                  “{item.sourceQuote}”
                </blockquote>
              ) : null}
            </details>
          ) : null}

          <div className="mt-3 flex flex-wrap gap-2">
            {item.removed ? (
              <Button
                size="sm"
                variant="soft"
                loading={busy}
                onClick={() => void run(() => remove({ data: { id: item.id, removed: false } }))}
              >
                Put back
              </Button>
            ) : (
              <>
                {item.needsReview ? (
                  <Button
                    size="sm"
                    variant="brand"
                    loading={busy}
                    onClick={() => void run(() => acknowledge({ data: { ids: [item.id] } }))}
                  >
                    Looks right
                  </Button>
                ) : null}
                <Button size="sm" variant="soft" onClick={() => setEditing(true)}>
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  loading={busy}
                  onClick={() => void run(() => remove({ data: { id: item.id, removed: true } }))}
                >
                  Remove
                </Button>
              </>
            )}
          </div>
        </>
      )}
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Editor (used to edit a record and to add one)                       */
/* ------------------------------------------------------------------ */

type Fields = {
  title: string;
  description: string | null;
  subtype: string;
  date: string | null;
  startTime: string | null;
  endTime: string | null;
  weekdays: number[] | null;
  location: string | null;
  points: number | null;
  weight: number | null;
};

function ItemEditor({
  kind,
  item,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  kind: StagedKind;
  item: StagedItem | null;
  submitLabel: string;
  onSubmit: (fields: Fields) => Promise<string | null>;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(item?.title ?? "");
  const [subtype, setSubtype] = useState(item?.subtype ?? SUBTYPES[kind][0]!.value);
  const [date, setDate] = useState(item?.date ?? "");
  const [startTime, setStartTime] = useState(item?.startTime ?? "");
  const [endTime, setEndTime] = useState(item?.endTime ?? "");
  const [weekdays, setWeekdays] = useState<number[]>(item?.weekdays ?? []);
  const [location, setLocation] = useState(item?.location ?? "");
  const [description, setDescription] = useState(item?.description ?? "");
  const [points, setPoints] = useState(item?.points?.toString() ?? "");
  const [weight, setWeight] = useState(item?.weight?.toString() ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const isPolicy = kind === "policy";
  const hasDate = kind === "deadline" || kind === "exam";
  const hasTimes = kind !== "policy";
  const hasLocation = kind === "exam" || kind === "class_meeting";
  const hasNumbers = kind === "deadline" || kind === "exam";

  const submit = async () => {
    setError(null);
    if (title.trim() === "") return setError("Give it a title.");
    if (kind === "class_meeting" && weekdays.length === 0)
      return setError("Pick at least one day.");
    if (isPolicy && description.trim() === "") return setError("Write out the rule.");

    const number = (value: string): number | null | "bad" => {
      if (value.trim() === "") return null;
      const parsed = Number(value);
      return Number.isFinite(parsed) && parsed >= 0 ? parsed : "bad";
    };
    const p = number(points);
    const w = number(weight);
    if (p === "bad" || w === "bad") return setError("Points and weight must be numbers.");
    if (w !== null && w > 100) return setError("Weight is a percentage from 0 to 100.");

    setSaving(true);
    const message = await onSubmit({
      title: title.trim(),
      description: description.trim() || null,
      subtype,
      date: hasDate ? date || null : null,
      startTime: hasTimes ? startTime || null : null,
      endTime: hasTimes && (kind === "exam" || kind === "class_meeting") ? endTime || null : null,
      weekdays: kind === "class_meeting" ? [...weekdays].sort() : null,
      location: hasLocation ? location.trim() || null : null,
      points: hasNumbers ? p : null,
      weight: hasNumbers ? w : null,
    });
    setSaving(false);
    if (message) setError(message);
  };

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <label className="space-y-1 text-sm">
          <span className="text-muted-foreground">Title</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={300}
            className={fieldClass}
          />
        </label>
        {SUBTYPES[kind].length > 1 ? (
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">Type</span>
            <select
              value={subtype}
              onChange={(e) => setSubtype(e.target.value)}
              className={fieldClass}
            >
              {SUBTYPES[kind].map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      {kind === "class_meeting" ? (
        <div className="space-y-1 text-sm">
          <span className="text-muted-foreground">Days</span>
          <div className="flex flex-wrap gap-2">
            {WEEKDAYS.map((label, index) => {
              const day = index + 1;
              const on = weekdays.includes(day);
              return (
                <Button
                  key={label}
                  type="button"
                  size="sm"
                  variant={on ? "brand" : "soft"}
                  aria-pressed={on}
                  onClick={() =>
                    setWeekdays((current) =>
                      on ? current.filter((d) => d !== day) : [...current, day],
                    )
                  }
                >
                  {label}
                </Button>
              );
            })}
          </div>
        </div>
      ) : null}

      {hasDate || hasTimes ? (
        <div className={cn("grid gap-3", hasDate ? "sm:grid-cols-3" : "sm:grid-cols-2")}>
          {hasDate ? (
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">Date</span>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className={fieldClass}
              />
            </label>
          ) : null}
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">
              {kind === "deadline" ? "Due time" : "Starts"}
            </span>
            <input
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className={fieldClass}
            />
          </label>
          {kind === "exam" || kind === "class_meeting" ? (
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">Ends</span>
              <input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className={fieldClass}
              />
            </label>
          ) : null}
        </div>
      ) : null}

      {hasLocation ? (
        <label className="block space-y-1 text-sm">
          <span className="text-muted-foreground">Location</span>
          <input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            maxLength={200}
            className={fieldClass}
          />
        </label>
      ) : null}

      {hasNumbers ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">Points (optional)</span>
            <input
              inputMode="decimal"
              value={points}
              onChange={(e) => setPoints(e.target.value)}
              className={fieldClass}
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">Weight in the grade, % (optional)</span>
            <input
              inputMode="decimal"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
              className={fieldClass}
            />
          </label>
        </div>
      ) : null}

      {kind !== "class_meeting" ? (
        <label className="block space-y-1 text-sm">
          <span className="text-muted-foreground">
            {isPolicy ? "The rule" : "Notes (optional)"}
          </span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={isPolicy ? 3 : 2}
            maxLength={2000}
            className={fieldClass}
          />
        </label>
      ) : null}

      {error ? <p className="text-sm text-accent">{error}</p> : null}

      <div className="flex flex-wrap gap-2">
        <Button variant="brand" size="sm" loading={saving} onClick={() => void submit()}>
          {submitLabel}
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
