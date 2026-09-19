import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";

import { PageHeader } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";
import { listCourses } from "@/lib/courses.functions";

export const Route = createFileRoute("/_authenticated/courses")({
  head: () => ({
    meta: [
      { title: "Courses — Syllabus" },
      {
        name: "description",
        content: "Every subject you carry this term, gathered in one shelf.",
      },
      { property: "og:title", content: "Courses — Syllabus" },
      {
        property: "og:description",
        content: "Every subject you carry this term, gathered in one shelf.",
      },
    ],
  }),
  component: CoursesPage,
});

function CoursesPage() {
  const fetchCourses = useServerFn(listCourses);
  const { data, isPending } = useQuery({
    queryKey: ["courses"],
    queryFn: () => fetchCourses(),
  });

  const courses = data ?? [];

  return (
    <>
      <PageHeader eyebrow="Courses" title="Your course shelf." />

      {isPending ? (
        <Panel>
          <p className="text-sm text-foreground/50">Loading your courses…</p>
        </Panel>
      ) : courses.length === 0 ? (
        <Panel className="p-6 sm:p-8">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
            <div className="sm:max-w-xs">
              <h2 className="mb-2 font-display text-2xl font-semibold text-foreground">
                Courses
              </h2>
              <p className="text-pretty text-sm leading-relaxed text-foreground/60">
                This is the home of every subject you carry this term. Right now
                it is an open shelf — once importing is switched on, your
                courses, syllabi and deadlines settle into place.
              </p>
            </div>
            <div className="w-full sm:ml-auto sm:w-auto">
              <Button variant="brand" className="w-full sm:w-auto" disabled>
                Connect your courses
              </Button>
              <p className="mt-2 text-xs text-foreground/40">Coming soon</p>
            </div>
          </div>
        </Panel>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {courses.map((course) => (
            <Panel key={course.id}>
              <h2 className="font-display text-lg font-semibold">
                {course.name}
              </h2>
              <p className="mt-1 text-sm text-foreground/55">
                {course.course_code ?? "No course code"}
              </p>
              {course.instructor ? (
                <p className="mt-2 text-sm text-foreground/60">
                  {course.instructor}
                </p>
              ) : null}
            </Panel>
          ))}
        </div>
      )}
    </>
  );
}
