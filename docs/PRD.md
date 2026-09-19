# Product Requirements Document

## Product Summary
College Survival Dashboard turns authorized Canvas EPUB exports into an evidence-backed semester view. The current frontend is Lovable-generated React/TypeScript using TanStack Start/Vite. The approved target adds a Python FastAPI backend, SQLite/SQLAlchemy persistence, deterministic EPUB processing, and server-side NVIDIA Nemotron. This target is not yet implemented.

## Priority Contract
### Must Have
- Select one to five EPUB files and process each independently.
- Show queued, reading, extracting, validating, and terminal states.
- Display courses, assignments, assessments, due dates, policies, and office hours when present.
- Combine multiple courses in a semester dashboard.
- Provide a course detail view and source/evidence drawer.
- Provide cited Ask My Semester answers and explicit abstention.
- Preserve unknown and conflicting values.
- Handle duplicate uploads and deletion.
- Enforce upload, session, ownership, and rendering safety.

### Should Have
Manual corrections with history, retry controls, search/filter polish, responsive refinements, and additional authorized samples.

### Stretch
ICS export, completion checkboxes, workload visualization, or a manual budget card with no financial AI.

### Post-Hackathon
Live Canvas API integration, real accounts/SSO, notifications, PDF/OCR, embeddings at scale, mobile app, banking, and financial advice.

## Main User Flow
1. Create a private browser workspace, select a timezone, and acknowledge NVIDIA processing.
2. Select up to five files; the frontend sends one file per request.
3. Watch independent import progress and warnings.
4. Review the combined dashboard and course details.
5. Open evidence for any supported fact.
6. Ask a supported or unsupported question and see citations or a limitation.
7. Delete an import and verify it no longer participates in the dashboard or Ask.

## Screens
- Workspace setup.
- Dashboard with course cards, upcoming and undated items, review issues, imports, and Ask.
- Course detail with metadata, assignments, assessments, policies, office hours, important dates, and evidence drawer.

## Acceptance Criteria
- Two valid fixture EPUBs produce exactly two course records and correct fixture items.
- Invalid or oversized files create no course or academic facts.
- Reloading the page preserves the session's saved progress and completed courses.
- Missing instructor email, points, or dates remain null and display as not found.
- Dates without an unambiguous year remain unresolved.
- Every non-null extracted field has field-level evidence.
- Duplicate successful uploads do not duplicate deadlines.
- Invalid AI JSON or nonexistent source references cannot persist.
- Supported policy questions are cited; absent professor-contact questions abstain.
- A workspace cannot access another workspace's records.
- Imported HTML is rendered as inert text.
- Interrupted imports do not appear as successful partial courses.
- Assessments are not counted twice as assignments.
- Conflicting dates remain visible for review and are excluded from dated totals.

## Date and Counting Semantics
Store academic dates separately from administrative timestamps. Never invent midnight, 23:59, a year, or a countdown. Date-only items have no time. Conflicts and unresolved dates remain outside dated totals and appear in review/undated areas. Sort known dates by date, known local time, title, then stable ID.

## Empty and Failure Language
Use “No assignments found in this export” rather than “You have no assignments.” Use “I couldn't find that in your imported material” rather than making a claim about a professor. Do not claim synchronization with Canvas.
