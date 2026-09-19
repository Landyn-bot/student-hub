# Legacy Frontend Notes

This document preserves useful planning information from the former root `roadmap.md`. It is non-authoritative and describes completed or planned work in the existing Lovable/Syllo frontend. It does not override [ROADMAP.md](ROADMAP.md) or define the approved College Survival Dashboard backend.

- Add private onboarding fields and an atomic setup save.
- Build the school, semester, and planning preference flow.
- Route incomplete accounts into setup and completed accounts into Syllo.
- Make preferences editable in Settings and reflect the current semester on Dashboard.
- Verify first-run and returning-user behavior on desktop and phone.

The current frontend uses React, TypeScript, TanStack Start/Vite tooling, Lovable-generated components, Supabase integrations, and PostgreSQL-oriented Drizzle configuration. These current-state technologies remain in the repository until a later controlled implementation phase.
