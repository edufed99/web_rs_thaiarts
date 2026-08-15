# AGENTS.md

Instructions and architectural invariants for AI agents working in this repository (`web_rs_thaiarts`).

## System Architecture

`web_rs_thaiarts` is a production web application for Thai arts and crafts recommendation, consisting of:
- **Frontend**: Next.js 14 (App Router) + TypeScript + Vanilla CSS (port `3000`).
- **Backend**: FastAPI + Python 3.11/3.12 with Uvicorn (port `8001`).
- **Database**: PostgreSQL 18 (`postgres:18` Docker image).
- **Algorithm**: Eligibility-Gated Hybrid Recommender (CBF with multilingual E5 embeddings + CF ItemKNN + Hybrid WeightedSum).
- **Runtime Design**: Zero runtime CSV reads or Python pipeline runs at request time — all served from pre-generated artifacts under `artifacts/` (`models/` and `outputs/`).

## Environment & Server Deployments

### Remote Production Server
- **Hostname**: `ssh thaiperform` (Public Key authentication configured).
- **Remote Application Directory**: `C:\Apps\ThaiArtsRecommender` (or `C:\Apps`).
- **Server Deployment Model**: **Docker Desktop & Docker Compose ONLY**.
- **No Source Code on Server**: The remote production server must **never** contain repository source code, git trees, tests, or build toolchains. It only holds:
  1. `docker-compose.yml` (production container topology).
  2. `.env` (environment secrets).
  3. Persistent Docker volumes:
     - `postgres_data` (PostgreSQL 18 database files).
     - `uploads_data` (User uploaded media, mounted at `/app/data/uploads`).
- **Reverse Proxy**: Host IIS maps incoming domain traffic (`http://thaiperform.fed.bpi.ac.th`) to internal containers:
  - Frontend: `127.0.0.1:3000`
  - Backend API: `127.0.0.1:8001` (forwarded under `/api/*`)

### Database Standard: PostgreSQL 18
- **PostgreSQL Version**: PostgreSQL 18 is required for both local development and remote production (`image: postgres:18`).
- **Docker Mount Path**: Per [PostgreSQL Docker Hub](https://hub.docker.com/_/postgres) instructions, PostgreSQL 18 uses `/var/lib/postgresql` as its data volume mount point:
  ```yaml
  volumes:
    - postgres_data:/var/lib/postgresql
  ```
  *(Do NOT use `/var/lib/postgresql/data`, which is deprecated/incompatible with standard Postgres 18 volume defaults).*

## Core Invariants

1. **Working Directory Rule**: All new code lives in `C:\Users\Pichaya\Downloads\web_appRS1`. Never touch `../web_appRS/thai_arts_webapp/` (read-only reference).
2. **Artifact-Driven Serving**: The backend loads models from `artifacts/` once during FastAPI lifespan into the `ArtifactLoader` singleton. The frontend only communicates with the backend over HTTP via `lib/api.ts`.
3. **Database Schema & Migrations**: Managed via Alembic (`backend/alembic.ini` and `backend/migrations/versions/`). Never create tables manually or introduce `CREATE TABLE IF NOT EXISTS` in service code.
4. **Database Driver**: Use `psycopg` (sync) with SQLAlchemy 2.x. Do not introduce `asyncpg`.
5. **User Identity & State**: `user_key VARCHAR(150)` identifies users (e.g. `anon:<uuid>` or member profile).
6. **Dual ID Mapping**: Dual item ID spaces exist: legacy Django ID (1..114) and pipeline artifact stable ID (`stable_id("item", name)`). Always map queries via `items.artifact_item_id` using `app.services.db_query` helpers.
7. **OAuth Client Separation**: `google_oauth_client.json` is reserved for admin Gmail sending; `google_login_client.json` is reserved for member OpenID Connect sign-in. Never persist access/refresh tokens in query params.

## Standard Development & Deployment Commands

### Local Development
```bash
# Start local PostgreSQL 18
docker compose up -d postgres

# Run backend (FastAPI on port 8001)
cd backend
uvicorn app.main:app --reload --port 8001

# Run frontend (Next.js on port 3000)
cd frontend
npm run dev
```

### Verification & Testing
```bash
# Backend unit & integration tests (enforces >= 90% coverage)
cd backend
pytest --cov=app --cov-report=term-missing

# Frontend type check & production build
cd frontend
npm run type-check
npm run build
```

### Production Docker Deployment (Docker Hub: `pichaya5502`)

Public images on Docker Hub:
- Backend: `pichaya5502/web_rs_thaiarts-backend:latest`
- Frontend: `pichaya5502/web_rs_thaiarts-frontend:latest`

#### Build & Publish to Docker Hub (Local):
```bash
# Build and push using Docker / WSL
docker build -t pichaya5502/web_rs_thaiarts-backend:latest -f backend/Dockerfile .
docker push pichaya5502/web_rs_thaiarts-backend:latest

docker build -t pichaya5502/web_rs_thaiarts-frontend:latest -f frontend/Dockerfile ./frontend
docker push pichaya5502/web_rs_thaiarts-frontend:latest
```

#### Deploy on Production Server (`ssh thaiperform`):
```bash
# Copy production docker-compose.yml and .env if updated
scp deployment/docker-compose.prod.yml thaiperform:C:/Apps/ThaiArtsRecommender/docker-compose.yml

# Pull latest images and restart containers
ssh thaiperform "cd C:\Apps\ThaiArtsRecommender && docker compose pull && docker compose up -d"
```
