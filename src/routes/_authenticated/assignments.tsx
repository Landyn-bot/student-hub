// A single ordered list of everything dated, drawn from the same planner data the
// dashboard and calendar use. No separate data source, no new model.
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import { ItemCheckbox } from "@/components/app/ItemCheckbox";
import { ManualItemForm } from "@/components/app/ManualItemForm";
import { PageHeader } from "@/components/app/PageHeader";
import { formatDay, PlannerItemDetails } from "@/components/app/PlannerItemDetails";
import { ErrorNote, LoadingRows } from "@/components/app/StatusNote";
import { Button } from "@/components/ui/app-button";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel, PanelHeader } from "@/components/ui/panel-surface";
import { coursePalette } from "@/lib/course-colors";
import { getPlannerData, type PlannerItem } from "@/lib/planner.functions";
import { cn } from "@/lib/utils";
import * as guestStore from "@/lib/guest/store";
import { useAppFn } from "@/lib/guest/use-app-fn";

export const Route = createFileRoute("/_authenticated/assignments")({
  head: () => ({
    meta: [
      { title: "Assignments — Syllo" },
      {
        name: "description",
        content: "Every reading, problem set and paper, sorted by what's next.",
      },
      { property: "og:title", content: "Assignments — Syllo" },
      {
        property: "og:description",
        content: "Every reading, problem set and paper, sorted by what's next.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AssignmentsPage,
});

/** Local YYYY-MM-DD, so "overdue" follows the student's own clock. */
function todayKey(): string {
  const now = new Date();
  const month = `${now.getMonth() + 1}`.padStart(2, "0");
  const day = `${now.getDate()}`.padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

type AssignmentFilter = "active" | "overdue" | "completed";

const FILTERS: { key: AssignmentFilter; label: string }[] = [
  { key: "active", label: "Active" },
  { key: "overdue", label: "Overdue" },
  { key: "completed", label: "Completed" },
];

function AssignmentsPage() {
  const fetchPlanner = useAppFn(getPlannerData, guestStore.getPlannerData);
  const [selected, setSelected] = useState<PlannerItem | null>(null);
  const [filter, setFilter] = useState<AssignmentFilter>("active");
  const [adding, setAdding] = useState(false);

  const { data, isPending, isError, refetch, isRefetching } = useQuery({
    queryKey: ["planner"],
    queryFn: () => fetchPlanner(),
  });

  const items = useMemo(() => {
    const all = data?.items ?? [];
    const today = todayKey();
    const matches = (item: PlannerItem) => {
      if (filter === "completed") return item.done;
      if (filter === "overdue") return !item.done && Boolean(item.date) && item.date! < today;
      // Active: work still to do, whether its date is coming up or unknown.
      return !item.done;
    };
    return all
      .filter(matches)
      .slice()
      .sort(
        (a, b) =>
          (a.date ?? "9999").localeCompare(b.date ?? "9999") ||
          (a.time ?? "").localeCompare(b.time ?? ""),
      );
  }, [data, filter]);

  const counts = useMemo(() => {
    const all = data?.items ?? [];
    const today = todayKey();
    return {
      active: all.filter((item) => !item.done).length,
      overdue: all.filter((item) => !item.done && Boolean(item.date) && item.date! < today).length,
      completed: all.filter((item) => item.done).length,
    };
  }, [data]);

  return (
    <>
      <PageHeader
        eyebrow="Assignments"
        title="What's due, in order."
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="soft" onClick={() => setAdding((open) => !open)}>
              {adding ? "Close" : "+ Add manually"}
            </Button>
            <Button variant="accent" asChild>
              <Link to="/import">+ Upload courses</Link>
            </Button>
          </div>
        }
      />

      {adding ? (
        <Panel className="mb-6">
          <PanelHeader title="Add it yourself" aside="No file needed" />
          <ManualItemForm courses={data?.courses ?? []} onDone={() => setAdding(false)} />
        </Panel>
      ) : null}

      <Panel>
        <PanelHeader
          title="All coursework"
          aside={
            <div className="flex gap-1 rounded-full bg-foreground/5 p-1">
              {FILTERS.map((entry) => (
                <button
                  key={entry.key}
                  type="button"
                  onClick={() => setFilter(entry.key)}
                  className={cn(
                    "rounded-full px-3 py-1 text-xs font-medium transition",
                    filter === entry.key
                      ? "bg-background text-foreground shadow-sm"
                      : "text-foreground/55 hover:text-foreground",
                  )}
                >
                  {entry.label}
                  {counts[entry.key] > 0 ? (
                    <span className="ml-1 text-foreground/45">{counts[entry.key]}</span>
                  ) : null}
                </button>
              ))}
            </div>
          }
        />
        {isPending ? (
          <LoadingRows rows={4} />
        ) : isError ? (
          <ErrorNote
            title="We could not load your coursework"
            onRetry={() => void refetch()}
            retrying={isRefetching}
          />
        ) : items.length === 0 ? (
          filter === "active" ? (
            <EmptyState
              title="Nothing active right now"
              description="Upload your course files and every dated piece of work gathers here."
              action={
                <Button variant="brand" asChild>
                  <Link to="/import">Upload courses</Link>
                </Button>
              }
            />
          ) : filter === "overdue" ? (
            <EmptyState
              title="Nothing overdue"
              description="Everything with a past date is checked off. Nice work."
            />
          ) : (
            <EmptyState
              title="Nothing completed yet"
              description="Tick the box beside an assignment when you've handed it in."
            />
          )
        ) : (
          <ul className="space-y-2">
            {items.map((item) => {
              const palette = coursePalette(item.courseId);
              return (
                <li key={item.id} className="flex items-stretch">
                  <ItemCheckbox id={item.id} completable={item.completable} />
                  <button
                    type="button"
                    onClick={() => setSelected(item)}
                    className={cn(
                      "inset-tile ml-2 flex w-full min-w-0 items-stretch gap-3 overflow-hidden bg-background text-left transition",
                      palette.hover,
                    )}
                  >
                    <span
                      className={cn("w-1.5 shrink-0 self-stretch", palette.solid)}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1 py-3">
                      <span className={cn("block truncate text-xs font-semibold", palette.text)}>
                        {item.courseName ?? "No course"}
                      </span>
                      <span className="block truncate text-sm font-medium text-foreground">
                        {item.title}
                      </span>
                      <span className="mt-0.5 block truncate text-xs capitalize text-foreground/55">
                        {item.type}
                      </span>
                    </span>
                    <span className="shrink-0 py-3 pr-3 text-right text-xs text-foreground/60">
                      {!item.done && item.date && item.date < todayKey() ? (
                        <span className="mb-1 inline-block rounded-full bg-accent/15 px-2 py-0.5 font-medium text-accent">
                          Overdue
                        </span>
                      ) : null}
                      <span className="block">{item.date ? formatDay(item.date) : "No date"}</span>
                      {item.time ? <span className="block">{item.time}</span> : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <PlannerItemDetails item={selected} onClose={() => setSelected(null)} />
    </>
  );
}
