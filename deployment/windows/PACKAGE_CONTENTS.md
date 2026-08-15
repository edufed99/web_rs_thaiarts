# Deployment package contents

This package was prepared for Windows Server deployment on 2026-08-13.

Included:

- `backend/app/` FastAPI runtime source
- `backend/migrations/` and `backend/alembic.ini`
- `backend/requirements.txt`
- `backend/data/uploads/` current uploaded media
- `frontend/app/`, `frontend/components/`, `frontend/lib/`, `frontend/public/`
- frontend production build configuration and locked npm dependencies
- recommender runtime files under `artifacts/models/` and `artifacts/outputs/`
- `docs/research_baseline.json` required by the metrics endpoint
- Windows setup, start, verification, and configuration templates under `deploy/windows/`

Explicitly excluded:

- `.git/`, editor/agent state, legacy code, research source data and offline pipelines
- `node_modules/`, `.next*`, virtual environments, caches, tests, logs and temporary files
- all real `.env` files
- OAuth client JSON, OAuth tokens, API keys, passwords and root-level `client_secret_*.json`
- local database contents and PostgreSQL credentials

Use `deploy/windows/README_DEPLOY_TH.md` as the entry point. The SHA-256 file
distributed next to the ZIP verifies archive integrity during transfer.

