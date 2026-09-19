# Data Model

## Status
This is the approved target persistence model. It does not replace the current Drizzle/Supabase database during this documentation pass.

## Storage Decisions
The local MVP uses SQLite through SQLAlchemy. Database IDs are server-generated. Academic dates are stored separately from administrative timestamps. JSON payloads are accepted only after Pydantic validation.

## Target Tables
- `workspaces`: timezone, consent time, lifecycle timestamps.
- `sessions`: workspace ownership, hashed session and CSRF tokens, expiry.
- `imports`: file hash, filename, lifecycle state, progress, warnings, and error code.
- `courses`: one successful course per import.
- `sources`: immutable normalized text and archive metadata.
- `chunks`: bounded source spans with exact offsets.
- `entities`: course, assignment, assessment, policy, office-hours, and important-date payloads.
- `evidence`: field-level source quotes and offsets.
- `issues`: missing, ambiguous, conflict, unsupported, or skipped-content records.

## Academic Date Rules
A date contains raw wording, nullable calendar date, nullable local time, nullable timezone, precision, and timezone origin. Missing years, ambiguous weekdays, contradictory dates, and unknown timezone context remain unresolved. No system clock or upload timestamp supplies missing academic information.

## Evidence Rules
Every non-null factual field has one or more evidence records. Quotes must occur exactly in the referenced normalized chunk. Source and chunk ownership is checked before persistence. Evidence is retained for source drawer links and Ask citations.

## Identity and Duplicates
File identity is the SHA-256 hash within a workspace. Exact repeated academic items are collapsed deterministically and evidence is unioned. Same-title items with different dates remain candidates for review; conflicts do not enter upcoming dated totals. Assessments are not copied into assignments merely to inflate counts.

## Transactions and Deletion
Parsing and model calls happen outside the final database transaction. Course, entities, evidence, issues, and terminal success are committed together. Failed validation produces no successful academic partial import. Deleting an import cascades its course, sources, entities, evidence, and issues.
