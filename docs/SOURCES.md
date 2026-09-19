# Sources, Assumptions, and Decision Register

## Source Status
The supplied College Survival Dashboard specification and revised BRD are the primary project-design materials for this setup. External EPUB, Canvas, NVIDIA, Pydantic, FastAPI, and file-upload references should be verified against the exact versions and account available during implementation.

No real authorized Canvas sample or live NVIDIA account test was verified during this documentation pass. Synthetic fixtures do not prove every Canvas export will contain the expected fields.

## Verification Gates
- Confirm the student's Canvas can export an authorized EPUB.
- Inspect which academic fields survive that export.
- Confirm whether one EPUB represents one course.
- Verify the exact Nemotron endpoint, model ID, output mode, and latency.
- Determine whether provider-side JSON schema is supported; retain backend validation regardless.
- Confirm event rules for AI assistance and generated work.

## Decisions
| ID | Decision |
|---|---|
| D1 | Deterministic EPUB parsing occurs before AI. |
| D2 | The approved target is FastAPI, SQLite, SQLAlchemy, and Pydantic. |
| D3 | Preserve the existing React/TypeScript frontend where practical. |
| D4 | Supabase/PostgreSQL migration is later implementation work, not this documentation task. |
| D5 | Store typed records with source evidence and visible uncertainty. |
| D6 | Use bounded lexical retrieval before considering a vector database. |
| D7 | Use private expiring demo workspaces rather than production accounts. |
| D8 | Finance, Azure, and cloud deployment are outside the active MVP. |

## Open Questions
The team still needs to provide an authorized sample EPUB, exact NVIDIA access/model details, official event rules, and measured fixture results before making compatibility or performance claims.
