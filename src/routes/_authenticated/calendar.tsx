import { createFileRoute } from "@tanstack/react-router";

import { PageHeader } from "@/components/app/PageHeader";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel, PanelHeader } from "@/components/ui/panel-surface";

export const Route = createFileRoute("/_authenticated/calendar")({
  head: () => ({
    meta: [
      { title: "Calendar — Syllo" },
      {
        name: "description",
        content: "Classes, deadlines and personal events on one calm timeline.",
      },
      { property: "og:title", content: "Calendar — Syllo" },
      {
        property: "og:description",
        content: "Classes, deadlines and personal events on one calm timeline.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CalendarPage,
});

function CalendarPage() {
  return (
    <>
      <PageHeader eyebrow="Calendar" title="A term-long view of your time." />
      <Panel>
        <PanelHeader title="This week" aside="No data yet" />
        <EmptyState
          title="Nothing scheduled"
          description="Class sessions and due dates appear here as soon as your courses are added."
        />
      </Panel>
    </>
  );
}
