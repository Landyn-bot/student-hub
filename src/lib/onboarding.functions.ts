import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const planningStyles = ["early", "balanced", "deadline"] as const;
export type PlanningStyle = (typeof planningStyles)[number];

export type OnboardingState = {
  completed: boolean;
  school: string | null;
  term: {
    name: string;
    starts_on: string | null;
    ends_on: string | null;
  } | null;
  preferences: {
    week_starts_on: number;
    default_reminder_hours: number;
    planning_style: PlanningStyle;
  };
};

const onboardingInput = z
  .object({
    school: z.string().trim().min(1, "Enter your school").max(160),
    term_name: z.string().trim().min(1, "Name your semester").max(100),
    starts_on: z.string().date(),
    ends_on: z.string().date(),
    week_starts_on: z.number().int().min(0).max(6),
    default_reminder_hours: z.union([
      z.literal(0),
      z.literal(12),
      z.literal(24),
      z.literal(48),
      z.literal(72),
    ]),
    planning_style: z.enum(planningStyles),
  })
  .refine((value) => value.ends_on >= value.starts_on, {
    message: "The semester end date must be after its start date",
    path: ["ends_on"],
  });

export const getOnboardingState = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<OnboardingState> => {
    const [profileResult, termResult] = await Promise.all([
      context.supabase
        .from("profiles")
        .select(
          "school, onboarding_completed_at, week_starts_on, default_reminder_hours, planning_style",
        )
        .eq("id", context.userId)
        .maybeSingle(),
      context.supabase
        .from("terms")
        .select("name, starts_on, ends_on")
        .eq("user_id", context.userId)
        .eq("is_current", true)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    if (profileResult.error) throw profileResult.error;
    if (termResult.error) throw termResult.error;

    const profile = profileResult.data;
    const planningStyle = planningStyles.includes(profile?.planning_style as PlanningStyle)
      ? (profile?.planning_style as PlanningStyle)
      : "balanced";

    return {
      completed: Boolean(profile?.onboarding_completed_at),
      school: profile?.school ?? null,
      term: termResult.data,
      preferences: {
        week_starts_on: profile?.week_starts_on ?? 1,
        default_reminder_hours: profile?.default_reminder_hours ?? 24,
        planning_style: planningStyle,
      },
    };
  });

export const completeOnboarding = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => onboardingInput.parse(data))
  .handler(async ({ data, context }) => {
    // One database operation saves profile preferences and the current term together.
    const { error } = await context.supabase.rpc("complete_onboarding", {
      _school: data.school,
      _term_name: data.term_name,
      _starts_on: data.starts_on,
      _ends_on: data.ends_on,
      _week_starts_on: data.week_starts_on,
      _default_reminder_hours: data.default_reminder_hours,
      _planning_style: data.planning_style,
    });

    if (error) throw error;
    return { ok: true };
  });