Frontend dashboard for the Resume Matcher AI system.

The app provides HR-focused views for candidates, requirements, AI-based matching, and per-requirement ATS-style statuses.

## Getting Started

Install dependencies:

```bash
yarn install
```

Run the development server:

```bash
yarn dev
```

The app will be available at http://localhost:3000.

Backend defaults assume the FastAPI service is running at http://localhost:8000 and that backend/docs/openapi.json is up to date.

## Key Screens

- **Overview**
	- System health: backend status, AI provider, models.
	- Queue overview: ingestion worker stats.
	- Requirement overview: per-requirement counts for current / processing / rejected / hired candidates.

- **Candidates**
	- Browse and edit candidate metadata (e.g., interview date / time, skills, experiences).
	- HR comments with history per candidate.

- **Matching**
	- Select a requirement and run matching against all candidates whose status for that requirement is `new`.
	- View ranked candidates with AI explanation for each match.
	- See per-requirement status for each candidate (`new`, `processing`, `rejected`, `hired`).
	- Inline actions to update status, plus bulk actions:
		- Reject all zero-score candidates.
		- Apply a status to all candidates below a given score threshold.

- **Resume Ingestion**
	- Upload resumes via single file, bulk files, single URL, or bulk URLs.
	- Optionally pick a requirement; uploaded candidates will be marked with status `new` for that requirement so they are immediately eligible for matching.

## API Types

Types are generated from the backend OpenAPI spec:

```bash
yarn generate:types
```

This reads backend/docs/openapi.json and updates src/generated/api-types.ts.

## Backend-first workflow (developer notes)

This frontend follows a backend-first workflow: backend API changes must be implemented, their OpenAPI spec regenerated, then TypeScript types must be regenerated before updating UI.

Steps:

```bash
# in backend (use the repo venv if available at backend/venv)
cd ../backend
./venv/bin/python scripts/generate_openapi.py

# in frontend
cd ../frontend
yarn generate:types
yarn dev
```

Notes:
- Use `yarn` (Corepack-managed) for package commands.
- If the backend venv is not present, create it in `backend/venv` and install with `pip install -e .`.
- The generated types live in `src/generated/api-types.ts`. Update frontend code to use these types before committing UI changes.

## Recent changes (April 2026)

Summary of frontend changes made to support optional unbound uploads, matching across all candidates, and the backend-first types workflow:

- Ingestion
	- Added a **Bind uploads to requirement** checkbox in the ingestion UI (default: ON). When enabled uploads include the selected `requirement_id` and the backend will auto-create a `candidate_status` row with `status='new'` if the candidate has not previously applied to the requirement. When disabled, uploads omit `requirement_id` and create unbound candidates.
	- Single-file, bulk-file, single-URL and bulk-URL flows now respect the bind toggle.

- Matching
	- Added a **Match all candidates** toggle that calls `POST /api/matching/{requirement_id}?match_all=true` to include candidates without a `candidate_status` row for the requirement.
	- `MatchResult.status` may now be `not_applied` — the UI displays this as "Not applied".

- Candidates listing
	- Added an **All candidates** selector option to view all candidates regardless of requirement. When `requirement_id` is passed to the list API, each `Candidate` now includes `requirement_status` which is `not_applied` when the candidate hasn't applied to that requirement.
	- Fixed an issue where selecting the empty "All candidates" option could set the selected requirement id to `NaN`.

- Types & API client
	- Regenerated types are located at `src/generated/api-types.ts` (created using `openapi-typescript` from `backend/docs/openapi.json`).
	- The typed API client and helper functions were updated in `src/lib/api-client.ts` to handle the new `requirement_status` and `match_all` behavior.

- Key frontend files changed
	- `src/generated/api-types.ts`
	- `src/lib/api-client.ts`
	- `src/components/dashboard/sections/ingestion-section.tsx`
	- `src/components/dashboard/sections/matching-section.tsx`
	- `src/components/dashboard/sections/candidates-section.tsx`

Commands

```bash
cd frontend
yarn generate:types   # regenerates src/generated/api-types.ts from backend/docs/openapi.json
yarn dev              # start local dev server
# or verify a production build
yarn build
```

Notes
- Run `yarn generate:types` after any backend API/schema change and before updating UI code that depends on the generated types.
- The Next.js build and TypeScript checks were run after these changes and completed successfully.
