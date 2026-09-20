import { createFileRoute, Link } from "@tanstack/react-router";

import { AnimatedBackground } from "@/components/app/AnimatedBackground";
import { Button } from "@/components/ui/app-button";

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
  return (
    <div className="relative min-h-screen font-body text-foreground">
      <AnimatedBackground />
      <header className="animate-fade-in mx-auto flex h-16 max-w-7xl items-center gap-4 px-5 sm:px-8">
        <div className="flex items-center gap-2">
          <span className="grid size-7 place-items-center rounded-[10px] bg-primary font-display text-xs font-semibold text-primary-foreground transition-transform duration-300 hover:rotate-6 hover:scale-110">
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
        <p className="animate-fade-up mb-2 inline-flex items-center gap-2 text-sm text-foreground/50 [animation-delay:0.05s]">
          <span className="relative flex size-2">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-accent/60" />
            <span className="relative inline-flex size-2 rounded-full bg-accent" />
          </span>
          A personal college operating system
        </p>
        <h1 className="animate-fade-up max-w-[22ch] text-balance font-display text-4xl font-semibold leading-tight [animation-delay:0.12s] sm:text-5xl">
          Your semester, kept in one glance.
        </h1>
        <p className="animate-fade-up mt-4 max-w-[52ch] text-pretty text-base leading-relaxed text-foreground/60 [animation-delay:0.2s]">
          Courses, assignments, your calendar and your money — gathered into one quiet planner
          instead of five tabs. Nothing is invented for you: it fills as you bring your own semester
          in.
        </p>
        <div className="animate-fade-up mt-7 [animation-delay:0.28s]">
          <Button variant="accent" size="lg" asChild>
            <Link to="/auth">Create your account</Link>
          </Button>
        </div>

        <section className="panel animate-fade-up mt-12 p-5 [animation-delay:0.36s] sm:p-6">
          <div className="stagger grid gap-3 sm:grid-cols-3">
            <div className="inset-tile group bg-primary/8 p-4 transition-all duration-300 hover:-translate-y-1 hover:bg-primary/12">
              <span className="mb-2 block text-[11px] uppercase tracking-[0.12em] text-primary/70">
                Academics
              </span>
              <p className="text-pretty text-sm text-foreground/60">
                Courses and assignments in one shelf, sorted by what is next.
              </p>
            </div>
            <div className="inset-tile group bg-accent/8 p-4 transition-all duration-300 hover:-translate-y-1 hover:bg-accent/12">
              <span className="mb-2 block text-[11px] uppercase tracking-[0.12em] text-accent/80">
                Time
              </span>
              <p className="text-pretty text-sm text-foreground/60">
                Classes and deadlines on a single term-long calendar.
              </p>
            </div>
            <div className="inset-tile group bg-foreground/4 p-4 transition-all duration-300 hover:-translate-y-1 hover:bg-foreground/8">
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
