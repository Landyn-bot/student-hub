// A single ordered list of everything dated, drawn from the same planner data the
// dashboard and calendar use. No separate data source, no new model.
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";

import { PageHeader } from "@/components/app/PageHeader";
import { formatDay, PlannerItemDetails } from "@/components/app/PlannerItemDetails";
import { ErrorNote, LoadingRows } from "@/components/app/StatusNote";
import { Button } from "@/components/ui/app-button";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel, PanelHeader } from "@/components/ui/panel-surface";
import { getPlannerData, type PlannerItem } from "@/lib/planner.functions";

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

function AssignmentsPage() {
  const fetchPlanner = useServerFn(getPlannerData);
  const [selected, setSelected] = useState<PlannerItem | null>(null);

  const { data, isPending, isError, refetch, isRefetching } = useQuery({
    queryKey: ["planner"],
    queryFn: () => fetchPlanner(),
  });

  const items = useMemo(() => {
    const all = data?.items ?? [];
    return all
      .slice()
      .sort(
        (a, b) =>
          (a.date ?? "9999").localeCompare(b.date ?? "9999") ||
          (a.time ?? "").localeCompare(b.time ?? ""),
      );
  }, [data]);

  return (
    <>
      <PageHeader
        eyebrow="Assignments"
        title="What's due, in order."
        action={
          <Button variant="accent" asChild>
            <Link to="/import">+ Upload courses</Link>
          </Button>
        }
      />

      <Panel>
        <PanelHeader
          title="All coursework"
          aside={items.length > 0 ? `${items.length} items` : undefined}
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
          <EmptyState
            title="No assignments tracked"
            description="Upload your course files and every dated piece of work gathers here."
            action={
              <Button variant="brand" asChild>
                <Link to="/import">Upload courses</Link>
              </Button>
            }
          />
        ) : (
          <ul className="space-y-2">
            {items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => setSelected(item)}
                  className="inset-tile flex w-full items-start justify-between gap-3 bg-background p-3 text-left transition hover:bg-primary/5"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground">
                      {item.title}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-foreground/55">
                      {[item.courseName ?? "No course", item.type].join(" · ")}
                    </span>
                  </span>
                  <span className="shrink-0 text-right text-xs text-foreground/60">
                    {item.date ? formatDay(item.date) : "No date"}
                    {item.time ? <span className="block">{item.time}</span> : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <PlannerItemDetails item={selected} onClose={() => setSelected(null)} />
    </>
  );
}
