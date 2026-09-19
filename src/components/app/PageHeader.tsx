import type { ReactNode } from "react";

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
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        {eyebrow ? (
          <p className="mb-1 text-sm text-foreground/50">{eyebrow}</p>
        ) : null}
        <h1 className="max-w-[40ch] text-balance font-display text-3xl font-semibold leading-tight text-foreground">
          {title}
        </h1>
      </div>
      {action}
    </div>
  );
}
