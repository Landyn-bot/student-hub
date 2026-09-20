import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, CalendarClock, CheckCircle2, Clock3, History } from "lucide-react";
import { useMemo, useState } from "react";

import { CourseForm } from "@/components/app/CourseForm";
import { ItemCheckbox } from "@/components/app/ItemCheckbox";
import { ManualItemForm } from "@/components/app/ManualItemForm";
import { PageHeader } from "@/components/app/PageHeader";
import { formatDay, PlannerItemDetails } from "@/components/app/PlannerItemDetails";
import { ErrorNote, LoadingRows } from "@/components/app/StatusNote";
import { Button } from "@/components/ui/app-button";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel, PanelHeader } from "@/components/ui/panel-surface";
import { coursePalette } from "@/lib/course-colors";
import { listCourses } from "@/lib/courses.functions";
import { isOverdue, sortByPriority, todayKey } from "@/lib/item-priority";
import {
  getPlannerData,
  type PlannerCourse,
  type PlannerItem,
} from "@/lib/planner.functions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/courses/$courseId")({
  head: () => ({
    meta: [
      { title: "Course overview — Syllo" },
      {
        name: "description",
        content: "Everything for one class: upcoming work, quizzes, exams and class times.",
      },
      { property: "og:title", content: "Course overview — Syllo" },
      {
        property: "og:description",
        content: "Everything for one class, gathered on a single page.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CourseOverviewPage,
});

const WEEKDAYS = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** Groups the class's work into the buckets a student actually thinks in. */
const GROUPS: { key: string; label: string; match: (type: string) => boolean }[] = [
  { key: "exams", label: "Exams & quizzes", match: (t) => /quiz|exam|test|midterm|final/i.test(t) },
  { key: "projects", label: "Projects", match: (t) => /project/i.test(t) },
  { key: "readings", label: "Readings", match: (t) => /read|chapter/i.test(t) },
  { key: "assignments", label: "Assignments", match: () => true },
];

function CourseOverviewPage() {
  const { courseId } = Route.useParams();
  const fetchPlanner = useServerFn(getPlannerData);
  const fetchCourses = useServerFn(listCourses);
  const [selected, setSelected] = useState<PlannerItem | null>(null);
  const [editing, setEditing] = useState(false);
  // Add an assignment, quiz, exam or project straight onto this class.
  const [adding, setAdding] = useState(false);

  const {
    data: planner,
    isPending,
    isError,
    refetch,
    isRefetching,
  } = useQuery({
    queryKey: ["planner"],
    queryFn: () => fetchPlanner(),
  });
  const { data: courses } = useQuery({ queryKey: ["courses"], queryFn: () => fetchCourses() });

  const course = courses?.find((entry) => entry.id === courseId) ?? null;
  const plannerCourse = planner?.courses.find((entry) => entry.id === courseId) ?? null;
  const palette = coursePalette(courseId);

  const view = useMemo(() => {
    const today = todayKey();
    const mine = (planner?.items ?? []).filter((item) => item.courseId === courseId);

    const done = mine.filter((item) => item.done);
    const live = mine.filter((item) => !item.done);
    const overdue = live.filter((item) => isOverdue(item, today));
    const past = live.filter((item) => !isOverdue(item, today) && item.date && item.date < today);
    const ahead = sortByPriority(
      live.filter((item) => !overdue.includes(item) && !past.includes(item)),
      today,
    );

    const grouped = GROUPS.map((group) => ({
      ...group,
      items: ahead.filter(
        (item) =>
          group.match(item.type) &&
          !GROUPS.slice(0, GROUPS.indexOf(group)).some((earlier) => earlier.match(item.type)),
      ),
    })).filter((group) => group.items.length > 0);

    const meetings = (planner?.classMeetings ?? [])
      .filter((meeting) => meeting.courseId === courseId)
      .sort(
        (a, b) => a.weekday - b.weekday || (a.startTime ?? "").localeCompare(b.startTime ?? ""),
      );

    return { done, overdue, past, ahead, grouped, meetings };
  }, [planner, courseId]);

  const title = course?.name ?? plannerCourse?.name ?? "Course";

  return (
    <>
      <div className="mb-3">
        <Button size="sm" variant="soft" asChild>
          <Link to="/courses">
            <ArrowLeft className="mr-1 size-4" aria-hidden />
            All courses
          </Link>
        </Button>
      </div>

      <PageHeader
        eyebrow={course?.course_code ?? plannerCourse?.courseCode ?? "Course"}
        title={title}
        action={
          course ? (
            <Button variant="soft" onClick={() => setEditing((open) => !open)}>
              {editing ? "Close" : "Edit class"}
            </Button>
          ) : null
        }
      />

      {course?.instructor ? (
        <p className="-mt-2 mb-4 text-sm text-foreground/60">{course.instructor}</p>
      ) : null}

      {editing && course ? (
        <Panel className="mb-4 p-6">
          <h2 className="mb-4 font-display text-lg font-semibold">Edit class</h2>
          <CourseForm editing={course} onDone={() => setEditing(false)} />
        </Panel>
      ) : null}

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        {[
          { label: "Coming up", value: view.ahead.length, tint: "from-course-blue/20" },
          { label: "Overdue", value: view.overdue.length, tint: "from-course-coral/20" },
          { label: "Completed", value: view.done.length, tint: "from-course-leaf/20" },
        ].map((stat, index) => (
          <div
            key={stat.label}
            className={cn(
              "inset-tile tile-lift rise-in bg-gradient-to-br to-transparent p-4",
              stat.tint,
            )}
            style={{ animationDelay: `${index * 60}ms` }}
          >
            <p className="font-display text-2xl font-semibold text-foreground">{stat.value}</p>
            <p className="mt-0.5 text-xs uppercase tracking-[0.12em] text-foreground/50">
              {stat.label}
            </p>
          </div>
        ))}
      </div>

      {view.meetings.length > 0 ? (
        <Panel className="mb-5" delay={40}>
          <PanelHeader title="Class times" icon={<Clock3 className="size-4 text-course-teal" />} />
          <ul className="space-y-1.5">
            {view.meetings.map((meeting) => (
              <li key={meeting.id} className="text-sm text-foreground/70">
                <span className="font-medium text-foreground">{WEEKDAYS[meeting.weekday]}</span>
                {meeting.startTime
                  ? ` · ${meeting.startTime}${meeting.endTime ? `–${meeting.endTime}` : ""}`
                  : ""}
                {meeting.location ? ` · ${meeting.location}` : ""}
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      {isPending ? (
        <Panel>
          <LoadingRows rows={3} />
        </Panel>
      ) : isError ? (
        <Panel>
          <ErrorNote
            title="We could not load this class"
            onRetry={() => void refetch()}
            retrying={isRefetching}
          />
        </Panel>
      ) : (
        <>
          {view.overdue.length > 0 ? (
            <Panel className="mb-5 border border-accent/40" delay={60}>
              <PanelHeader
                title="Overdue"
                icon={<CalendarClock className="size-4 text-course-coral" />}
                aside={`${view.overdue.length}`}
              />
              <ul className="space-y-2">
                {view.overdue.map((item) => (
                  <Row key={item.id} item={item} onOpen={setSelected} />
                ))}
              </ul>
            </Panel>
          ) : null}

          {view.grouped.length === 0 && view.overdue.length === 0 ? (
            <Panel delay={80}>
              <EmptyState
                title="Nothing scheduled for this class yet"
                description="Add work by hand from the Assignments page, or upload the course file and Syllo fills this in."
              />
            </Panel>
          ) : (
            view.grouped.map((group, index) => (
              <Panel key={group.key} className="mb-5" delay={80 + index * 40}>
                <PanelHeader
                  title={group.label}
                  aside={`${group.items.length}`}
                  icon={<span className={cn("size-3 rounded-full", palette.solid)} aria-hidden />}
                />
                <ul className="space-y-2">
                  {group.items.map((item) => (
                    <Row key={item.id} item={item} onOpen={setSelected} />
                  ))}
                </ul>
              </Panel>
            ))
          )}

          {view.past.length > 0 ? (
            <Panel className="mb-5" delay={200}>
              <details>
                <summary className="cursor-pointer list-none">
                  <PanelHeader
                    title="Earlier this term"
                    aside={`${view.past.length}`}
                    icon={<History className="size-4 text-course-mustard" />}
                  />
                </summary>
                <ul className="space-y-2">
                  {view.past.map((item) => (
                    <Row key={item.id} item={item} onOpen={setSelected} />
                  ))}
                </ul>
              </details>
            </Panel>
          ) : null}

          {view.done.length > 0 ? (
            <Panel delay={240}>
              <details>
                <summary className="cursor-pointer list-none">
                  <PanelHeader
                    title="Completed"
                    aside={`${view.done.length}`}
                    icon={<CheckCircle2 className="size-4 text-course-leaf" />}
                  />
                </summary>
                <ul className="space-y-2">
                  {view.done.map((item) => (
                    <Row key={item.id} item={item} onOpen={setSelected} />
                  ))}
                </ul>
              </details>
            </Panel>
          ) : null}
        </>
      )}

      <PlannerItemDetails item={selected} onClose={() => setSelected(null)} />
    </>
  );
}

/** One line of work inside the course overview. */
function Row({ item, onOpen }: { item: PlannerItem; onOpen: (item: PlannerItem) => void }) {
  const palette = coursePalette(item.courseId);
  return (
    <li className="flex items-stretch">
      <ItemCheckbox id={item.id} completable={item.completable} />
      <button
        type="button"
        onClick={() => onOpen(item)}
        className={cn(
          "inset-tile tile-lift group ml-2 flex w-full min-w-0 items-stretch gap-3 overflow-hidden bg-background text-left",
          palette.hover,
        )}
      >
        <span
          className={cn(
            "w-1.5 shrink-0 self-stretch transition-all duration-200 group-hover:w-2.5",
            palette.solid,
          )}
          aria-hidden
        />
        <span className="min-w-0 flex-1 py-3">
          <span
            className={cn(
              "block truncate text-sm font-medium text-foreground",
              item.done && "line-through opacity-60",
            )}
          >
            {item.title}
          </span>
          <span className={cn("mt-0.5 block truncate text-xs font-medium", palette.text)}>
            {item.type}
          </span>
        </span>
        <span className="shrink-0 py-3 pr-3 text-right text-xs text-foreground/60">
          {item.date ? formatDay(item.date) : "No date"}
          {item.time ? <span className="block">{item.time}</span> : null}
        </span>
      </button>
    </li>
  );
}
