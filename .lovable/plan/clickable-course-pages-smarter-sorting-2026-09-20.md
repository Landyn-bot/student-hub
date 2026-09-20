# Clickable course pages + smarter sorting

## What you get

1. **Course cards become clickable.** On the Courses page (and the course tiles on the
   dashboard) each card lifts, shows a pointer cursor and an arrow on hover, and opens a
   full overview page for that class.
2. **Course overview page.** One page per class showing everything Syllo knows about it:
   - Header: class name, course code, instructor, plus counts (upcoming, overdue, done).
   - Weekly class times, when they were imported.
   - Upcoming work grouped by type (assignments, quizzes, exams, projects, readings).
   - Past / completed work in collapsed sections.
   - Each row opens the existing item details card (edit/delete still work for manual items).
   - Edit button for the class details, reusing the existing course form.
   - Calm empty state when a class has nothing yet.
3. **Sharper item handling after the model replies.** A second interpretation pass cleans
   the extracted list before it is saved, and the dashboard orders work more intelligently.

## The two AI/logic refinements

**A. Clean-up pass at import time (after the Nemotron JSON arrives, before saving)**
- Deterministic first: normalise titles (strip "Assignment:" prefixes, collapse whitespace,
  de-duplicate near-identical titles within one import), re-classify obvious types from the
  wording, drop empty/boilerplate rows ("Course Home", "Syllabus"), and reject dates that
  fall outside the student's term.
- Then one model call over just the compact list of extracted items (titles + dates + the
  source sentence, no raw document text) that returns, per item: the best type
  (assignment / quiz / exam / project / reading / policy / date), a tidied title, and
  whether two entries are the same thing. Anything the model is unsure about keeps the
  original value — nothing is invented, unknown stays unknown, and every item keeps its
  source sentence and document link.
- Items the pass cannot settle still flow into the existing "needs attention" path.

**B. Smarter ordering on the dashboard and course pages**
- The existing focus ranking is extended into a shared scoring helper used by the
  dashboard's "What should I work on?", the Today/Upcoming lists and the new course page:
  weighting by days remaining, overdue state, sitting vs. hand-in work, weight/points, and
  how many items land on the same day. Deterministic ordering stays the source of truth;
  the model only supplies the short "why" line, as it does today.

## Technical notes

- New route `src/routes/_authenticated/courses.$courseId.tsx` with its own `head()` meta.
- New `getCourseOverview` server function in `src/lib/courses.functions.ts`
  (`requireSupabaseAuth`, filtered by `user_id` and the course id) returning the course row,
  its planner items and class meetings — reusing the mapping logic already in
  `planner.functions.ts` rather than duplicating queries.
- Course cards wrapped in `<Link to="/courses/$courseId">` with the existing `tile-lift`
  hover treatment plus focus ring and `aria-label`.
- New `src/lib/server/item-refine.server.ts` holding the deterministic cleaners and the
  single model call, dynamically imported inside the existing save handler in
  `src/lib/server/course-import.server.ts` — no change to the EPUB parser, the edge
  function, or the provenance columns.
- New `src/lib/item-priority.ts` (pure, client-safe) with the shared scoring used by the
  dashboard, focus plan and course page.
- No schema change. No fake data. Type-check, lint and build after each step.

## Not in scope

Import UI redesign, the edge function, `src/lib/epub.ts`, finances, assistant.
