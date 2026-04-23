# Resume Matcher AI

This repository contains a FastAPI backend and a Next.js/TypeScript frontend for ingesting resumes, tracking per-requirement candidate status, and AI-based matching/ranking.

This README gives a short overview and points to developer commands for the backend-first workflow used in this project.

## Project layout

- `backend/` — FastAPI backend, SQLAlchemy models, Celery tasks for resume processing.
- `frontend/` — Next.js TypeScript dashboard and UI components. Types are generated from the backend OpenAPI spec.

## What changed (April 2026)

Recent work implemented the ability to ingest and work with candidates without requiring them to be bound to a requirement, plus a backend-first OpenAPI → TS types workflow. High level:

- Candidates are no longer implicitly filtered by requirement. `GET /api/candidates` returns all candidates.
- When the frontend passes `requirement_id` to candidate-listing endpoints, each candidate now includes a `requirement_status` field. Candidates with no `candidate_status` for the requirement are reported as `not_applied`.
- Resume ingestion endpoints accept an optional `requirement_id`. When provided, the backend auto-creates a `candidate_status` row with `status='new'` for the new candidate if it did not exist before.
- Matching endpoints support `POST /api/matching/{requirement_id}?match_all=true` to match/rank across all candidates. Matching results include `status: 'not_applied'` for candidates without a `candidate_status` row.
- The OpenAPI spec was regenerated (`backend/docs/openapi.json`) and TypeScript types were generated using `openapi-typescript` into `frontend/src/generated/api-types.ts`. The frontend API client was updated to use these generated types.

## Quick developer workflow

1. Make backend changes (implement API/schema updates in `backend/app/`).
2. Run quick backend checks and regenerate OpenAPI:

```bash
cd backend
./venv/bin/python -m compileall -q app
./venv/bin/python scripts/generate_openapi.py
```

3. Regenerate frontend types and run the frontend:

```bash
cd frontend
yarn generate:types
yarn dev
```

4. Verify UI flows: ingestion (bind/unbound uploads), candidates listing (All candidates vs requirement-scoped), matching with and without `match_all`.

## Where to look for the changes

- Backend: `backend/app/services/resume_service.py`, `backend/app/services/candidate_service.py`, `backend/app/services/matching_service.py`, `backend/app/routers/*`.
- Frontend: `frontend/src/lib/api-client.ts`, `frontend/src/generated/api-types.ts`, `frontend/src/components/dashboard/sections/*`.

If you'd like, I can run a local smoke test sequence next (start backend, start frontend dev server, upload a test resume with and without `requirement_id`, run matching with and without `match_all`).
