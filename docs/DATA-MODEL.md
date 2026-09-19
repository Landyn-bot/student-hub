# Data Model

## Status
This is the approved target persistence model. It does not replace the current Drizzle/Supabase database during this documentation pass.

## Storage Decisions
The local MVP uses SQLite through SQLAlchemy. Database IDs are server-generated. Academic dates are stored separately from administrative timestamps. JSON payloads are accepted only after Pydantic validation.

## Active Phase 2 Tables
The simplified Phase 2 persistence model consists of exactly five tables:

- `imports`: file hash, filename, lifecycle status, and timestamps.
- `courses`: one course per import, with nullable course metadata.
- `sources`: immutable normalized text and archive metadata.
- `academic_items`: assignments, assessments, policies, office hours, and important dates in one simple table.
- `evidence`: field-level source quotes and offsets connected to a course, source, and optional academic item.

Workspace tables, sessions, authentication, CSRF/access-code infrastructure, issue tables, and correction history are deferred. Upload handling, deduplication behavior, and API resource endpoints are also outside Phase 2.

## Future Persistence Model
The larger architecture may later add workspaces, sessions, chunks, issues, and correction history when privacy, import lifecycle, and review workflows are implemented. Those future tables are not part of the active Phase 2 schema.

## Academic Date Rules
A date contains raw wording, nullable calendar date, nullable local time, nullable timezone, precision, and timezone origin. Missing years, ambiguous weekdays, contradictory dates, and unknown timezone context remain unresolved. No system clock or upload timestamp supplies missing academic information.

## Evidence Rules
Every non-null factual field has one or more evidence records. Quotes must occur exactly in the referenced normalized chunk. Source and chunk ownership is checked before persistence. Evidence is retained for source drawer links and Ask citations.

## Identity and Duplicates
File identity is the SHA-256 hash within a workspace. Exact repeated academic items are collapsed deterministically and evidence is unioned. Same-title items with different dates remain candidates for review; conflicts do not enter upcoming dated totals. Assessments are not copied into assignments merely to inflate counts.

## Transactions and Deletion
Phase 2 provides local table creation, foreign-key relationships, and basic cascade behavior. Parsing, model calls, upload deduplication, atomic import workflows, and issue handling are later phases. Deleting an import will cascade its course and sources in the database foundation; academic-item and evidence cleanup follows their course relationship.
