-- Every policy on these tables is scoped TO authenticated with auth.uid() = user_id,
-- so the anon role has no legitimate read path. Remove its table grants as defence in depth.
REVOKE ALL ON public.assignments FROM anon;
REVOKE ALL ON public.budgets FROM anon;
REVOKE ALL ON public.calendar_events FROM anon;
REVOKE ALL ON public.chat_conversations FROM anon;
REVOKE ALL ON public.chat_messages FROM anon;
REVOKE ALL ON public.course_documents FROM anon;
REVOKE ALL ON public.course_policies FROM anon;
REVOKE ALL ON public.courses FROM anon;
REVOKE ALL ON public.exams FROM anon;
REVOKE ALL ON public.financial_transactions FROM anon;
REVOKE ALL ON public.item_conflicts FROM anon;
REVOKE ALL ON public.profiles FROM anon;
REVOKE ALL ON public.tasks FROM anon;
REVOKE ALL ON public.terms FROM anon;
