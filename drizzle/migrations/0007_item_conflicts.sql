CREATE TABLE public.item_conflicts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  course_id uuid REFERENCES public.courses(id) ON DELETE CASCADE,
  item_kind text NOT NULL,
  item_id uuid,
  field text NOT NULL DEFAULT 'date',
  resolution text NOT NULL,
  existing_value text,
  incoming_value text,
  chosen_value text,
  existing_source_text text,
  incoming_source_text text,
  existing_document_id uuid REFERENCES public.course_documents(id) ON DELETE SET NULL,
  incoming_document_id uuid REFERENCES public.course_documents(id) ON DELETE SET NULL,
  detail text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.item_conflicts TO authenticated;
GRANT ALL ON public.item_conflicts TO service_role;

ALTER TABLE public.item_conflicts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own conflicts"
  ON public.item_conflicts
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX item_conflicts_user_course_idx ON public.item_conflicts (user_id, course_id);
