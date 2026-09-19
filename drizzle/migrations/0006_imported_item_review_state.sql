-- Review state for AI-extracted items. Rejected rows stay in the database (the source
-- material is never destroyed) but are excluded from every active planner query.
ALTER TABLE public.assignments
  ADD COLUMN IF NOT EXISTS review_status text NOT NULL DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS edited_by_user boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS edited_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS source_chunk_key text,
  ADD COLUMN IF NOT EXISTS needs_attention_reason text;

ALTER TABLE public.exams
  ADD COLUMN IF NOT EXISTS review_status text NOT NULL DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS edited_by_user boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS edited_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS source_chunk_key text,
  ADD COLUMN IF NOT EXISTS needs_attention_reason text,
  ADD COLUMN IF NOT EXISTS ai_confidence numeric;

ALTER TABLE public.calendar_events
  ADD COLUMN IF NOT EXISTS review_status text NOT NULL DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS edited_by_user boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS edited_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS source_chunk_key text,
  ADD COLUMN IF NOT EXISTS needs_attention_reason text,
  ADD COLUMN IF NOT EXISTS ai_confidence numeric;

ALTER TABLE public.course_policies
  ADD COLUMN IF NOT EXISTS review_status text NOT NULL DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS edited_by_user boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS edited_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS source_chunk_key text,
  ADD COLUMN IF NOT EXISTS needs_attention_reason text,
  ADD COLUMN IF NOT EXISTS ai_confidence numeric;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'assignments_review_status_check') THEN
    ALTER TABLE public.assignments ADD CONSTRAINT assignments_review_status_check
      CHECK (review_status IN ('approved', 'needs_attention', 'rejected'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'exams_review_status_check') THEN
    ALTER TABLE public.exams ADD CONSTRAINT exams_review_status_check
      CHECK (review_status IN ('approved', 'needs_attention', 'rejected'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'calendar_events_review_status_check') THEN
    ALTER TABLE public.calendar_events ADD CONSTRAINT calendar_events_review_status_check
      CHECK (review_status IN ('approved', 'needs_attention', 'rejected'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'course_policies_review_status_check') THEN
    ALTER TABLE public.course_policies ADD CONSTRAINT course_policies_review_status_check
      CHECK (review_status IN ('approved', 'needs_attention', 'rejected'));
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS assignments_user_review_idx ON public.assignments (user_id, review_status);
CREATE INDEX IF NOT EXISTS exams_user_review_idx ON public.exams (user_id, review_status);
CREATE INDEX IF NOT EXISTS calendar_events_user_review_idx ON public.calendar_events (user_id, review_status);
CREATE INDEX IF NOT EXISTS course_policies_user_review_idx ON public.course_policies (user_id, review_status);

-- Courses are matched back to the upload that produced them.
CREATE INDEX IF NOT EXISTS courses_user_external_idx ON public.courses (user_id, external_id);