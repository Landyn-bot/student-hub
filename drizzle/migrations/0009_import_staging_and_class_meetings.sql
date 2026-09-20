-- Review-before-commit import pipeline.
--
-- The import-epub edge function writes what the model extracted into STAGING tables only.
-- Nothing reaches assignments / exams / calendar_events / course_policies / class_meetings
-- until the student confirms the batch on the review screen.

-- ============ import_batches: one row per uploaded file ============
CREATE TABLE IF NOT EXISTS public.import_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  file_hash TEXT NOT NULL,
  file_size BIGINT NOT NULL DEFAULT 0,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('epub', 'text')),
  status TEXT NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing', 'ready', 'partial', 'failed', 'confirmed', 'discarded')),
  stage TEXT NOT NULL DEFAULT 'extracting',
  chunks_total INTEGER NOT NULL DEFAULT 0,
  chunks_done INTEGER NOT NULL DEFAULT 0,
  chunks_failed INTEGER NOT NULL DEFAULT 0,
  done_chunk_ids TEXT[] NOT NULL DEFAULT '{}',
  error_code TEXT,
  error_message TEXT,
  model TEXT,
  course_code TEXT,
  course_name TEXT,
  course_instructor TEXT,
  course_term TEXT,
  -- Normalised chunks kept so a partial or failed import can be resumed without re-uploading.
  ir JSONB,
  warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
  heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at TIMESTAMPTZ,
  confirmed_course_id UUID REFERENCES public.courses(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.import_batches TO authenticated;
GRANT ALL ON public.import_batches TO service_role;
REVOKE ALL ON public.import_batches FROM anon;
ALTER TABLE public.import_batches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own import batches" ON public.import_batches
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER set_import_batches_updated_at BEFORE UPDATE ON public.import_batches
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX IF NOT EXISTS import_batches_user_status_idx ON public.import_batches (user_id, status);
CREATE INDEX IF NOT EXISTS import_batches_user_hash_idx ON public.import_batches (user_id, file_hash);

-- ============ import_staged_items: extracted records awaiting review ============
CREATE TABLE IF NOT EXISTS public.import_staged_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES public.import_batches(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('deadline', 'exam', 'class_meeting', 'policy')),
  subtype TEXT NOT NULL DEFAULT 'other',
  title TEXT NOT NULL,
  -- For policies this holds the rule text.
  description TEXT,
  item_date DATE,
  start_time TIME,
  end_time TIME,
  -- ISO weekdays, Monday = 1 ... Sunday = 7 (class meetings).
  weekdays SMALLINT[],
  location TEXT,
  points NUMERIC,
  weight NUMERIC,
  parameters JSONB,
  confidence NUMERIC,
  needs_review BOOLEAN NOT NULL DEFAULT false,
  review_reason TEXT,
  source_quote TEXT,
  source_section TEXT,
  source_chunk_id TEXT,
  -- pending: as extracted, edited: changed by the student, removed: excluded from the commit.
  user_status TEXT NOT NULL DEFAULT 'pending' CHECK (user_status IN ('pending', 'edited', 'removed')),
  added_by_user BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.import_staged_items TO authenticated;
GRANT ALL ON public.import_staged_items TO service_role;
REVOKE ALL ON public.import_staged_items FROM anon;
ALTER TABLE public.import_staged_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own staged items" ON public.import_staged_items
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER set_import_staged_items_updated_at BEFORE UPDATE ON public.import_staged_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX IF NOT EXISTS import_staged_items_batch_idx ON public.import_staged_items (batch_id);

-- ============ class_meetings: the recurring weekly schedule ============
CREATE TABLE IF NOT EXISTS public.class_meetings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  course_id UUID REFERENCES public.courses(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'Class meeting',
  -- ISO weekday, Monday = 1 ... Sunday = 7.
  weekday SMALLINT NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  start_time TIME,
  end_time TIME,
  location TEXT,
  source_document_id UUID REFERENCES public.course_documents(id) ON DELETE SET NULL,
  source_text TEXT,
  source_section TEXT,
  source_chunk_key TEXT,
  ai_generated BOOLEAN NOT NULL DEFAULT false,
  ai_confidence NUMERIC,
  review_status TEXT NOT NULL DEFAULT 'approved'
    CHECK (review_status IN ('approved', 'needs_attention', 'rejected')),
  edited_by_user BOOLEAN NOT NULL DEFAULT false,
  edited_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.class_meetings TO authenticated;
GRANT ALL ON public.class_meetings TO service_role;
REVOKE ALL ON public.class_meetings FROM anon;
ALTER TABLE public.class_meetings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own class meetings" ON public.class_meetings
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER set_class_meetings_updated_at BEFORE UPDATE ON public.class_meetings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX IF NOT EXISTS class_meetings_user_idx ON public.class_meetings (user_id, weekday);
CREATE INDEX IF NOT EXISTS class_meetings_course_idx ON public.class_meetings (course_id);

-- ============ citations and structured policy parameters on the live tables ============
ALTER TABLE public.assignments ADD COLUMN IF NOT EXISTS source_section TEXT;
ALTER TABLE public.exams ADD COLUMN IF NOT EXISTS source_section TEXT;
ALTER TABLE public.calendar_events ADD COLUMN IF NOT EXISTS source_section TEXT;
ALTER TABLE public.course_policies ADD COLUMN IF NOT EXISTS source_section TEXT;
ALTER TABLE public.course_policies ADD COLUMN IF NOT EXISTS parameters JSONB;
