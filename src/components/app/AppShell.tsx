import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Menu, X } from "lucide-react";
import { useState, type ReactNode } from "react";

import { Button } from "@/components/ui/app-button";
import { supabase } from "@/integrations/supabase/client";
import { setGuestMode } from "@/lib/guest/mode";

import { SidebarNav } from "./SidebarNav";

function initials(name: string) {
  return name.trim().charAt(0).toUpperCase() || "S";
}

export function AppShell({
  children,
  displayName,
  guest = false,
}: {
  children: ReactNode;
  displayName: string;
  /** True when the planner is running without an account, saved in this browser. */
  guest?: boolean;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  async function handleSignOut() {
    // Clear private cached data before ending the cloud session.
    await queryClient.cancelQueries();
    queryClient.clear();
    if (guest) {
      // Leaving guest mode keeps the browser-saved work for next time.
      setGuestMode(false);
    } else {
      await supabase.auth.signOut();
    }
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="relative min-h-screen bg-background font-body text-foreground">
      {/* Decorative drifting colour behind every page. */}
      <div className="aurora-field" aria-hidden>
        <span
          className="aurora-blob -left-32 top-[-10rem] size-[30rem] bg-course-leaf/35"
          style={{ animationDelay: "0s" }}
        />
        <span
          className="aurora-blob right-[-12rem] top-24 size-[26rem] bg-course-blue/30"
          style={{ animationDelay: "-7s" }}
        />
        <span
          className="aurora-blob bottom-[-14rem] left-1/3 size-[32rem] bg-course-coral/25"
          style={{ animationDelay: "-14s" }}
        />
        <span
          className="aurora-blob bottom-24 right-1/4 size-[22rem] bg-course-mustard/25"
          style={{ animationDelay: "-20s" }}
        />
      </div>

      <header className="sticky top-0 z-20 bg-background/70 ring-1 ring-black/5 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-5 sm:px-8">
          <Button
            variant="soft"
            size="icon"
            onClick={() => setMobileOpen(true)}
            className="lg:hidden"
            aria-label="Open navigation"
          >
            <Menu className="size-4" />
          </Button>

          <Link to="/dashboard" className="group flex items-center gap-2">
            <span className="grid size-7 place-items-center rounded-[10px] bg-gradient-to-br from-primary to-course-teal font-display text-xs font-semibold text-primary-foreground shadow-[0_10px_20px_-14px_oklch(0.313_0.0175_158/90%)] transition-transform duration-300 group-hover:scale-110 group-hover:rotate-6">
              S
            </span>
            <span className="font-display text-lg font-semibold tracking-tight">Syllo</span>
          </Link>

          <div className="ml-auto flex items-center gap-2">
            {guest ? (
              <Button variant="accent" size="sm" className="h-9" asChild>
                <Link to="/auth">Save to an account</Link>
              </Button>
            ) : null}
            <Button
              variant="soft"
              size="sm"
              onClick={handleSignOut}
              className="h-9 gap-2 py-1 pl-1 pr-3"
            >
              <span className="grid size-7 place-items-center rounded-[10px] bg-gradient-to-br from-accent to-course-coral text-xs font-semibold text-accent-foreground">
                {initials(displayName)}
              </span>
              <span className="hidden text-sm font-medium sm:inline">{displayName}</span>
              <span className="text-xs text-foreground/40">{guest ? "Leave" : "Sign out"}</span>
            </Button>
          </div>
        </div>
      </header>

      <div className="relative z-10 mx-auto flex max-w-7xl gap-6 px-5 sm:px-8">
        <aside className="hidden w-56 shrink-0 py-6 lg:block">
          <div className="sticky top-24">
            <SidebarNav />
            <p className="mt-8 border-t border-border pt-4 text-xs leading-relaxed text-foreground/45">
              Built for SteelHacks XIII · 2026
            </p>
          </div>
        </aside>

        <main className="min-w-0 flex-1 py-6">{children}</main>
      </div>

      {mobileOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/30" onClick={() => setMobileOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-64 bg-card p-5 shadow-xl">
            <div className="mb-6 flex items-center justify-between">
              <span className="font-display text-lg font-semibold">Syllo</span>
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
