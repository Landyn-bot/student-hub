// Small form for adding a class by hand or renaming one already on the shelf,
// so a course never has to come from a file import.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/app-button";
import { addCourse, updateCourse, type Course } from "@/lib/courses.functions";

const fieldClass =
  "w-full rounded-xl border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring";

export function CourseForm({
  editing,
  onDone,
}: {
  /** When set, the form edits that course instead of adding a new one. */
  editing?: Course;
  onDone?: () => void;
}) {
  const queryClient = useQueryClient();
  const runAdd = useServerFn(addCourse);
  const runUpdate = useServerFn(updateCourse);

  const [name, setName] = useState(editing?.name ?? "");
  const [courseCode, setCourseCode] = useState(editing?.course_code ?? "");
  const [instructor, setInstructor] = useState(editing?.instructor ?? "");
  const [error, setError] = useState<string | null>(null);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["courses"] });
    void queryClient.invalidateQueries({ queryKey: ["planner"] });
  };

  const addMutation = useMutation({ mutationFn: runAdd, onSuccess: refresh });
  const updateMutation = useMutation({ mutationFn: runUpdate, onSuccess: refresh });
  const saving = addMutation.isPending || updateMutation.isPending;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError("Give the class a name.");
      return;
    }
    const payload = { name, courseCode: courseCode || null, instructor: instructor || null };
    const onError = (err: unknown) =>
      setError(err instanceof Error ? err.message : "We could not save that class.");

    if (editing) {
      updateMutation.mutate(
        { data: { id: editing.id, ...payload } },
        { onSuccess: () => onDone?.(), onError },
      );
    } else {
      addMutation.mutate(
        { data: payload },
        {
          onSuccess: () => {
            setName("");
            setCourseCode("");
            setInstructor("");
            onDone?.();
          },
          onError,
        },
      );
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <label className="block space-y-1 text-sm">
        <span className="text-muted-foreground">Class name</span>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Intro to Biology"
          className={fieldClass}
        />
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span className="text-muted-foreground">Course code (optional)</span>
          <input
            value={courseCode}
            onChange={(event) => setCourseCode(event.target.value)}
            placeholder="BIOL 0101"
            className={fieldClass}
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-muted-foreground">Instructor (optional)</span>
          <input
            value={instructor}
            onChange={(event) => setInstructor(event.target.value)}
            placeholder="Dr. Rivera"
            className={fieldClass}
          />
        </label>
      </div>

      {error ? <p className="text-sm text-accent">{error}</p> : null}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="accent" loading={saving}>
          {editing ? "Save changes" : "Add class"}
        </Button>
        {onDone ? (
          <Button type="button" variant="soft" onClick={onDone}>
            Cancel
          </Button>
        ) : null}
      </div>
    </form>
  );
}
