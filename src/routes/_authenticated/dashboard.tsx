import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { PageHeader } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/app-button";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel, PanelHeader } from "@/components/ui/panel-surface";
import { getOnboardingState } from "@/lib/onboarding.functions";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — Syllo" },
      {
        name: "description",
        content:
          "Your semester at a glance: upcoming assignments, today's schedule and finances in one place.",
      },
      { property: "og:title", content: "Dashboard — Syllo" },
      {
        property: "og:description",
        content: "Your semester at a glance, in one calm planner.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: DashboardPage,
});

function DashboardPage() {
  const fetchOnboarding = useServerFn(getOnboardingState);
  const { data } = useQuery({
    queryKey: ["onboarding"],
    queryFn: () => fetchOnboarding(),
  });

  return (
    <>
      <PageHeader
        eyebrow={data?.term?.name ?? "Your current semester"}
        title="Your semester, kept in one glance."
        action={
          <Button variant="accent" asChild>
            <Link to="/import">+ Upload courses</Link>
          </Button>
        }
      />

      <Panel className="mb-5">
        <PanelHeader title="Upcoming assignments" aside="No data yet" />
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="inset-tile bg-primary/8 p-4">
            <span className="mb-2 block text-[11px] uppercase tracking-[0.12em] text-primary/70">
              This week
            </span>
            <p className="text-pretty text-sm text-foreground/60">
              Once your courses are added, due dates gather here automatically.
            </p>
          </div>
          <div className="inset-tile bg-accent/8 p-4">
            <span className="mb-2 block text-[11px] uppercase tracking-[0.12em] text-accent/80">
              Overdue
            </span>
            <p className="text-pretty text-sm text-foreground/60">
              Nothing flagged. Graded and pending work will sort itself.
            </p>
          </div>
          <div className="inset-tile bg-foreground/4 p-4">
            <span className="mb-2 block text-[11px] uppercase tracking-[0.12em] text-foreground/50">
              Next 7 days
            </span>
            <p className="text-pretty text-sm text-foreground/60">
              A quiet week reads well here when it is.
            </p>
          </div>
        </div>
      </Panel>

      <div className="grid gap-5 md:grid-cols-2">
        <Panel>
          <PanelHeader title="Today's schedule" />
          <EmptyState
            title="No classes on the books yet"
            description="Add your courses and the day fills with session, room and time."
          />
        </Panel>

        <Panel>
          <PanelHeader title="Finances" />
          <div className="inset-tile bg-background p-5">
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-foreground/55">Monthly budget</span>
              <span className="font-display text-2xl font-semibold text-foreground">$0</span>
            </div>
            <div className="mt-3 h-2 rounded-full bg-border/60" />
            <p className="mt-3 text-pretty text-sm text-foreground/55">
              Set a budget to track spending without leaving the planner.
            </p>
          </div>
        </Panel>
      </div>
    </>
  );
}
