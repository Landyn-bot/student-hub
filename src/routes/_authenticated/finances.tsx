import { createFileRoute } from "@tanstack/react-router";

import { PageHeader } from "@/components/app/PageHeader";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel, PanelHeader } from "@/components/ui/panel-surface";

export const Route = createFileRoute("/_authenticated/finances")({
  head: () => ({
    meta: [
      { title: "Finances — Syllabus" },
      {
        name: "description",
        content: "Tuition, books, rent and everyday spending in one ledger.",
      },
      { property: "og:title", content: "Finances — Syllabus" },
      {
        property: "og:description",
        content: "Tuition, books, rent and everyday spending in one ledger.",
      },
    ],
  }),
  component: FinancesPage,
});

function FinancesPage() {
  return (
    <>
      <PageHeader eyebrow="Finances" title="Money, kept next to the plan." />
      <Panel>
        <PanelHeader title="Budgets" aside="No data yet" />
        <EmptyState
          title="No budget set"
          description="Track books, food and rent in one calm ledger. Budgeting arrives in an upcoming step."
        />
      </Panel>
    </>
  );
}
