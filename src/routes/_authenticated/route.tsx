import { useQuery } from "@tanstack/react-query";
import {
  createFileRoute,
  Outlet,
  redirect,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect } from "react";

import { AppShell } from "@/components/app/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { getOnboardingState } from "@/lib/onboarding.functions";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    // Keep every child page behind the active Lovable Cloud session.
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      throw redirect({ to: "/auth" });
    }
    return { user: data.user };
  },
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const { user } = Route.useRouteContext();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const fetchOnboarding = useServerFn(getOnboardingState);
  const onboarding = useQuery({
    queryKey: ["onboarding"],
    queryFn: () => fetchOnboarding(),
  });
  const displayName =
    (user.user_metadata?.["full_name"] as string | undefined) ??
    user.email?.split("@")[0] ??
    "Student";

  const isOnboarding = pathname === "/onboarding";

  useEffect(() => {
    if (!onboarding.data) return;

    if (!onboarding.data.completed && !isOnboarding) {
      navigate({ to: "/onboarding", replace: true });
    } else if (onboarding.data.completed && isOnboarding) {
      navigate({ to: "/dashboard", replace: true });
    }
  }, [isOnboarding, navigate, onboarding.data]);

  if (onboarding.isPending) {
    return (
      <div className="grid min-h-screen place-items-center bg-background px-5 text-sm text-foreground/55">
        Preparing your planner…
      </div>
    );
  }

  if (onboarding.data && !onboarding.data.completed && !isOnboarding) return null;
  if (onboarding.data?.completed && isOnboarding) return null;
  if (isOnboarding) return <Outlet />;

  return <AppShell displayName={displayName}><Outlet /></AppShell>;
}
