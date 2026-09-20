import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * The shared translucent card surface. `delay` staggers the entrance so a page
 * of panels settles in sequence instead of snapping into place at once.
 */
export function Panel({
  children,
  className,
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  return (
    <section
      className={cn("panel panel-lift rise-in p-5 sm:p-6", className)}
      style={{ animationDelay: `${delay}ms` }}
    >
      {children}
    </section>
  );
}

export function PanelHeader({
  title,
  aside,
  icon,
}: {
  title: string;
  aside?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <h2 className="flex items-center gap-2 font-display text-lg font-semibold text-foreground">
        {icon ? <span className="shrink-0">{icon}</span> : null}
        {title}
      </h2>
      {aside ? (
        <span className="shrink-0 rounded-full bg-black/[0.04] px-2.5 py-1 text-xs text-foreground/55">
          {aside}
        </span>
      ) : null}
    </div>
  );
}
