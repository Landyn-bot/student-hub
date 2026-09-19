import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { coursePalette } from "@/lib/course-colors";
import type { PlannerItem } from "@/lib/planner.functions";
import { cn } from "@/lib/utils";

export function formatDay(key: string): string {
  return new Date(`${key}T00:00:00`).toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
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

  return (
    <Dialog open={Boolean(item)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg gap-0 overflow-hidden border-border bg-card p-0 sm:rounded-2xl">
        {item && (
          <>
            <div className={cn("h-2", palette.solid)} />
            <div className="p-6 sm:p-8">
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
                    <p className="text-xs font-semibold uppercase text-foreground/45">Location</p>
                    <p className="mt-1 text-sm font-medium text-foreground">{item.location}</p>
                  </div>
                ) : null}
              </div>

              {item.description ? (
                <div className="mt-6">
                  <h3 className="text-xs font-semibold uppercase text-foreground/45">Details</h3>
                  <p className="mt-2 text-pretty text-sm leading-relaxed text-foreground/75">
                    {item.description}
                  </p>
                </div>
              ) : null}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
