import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/app/PageHeader";
import { SchoolField } from "@/components/app/SchoolField";
import { Button } from "@/components/ui/app-button";
import { Panel, PanelHeader } from "@/components/ui/panel-surface";
import { getProfile, updateProfile } from "@/lib/profile.functions";
import {
  completeOnboarding,
  getOnboardingState,
  type PlanningStyle,
} from "@/lib/onboarding.functions";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({
    meta: [
      { title: "Settings — Syllo" },
      { name: "description", content: "Your account and planner preferences." },
      { property: "og:title", content: "Settings — Syllo" },
      {
        property: "og:description",
        content: "Your account and planner preferences.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SettingsPage,
});

const fieldClass =
  "mt-1 h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary";

function SettingsPage() {
  const fetchProfile = useServerFn(getProfile);
  const saveProfile = useServerFn(updateProfile);
  const fetchOnboarding = useServerFn(getOnboardingState);
  const saveOnboarding = useServerFn(completeOnboarding);
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: ["profile"],
    queryFn: () => fetchProfile(),
  });

  const [fullName, setFullName] = useState("");
  const [school, setSchool] = useState("");
  const [termName, setTermName] = useState("");
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [weekStartsOn, setWeekStartsOn] = useState(1);
  const [reminderHours, setReminderHours] = useState<0 | 12 | 24 | 48 | 72>(24);
  const [planningStyle, setPlanningStyle] = useState<PlanningStyle>("balanced");
  const [emailReminders, setEmailReminders] = useState(true);

  const { data: onboarding } = useQuery({
    queryKey: ["onboarding"],
    queryFn: () => fetchOnboarding(),
  });

  useEffect(() => {
    if (data) {
      setFullName(data.full_name ?? "");
      setSchool(data.school ?? "");
    }
  }, [data]);

  useEffect(() => {
    if (!onboarding) return;
    setSchool(onboarding.school ?? "");
    setTermName(onboarding.term?.name ?? "");
    setStartsOn(onboarding.term?.starts_on ?? "");
    setEndsOn(onboarding.term?.ends_on ?? "");
    setWeekStartsOn(onboarding.preferences.week_starts_on);
    setReminderHours(onboarding.preferences.default_reminder_hours as 0 | 12 | 24 | 48 | 72);
    setPlanningStyle(onboarding.preferences.planning_style);
    setEmailReminders(onboarding.preferences.email_reminders);
  }, [onboarding]);

  const mutation = useMutation({
    mutationFn: async () => {
      await saveProfile({
        data: { full_name: fullName.trim() || null, school: school.trim() || null },
      });
      await saveOnboarding({
        data: {
          school,
          term_name: termName,
          starts_on: startsOn,
          ends_on: endsOn,
          week_starts_on: weekStartsOn,
          default_reminder_hours: reminderHours,
          planning_style: planningStyle,
          email_reminders: emailReminders,
        },
      });
    },
    onSuccess: () => {
      toast.success("Profile saved");
      queryClient.invalidateQueries({ queryKey: ["profile"] });
      queryClient.invalidateQueries({ queryKey: ["onboarding"] });
    },
    onError: () => toast.error("Could not save your profile"),
  });

  return (
    <>
      <PageHeader eyebrow="Settings" title="Your account." />
      <Panel className="max-w-2xl">
        <PanelHeader title="Profile & planner" />
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
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm text-foreground/70">
              Semester name
              <input
                className={fieldClass}
                required
                maxLength={100}
                value={termName}
                onChange={(event) => setTermName(event.target.value)}
              />
            </label>
            <label className="block text-sm text-foreground/70">
              Week starts on
              <select
                className={fieldClass}
                value={weekStartsOn}
                onChange={(event) => setWeekStartsOn(Number(event.target.value))}
              >
                <option value={0}>Sunday</option>
                <option value={1}>Monday</option>
                <option value={6}>Saturday</option>
              </select>
            </label>
            <label className="block text-sm text-foreground/70">
              Semester starts
              <input
                className={fieldClass}
                type="date"
                required
                value={startsOn}
                onChange={(event) => setStartsOn(event.target.value)}
              />
            </label>
            <label className="block text-sm text-foreground/70">
              Semester ends
              <input
                className={fieldClass}
                type="date"
                required
                min={startsOn}
                value={endsOn}
                onChange={(event) => setEndsOn(event.target.value)}
              />
            </label>
            <label className="block text-sm text-foreground/70">
              Planning style
              <select
                className={fieldClass}
                value={planningStyle}
                onChange={(event) => setPlanningStyle(event.target.value as PlanningStyle)}
              >
                <option value="early">Work ahead</option>
                <option value="balanced">Balanced</option>
                <option value="deadline">Deadline focused</option>
              </select>
            </label>
            <label className="block text-sm text-foreground/70">
              Default reminder
              <select
                className={fieldClass}
                value={reminderHours}
                onChange={(event) =>
                  setReminderHours(Number(event.target.value) as 0 | 12 | 24 | 48 | 72)
                }
              >
                <option value={0}>No reminder</option>
                <option value={12}>12 hours before</option>
                <option value={24}>1 day before</option>
                <option value={48}>2 days before</option>
                <option value={72}>3 days before</option>
              </select>
            </label>
          </div>
          <div className="block text-sm text-foreground/70">
            School
            <SchoolField
              className={fieldClass}
              value={school}
              onChange={setSchool}
              placeholder="Where you study"
            />
          </div>
          <label className="flex items-start gap-3 text-sm text-foreground/70">
            <input
              type="checkbox"
              className="mt-1 size-4 accent-[hsl(var(--primary))]"
              checked={emailReminders}
              onChange={(event) => setEmailReminders(event.target.checked)}
              disabled={reminderHours === 0}
            />
            <span>
              Email me my reminders
              <span className="mt-1 block text-xs text-foreground/45">
                {reminderHours === 0
                  ? "Pick a reminder time above to receive emails."
                  : `Sent to ${onboarding?.reminder_email ?? "your account email"} before each due date.`}
              </span>
            </span>
          </label>
          <Button type="submit" variant="brand" disabled={mutation.isPending}>
            {mutation.isPending ? "Saving…" : "Save changes"}
          </Button>
        </form>
      </Panel>
    </>
  );
}
