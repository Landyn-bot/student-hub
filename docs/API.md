# REST API Contract

## Status
The API described here is the approved target contract for the future FastAPI backend. It is not evidence that these routes currently exist.

## Conventions
Base path: `/api/v1`. JSON uses camelCase. Resource identifiers are server-generated UUIDs. The session cookie supplies workspace ownership; clients never submit a workspace ID. Responses are non-cached and errors use a safe envelope:

```json
{"error":{"code":"INVALID_EPUB","message":"This file is not a supported EPUB.","requestId":"server-generated-id","details":[]}}
```

## Core Routes
| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Operational health check. |
| POST/GET | `/api/v1/session` | Create or restore a private workspace. |
| DELETE | `/api/v1/session` | End the current session. |
| DELETE | `/api/v1/workspace` | Delete workspace data when no import is active. |
| POST | `/api/v1/imports` | Upload exactly one EPUB and enqueue it. |
| GET | `/api/v1/imports` | List owned imports. |
| GET | `/api/v1/imports/{id}` | Poll import progress. |
| POST | `/api/v1/imports/{id}/retry` | Retry a failed/interrupted import when IR is retained. |
| DELETE | `/api/v1/imports/{id}` | Delete a terminal import and related data. |
| GET | `/api/v1/courses` | List owned courses. |
| GET | `/api/v1/courses/{id}` | Read one owned course. |
| GET | `/api/v1/items` | Filter academic entities. |
| GET | `/api/v1/sources/{id}` | Read bounded normalized source text. |
| GET | `/api/v1/semester` | Read combined deadline/count data. |
| GET | `/api/v1/issues` | Read missing, conflict, and review issues. |
| POST | `/api/v1/ask` | Ask a stateless grounded question. |

## Security Contract
State-changing requests require the session's CSRF token and exact configured origin. Unknown or foreign resource IDs return 404. Upload, pagination, question length, and rate limits are enforced server-side.

## Import Response
An import reports `id`, `filename`, `status`, `stage`, chunk progress, `courseId`, warnings, safe error information, timestamps, duplicate status, and retry availability. A successful duplicate returns the existing import rather than creating another course.

## Ask Response
Ask returns status, claims, limitations, coverage, searched courses, retrieved source count, and deterministic deadline cards when applicable. Claims include validated citations with source and chunk references. Empty or unsupported retrieval returns a limitation rather than an invented answer.

## Contract Rules
No frontend direct database or model client is permitted. Pydantic models are the backend source of truth. OpenAPI and frontend types must be generated or synchronized from the actual implementation when the backend phase begins.
