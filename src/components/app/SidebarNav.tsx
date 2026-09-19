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
                className="flex items-center gap-3 rounded-xl px-3 py-2 text-foreground/70 transition-colors hover:bg-black/5"
                activeProps={{
                  className:
                    "flex items-center gap-3 rounded-xl px-3 py-2 bg-primary text-primary-foreground font-medium hover:bg-primary",
                }}
              >
                {item.label}
              </Link>
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}
