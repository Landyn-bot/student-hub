# Nemotron Processing and Ask My Semester

## Status
This describes the approved target AI boundary. No NVIDIA backend implementation is being added in this documentation pass.

## Provider Boundary
Use the configured NVIDIA Nemotron endpoint exclusively from the backend. Verify the exact model, endpoint, response shape, supported JSON mode, context limits, and latency before live claims. If provider schema mode is unavailable, use a JSON prompt plus mandatory application validation and one bounded repair. Do not silently substitute another provider or model.

## Extraction Sequence
1. Load validated normalized IR chunks only.
2. Send one bounded extraction request per chunk with schema version and source IDs.
3. Parse exactly one JSON value; reject extra keys, duplicate keys, markdown fences, trailing prose, refusal, truncation, and invalid types.
4. Validate Pydantic structure and semantic invariants, including dates, numbers, evidence membership, and quote presence.
5. Use at most one repair or transport retry within the fixed call budget.
6. Reconcile metadata, exact duplicates, and conflicts deterministically.
7. Commit academic data atomically only after all chunks validate.

## Grounding Rules
Every non-null factual field needs exact evidence. Missing fields are null. The model may not infer years, instructors, emails, points, times, or timezones from outside knowledge. The backend resolves source membership, offsets, date validity, and ownership.

## Ask My Semester
Ask is a bounded answer function, not an autonomous agent. Deadline mode queries stored resolved dates deterministically. General questions use deterministic lexical retrieval over owned completed imports, then supply bounded source context to Nemotron. Empty retrieval returns `not_found` without a model call.

Answer claims must include exact citations to server-created context IDs. The backend validates citations, offsets, ownership, and deterministic deadline counts. Unsupported, incomplete, or conflicting information produces a clear limitation. Imported text is evidence, never an instruction to execute tools or reveal secrets.

## Evaluation
Measure field precision, recall, date accuracy, invented-date count, schema acceptance, citation resolution, citation entailment, abstention, retrieval recall, latency, and provider call count on original synthetic fixtures. Schema validity is not proof of factual accuracy.
