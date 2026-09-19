import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";

import { PageHeader } from "@/components/app/PageHeader";
import { PlannerItemDetails } from "@/components/app/PlannerItemDetails";
import { Button } from "@/components/ui/app-button";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel, PanelHeader } from "@/components/ui/panel-surface";
import { getPlannerData, type PlannerItem } from "@/lib/planner.functions";

export const Route = createFileRoute("/_authenticated/calendar")({
  head: () => ({
    meta: [
      { title: "Calendar — Syllo" },
      {
        name: "description",
        content: "Assignments, exams, quizzes, projects and key dates on one timeline.",
      },
      { property: "og:title", content: "Calendar — Syllo" },
      {
        property: "og:description",
        content: "Assignments, exams, quizzes, projects and key dates on one timeline.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CalendarPage,
});

type View = "month" | "agenda";

/** Local calendar day as YYYY-MM-DD. */
function dayKey(date: Date): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function CalendarPage() {
  const fetchPlanner = useServerFn(getPlannerData);
  const [view, setView] = useState<View>("month");
  const [courseFilter, setCourseFilter] = useState<string | null>(null);
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [selected, setSelected] = useState<PlannerItem | null>(null);

  // Same cache key as the dashboard — imported data refreshes both views.
  const { data: planner, isPending } = useQuery({
    queryKey: ["planner"],
    queryFn: () => fetchPlanner(),
  });

  const courses = planner?.courses ?? [];
  const items = useMemo(() => {
    const dated = (planner?.items ?? []).filter((item): item is PlannerItem & { date: string } =>
      Boolean(item.date),
    );
    return courseFilter ? dated.filter((item) => item.courseId === courseFilter) : dated;
  }, [planner, courseFilter]);

  const byDate = useMemo(() => {
    const map = new Map<string, PlannerItem[]>();
    for (const item of items) {
      const bucket = map.get(item.date) ?? [];
      bucket.push(item);
      map.set(item.date, bucket);
    }
    for (const bucket of map.values()) {
      bucket.sort((a, b) => (a.time ?? "").localeCompare(b.time ?? ""));
    }
    return map;
  }, [items]);

  const monthLabel = month.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const moveMonth = (delta: number) =>
    setMonth((current) => new Date(current.getFullYear(), current.getMonth() + delta, 1));

  return (
    <>
      <PageHeader
        eyebrow="Calendar"
        title="Deadlines and dates, one timeline."
        action={
          <Button variant="accent" asChild>
            <Link to="/import">+ Upload courses</Link>
          </Button>
        }
      />

      {/* Course filter + view switch */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant={variant={courseFilter === null ? "accent" : "soft"}}
          onClick={() => setCourseFilter(null)}
        >
          All courses
        </Button>
        {courses.map((course) => (
          <Button
            key={course.id}
            size="sm"
            variant={variant={courseFilter === course.id ? "accent" : "soft"}}
            onClick={() => setCourseFilter(courseFilter === course.id ? null : course.id)}
          >
            {course.courseCode ?? course.name}
          </Button>
        ))}
        <div className="ml-auto flex gap-2">
          <Button
            size="sm"
            variant={variant={view === "month" ? "accent" : "soft"}}
            onClick={() => setView("month")}
          >
            Month
          </Button>
          <Button
            size="sm"
            variant={variant={view === "agenda" ? "accent" : "soft"}}
            onClick={() => setView("agenda")}
          >
            Agenda
          </Button>
        </div>
      </div>

      {isPending ? (
        <Panel>
          <p className="text-sm text-foreground/50">Loading your calendar…</p>
        </Panel>
      ) : items.length === 0 ? (
        <Panel>
          <EmptyState
            title={courses.length === 0 ? "No courses yet" : "Nothing scheduled"}
            description={
              courses.length === 0
                ? "Upload your course files and dated work lands here automatically."
                : courseFilter
                  ? "This course has nothing dated right now — try another course or all courses."
                  : "Once an import finds due dates and exam days, they appear here."
            }
          />
        </Panel>
      ) : view === "month" ? (
        <MonthView
          month={month}
          byDate={byDate}
          onMove={moveMonth}
          onOpen={setSelected}
          label={monthLabel}
        />
      ) : (
        <AgendaView byDate={byDate} onOpen={setSelected} />
      )}

      <PlannerItemDetails item={selected} onClose={() => setSelected(null)} />
    </>
  );
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** A simple one-month grid; each day lists its items. */
function MonthView({
  month,
  byDate,
  onMove,
  onOpen,
  label,
}: {
  month: Date;
  byDate: Map<string, PlannerItem[]>;
  onMove: (delta: number) => void;
  onOpen: (item: PlannerItem) => void;
  label: string;
}) {
  const today = dayKey(new Date());
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  // Monday-first grid: find the Monday on or before the 1st of the month.
  const first = new Date(year, monthIndex, 1);
  const startOffset = (first.getDay() + 6) % 7;
  const gridStart = new Date(year, monthIndex, 1 - startOffset);
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const cellCount = Math.ceil((startOffset + daysInMonth) / 7) * 7;

  const cells = Array.from({ length: cellCount }, (_, i) => {
    const date = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
    const key = dayKey(date);
    return { key, inMonth: date.getMonth() === monthIndex, day: date.getDate() };
  });

  return (
    <Panel>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-lg font-semibold text-foreground">{label}</h2>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={() => onMove(-1)}>
            ←
          </Button>
          <Button size="sm" variant="secondary" onClick={() => onMove(1)}>
            →
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-px text-center text-[11px] uppercase tracking-[0.1em] text-foreground/45">
        {WEEKDAYS.map((day) => (
          <span key={day} className="pb-1">
            {day}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((cell) => {
          const items = byDate.get(cell.key) ?? [];
          return (
            <div
              key={cell.key}
              className={`inset-tile min-h-20 p-1.5 text-left ${
                cell.inMonth ? "bg-background" : "bg-foreground/2 opacity-45"
              } ${cell.key === today ? "ring-1 ring-accent" : ""}`}
            >
              <span className="text-xs text-foreground/60">{cell.day}</span>
              <ul className="mt-1 space-y-1">
                {items.slice(0, 3).map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => onOpen(item)}
                      className="block w-full truncate rounded-md bg-primary/10 px-1.5 py-0.5 text-left text-[11px] text-foreground/80 hover:bg-primary/15"
                    >
                      {item.title}
                    </button>
                  </li>
                ))}
                {items.length > 3 && (
                  <li className="pl-1 text-[11px] text-foreground/50">+{items.length - 3} more</li>
                )}
              </ul>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

/** A list of days, soonest first, each with its items. */
function AgendaView({
  byDate,
  onOpen,
}: {
  byDate: Map<string, PlannerItem[]>;
  onOpen: (item: PlannerItem) => void;
}) {
  const days = [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b));

  return (
    <Panel>
      <PanelHeader title="Agenda" aside={`${days.length} days with plans`} />
      <div className="space-y-4">
        {days.map(([day, items]) => (
          <div key={day}>
            <h3 className="mb-2 text-[11px] uppercase tracking-[0.12em] text-foreground/50">
              {new Date(`${day}T00:00:00`).toLocaleDateString(undefined, {
                weekday: "long",
                month: "short",
                day: "numeric",
              })}
            </h3>
            <ul className="space-y-2">
              {items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => onOpen(item)}
                    className="inset-tile flex w-full items-start justify-between gap-3 bg-background p-3 text-left transition hover:bg-primary/5"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-foreground">
                        {item.title}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-foreground/55">
                        {[item.courseName ?? "No course", item.type].join(" · ")}
                      </span>
                    </span>
                    {/* Date-only items stay date-only; a time shows only when the source had one. */}
                    {item.time && (
                      <span className="shrink-0 text-xs text-foreground/60">{item.time}</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Panel>
  );
}
