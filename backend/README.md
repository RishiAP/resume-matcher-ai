# Recruitment Backend (FastAPI)

FastAPI backend for resume ingestion, candidate management, requirements, and AI-based matching.

## 1. Create environment

```bash
cd /home/rishi/Documents/dev/resume-matcher-ai/backend
python3 -m venv .venv
source .venv/bin/activate
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
- `GET /api/matching/{requirement_id}` — list match results for this requirement
- `POST /api/matching/{requirement_id}/candidates/{candidate_id}` — run matching for a single candidate
- `PATCH /api/matching/{requirement_id}/candidates/{candidate_id}/status` — set per‑requirement status (`new`/`processing`/`rejected`/`hired`)
- `POST /api/matching/{requirement_id}/bulk/reject-zero` — mark all zero‑score candidates as `rejected`
- `POST /api/matching/{requirement_id}/bulk/threshold` — set status for candidates with score below a threshold
- `GET /api/matching/overview/{requirement_id}` — aggregate counts for current / processing / rejected / hired

Status is tracked per (candidate, requirement) in the `candidate_status` table. The status values are a Postgres enum: `new`, `processing`, `rejected`, `hired`.

Matching only considers candidates who have **applied** to a requirement, where "applied" means they have a `candidate_status` row for that `(candidate_id, requirement_id)` with status `new`.

Resume uploads can optionally include a `requirement_id`. When provided, the backend will create a `candidate_status` row with status `new` for that requirement (if one does not already exist) after processing the resume.

## 7. Generate OpenAPI JSON for frontend

```bash
# default output: ./docs/openapi.json
generate-docs

# optional custom output path
OPENAPI_OUTPUT=./openapi.json generate-docs
```
