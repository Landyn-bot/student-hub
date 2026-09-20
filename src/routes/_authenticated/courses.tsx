import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";

import { CourseForm } from "@/components/app/CourseForm";
import { PageHeader } from "@/components/app/PageHeader";
import { ErrorNote, LoadingTiles } from "@/components/app/StatusNote";
import { Button } from "@/components/ui/app-button";
import { Panel } from "@/components/ui/panel-surface";
import { listCourses, type Course } from "@/lib/courses.functions";
import { coursePalette } from "@/lib/course-colors";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/courses")({
  head: () => ({
    meta: [
      { title: "Courses — Syllo" },
      {
        name: "description",
        content: "Every subject you carry this term, gathered in one shelf.",
      },
      { property: "og:title", content: "Courses — Syllo" },
      {
        property: "og:description",
        content: "Every subject you carry this term, gathered in one shelf.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CoursesPage,
});

function CoursesPage() {
  const fetchCourses = useServerFn(listCourses);
  const { data, isPending, isError, refetch, isRefetching } = useQuery({
    queryKey: ["courses"],
    queryFn: () => fetchCourses(),
  });

  // Which form is open: a new class, or the class being renamed.
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Course | null>(null);

  const courses = data ?? [];

  return (
    <>
      <PageHeader
        eyebrow="Courses"
        title="Your course shelf."
        action={
          !isPending && !isError ? (
            <Button
              variant="brand"
              onClick={() => {
                setEditing(null);
                setAdding((open) => !open);
              }}
            >
              {adding ? "Close" : "+ Add course"}
            </Button>
          ) : null
        }
      />

      {adding ? (
        <Panel className="mb-4 p-6">
          <h2 className="mb-4 font-display text-lg font-semibold">Add a class</h2>
          <CourseForm onDone={() => setAdding(false)} />
        </Panel>
      ) : null}

      {isPending ? (
        <LoadingTiles />
      ) : isError ? (
        <Panel>
          <ErrorNote
            title="We could not load your courses"
            onRetry={() => void refetch()}
            retrying={isRefetching}
          />
        </Panel>
      ) : courses.length === 0 ? (
        <Panel className="p-6 sm:p-8">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
            <div className="sm:max-w-xs">
              <h2 className="mb-2 font-display text-2xl font-semibold text-foreground">Courses</h2>
              <p className="text-pretty text-sm leading-relaxed text-foreground/60">
                This is the home of every subject you carry this term. Upload your course exports
                and your courses, syllabi and deadlines settle into place here — or add a class by
                hand above.
              </p>
            </div>
            <div className="w-full sm:ml-auto sm:w-auto">
              <Button variant="brand" className="w-full sm:w-auto" asChild>
                <Link to="/import">Upload your courses</Link>
              </Button>
            </div>
          </div>
        </Panel>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {courses.map((course) => {
            const palette = coursePalette(course.id);
            const isEditing = editing?.id === course.id;
            return (
              <Panel key={course.id} className={cn("overflow-hidden border-l-4", palette.border)}>
                {isEditing && editing ? (
                  <>
                    <h2 className="mb-4 font-display text-lg font-semibold">Edit class</h2>
                    <CourseForm editing={editing} onDone={() => setEditing(null)} />
                  </>
                ) : (
                  <>
                    <div className="flex items-start justify-between gap-3">
                      <span
                        className={cn("mb-4 block size-3 rounded-full", palette.solid)}
                        aria-hidden
                      />
                      <Button
                        size="sm"
                        variant="soft"
                        onClick={() => {
                          setAdding(false);
                          setEditing(course);
                        }}
                      >
                        Edit
                      </Button>
                    </div>
                    <h2 className="font-display text-lg font-semibold">{course.name}</h2>
                    <p className="mt-1 text-sm text-foreground/55">
                      {course.course_code ?? "No course code"}
                    </p>
                    {course.instructor ? (
                      <p className="mt-2 text-sm text-foreground/60">{course.instructor}</p>
                    ) : null}
                  </>
                )}
              </Panel>
            );
          })}
        </div>
      )}
    </>
  );
}
