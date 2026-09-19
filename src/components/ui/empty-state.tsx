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
    <div className={cn("inset-tile bg-background p-6 text-center sm:p-8", className)}>
      <p className="font-display text-base font-medium text-foreground">{title}</p>
      <p className="mx-auto mt-1 max-w-[40ch] text-pretty text-sm text-foreground/55">
        {description}
      </p>
      {action ? <div className="mt-5 flex justify-center">{action}</div> : null}
    </div>
  );
}
