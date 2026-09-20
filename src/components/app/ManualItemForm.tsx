// Lets a student add one assignment, quiz, exam or project by hand, so nothing
// has to be imported from a file. Writes through the same planner data everything
// else on the site reads.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/app-button";
import { addManualItem, type ManualItemKind, type PlannerCourse } from "@/lib/planner.functions";

const KINDS: { key: ManualItemKind; label: string }[] = [
  { key: "assignment", label: "Assignment" },
  { key: "quiz", label: "Quiz" },
  { key: "exam", label: "Exam" },
  { key: "project", label: "Project" },
];

const NEW_COURSE = "__new__";

const fieldClass =
  "w-full rounded-xl border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring";

/** Local YYYY-MM-DD, used as the default date. */
function todayKey(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

export function ManualItemForm({
  courses,
  onDone,
}: {
  courses: PlannerCourse[];
  onDone?: () => void;
}) {
  const queryClient = useQueryClient();
  const runAdd = useServerFn(addManualItem);

  const [kind, setKind] = useState<ManualItemKind>("assignment");
  const [title, setTitle] = useState("");
  const [courseChoice, setCourseChoice] = useState<string>(courses[0]?.id ?? NEW_COURSE);
  const [newCourse, setNewCourse] = useState("");
  const [date, setDate] = useState(todayKey());
  const [time, setTime] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  const addMutation = useMutation({
    mutationFn: runAdd,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["planner"] });
      void queryClient.invalidateQueries({ queryKey: ["focus"] });
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!title.trim()) {
      setError("Give it a title.");
      return;
    }
    if (courseChoice === NEW_COURSE && !newCourse.trim()) {
      setError("Name the class it's for.");
      return;
    }
    addMutation.mutate(
      {
        data: {
          kind,
          title,
          courseId: courseChoice === NEW_COURSE ? null : courseChoice,
          courseName: courseChoice === NEW_COURSE ? newCourse : null,
          date,
          time: time || null,
          notes: notes || null,
        },
      },
      {
        onSuccess: () => {
          setTitle("");
          setTime("");
          setNotes("");
          onDone?.();
        },
        onError: (err) =>
          setError(err instanceof Error ? err.message : "We could not save that item."),
      },
    );
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {KINDS.map((entry) => (
          <Button
            key={entry.key}
            type="button"
            size="sm"
            variant={kind === entry.key ? "brand" : "soft"}
            onClick={() => setKind(entry.key)}
          >
            {entry.label}
          </Button>
        ))}
      </div>

      <label className="block space-y-1 text-sm">
        <span className="text-muted-foreground">Title</span>
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Problem set 3"
          className={fieldClass}
        />
      </label>

      <label className="block space-y-1 text-sm">
        <span className="text-muted-foreground">Class</span>
        <select
          value={courseChoice}
          onChange={(event) => setCourseChoice(event.target.value)}
          className={fieldClass}
        >
          {courses.map((course) => (
            <option key={course.id} value={course.id}>
              {course.name}
            </option>
          ))}
          <option value={NEW_COURSE}>+ New class…</option>
        </select>
      </label>

      {courseChoice === NEW_COURSE ? (
        <label className="block space-y-1 text-sm">
          <span className="text-muted-foreground">Class name</span>
          <input
            value={newCourse}
            onChange={(event) => setNewCourse(event.target.value)}
            placeholder="Intro to Biology"
            className={fieldClass}
          />
        </label>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span className="text-muted-foreground">Date</span>
          <input
            type="date"
            required
            value={date}
            onChange={(event) => setDate(event.target.value)}
            className={fieldClass}
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-muted-foreground">Time (optional)</span>
          <input
            type="time"
            value={time}
            onChange={(event) => setTime(event.target.value)}
            className={fieldClass}
          />
        </label>
      </div>

      <label className="block space-y-1 text-sm">
        <span className="text-muted-foreground">Notes (optional)</span>
        <textarea
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          rows={2}
          className={fieldClass}
        />
      </label>

      {error ? <p className="text-sm text-accent">{error}</p> : null}

      <Button type="submit" variant="accent" loading={addMutation.isPending}>
        Add to my planner
      </Button>
    </form>
  );
}
