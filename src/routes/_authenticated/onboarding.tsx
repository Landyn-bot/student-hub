import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  GraduationCap,
  SlidersHorizontal,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { SchoolField } from "@/components/app/SchoolField";
import { Button } from "@/components/ui/app-button";
import {
  completeOnboarding,
  getOnboardingState,
  type PlanningStyle,
} from "@/lib/onboarding.functions";
import { guessCurrentSemester } from "@/lib/semester";

export const Route = createFileRoute("/_authenticated/onboarding")({
  head: () => ({
    meta: [
      { title: "Set up your planner — Syllo" },
      { name: "description", content: "Set your school, semester, and planning preferences." },
      { property: "og:title", content: "Set up your planner — Syllo" },
      {
        property: "og:description",
        content: "Set your school, semester, and planning preferences.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: OnboardingPage,
});

const fieldClass =
  "mt-2 h-11 w-full rounded-xl border border-border bg-background px-3 text-sm text-foreground outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/15";

const steps = [
  { label: "School", icon: GraduationCap },
  { label: "Semester", icon: CalendarDays },
  { label: "Planning", icon: SlidersHorizontal },
] as const;

const planningOptions: Array<{
  value: PlanningStyle;
  label: string;
  description: string;
}> = [
  { value: "early", label: "Work ahead", description: "Nudge tasks forward when time allows." },
  { value: "balanced", label: "Balanced", description: "Spread work steadily across the week." },
  {
    value: "deadline",
    label: "Deadline focused",
    description: "Keep the nearest due dates front and center.",
  },
];

function OnboardingPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const fetchOnboarding = useServerFn(getOnboardingState);
  const saveOnboarding = useServerFn(completeOnboarding);
  // Today's date decides the semester we suggest, so students only confirm it.
  const [suggested] = useState(() => guessCurrentSemester());
  const [step, setStep] = useState(0);
  const [school, setSchool] = useState("");
  const [termName, setTermName] = useState(suggested.name);
  const [startsOn, setStartsOn] = useState(suggested.startsOn);
  const [endsOn, setEndsOn] = useState(suggested.endsOn);
  const [weekStartsOn, setWeekStartsOn] = useState(1);
  const [reminderHours, setReminderHours] = useState<0 | 12 | 24 | 48 | 72>(24);
  const [planningStyle, setPlanningStyle] = useState<PlanningStyle>("balanced");
  const [emailReminders, setEmailReminders] = useState(true);

  const { data } = useQuery({
    queryKey: ["onboarding"],
    queryFn: () => fetchOnboarding(),
  });

  useEffect(() => {
    if (!data) return;
    setSchool(data.school ?? "");
    // Keep the suggested semester unless one was already saved.
    setTermName(data.term?.name ?? suggested.name);
    setStartsOn(data.term?.starts_on ?? suggested.startsOn);
    setEndsOn(data.term?.ends_on ?? suggested.endsOn);
    setWeekStartsOn(data.preferences.week_starts_on);
    setReminderHours(data.preferences.default_reminder_hours as 0 | 12 | 24 | 48 | 72);
    setPlanningStyle(data.preferences.planning_style);
    setEmailReminders(data.preferences.email_reminders);
  }, [data, suggested]);

  const mutation = useMutation({
    mutationFn: () =>
      saveOnboarding({
        data: {
          school,
          term_name: termName,
          starts_on: startsOn,
          ends_on: endsOn,
          week_starts_on: weekStartsOn,
          default_reminder_hours: reminderHours,
          planning_style: planningStyle,
        },
      }),
    onSuccess: async () => {
      // Refresh the setup guard before leaving this page.
      await queryClient.invalidateQueries({ queryKey: ["onboarding"] });
      toast.success("Your planner is ready");
      navigate({ to: "/dashboard", replace: true });
    },
    onError: () => toast.error("We couldn't save your setup. Please try again."),
  });

  function continueForward() {
    if (step === 0 && !school.trim()) {
      toast.error("Enter your school to continue");
      return;
    }
    if (step === 1) {
      if (!termName.trim() || !startsOn || !endsOn) {
        toast.error("Complete your semester details to continue");
        return;
      }
      if (endsOn < startsOn) {
        toast.error("The end date must be after the start date");
        return;
      }
    }
    if (step < steps.length - 1) setStep((current) => current + 1);
    else mutation.mutate();
  }

  return (
    <main className="min-h-screen bg-background px-5 py-6 text-foreground sm:px-8 sm:py-10">
      <div className="mx-auto max-w-4xl">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="grid size-8 place-items-center rounded-xl bg-primary font-display text-sm font-semibold text-primary-foreground">
              S
            </span>
            <span className="font-display text-xl font-semibold">Syllo</span>
          </div>
          <p className="text-xs text-foreground/45">SteelHacks XIII · 2026</p>
        </header>

        <div className="mt-10 grid gap-8 lg:mt-14 lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-12">
          <aside>
            <p className="text-sm font-medium text-primary">Set up your planner</p>
            <h1 className="mt-2 text-balance font-display text-3xl font-semibold leading-tight sm:text-4xl">
              Make Syllo fit your semester.
            </h1>
            <p className="mt-3 text-sm leading-6 text-foreground/55">
              Only your setup is saved. Courses and assignments stay empty until you add them.
            </p>

            <ol className="mt-7 flex gap-2 lg:flex-col">
              {steps.map((item, index) => {
                const Icon = item.icon;
                const active = index === step;
                const complete = index < step;
                return (
                  <li
                    key={item.label}
                    className={`flex min-w-0 flex-1 items-center gap-3 rounded-xl p-2 text-sm transition-colors ${active ? "bg-card text-foreground ring-1 ring-border" : "text-foreground/45"}`}
                    aria-current={active ? "step" : undefined}
                  >
                    <span
                      className={`grid size-8 shrink-0 place-items-center rounded-xl ${active || complete ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
                    >
                      {complete ? <Check className="size-4" /> : <Icon className="size-4" />}
                    </span>
                    <span className="hidden lg:inline">{item.label}</span>
                  </li>
                );
              })}
            </ol>
          </aside>

          <section className="panel min-h-[27rem] p-6 sm:p-8">
            <div className="mb-7">
              <p className="text-xs font-medium uppercase tracking-[0.12em] text-foreground/40">
                Step {step + 1} of {steps.length}
              </p>
              <h2 className="mt-2 font-display text-2xl font-semibold">
                {step === 0
                  ? "Where do you study?"
                  : step === 1
                    ? "Set your current semester."
                    : "How do you like to plan?"}
              </h2>
              <p className="mt-2 text-sm leading-6 text-foreground/55">
                {step === 0
                  ? "This keeps your workspace grounded in your school."
                  : step === 1
                    ? "Dates help Syllo frame your calendar without adding any coursework."
                    : "These defaults shape future reminders and weekly views."}
              </p>
            </div>

            {step === 0 ? (
              <label className="block max-w-lg text-sm font-medium text-foreground/75">
                School or university
                <input
                  autoFocus
                  className={fieldClass}
                  value={school}
                  onChange={(event) => setSchool(event.target.value)}
                  placeholder="University of Pittsburgh"
                  maxLength={160}
                  autoComplete="organization"
                />
              </label>
            ) : null}

            {step === 1 ? (
              <div className="grid max-w-xl gap-5 sm:grid-cols-2">
                <label className="block text-sm font-medium text-foreground/75 sm:col-span-2">
                  Semester name
                  <input
                    autoFocus
                    className={fieldClass}
                    value={termName}
                    onChange={(event) => setTermName(event.target.value)}
                    placeholder="Fall 2026"
                    maxLength={100}
                  />
                </label>
                <label className="block text-sm font-medium text-foreground/75">
                  Starts
                  <input
                    className={fieldClass}
                    type="date"
                    value={startsOn}
                    onChange={(event) => setStartsOn(event.target.value)}
                  />
                </label>
                <label className="block text-sm font-medium text-foreground/75">
                  Ends
                  <input
                    className={fieldClass}
                    type="date"
                    min={startsOn}
                    value={endsOn}
                    onChange={(event) => setEndsOn(event.target.value)}
                  />
                </label>
              </div>
            ) : null}

            {step === 2 ? (
              <div className="space-y-6">
                <fieldset>
                  <legend className="text-sm font-medium text-foreground/75">Planning style</legend>
                  <div className="mt-2 grid gap-2 sm:grid-cols-3">
                    {planningOptions.map((option) => (
                      <label
                        key={option.value}
                        className={`inset-tile cursor-pointer p-3 transition-colors ${planningStyle === option.value ? "border-primary bg-primary/8" : "bg-background"}`}
                      >
                        <input
                          className="sr-only"
                          type="radio"
                          name="planning-style"
                          checked={planningStyle === option.value}
                          onChange={() => setPlanningStyle(option.value)}
                        />
                        <span className="block text-sm font-semibold">{option.label}</span>
                        <span className="mt-1 block text-xs leading-5 text-foreground/50">
                          {option.description}
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>
                <div className="grid gap-5 sm:grid-cols-2">
                  <label className="block text-sm font-medium text-foreground/75">
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
                  <label className="block text-sm font-medium text-foreground/75">
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
              </div>
            ) : null}

            <div className="mt-10 flex items-center justify-between border-t border-border pt-5">
              <Button
                type="button"
                variant="ghost"
                disabled={step === 0 || mutation.isPending}
                onClick={() => setStep((current) => current - 1)}
              >
                <ArrowLeft className="size-4" /> Back
              </Button>
              <Button
                type="button"
                variant={step === steps.length - 1 ? "accent" : "brand"}
                disabled={mutation.isPending}
                onClick={continueForward}
              >
                {mutation.isPending
                  ? "Saving…"
                  : step === steps.length - 1
                    ? "Enter Syllo"
                    : "Continue"}
                {step === steps.length - 1 ? (
                  <Check className="size-4" />
                ) : (
                  <ArrowRight className="size-4" />
                )}
              </Button>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
