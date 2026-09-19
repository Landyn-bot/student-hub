import { createFileRoute } from "@tanstack/react-router";

import { PageHeader } from "@/components/app/PageHeader";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel, PanelHeader } from "@/components/ui/panel-surface";

export const Route = createFileRoute("/_authenticated/assignments")({
  head: () => ({
    meta: [
      { title: "Assignments — Syllabus" },
      {
        name: "description",
        content: "Every reading, problem set and paper, sorted by what's next.",
      },
      { property: "og:title", content: "Assignments — Syllabus" },
      {
        property: "og:description",
        content: "Every reading, problem set and paper, sorted by what's next.",
      },
    ],
  }),
  component: AssignmentsPage,
});

function AssignmentsPage() {
  return (
    <>
      <PageHeader eyebrow="Assignments" title="What's due, in order." />
      <Panel>
        <PanelHeader title="All assignments" aside="No data yet" />
        <EmptyState
          title="No assignments tracked"
          description="Work items show up here once your course content is brought in."
        />
      </Panel>
    </>
  );
}
