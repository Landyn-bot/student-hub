# Security Requirements

## Scope
These are MVP release gates for a bounded prototype, not a production security certification.

## Upload and Parser Safety
Limit file size, multipart body size, archive members, declared and actual decompressed bytes, individual entries, compression ratio, XML size, normalized characters, and chunks. Reject encrypted archives, traversal, symlinks, device entries, duplicate/case-colliding paths, invalid mimetype, DTD/entities, unsupported compression, CRC failures, nested archives, and active HTML content. Delete temporary raw uploads after parsing or failure.

## Access and Ownership
Use a private expiring workspace with a cryptographically random opaque session token. Store only token hashes. Scope every read, write, retry, delete, source, and Ask query to the session workspace. Require CSRF and exact origin checks for state-changing browser requests. Foreign IDs return 404.

## Secrets and Repository
The NVIDIA API key exists only in the backend environment and never in frontend code, logs, prompts, or API responses. Keep `.env` and runtime data out of Git. The current repository has a tracked `.env`; this must be fixed before the next commit. Only synthetic fixtures may be committed.

## Content and Model Boundaries
Render imported and model text as text nodes. Do not execute scripts or load remote resources. The model cannot choose URLs, execute SQL, call tools, access files, or change ownership. Validate all model output, evidence references, dates, numbers, and citations before persistence or display.

## Data Handling
Tell users that selected course text is sent to NVIDIA for processing. Store normalized source text only for source viewing and retrieval. Do not log full source text, questions, answers, prompts, tokens, or credentials. Purge expired workspaces and cascade deletion of imported data.

## Release Checks
Adversarial archive tests, script inertness, two-workspace authorization tests, CSRF/origin tests, secret scans, invalid-output rollback tests, deletion/retrieval tests, quota tests, provider timeout tests, and honest fixture-mode labeling must pass before demo readiness.
