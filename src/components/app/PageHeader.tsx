import type { ReactNode } from "react";

/**
 * The single page title treatment used across Syllo. On narrow screens the
 * action drops below the title and stretches, so it never squeezes the heading.
 * The title carries a slow colour sweep so the page feels alive on arrival.
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
    <div className="rise-in relative mb-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between sm:gap-4">
      <div className="min-w-0">
        {eyebrow ? (
          <p className="mb-1 flex items-center gap-2 truncate text-sm text-foreground/50">
            <span className="soft-pulse size-1.5 rounded-full bg-accent" aria-hidden />
            {eyebrow}
          </p>
        ) : null}
        <h1 className="gradient-ink max-w-[40ch] text-balance font-display text-2xl font-semibold leading-tight sm:text-3xl">
          {title}
        </h1>
      </div>
      {action ? <div className="shrink-0 [&>*]:w-full sm:[&>*]:w-auto">{action}</div> : null}
    </div>
  );
}
