-- Store whether the student wants due-date reminders emailed to their account address.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS email_reminders boolean NOT NULL DEFAULT true;

DROP FUNCTION IF EXISTS public.complete_onboarding(text, text, date, date, smallint, integer, text);

CREATE FUNCTION public.complete_onboarding(
  _school text,
  _term_name text,
  _starts_on date,
  _ends_on date,
  _week_starts_on smallint,
  _default_reminder_hours integer,
  _planning_style text,
  _email_reminders boolean DEFAULT true
)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  _user_id uuid := auth.uid();
  _current_term_id uuid;
BEGIN
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF length(trim(_school)) = 0 OR length(_school) > 160 THEN
    RAISE EXCEPTION 'Invalid school';
  END IF;

  IF length(trim(_term_name)) = 0 OR length(_term_name) > 100 OR _ends_on < _starts_on THEN
    RAISE EXCEPTION 'Invalid semester';
  END IF;

  IF _week_starts_on NOT BETWEEN 0 AND 6
    OR _default_reminder_hours NOT IN (0, 12, 24, 48, 72)
    OR _planning_style NOT IN ('early', 'balanced', 'deadline') THEN
    RAISE EXCEPTION 'Invalid planning preferences';
  END IF;

  SELECT id INTO _current_term_id
  FROM public.terms
  WHERE user_id = _user_id AND is_current = true
  ORDER BY created_at DESC
  LIMIT 1;

  UPDATE public.terms
  SET is_current = false
  WHERE user_id = _user_id
    AND is_current = true
    AND (_current_term_id IS NULL OR id <> _current_term_id);

  IF _current_term_id IS NULL THEN
    INSERT INTO public.terms (user_id, name, starts_on, ends_on, is_current)
    VALUES (_user_id, trim(_term_name), _starts_on, _ends_on, true);
  ELSE
    UPDATE public.terms
    SET name = trim(_term_name), starts_on = _starts_on, ends_on = _ends_on, is_current = true
    WHERE id = _current_term_id AND user_id = _user_id;
  END IF;

  UPDATE public.profiles
  SET school = trim(_school),
      week_starts_on = _week_starts_on,
      default_reminder_hours = _default_reminder_hours,
      planning_style = _planning_style,
      email_reminders = _email_reminders,
      onboarding_completed_at = now(),
      updated_at = now()
  WHERE id = _user_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.complete_onboarding(text, text, date, date, smallint, integer, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_onboarding(text, text, date, date, smallint, integer, text, boolean) TO authenticated, service_role;