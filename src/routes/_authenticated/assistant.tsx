import { createFileRoute } from "@tanstack/react-router";

import { PageHeader } from "@/components/app/PageHeader";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel, PanelHeader } from "@/components/ui/panel-surface";

export const Route = createFileRoute("/_authenticated/assistant")({
  head: () => ({
    meta: [
      { title: "AI Assistant — Syllo" },
      {
        name: "description",
        content: "A study assistant that knows your own course material.",
      },
      { property: "og:title", content: "AI Assistant — Syllo" },
      {
        property: "og:description",
        content: "A study assistant that knows your own course material.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
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
