import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";

import { Button } from "@/components/ui/app-button";
import { setGuestMode } from "@/lib/guest/mode";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Syllo — your college operating system" },
      {
        name: "description",
        content:
          "Syllo keeps your courses, assignments, calendar and finances in one calm planner built for students.",
      },
      { property: "og:title", content: "Syllo — your college operating system" },
      {
        property: "og:description",
        content:
          "Courses, assignments, calendar and finances in one calm planner built for students.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Landing,
});

function Landing() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background font-body text-foreground">
      <header className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-5 sm:px-8">
        <div className="flex items-center gap-2">
          <span className="grid size-7 place-items-center rounded-[10px] bg-primary font-display text-xs font-semibold text-primary-foreground">
            S
          </span>
          <span className="font-display text-lg font-semibold tracking-tight">Syllo</span>
        </div>
        <div className="ml-auto">
          <Button variant="soft" size="sm" asChild>
            <Link to="/auth">Sign in</Link>
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-5 pb-20 pt-10 sm:px-8">
        <p className="mb-2 text-sm text-foreground/50">A personal college operating system</p>
        <h1 className="max-w-[22ch] text-balance font-display text-4xl font-semibold leading-tight sm:text-5xl">
          Your semester, kept in one glance.
        </h1>
        <p className="mt-4 max-w-[52ch] text-pretty text-base leading-relaxed text-foreground/60">
          Courses, assignments, your calendar and your money — gathered into one quiet planner
          instead of five tabs. Nothing is invented for you: it fills as you bring your own semester
          in.
        </p>
        <div className="mt-7 flex flex-wrap items-center gap-3">
          <Button variant="accent" size="lg" asChild>
            <Link to="/auth">Create your account</Link>
          </Button>
          <Button
            variant="soft"
            size="lg"
            onClick={() => {
              // No account needed: the planner saves into this browser.
              setGuestMode(true);
              void navigate({ to: "/dashboard" });
            }}
          >
            Try it without an account
          </Button>
        </div>
        <p className="mt-3 text-xs text-foreground/45">
          Without an account your work is saved in this browser only. Importing course files needs
          an account.
        </p>

        <section className="panel mt-12 p-5 sm:p-6">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="inset-tile bg-primary/8 p-4">
              <span className="mb-2 block text-[11px] uppercase tracking-[0.12em] text-primary/70">
                Academics
              </span>
              <p className="text-pretty text-sm text-foreground/60">
                Courses and assignments in one shelf, sorted by what is next.
              </p>
            </div>
            <div className="inset-tile bg-accent/8 p-4">
              <span className="mb-2 block text-[11px] uppercase tracking-[0.12em] text-accent/80">
                Time
              </span>
              <p className="text-pretty text-sm text-foreground/60">
                Classes and deadlines on a single term-long calendar.
              </p>
            </div>
            <div className="inset-tile bg-foreground/4 p-4">
              <span className="mb-2 block text-[11px] uppercase tracking-[0.12em] text-foreground/50">
                Money
              </span>
              <p className="text-pretty text-sm text-foreground/60">
                Books, food and rent tracked beside the rest of your term.
              </p>
            </div>
          </div>
        </section>
      </main>
      <footer className="border-t border-border px-5 py-6 text-center text-xs text-foreground/45 sm:px-8">
        Syllo · Built for SteelHacks XIII 2026
      </footer>
    </div>
  );
}
