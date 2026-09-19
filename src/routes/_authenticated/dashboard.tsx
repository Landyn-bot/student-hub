import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";

import { PageHeader } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/app-button";
import { formatDay, PlannerItemDetails } from "@/components/app/PlannerItemDetails";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel, PanelHeader } from "@/components/ui/panel-surface";
import { getFocusPlan, type FocusItem } from "@/lib/focus.functions";
import { getOnboardingState } from "@/lib/onboarding.functions";
import { getPlannerData, type PlannerItem } from "@/lib/planner.functions";

/** "Due tomorrow", "Due Friday", "2 days past due" — never invented, always from the stored date. */
function dueLabel(item: FocusItem): string {
  if (item.overdue) {
    const days = Math.abs(item.daysUntil);
    return `${days} day${days === 1 ? "" : "s"} past due`;
  }
  if (item.daysUntil === 0) return "Due today";
  if (item.daysUntil === 1) return "Due tomorrow";
  return `Due ${formatDay(item.date)}`;
}

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — Syllo" },
      {
        name: "description",
        content:
          "Your semester at a glance: what is due today, what is coming up and how each course is tracking.",
      },
      { property: "og:title", content: "Dashboard — Syllo" },
      {
        property: "og:description",
        content: "Your semester at a glance, in one calm planner.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: DashboardPage,
});

/** Local calendar day as YYYY-MM-DD, so "today" matches the student's own day. */
function todayKey(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

function addDays(key: string, days: number): string {
  const date = new Date(`${key}T00:00:00`);
  date.setDate(date.getDate() + days);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function DashboardPage() {
  const fetchOnboarding = useServerFn(getOnboardingState);
  const fetchPlanner = useServerFn(getPlannerData);
  const fetchFocus = useServerFn(getFocusPlan);
  const [selected, setSelected] = useState<PlannerItem | null>(null);

  const { data: onboarding } = useQuery({
    queryKey: ["onboarding"],
    queryFn: () => fetchOnboarding(),
  });

  // Shares the planner cache key with the import flow, so the dashboard
  // refreshes itself as soon as newly imported data lands.
  const { data: planner, isPending } = useQuery({
    queryKey: ["planner"],
    queryFn: () => fetchPlanner(),
  });

  // Short ranked focus list; ranking is deterministic, wording comes from the model.
  const { data: focus, isPending: focusPending } = useQuery({
    queryKey: ["focus"],
    queryFn: () => fetchFocus(),
  });

  const groups = useMemo(() => {
    const today = todayKey();
    const weekEnd = addDays(today, 7);
    const items = planner?.items ?? [];
    const dated = items
      .filter((item): item is PlannerItem & { date: string } => Boolean(item.date))
      .sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? "").localeCompare(b.time ?? ""));

    const dueToday = dated.filter((item) => item.date === today);
    const upcoming = dated.filter((item) => item.date > today);
    const thisWeek = upcoming.filter((item) => item.date <= weekEnd);

    const byDate = new Map<string, PlannerItem[]>();
    for (const item of thisWeek) {
      const bucket = byDate.get(item.date) ?? [];
      bucket.push(item);
      byDate.set(item.date, bucket);
    }

    const perCourse = new Map<string, number>();
    for (const item of [...dueToday, ...upcoming]) {
      if (!item.courseId) continue;
      perCourse.set(item.courseId, (perCourse.get(item.courseId) ?? 0) + 1);
    }

    return { dueToday, upcoming, week: [...byDate.entries()], perCourse };
  }, [planner]);

  const courses = planner?.courses ?? [];
  const attention = planner?.attentionCount ?? 0;

  return (
    <>
      <PageHeader
        eyebrow={onboarding?.term?.name ?? "Your current semester"}
        title="Your semester, kept in one glance."
        action={
          <Button variant="accent" asChild>
            <Link to="/import">+ Upload courses</Link>
          </Button>
        }
      />

      {attention > 0 && (
        <Panel className="mb-5 border-accent/40">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-lg font-semibold text-foreground">
                {attention} item{attention === 1 ? "" : "s"} need your attention
              </h2>
              <p className="text-sm text-foreground/60">
                Imported details Syllo could not confirm on its own.
              </p>
            </div>
            <Button variant="accent" asChild>
              <Link to="/import">Resolve them</Link>
            </Button>
          </div>
        </Panel>
      )}

      <Panel className="mb-5">
        <PanelHeader title="What should I work on?" aside="Ranked from your own deadlines" />
        {focusPending ? (
          <p className="text-sm text-foreground/50">Working out your priorities…</p>
        ) : (focus?.items.length ?? 0) === 0 ? (
          <EmptyState
            title="Nothing to prioritise yet"
            description={
              courses.length === 0
                ? "Upload your courses and Syllo will point you at the work that matters first."
                : "No dated work in the next couple of weeks."
            }
          />
        ) : (
          <ul className="space-y-2">
            {focus?.items.map((item) => {
              const match = planner?.items.find((entry) => entry.id === item.id) ?? null;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => match && setSelected(match)}
                    className="inset-tile flex w-full items-start justify-between gap-3 bg-background p-3 text-left transition hover:bg-primary/5"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-foreground">
                        {item.title}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-foreground/55">
                        {[item.courseName ?? "No course", dueLabel(item)].join(" · ")}
                      </span>
                      <span className="mt-1 block text-xs text-foreground/60">{item.reason}</span>
                    </span>
                    {item.overdue ? (
                      <span className="shrink-0 text-xs text-accent">Overdue</span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel>
          <PanelHeader
            title="Today"
            aside={groups.dueToday.length > 0 ? `${groups.dueToday.length} due` : undefined}
          />
          {isPending ? (
            <p className="text-sm text-foreground/50">Loading your day…</p>
          ) : groups.dueToday.length === 0 ? (
            <EmptyState
              title="Nothing due today"
              description={
                courses.length === 0
                  ? "Upload your courses and today's work shows up here."
                  : "Enjoy it — the next deadlines are listed under Upcoming."
              }
            />
          ) : (
            <ul className="space-y-2">
              {groups.dueToday.map((item) => (
                <ItemRow key={item.id} item={item} onOpen={setSelected} />
              ))}
            </ul>
          )}
        </Panel>

        <Panel>
          <PanelHeader
            title="Upcoming"
            aside={groups.upcoming.length > 0 ? `${groups.upcoming.length} items` : undefined}
          />
          {isPending ? (
            <p className="text-sm text-foreground/50">Loading…</p>
          ) : groups.upcoming.length === 0 ? (
            <EmptyState
              title="No upcoming work"
              description={
                courses.length === 0
                  ? "Assignments, exams and quizzes appear once a course is imported."
                  : "Nothing scheduled ahead — dated work will gather here."
              }
            />
          ) : (
            <ul className="space-y-2">
              {groups.upcoming.slice(0, 8).map((item) => (
                <ItemRow key={item.id} item={item} onOpen={setSelected} showDate />
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel className="mt-5">
        <PanelHeader title="This week" />
        {groups.week.length === 0 ? (
          <EmptyState
            title="A quiet week"
            description="Anything due in the next seven days gets grouped by day here."
          />
        ) : (
          <div className="space-y-4">
            {groups.week.map(([day, items]) => (
              <div key={day}>
                <h3 className="mb-2 text-[11px] uppercase tracking-[0.12em] text-foreground/50">
                  {formatDay(day)}
                </h3>
                <ul className="space-y-2">
                  {items.map((item) => (
                    <ItemRow key={item.id} item={item} onOpen={setSelected} />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel className="mt-5">
        <PanelHeader title="Courses" aside={courses.length > 0 ? `${courses.length}` : undefined} />
        {courses.length === 0 ? (
          <EmptyState
            title="No courses yet"
            description="Upload your course files and Syllo builds your semester from them."
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {courses.map((course) => (
              <div key={course.id} className="inset-tile bg-background p-4">
                <p className="font-display text-base font-semibold text-foreground">
                  {course.name}
                </p>
                <p className="mt-1 text-xs text-foreground/55">
                  {course.courseCode ?? course.instructor ?? "Imported course"}
                </p>
                <p className="mt-3 text-sm text-foreground/70">
                  {groups.perCourse.get(course.id) ?? 0} upcoming item
                  {(groups.perCourse.get(course.id) ?? 0) === 1 ? "" : "s"}
                </p>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <PlannerItemDetails item={selected} onClose={() => setSelected(null)} />
    </>
  );
}

/** One compact line: course, title, type and when it is due. */
function ItemRow({
  item,
  onOpen,
  showDate = false,
}: {
  item: PlannerItem;
  onOpen: (item: PlannerItem) => void;
  showDate?: boolean;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(item)}
        className="inset-tile flex w-full items-start justify-between gap-3 bg-background p-3 text-left transition hover:bg-primary/5"
      >
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-foreground">{item.title}</span>
          <span className="mt-0.5 block truncate text-xs text-foreground/55">
            {[item.courseName ?? "No course", item.type].join(" · ")}
          </span>
          {item.description && (
            <span className="mt-1 block truncate text-xs text-foreground/50">
              {item.description}
            </span>
          )}
        </span>
        <span className="shrink-0 text-right text-xs text-foreground/60">
          {showDate && item.date ? formatDay(item.date) : null}
          {item.time ? <span className="block">{item.time}</span> : null}
        </span>
      </button>
    </li>
  );
}
