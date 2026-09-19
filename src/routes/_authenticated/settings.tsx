import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/app-button";
import { Panel, PanelHeader } from "@/components/ui/panel-surface";
import { getProfile, updateProfile } from "@/lib/profile.functions";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({
    meta: [
      { title: "Settings — Syllabus" },
      { name: "description", content: "Your account and planner preferences." },
      { property: "og:title", content: "Settings — Syllabus" },
      {
        property: "og:description",
        content: "Your account and planner preferences.",
      },
    ],
  }),
  component: SettingsPage,
});

const fieldClass =
  "mt-1 h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary";

function SettingsPage() {
  const fetchProfile = useServerFn(getProfile);
  const saveProfile = useServerFn(updateProfile);
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: ["profile"],
    queryFn: () => fetchProfile(),
  });

  const [fullName, setFullName] = useState("");
  const [school, setSchool] = useState("");

  useEffect(() => {
    if (data) {
      setFullName(data.full_name ?? "");
      setSchool(data.school ?? "");
    }
  }, [data]);

  const mutation = useMutation({
    mutationFn: () =>
      saveProfile({
        data: {
          full_name: fullName.trim() || null,
          school: school.trim() || null,
        },
      }),
    onSuccess: () => {
      toast.success("Profile saved");
      queryClient.invalidateQueries({ queryKey: ["profile"] });
    },
    onError: () => toast.error("Could not save your profile"),
  });

  return (
    <>
      <PageHeader eyebrow="Settings" title="Your account." />
      <Panel className="max-w-xl">
        <PanelHeader title="Profile" />
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            mutation.mutate();
          }}
        >
          <label className="block text-sm text-foreground/70">
            Full name
            <input
              className={fieldClass}
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              placeholder="Your name"
            />
          </label>
          <label className="block text-sm text-foreground/70">
            School
            <input
              className={fieldClass}
              value={school}
              onChange={(event) => setSchool(event.target.value)}
              placeholder="Where you study"
            />
          </label>
          <Button type="submit" variant="brand" disabled={mutation.isPending}>
            {mutation.isPending ? "Saving…" : "Save changes"}
          </Button>
        </form>
      </Panel>
    </>
  );
}
