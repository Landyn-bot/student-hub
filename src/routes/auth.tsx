import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/app-button";
import { lovable } from "@/integrations/lovable/index";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Sign in — Syllo" },
      {
        name: "description",
        content: "Sign in to Syllo, the calm planner for your whole semester.",
      },
      { property: "og:title", content: "Sign in — Syllo" },
      {
        property: "og:description",
        content: "Sign in to Syllo, the calm planner for your semester.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AuthPage,
});

const fieldClass =
  "mt-1 h-11 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary";

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Send returning students directly to their workspace.
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        navigate({ to: "/dashboard", replace: true });
      }
    });
  }, [navigate]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: window.location.origin,
            data: { full_name: fullName.trim() || null },
          },
        });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
      }
      navigate({ to: "/dashboard", replace: true });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function handleGoogle() {
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });
    if (result.error) {
      toast.error("Google sign-in failed");
      return;
    }
    if (result.redirected) {
      return;
    }
    navigate({ to: "/dashboard", replace: true });
  }

  return (
    <div className="flex min-h-screen flex-col bg-background font-body text-foreground">
      <header className="mx-auto flex h-16 w-full max-w-7xl items-center px-5 sm:px-8">
        <Link to="/" className="flex items-center gap-2">
          <span className="grid size-7 place-items-center rounded-[10px] bg-primary font-display text-xs font-semibold text-primary-foreground">
            S
          </span>
          <span className="font-display text-lg font-semibold tracking-tight">Syllo</span>
        </Link>
      </header>

      <main className="flex flex-1 items-center justify-center px-5 pb-16">
        <div className="panel w-full max-w-md p-6 sm:p-8">
          <h1 className="font-display text-2xl font-semibold">
            {mode === "signin" ? "Welcome back." : "Start your semester."}
          </h1>
          <p className="mt-1 text-sm text-foreground/55">
            {mode === "signin"
              ? "Sign in to pick up where you left off."
              : "Create an account to set up your planner."}
          </p>

          <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
            {mode === "signup" ? (
              <label className="block text-sm text-foreground/70">
                Full name
                <input
                  className={fieldClass}
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                  placeholder="Your name"
                />
              </label>
            ) : null}
            <label className="block text-sm text-foreground/70">
              Email
              <input
                className={fieldClass}
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            <label className="block text-sm text-foreground/70">
              Password
              <input
                className={fieldClass}
                type="password"
                required
                minLength={8}
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>

            <Button type="submit" variant="brand" size="lg" className="w-full" disabled={busy}>
              {busy ? "One moment…" : mode === "signin" ? "Sign in" : "Create account"}
            </Button>
          </form>

          <div className="my-5 flex items-center gap-3 text-xs text-foreground/40">
            <span className="h-px flex-1 bg-border" />
            or
            <span className="h-px flex-1 bg-border" />
          </div>

          <Button variant="outline" size="lg" className="w-full" onClick={handleGoogle}>
            Continue with Google
          </Button>

          <p className="mt-6 text-center text-sm text-foreground/55">
            {mode === "signin" ? "New here?" : "Already have an account?"}{" "}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="font-medium text-primary underline-offset-4 hover:underline"
              onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
            >
              {mode === "signin" ? "Create an account" : "Sign in"}
            </Button>
          </p>
        </div>
      </main>
    </div>
  );
}
