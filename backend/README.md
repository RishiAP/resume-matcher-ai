# Recruitment Backend (FastAPI)

FastAPI backend for resume ingestion, candidate management, requirements, and AI-based matching.

## 1. Create environment

```bash
cd /home/rishi/Documents/dev/resume-matcher-ai/backend
#
# Preferred: this repository uses a project venv at `backend/venv`.
# If a preexisting `backend/venv` exists, activate it:
source venv/bin/activate

# To create a local venv following the repo preference:
python3 -m venv venv
source venv/bin/activate
pip install -U pip
pip install -e .
```

## 2. Configure environment

```bash
cp .env.example .env
# edit .env values
```

## 3. Run database migration

```bash
alembic upgrade head
```

## 4. Start the API

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

## 5. Start Celery worker (required for resume processing)

```bash
# Optional throttling knobs to reduce provider 429s:
# export CELERY_WORKER_CONCURRENCY=1
# export CELERY_WORKER_PREFETCH_MULTIPLIER=1
# export CELERY_AI_RATE_LIMIT_MAX_RETRIES=3
# export CELERY_AI_RATE_LIMIT_RETRY_DELAY_SECONDS=300
# export CELERY_AI_RATE_LIMIT_RETRY_DELAY_MAX_SECONDS=1800
celery -A app.celery_app.celery_app worker --loglevel=info
```

## 6. API endpoints (selected)

- `GET /api/health`
- `POST /api/resume/upload`
- `POST /api/resume/upload/bulk`
- `POST /api/resume/upload/url`
- `POST /api/resume/upload/url/bulk`
- `GET /api/resume/jobs`
- `GET /api/candidates`
- `PATCH /api/candidates/{candidate_id}` — update interview date / time
- `GET /api/requirements`
- `POST /api/requirements`
- `PATCH /api/requirements/{requirement_id}`

### Matching & per‑requirement status

- `POST /api/matching/{requirement_id}` — run matching for all candidates whose status for this requirement is `new`
 - `POST /api/matching/{requirement_id}` — run matching for candidates. By default this runs only for candidates with status `new` for the requirement; pass the query param `?match_all=true` to run matching across all candidates (including those without a `candidate_status` row).
- `GET /api/matching/{requirement_id}` — list match results for this requirement
- `POST /api/matching/{requirement_id}/candidates/{candidate_id}` — run matching for a single candidate
- `PATCH /api/matching/{requirement_id}/candidates/{candidate_id}/status` — set per‑requirement status (`new`/`processing`/`rejected`/`hired`)
- `POST /api/matching/{requirement_id}/bulk/reject-zero` — mark all zero‑score candidates as `rejected`
- `POST /api/matching/{requirement_id}/bulk/threshold` — set status for candidates with score below a threshold
- `GET /api/matching/overview/{requirement_id}` — aggregate counts for current / processing / rejected / hired

Status is tracked per (candidate, requirement) in the `candidate_status` table. The status values are a Postgres enum: `new`, `processing`, `rejected`, `hired`.

Matching by default only considers candidates who have **applied** to a requirement, where "applied" means they have a `candidate_status` row for that `(candidate_id, requirement_id)` with status `new`. Use `?match_all=true` to include all candidates (the endpoint will still return per-candidate status as `not_applied` when no `candidate_status` exists).

Resume uploads can optionally include a `requirement_id`. When provided, the backend will create a `candidate_status` row with status `new` for that requirement (if one does not already exist) after processing the resume.

## 7. Generate OpenAPI JSON for frontend

```bash
# Notes:
# - Prefer using the repository venv at `backend/venv`. If that exists use
#   `./venv/bin/python` (or activate the venv) to run the generator.
#
# Examples:
# (when `backend/venv` exists)
./venv/bin/python scripts/generate_openapi.py

# or when the venv is activated:
python scripts/generate_openapi.py

# default output: ./docs/openapi.json
# regenerate whenever backend API schemas change
```

## Backend-first workflow

Follow these steps when making API changes:

1. Implement the change in the backend source (`app/`).
2. Run quick syntax checks and tests in the backend venv:

```bash
./venv/bin/python -m compileall -q app
# or `pytest` if you have tests
```

3. Regenerate the OpenAPI spec:

```bash
./venv/bin/python scripts/generate_openapi.py
```

4. Commit backend changes.
5. Regenerate frontend types and update UI:

```bash
cd ../frontend
yarn generate:types
yarn dev
```

6. Verify UI behavior and adjust frontend code to use the updated types.

## Recent changes (April 2026)

Summary of recent backend/API changes made as part of the "unbind candidates from requirements" and backend-first types workflow:

- Candidates listing
	- `GET /api/candidates` now returns all candidates (no implicit filtering by requirement).
	- When `requirement_id` is provided to the list endpoint, each returned candidate includes a `requirement_status` field:
		- `null` when no `requirement_id` was requested
		- `not_applied` when the candidate has no `candidate_status` row for the requested requirement
		- otherwise one of: `new`, `processing`, `rejected`, `hired`

- Resume ingestion
	- Resume upload endpoints accept an optional `requirement_id` (form field or JSON). When `requirement_id` is provided, the backend will auto-create a `candidate_status` row with `status = 'new'` for the `(candidate_id, requirement_id)` if none exists after processing. This keeps newly-uploaded candidates immediately eligible for matching when a requirement is selected.
	- Frontend exposes a `Bind uploads to requirement` toggle to allow uploads without a requirement (toggle OFF → upload without `requirement_id`).

- Matching
	- `POST /api/matching/{requirement_id}` supports the query param `?match_all=true` to run matching across *all* candidates (not only those with a `new` status). The default behaviour (no `match_all`) remains unchanged and ranks only candidates with `status='new'` for that requirement.
	- Matching results and endpoints now report `status: "not_applied"` for candidates that have no `candidate_status` row for the requirement instead of implicitly defaulting to `new`.

- OpenAPI & frontend types
	- The OpenAPI spec was regenerated at `backend/docs/openapi.json`.
	- Frontend TypeScript types are generated from the OpenAPI spec using `openapi-typescript` (written to `frontend/src/generated/api-types.ts`).

Developer notes & common commands

- Regenerate OpenAPI JSON (use the repository venv when available):
```bash
cd backend
# if backend/venv exists: ./venv/bin/python scripts/generate_openapi.py
# otherwise activate your Python env and run:
python scripts/generate_openapi.py
```

- Quick backend syntax check / smoke check:
```bash
./venv/bin/python -m compileall -q app
# or run pytest if tests are available
```

- Important backend files changed (search these when debugging the new behavior):
	- `app/services/resume_service.py` — auto-create `CandidateStatus` when `requirement_id` provided on upload
	- `app/services/candidate_service.py` — return all candidates and attach per-requirement `requirement_status`
	- `app/services/matching_service.py` — support `match_all` and return `not_applied` for missing status
	- `app/routers/resume.py`, `app/routers/matching.py` — endpoint behavior and schema wiring

After making backend changes: regenerate the OpenAPI spec, commit the backend change, then regenerate frontend types and update UI as needed.
