import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function EmptyState({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "inset-tile relative overflow-hidden bg-gradient-to-br from-background to-course-teal-soft/50 p-6 text-center sm:p-8",
        className,
      )}
    >
      <span
        className="soft-pulse mx-auto mb-3 block size-2 rounded-full bg-course-teal"
        aria-hidden
      />
      <p className="font-display text-base font-medium text-foreground">{title}</p>
      <p className="mx-auto mt-1 max-w-[40ch] text-pretty text-sm text-foreground/55">
        {description}
      </p>
      {action ? <div className="mt-5 flex justify-center">{action}</div> : null}
    </div>
  );
}
