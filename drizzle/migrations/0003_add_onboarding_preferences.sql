ALTER TABLE public.profiles
  ADD COLUMN onboarding_completed_at timestamptz,
  ADD COLUMN week_starts_on smallint NOT NULL DEFAULT 1,
  ADD COLUMN default_reminder_hours integer NOT NULL DEFAULT 24,
  ADD COLUMN planning_style text NOT NULL DEFAULT 'balanced';

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_week_starts_on_check CHECK (week_starts_on BETWEEN 0 AND 6),
  ADD CONSTRAINT profiles_default_reminder_hours_check CHECK (default_reminder_hours IN (0, 12, 24, 48, 72)),
  ADD CONSTRAINT profiles_planning_style_check CHECK (planning_style IN ('early', 'balanced', 'deadline'));

ALTER TABLE public.terms
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX terms_user_current_idx ON public.terms (user_id, is_current);

CREATE TRIGGER set_terms_updated_at
  BEFORE UPDATE ON public.terms
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();