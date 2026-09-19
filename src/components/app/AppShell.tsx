import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Menu, X } from "lucide-react";
import { useState, type ReactNode } from "react";

import { Button } from "@/components/ui/Button";
import { supabase } from "@/integrations/supabase/client";

import { SidebarNav } from "./SidebarNav";

function initials(name: string) {
  return name.trim().charAt(0).toUpperCase() || "S";
}

export function AppShell({
  children,
  displayName,
}: {
  children: ReactNode;
  displayName: string;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  async function handleSignOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="min-h-screen bg-background font-body text-foreground">
      <header className="sticky top-0 z-20 bg-background/85 ring-1 ring-black/5 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-5 sm:px-8">
          <button
            onClick={() => setMobileOpen(true)}
            className="grid size-10 place-items-center rounded-xl bg-card text-foreground/70 ring-1 ring-black/5 lg:hidden"
            aria-label="Open navigation"
          >
            <Menu className="size-4" />
          </button>

          <Link to="/dashboard" className="flex items-center gap-2">
            <span className="grid size-7 place-items-center rounded-[10px] bg-primary font-display text-xs font-semibold text-primary-foreground">
              S
            </span>
            <span className="font-display text-lg font-semibold tracking-tight">
              Syllabus
            </span>
          </Link>

          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={handleSignOut}
              className="flex items-center gap-2 rounded-xl bg-card py-1 pl-1 pr-3 ring-1 ring-black/5 transition-transform hover:-translate-y-px"
            >
              <span className="grid size-7 place-items-center rounded-[10px] bg-accent/90 text-xs font-semibold text-accent-foreground">
                {initials(displayName)}
              </span>
              <span className="hidden text-sm font-medium sm:inline">
                {displayName}
              </span>
              <span className="text-xs text-foreground/40">Sign out</span>
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-7xl gap-6 px-5 sm:px-8">
        <aside className="hidden w-56 shrink-0 py-6 lg:block">
          <SidebarNav />
        </aside>

        <main className="min-w-0 flex-1 py-6">{children}</main>
      </div>

      {mobileOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-black/30"
            onClick={() => setMobileOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 w-64 bg-card p-5 shadow-xl">
            <div className="mb-6 flex items-center justify-between">
              <span className="font-display text-lg font-semibold">Syllabus</span>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Close navigation"
                onClick={() => setMobileOpen(false)}
              >
                <X className="size-4" />
              </Button>
            </div>
            <SidebarNav onNavigate={() => setMobileOpen(false)} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
