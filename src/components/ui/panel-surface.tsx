import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section className={cn("panel panel-lift animate-fade-up p-5 sm:p-6", className)}>
      {children}
    </section>
  );
}

export function PanelHeader({ title, aside }: { title: string; aside?: ReactNode }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <h2 className="font-display text-lg font-semibold text-foreground">{title}</h2>
      {aside ? <span className="text-xs text-foreground/40">{aside}</span> : null}
    </div>
  );
}
