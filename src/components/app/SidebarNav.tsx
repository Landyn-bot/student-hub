import { Link } from "@tanstack/react-router";

import { navGroups } from "./nav";

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="space-y-6 text-sm">
      {navGroups.map((group) => (
        <div key={group.heading}>
          <p className="px-3 pb-2 text-[11px] uppercase tracking-[0.14em] text-foreground/40">
            {group.heading}
          </p>
          <div className="space-y-1">
            {group.items.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                onClick={onNavigate}
                className="group flex items-center gap-3 rounded-xl px-3 py-2 text-foreground/70 transition-all duration-200 hover:translate-x-1 hover:bg-black/5"
                activeProps={{
                  className:
                    "flex items-center gap-3 rounded-xl px-3 py-2 bg-primary text-primary-foreground font-medium shadow-sm shadow-primary/30 hover:bg-primary",
                }}
              >
                <span
                  aria-hidden
                  className="size-1.5 shrink-0 rounded-full bg-current opacity-0 transition-opacity duration-200 group-hover:opacity-40"
                />
                {item.label}
              </Link>
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}
