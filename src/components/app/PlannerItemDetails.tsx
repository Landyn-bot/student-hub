import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";

import { ManualItemForm } from "@/components/app/ManualItemForm";
import { Button } from "@/components/ui/app-button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { coursePalette } from "@/lib/course-colors";
import {
  deleteManualItem,
  getPlannerData,
  type ManualItemKind,
  type PlannerItem,
} from "@/lib/planner.functions";
import { cn } from "@/lib/utils";

export function formatDay(key: string): string {
  return new Date(`${key}T00:00:00`).toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

/** The stored type label maps back to the manual-add kind for the edit form. */
function manualKind(item: PlannerItem): ManualItemKind {
  if (item.type === "quiz" || item.type === "exam" || item.type === "project") return item.type;
  return "assignment";
}

/** Student-facing detail view. Date-only items stay date-only. */
export function PlannerItemDetails({
  item,
  onClose,
}: {
  item: PlannerItem | null;
  onClose: () => void;
}) {
  const palette = coursePalette(item?.courseId);
  const queryClient = useQueryClient();
  const runDelete = useServerFn(deleteManualItem);
  const fetchPlanner = useServerFn(getPlannerData);

  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Only fetched when an edit actually starts; normally served from cache.
  const { data: planner } = useQuery({
    queryKey: ["planner"],
    queryFn: () => fetchPlanner(),
    enabled: editing,
  });

  const close = () => {
    setEditing(false);
    setConfirmingDelete(false);
    setError(null);
    onClose();
  };

  const deleteMutation = useMutation({
    mutationFn: runDelete,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["planner"] });
      void queryClient.invalidateQueries({ queryKey: ["focus"] });
      close();
    },
    onError: (err) =>
      setError(err instanceof Error ? err.message : "We could not delete that item."),
  });

  // Only items the student typed in by hand are editable/removable here.
  const isManual = Boolean(item && !item.aiGenerated && item.kind !== "event");

  return (
    <Dialog
      open={Boolean(item)}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent className="max-w-lg gap-0 overflow-hidden border-border bg-card p-0 sm:rounded-2xl">
        {item && (
          <>
            <div className={cn("h-2", palette.solid)} />
            <div className="p-6 sm:p-8">
              {editing && isManual ? (
                <>
                  <DialogHeader className="text-left">
                    <DialogTitle className="font-display text-2xl leading-tight text-foreground">
                      Edit {item.type}
                    </DialogTitle>
                    <DialogDescription>
                      Change the details and save — it updates everywhere at once.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="mt-6">
                    <ManualItemForm
                      courses={planner?.courses ?? []}
                      editing={item}
                      onDone={close}
                    />
                  </div>
                  <Button variant="ghost" className="mt-3" onClick={() => setEditing(false)}>
                    Cancel
                  </Button>
                </>
              ) : (
                <>
                  <DialogHeader className="pr-8 text-left">
                    <DialogDescription
                      className={cn(
                        "mb-2 w-fit rounded-full px-3 py-1 text-xs font-semibold capitalize",
                        palette.soft,
                        palette.text,
                      )}
                    >
                      {[item.courseName ?? "No course", item.type].join(" · ")}
                    </DialogDescription>
                    <DialogTitle className="font-display text-2xl leading-tight text-foreground">
                      {item.title}
                    </DialogTitle>
                  </DialogHeader>

                  <div className="mt-6 grid gap-3 sm:grid-cols-2">
                    <div className={cn("rounded-xl p-4", palette.soft)}>
                      <p className={cn("text-xs font-semibold uppercase", palette.text)}>Due</p>
                      <p className="mt-1 text-sm font-medium text-foreground">
                        {item.date ? formatDay(item.date) : "No date found"}
                        {item.time ? ` at ${item.time}` : ""}
                      </p>
                    </div>
                    {item.location ? (
                      <div className="rounded-xl bg-secondary p-4">
                        <p className="text-xs font-semibold uppercase text-foreground/45">
                          Location
                        </p>
                        <p className="mt-1 text-sm font-medium text-foreground">{item.location}</p>
                      </div>
                    ) : null}
                  </div>

                  {item.description ? (
                    <div className="mt-6">
                      <h3 className="text-xs font-semibold uppercase text-foreground/45">
                        Details
                      </h3>
                      <p className="mt-2 text-pretty text-sm leading-relaxed text-foreground/75">
                        {item.description}
                      </p>
                    </div>
                  ) : null}

                  {isManual ? (
                    <div className="mt-8 flex flex-wrap items-center gap-2 border-t border-border pt-5">
                      <Button variant="soft" size="sm" onClick={() => setEditing(true)}>
                        Edit
                      </Button>
                      {confirmingDelete ? (
                        <>
                          <span className="text-sm text-foreground/70">Delete it for good?</span>
                          <Button
                            variant="accent"
                            size="sm"
                            loading={deleteMutation.isPending}
                            onClick={() =>
                              deleteMutation.mutate({
                                data: { id: item.id, kind: manualKind(item) },
                              })
                            }
                          >
                            Yes, delete
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setConfirmingDelete(false)}
                          >
                            Keep it
                          </Button>
                        </>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-accent"
                          onClick={() => setConfirmingDelete(true)}
                        >
                          Delete
                        </Button>
                      )}
                    </div>
                  ) : null}

                  {error ? <p className="mt-3 text-sm text-accent">{error}</p> : null}
                </>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
