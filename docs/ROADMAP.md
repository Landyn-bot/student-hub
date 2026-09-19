# Authoritative MVP Roadmap

This is the only authoritative roadmap for the College Survival Dashboard. It describes the approved target architecture, not the current Lovable/Supabase implementation.

## Phase 0: Verify Inputs and Provider
Inspect an authorized EPUB and verify the exact NVIDIA Nemotron endpoint, model, output behavior, and latency. Create original synthetic fixtures. Do not claim Canvas compatibility or live AI until verified.

## Phase 1: Freeze Contracts
Define Pydantic academic, IR, API, and Ask schemas. Generate schema artifacts and agree on frontend types. Add environment templates and safe ignore rules during implementation, without exposing secrets.

## Phase 2: Private Workspace and Persistence
Implement target SQLite/SQLAlchemy tables, private session ownership, CSRF/origin checks, expiry, and scoped query helpers. Test that separate workspaces cannot access one another.

## Phase 3: Bounded EPUB Reader
Implement safe ZIP/XML/HTML handling, normalization, chunks, offsets, warnings, and parser tests. Malicious fixtures must fail before any AI call.

## Phase 4: Validated Nemotron Extraction
Add the server-side adapter, versioned prompts, strict JSON parsing, Pydantic validation, evidence resolution, semantic checks, bounded repair, and fake-provider tests. Invalid output must not reach academic storage.

## Phase 5: End-to-End Import
Stream uploads, enforce quotas, deduplicate by file hash, run the worker, reconcile records, persist atomically, expose progress, retry retained IR, and connect the existing frontend through the API contract.

## Phase 6: Dashboard and Evidence
Implement course, item, semester, issue, and source endpoints. Show two courses, dates, undated items, conflicts, policies, office hours, import timestamps, and exact source evidence.

## Phase 7: Ask My Semester
Implement deterministic deadline queries, bounded lexical retrieval, citation validation, abstention, conflict behavior, and Ask UI states. Keep the feature stateless and workspace-scoped.

## Phase 8: Release Gate
Run parser safety, authorization, transaction, date, model-contract, browser, secret-scan, and build checks. Measure fixture precision, recall, date accuracy, citation resolution, abstention, latency, and model calls. Rehearse the local demo.

## Deferred Work
Azure, PostgreSQL migration, Docker, distributed workers, live Canvas API integration, production accounts, PDF/OCR, mobile, embeddings, banking, and financial advice remain future or post-hackathon work. They must not displace the core local MVP.

## Definition of Done
The MVP is ready only when two synthetic courses import, invalid files are rejected safely, facts are evidence-backed, missing/conflicting data is visible, Ask cites or abstains, ownership works, deletion works, and the local demo passes without pretending that unverified live behavior is complete.
