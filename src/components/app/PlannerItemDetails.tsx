import type { ReactNode } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { PlannerItem } from "@/lib/planner.functions";

export function formatDay(key: string): string {
  return new Date(`${key}T00:00:00`).toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

/**
 * Detail view for one academic item, including where the fact came from in the
 * imported file. Date-only items show the date alone — no time is invented.
 */
export function PlannerItemDetails({
  item,
  onClose,
}: {
  item: PlannerItem | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={Boolean(item)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        {item && (
          <>
            <DialogHeader>
              <DialogTitle className="font-display">{item.title}</DialogTitle>
              <DialogDescription>
                {[item.courseName ?? "No course", item.type].join(" · ")}
              </DialogDescription>
            </DialogHeader>

            <dl className="space-y-3 text-sm">
              <Detail label="When">
                {item.date ? formatDay(item.date) : "No date found"}
                {item.time ? ` · ${item.time}` : ""}
              </Detail>
              {item.location && <Detail label="Where">{item.location}</Detail>}
              {item.description && <Detail label="Details">{item.description}</Detail>}
              {item.sourceName && <Detail label="From file">{item.sourceName}</Detail>}
              {item.sourceText && (
                <Detail label="Original wording">
                  <span className="italic text-foreground/70">“{item.sourceText}”</span>
                </Detail>
              )}
              {item.aiGenerated && (
                <p className="text-xs text-foreground/50">
                  Read automatically from your uploaded course file.
                </p>
              )}
            </dl>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-[0.12em] text-foreground/45">{label}</dt>
      <dd className="mt-0.5 text-pretty text-foreground/80">{children}</dd>
    </div>
  );
}
