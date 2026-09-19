// Small shared building blocks for the three states every data panel can be in:
// loading, failed to load, and plain informational notes. Keeping them here means
// every page shows the same shapes, spacing and wording.
import { AlertCircle } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/app-button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/** Placeholder rows while a list loads, sized like the real rows they replace. */
export function LoadingRows({ rows = 3, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("space-y-2", className)} aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-16 w-full rounded-2xl" />
      ))}
    </div>
  );
}

/** Placeholder tiles for grid layouts such as the course shelf. */
export function LoadingTiles({ tiles = 3, className }: { tiles?: number; className?: string }) {
  return (
    <div className={cn("grid gap-3 sm:grid-cols-2 lg:grid-cols-3", className)} aria-busy="true">
      <span className="sr-only">Loading…</span>
      {Array.from({ length: tiles }, (_, index) => (
        <Skeleton key={index} className="h-28 w-full rounded-2xl" />
      ))}
    </div>
  );
}

/**
 * A calm, plain-language failure note. Never shows raw technical text unless a
 * caller passes a detail line worth reading.
 */
export function ErrorNote({
  title = "We could not load this just now",
  description = "Check your connection and try again — nothing was lost.",
  detail,
  onRetry,
  retrying,
  action,
}: {
  title?: string;
  description?: string;
  detail?: string | undefined;
  onRetry?: (() => void) | undefined;
  retrying?: boolean;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4">
      <div className="flex items-start gap-3">
        <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">{title}</p>
          <p className="mt-1 text-sm text-foreground/60">{description}</p>
          {detail ? <p className="mt-1 text-xs text-foreground/45">{detail}</p> : null}
          {onRetry || action ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {onRetry ? (
                <Button size="sm" variant="soft" onClick={onRetry} loading={retrying === true}>
                  Try again
                </Button>
              ) : null}
              {action}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
