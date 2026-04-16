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
