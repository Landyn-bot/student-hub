import { createFileRoute } from "@tanstack/react-router";

import { PageHeader } from "@/components/app/PageHeader";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel, PanelHeader } from "@/components/ui/panel-surface";

export const Route = createFileRoute("/_authenticated/assistant")({
  head: () => ({
    meta: [
      { title: "AI Assistant — Syllabus" },
      {
        name: "description",
        content: "A study assistant that knows your own course material.",
      },
      { property: "og:title", content: "AI Assistant — Syllabus" },
      {
        property: "og:description",
        content: "A study assistant that knows your own course material.",
      },
    ],
  }),
  component: AssistantPage,
});

function AssistantPage() {
  return (
    <>
      <PageHeader eyebrow="AI Assistant" title="Not switched on yet." />
      <Panel>
        <PanelHeader title="Assistant" aside="Coming soon" />
        <EmptyState
          title="Nothing to study from yet"
          description="The assistant needs your course material first. Once readings and syllabi are brought in, it can answer questions about them here."
        />
      </Panel>
    </>
  );
}
