import { Link } from "@tanstack/react-router";

import { navGroups } from "./nav";
import { cn } from "@/lib/utils";

/**
 * The main navigation rail. Each entry carries a tinted icon so the sections
 * are distinguishable at a glance; the active entry slides slightly right and
 * keeps a solid brand pill.
 */
export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const base =
    "group relative flex items-center gap-3 rounded-xl px-3 py-2 transition-all duration-200";

  return (
    <nav className="space-y-6 text-sm">
      {navGroups.map((group, groupIndex) => (
        <div
          key={group.heading}
          className="rise-in"
          style={{ animationDelay: `${groupIndex * 70}ms` }}
        >
          <p className="px-3 pb-2 text-[11px] uppercase tracking-[0.14em] text-foreground/40">
            {group.heading}
          </p>
          <div className="space-y-1">
            {group.items.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  onClick={onNavigate}
                  className={cn(base, "text-foreground/70 hover:translate-x-1 hover:bg-black/[0.04]")}
                  activeProps={{
                    className: cn(
                      base,
                      "translate-x-1 bg-primary font-medium text-primary-foreground shadow-[0_12px_24px_-18px_oklch(0.313_0.0175_158/90%)] hover:bg-primary",
                    ),
                  }}
                >
                  {({ isActive }) => (
                    <>
                      <Icon
                        className={cn(
                          "size-4 shrink-0 transition-transform duration-200 group-hover:scale-110",
                          isActive ? "text-primary-foreground" : item.tint,
                        )}
                      />
                      <span className="truncate">{item.label}</span>
                    </>
                  )}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}
