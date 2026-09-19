import type { ReactNode } from "react";

/**
 * The single page title treatment used across Syllo. On narrow screens the
 * action drops below the title and stretches, so it never squeezes the heading.
 */
export function PageHeader({
  eyebrow,
  title,
  action,
}: {
  eyebrow?: string;
  title: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between sm:gap-4">
      <div className="min-w-0">
        {eyebrow ? <p className="mb-1 truncate text-sm text-foreground/50">{eyebrow}</p> : null}
        <h1 className="max-w-[40ch] text-balance font-display text-2xl font-semibold leading-tight text-foreground sm:text-3xl">
          {title}
        </h1>
      </div>
      {action ? <div className="shrink-0 [&>*]:w-full sm:[&>*]:w-auto">{action}</div> : null}
    </div>
  );
}
