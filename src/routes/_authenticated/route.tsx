import { useQuery } from "@tanstack/react-query";
import {
  createFileRoute,
  Outlet,
  redirect,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import { useEffect } from "react";

import { AppShell } from "@/components/app/AppShell";
import { Button } from "@/components/ui/app-button";
import { supabase } from "@/integrations/supabase/client";
import { isGuestMode } from "@/lib/guest/mode";
import * as guestStore from "@/lib/guest/store";
import { useAppFn } from "@/lib/guest/use-app-fn";
import { getOnboardingState } from "@/lib/onboarding.functions";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    // Either an active account session, or the student chose to work without one.
    const { data, error } = await supabase.auth.getUser();
    if (!error && data.user) {
      return { user: data.user, guest: false as const };
    }
    if (isGuestMode()) {
      return { user: null, guest: true as const };
    }
    throw redirect({ to: "/auth" });
  },
  component: AuthenticatedLayout,
});

/** Reading course files needs an account, so guests see a friendly nudge instead. */
function AccountNeeded() {
  return (
    <div className="panel p-8 text-center">
      <h1 className="font-display text-xl font-semibold">This part needs a free account</h1>
      <p className="mx-auto mt-2 max-w-md text-sm text-foreground/60">
        Reading course files happens in the cloud, so it needs somewhere to keep the result. Making
        an account takes a moment, and everything you have added here can come with you.
      </p>
      <div className="mt-6">
        <Button variant="accent" asChild>
          <a href="/auth">Create an account</a>
        </Button>
      </div>
    </div>
  );
}

function AuthenticatedLayout() {
  const { user, guest } = Route.useRouteContext();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const fetchOnboarding = useAppFn(getOnboardingState, guestStore.getOnboardingState);
  const onboarding = useQuery({
    queryKey: ["onboarding"],
    queryFn: () => fetchOnboarding(),
  });
  const displayName = guest
    ? "Guest"
    : ((user?.user_metadata?.["full_name"] as string | undefined) ??
      user?.email?.split("@")[0] ??
      "Student");

  const isOnboarding = pathname === "/onboarding";
  const needsAccount = guest && pathname.startsWith("/import");

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

  return (
    <AppShell displayName={displayName} guest={guest}>
      {needsAccount ? <AccountNeeded /> : <Outlet />}
    </AppShell>
  );
}
