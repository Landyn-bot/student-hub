# Make Nemotron's semantic role visible in the import pipeline

Most of what you asked for already exists: Nemotron already classifies extracted course
content into assignments, exams, quizzes, projects, readings, policies, grading and
important dates, and it is already used to compare two sources when they may describe the
same item. The deterministic parser still does all file parsing. So this phase does not
rebuild the pipeline — it captures and surfaces what Nemotron actually does, and tightens
the two gaps.

## What changes

### 1. Keep a trace of every model step (server)

`src/lib/server/nemotron.ts` already analyses each chunk independently. It will also return
a per-chunk trace record: the excerpt that was sent, the model's raw reply, the validated
result, status and latency. Nothing about NVIDIA leaves the server — the trace is Syllo's
own data, and the API key is never part of it.

`src/lib/course-content.ts` gains the trace type; the analyze endpoint passes it through
unchanged.

### 2. Record conflict decisions (server)

`saveCourseImport` already reconciles new items against existing ones (insert / merge /
supersede / needs attention), using Nemotron when the titles are close but not identical.
It will return those decisions with the run result so the debug view can show why an item
was merged, replaced or flagged. The stored `item_conflicts` rows are unchanged.

### 3. Small developer view (one page, no redesign)

New route `/import-debug`, reachable only from a quiet "Developer view" link at the bottom
of the finished import summary. It shows, for the most recent import held in memory:

- a list of chunks on the left
- for the selected chunk: **source text** (exactly what was sent), **Nemotron
  interpretation** (the raw model reply plus the validated categories it produced), and
  **final structured result** (the rows that were saved, or the conflict decision that
  merged, superseded or flagged them)

Import state moves to a small shared store so the debug page can read the last run without
re-uploading. No new database tables, no changes to the dashboard, calendar or assistant.

## Technical notes

- New: `src/lib/import-store.ts` (in-memory last-run store), `src/routes/_authenticated/import-debug.tsx`.
- Modified: `src/lib/server/nemotron.ts`, `src/lib/course-content.ts`,
  `src/lib/course-analysis.functions.ts`, `src/lib/semester-import.functions.ts`,
  `src/routes/_authenticated/import.tsx` (store the run, add the link).
- `src/lib/epub.ts` is not touched. Parsing stays fully deterministic.
- Trace is capped (raw reply truncated) so a large import does not bloat memory.
- Typecheck, lint and prettier run after the change.
