# College Survival Dashboard
## Business Requirements Document

**Project Owner:** SteelHacks XIII 2-Person Team  
**Document Version:** 1.1 (Hackathon MVP)  
**Date:** 09/19/2026

## 1. Introduction
### 1.1 Purpose of Document
This document defines the business need, user value, MVP scope, requirements, risks, implementation priorities, and acceptance criteria for the College Survival Dashboard.

### 1.2 Project Background
Students often have course information scattered across Canvas exports, syllabus text, assignments, policies, and office-hours pages. The product accepts authorized Canvas-generated EPUBs, deterministically normalizes their readable content, and uses NVIDIA Nemotron to create validated academic data for a semester dashboard and Ask My Semester.

The current repository contains a Lovable-generated React and TypeScript frontend using TanStack Start/Vite tooling, Supabase integration, and PostgreSQL-oriented Drizzle configuration. Those are current-state facts, not claims that the approved backend architecture is already implemented.

### 1.3 Project Objectives
- Reduce manual course-data re-entry.
- Combine multiple course exports into one semester view.
- Normalize differently formatted course text into consistent academic objects.
- Preserve source evidence and visible uncertainty.
- Deliver a complete local-first MVP during the hackathon.

### 1.4 Scope
- Upload one to five EPUBs, one course export per file.
- Deterministic EPUB, XML, XHTML, and HTML processing in Python.
- Server-side NVIDIA Nemotron extraction from cleaned text only.
- Strict validation before persistence.
- Dashboard, course details, source evidence, and Ask My Semester.
- React/TypeScript frontend communicating with a FastAPI backend.
- SQLite persistence through SQLAlchemy.

### 1.5 Out of Scope
- Azure deployment, PostgreSQL migration, Docker, Kubernetes, Redis, Celery, microservices, or vector databases as MVP requirements.
- Live Canvas API/OAuth synchronization.
- Production authentication or SSO.
- PDF/OCR, mobile app, background notifications, banking integrations, or financial advice.
- Replacing or recreating the existing frontend solely to make it a plain Vite SPA.

## 2. Market Analysis
### 2.1 Industry Overview
The project sits at the intersection of student productivity, LMS document understanding, structured data extraction, and grounded question answering. This is a hackathon prototype and makes no market-size, revenue, or production-readiness claim.

### 2.2 Target Market and Users
The primary user is a college student managing multiple courses with differently structured exports. The secondary audience is a hackathon evaluator reviewing an end-to-end trustworthy ingestion workflow.

### 2.3 Competitive Analysis
#### 2.3.1 Key Competitors
Canvas and other LMS platforms, calendar/to-do applications, manual syllabus planners, and generic document-chat tools.

#### 2.3.2 Competitor Strengths and Weaknesses
Canvas is authoritative but fragmented. Calendars are organized but require manual entry. Generic chat tools are flexible but generally lack a persistent typed semester model and field-level evidence. Manual planners are predictable but slow to set up.

#### 2.3.3 Competitive Advantage
The MVP combines multi-course import, deterministic parsing, typed validation, source evidence, visible uncertainty, and a grounded semester assistant in one workflow.

## 3. Business Requirements
### 3.1 Functional Requirements
#### 3.1.1 User Requirements
Users can upload EPUBs, see import progress, view combined courses and deadlines, inspect course details and source evidence, ask questions, see unknown or conflicting values, and delete imports.

#### 3.1.2 System Requirements
The target backend safely parses EPUBs, preserves source identifiers, keeps NVIDIA credentials server-side, validates model output, stores structured records and evidence, and grounds Ask My Semester in imported material. Missing facts remain null or unknown rather than being guessed.

#### 3.1.3 Administrative Requirements
The MVP has no admin portal. Configuration uses environment variables. Only synthetic fixtures belong in Git. The active implementation target is local-first and does not require cloud hosting.

### 3.2 Non-Functional Requirements
#### 3.2.1 Performance
The UI should remain responsive and small imports should complete reliably. Model latency and extraction accuracy must be measured before presentation claims are made.

#### 3.2.2 Security
Treat EPUBs as untrusted input. Reject unsafe archives and paths, never execute uploaded content, render imported text inertly, keep secrets server-side, enforce workspace ownership, and validate model output before storage.

#### 3.2.3 Compliance
The project makes no FERPA, GDPR, or security-certification claim. Users should upload only authorized course content and should be told that selected text is processed by NVIDIA.

#### 3.2.4 Scalability
The MVP targets a small local prototype. University-wide scale, distributed workers, and production infrastructure are future work.

#### 3.2.5 Availability
The target is a repeatable local demo, not an SLA. Any previously processed or recorded fallback must be labeled honestly.

#### 3.2.6 Usability
The main flow is upload, processing, dashboard, source inspection, and asking a question. Missing, conflicting, and unsupported information must be visibly distinguished.

## 4. Use Cases
### 4.1 User Personas
- Student organizer managing several courses.
- Time-constrained student who needs a quick semester view.
- Hackathon evaluator testing trust, evidence, and failure behavior.

### 4.2 Primary Use Cases
Import courses; review the semester; inspect evidence; ask My Semester; delete an import.

### 4.3 Secondary Use Cases
Review conflicts, handle duplicate uploads, run synthetic demo fixtures, and optionally provide one small post-acceptance enhancement.

## 5. Assumptions, Constraints, and Dependencies
### 5.1 Assumptions
The user has an authorized readable EPUB export, the export contains some academic information, each MVP EPUB represents one course, and a configured Nemotron endpoint is available for live testing.

### 5.2 Constraints
The team has two beginner developers, limited hackathon time, variable EPUB contents, and a local-first requirement. The current frontend remains in place while the target backend is developed in a controlled phase.

### 5.3 Dependencies
React/TypeScript/TanStack Start/Vite frontend; Python 3.11+, FastAPI, SQLAlchemy, SQLite, Pydantic, EPUB/XML/HTML libraries, NVIDIA Nemotron, and Git/GitHub.

## 6. Risks and Mitigation
### 6.1 Identified Risks
EPUB omissions, model errors, malicious archives, provider outage, scope creep, contract drift, and accidental commits of secrets or private course files.

### 6.2 Risk Mitigation Plan
Inspect an authorized EPUB early, require evidence and validation, use bounded parsing, rehearse a labeled fallback, freeze contracts, use synthetic fixtures, and fix environment-file tracking before the next commit.

## 7. Implementation Plan
### 7.1 High-Level Timeline
1. Verify EPUB and Nemotron assumptions.
2. Freeze schemas and API contracts.
3. Build private workspace/session ownership.
4. Build the bounded EPUB parser.
5. Add validated Nemotron extraction.
6. Connect atomic import persistence.
7. Build dashboard and source evidence.
8. Build Ask My Semester, test, and rehearse.

### 7.2 Key Milestones
EPUB to normalized text; normalized chunk to validated JSON; one upload to one course; two-course dashboard; source drawer; supported and unsupported Ask behavior; repeatable local demo.

### 7.3 Resources Required
Two developers, the existing frontend workspace, Python backend environment, VS Code, Git/GitHub, NVIDIA access, one authorized real EPUB for inspection, and original synthetic fixtures.

### 7.4 Estimated Budget
Target new infrastructure cost for the local MVP: **$0**. Cloud hosting and managed databases are not required for acceptance.

## 8. Acceptance Criteria
### 8.1 Criteria for Successful Implementation
Two courses import; unsafe EPUBs fail before AI; facts are source-supported; missing values remain unknown; evidence opens; invalid AI output cannot persist; the combined dashboard works; Ask cites supported answers and abstains when unsupported; secrets stay out of frontend bundles and Git; and the demo works locally without cloud hosting.

### 8.2 Testing and Validation Approach
Use unit tests, synthetic EPUB fixtures, mocked AI contract tests, an opt-in live Nemotron smoke test, browser end-to-end testing, a small labeled extraction evaluation, and a secret scan. Report actual precision, recall, latency, and limitations.

## 9. Appendices
### 9.1 Glossary
**EPUB:** Electronic publication archive. **IR:** Intermediate representation. **Nemotron:** NVIDIA model used for structured extraction and grounded answers. **Evidence:** Source passage supporting a field. **Schema validation:** Type and semantic checks performed before persistence.

### 9.2 References and Supporting Documents
See [README.md](../README.md) and the active documents in this `docs/` directory. The supplied College Survival Dashboard specification and revised BRD are the source materials for this documentation setup.

### 9.3 Stakeholder Contact Information
Project Owner/Team: SteelHacks XIII two-person team. Frontend/UI and backend/AI responsibilities are divided between the team members.

## Document Approval
| Role | Name | Signature | Date |
|---|---|---|---|
| Project Sponsor | | | |
| Business Owner | | | |
| Project Manager | | | |
| Technical Lead | | | |

## Revision History
| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 09/19/2026 | SteelHacks XIII Team | Initial architecture-generated BRD. |
| 1.1 | 09/19/2026 | SteelHacks XIII Team | Reorganized for the required business-document template and local-first hackathon MVP. |
