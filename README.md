# College Survival Dashboard

College Survival Dashboard is a hackathon MVP for turning authorized Canvas course EPUB exports into an evidence-backed semester view. The planned experience combines courses, assignments, assessments, due dates, policies, office hours, source evidence, and an Ask My Semester assistant that answers only from imported course material.

## Documentation

The active project documentation is in [`docs/`](docs/). [`docs/ROADMAP.md`](docs/ROADMAP.md) is the single authoritative implementation roadmap.

- [Business requirements](docs/BRD.md)
- [Product requirements](docs/PRD.md)
- [Architecture](docs/ARCHITECTURE.md)
- [API contract](docs/API.md)
- [Data model](docs/DATA-MODEL.md)
- [EPUB pipeline](docs/EPUB-PIPELINE.md)
- [AI pipeline](docs/AI-PIPELINE.md)
- [Security requirements](docs/SECURITY.md)
- [Demo runbook](docs/DEMO.md)
- [Pitch notes](docs/PITCH.md)
- [Evaluation](docs/SCORING.md)
- [Sources and decisions](docs/SOURCES.md)

## Current Repository State

The repository currently contains a Lovable-generated React and TypeScript frontend using TanStack Start/Vite tooling, existing Supabase integrations, and PostgreSQL-oriented Drizzle configuration. These technologies have not been removed or migrated by the documentation setup.

## Approved Hackathon Target

The approved MVP target preserves the existing frontend where practical and adds a Python FastAPI backend, SQLite through SQLAlchemy, Pydantic validation, deterministic EPUB parsing, and server-side NVIDIA Nemotron processing. The frontend will communicate with that backend through a documented API. The FastAPI backend is a target architecture, not a claim that it already exists.

Azure, PostgreSQL migration, Docker, Kubernetes, Redis, Celery, microservices, vector databases, Supabase migration, live Canvas API integration, banking integrations, and production financial advice are outside the active MVP.

## Development

The current frontend can be run with Node.js and npm:

```sh
npm install
npm run dev
```

### Backend

The Phase 1 backend lives under `backend/` and uses the repository's Python 3.14.3 interpreter:

```sh
python3 -m venv backend/.venv
backend/.venv/bin/python -m pip install -e "backend[dev]"
backend/.venv/bin/pytest
backend/.venv/bin/uvicorn app.main:app --reload --app-dir backend
```

The health endpoint is available at `http://127.0.0.1:8000/health`. Backend database, EPUB, AI, authentication, and frontend integration work remains sequenced in [`docs/ROADMAP.md`](docs/ROADMAP.md).

Phase 2 initializes the local SQLite database at `backend/var/app.db`:

```sh
backend/.venv/bin/python -c "from app.db import init_db; init_db()"
```

## Legacy Notes

Useful planning notes from the former root roadmap are preserved in [docs/LEGACY-FRONTEND-NOTES.md](docs/LEGACY-FRONTEND-NOTES.md). That file is informational and is not authoritative for the MVP architecture.
