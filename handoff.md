# Handoff Document — Thai Arts Recommender Web App Refactor

**Saved to:** `C:\Users\Pichaya\Downloads\web_appRS1\handoff.md`

**Date:** 2026-07-28
**From:** Claude Code session (preceding conversation)
**To:** Next Claude Code session

---

## What this project is

A **new web app** at `C:\Users\Pichaya\Downloads\web_appRS1\` that refactors the legacy Django prototype at `C:\Users\Pichaya\Downloads\web_appRS\thai_arts_webapp\` (read-only — never modify). The new app uses **Next.js 14 + TypeScript** (frontend) and **Python FastAPI** (backend) with **PostgreSQL** (live user data) and pre-built **artifacts** (static ML model files).

See `docs/adr.md` for the full Architecture Decision Record and `docs/comparison.md` for a side-by-side comparison with the legacy project.

---

## Where to start

1. **Read `CLAUDE.md`** — high-level conventions, common commands, architecture invariants.
2. **Read `docs/adr.md`** — architecture rationale, API design, artifact strategy, out-of-scope.
3. **Read `README.md`** (root) — quick start, endpoint list, layout.
4. **Read `docs/api.md`** — human walkthrough of every endpoint with curl examples.
5. **Skim `docs/comparison.md`** — what changed from the legacy system.

---

## Repository layout (root: `C:\Users\Pichaya\Downloads\web_appRS1\`)

```
.
├── README.md                    quick start + architecture overview
├── CLAUDE.md                    notes for future Claude sessions
├── handoff.md                   ← THIS FILE
├── .gitignore
├── docs/
│   ├── adr.md                   architecture decision record
│   ├── api.md                   endpoint tour + curl examples
│   └── comparison.md            new vs legacy comparison
├── pipelines/
│   ├── train_or_generate_artifacts.py   offline CSV → artifacts
│   └── migrate_sqlite_to_postgres.py    legacy SQLite → Postgres (one-shot)
├── artifacts/                   generated, gitignored binaries (7 files)
│   ├── models/                  item_embeddings.npz + CF indices (5 files)
│   └── outputs/                 catalog.parquet + metadata.json (2 files)
├── backend/                     FastAPI service (port 8080)
│   ├── README.md
│   ├── requirements.txt         fastapi, sqlalchemy, asyncpg, alembic, psycopg, pytest
│   ├── pytest.ini               enforces ≥90% coverage
│   ├── app/
│   │   ├── main.py              FastAPI entry, lifespan, CORS, exception handlers
│   │   ├── model_loader.py      ArtifactLoader singleton
│   │   ├── db.py                SQLAlchemy engine + session factory
│   │   ├── models_db.py         ORM: Context, Item, Keyword, LegacyInteraction, ...
│   │   ├── explanations.py      Thai explanation builder
│   │   ├── core/
│   │   │   ├── config.py        Settings (RECSYS_* env vars)
│   │   │   └── exceptions.py    DomainError hierarchy + handlers
│   │   ├── schemas/             Pydantic v2 request/response models
│   │   ├── services/            Algorithm + DB queries
│   │   │   ├── eligibility.py   context + keyword filter
│   │   │   ├── cbf_service.py   E5 cosine + keyword boost
│   │   │   ├── cf_service.py    ItemKNN + popularity + live-DB merge
│   │   │   ├── hybrid_service.py   z-score weighted sum
│   │   │   ├── db_query.py      live DB queries
│   │   │   └── recommendation_service.py   orchestrator
│   │   └── routers/             FastAPI routers
│   │       ├── health.py
│   │       ├── recommendations.py
│   │       ├── catalog.py
│   │       ├── metrics.py
│   │       └── legacy.py        /db/health, /items/{id}/legacy-stats
│   └── tests/                   109 pytest tests, 92.46% coverage
└── frontend/                    Next.js 14 + TypeScript (port 3000)
    ├── README.md
    ├── package.json             next 14.2.5, react 18.3, typescript 5.5
    ├── tsconfig.json            strict mode
    ├── next.config.mjs          NEXT_PUBLIC_API_BASE_URL
    ├── .env.example
    ├── app/                     App Router
    │   ├── layout.tsx           root layout, Thai fonts, header
    │   ├── page.tsx             home: /health + /metrics + CTA
    │   ├── recommend/page.tsx   form: context + keywords + top-K
    │   └── results/page.tsx     fetch /recommendations, render cards
    ├── components/              LoadingState, ErrorState, EmptyState,
    │                            ContextPicker, KeywordPicker, RecommendationCard
    └── lib/
        ├── api.ts               typed fetch client
        └── types.ts             mirrors backend Pydantic schemas
```

---

## Status (all jobs complete)

| # | Job | Status |
|---|---|---|
| 1 | Explore original thai_arts_webapp codebase | ✅ |
| 2 | Write ADR in docs/adr.md | ✅ |
| 3 | Scaffold folder structure | ✅ |
| 4 | Build pipeline that exports model artifacts | ✅ |
| 5 | Build FastAPI backend | ✅ |
| 6 | Build Next.js + TypeScript frontend | ✅ |
| 7 | Write pytest tests with ≥90% coverage | ✅ |
| 8 | Validate full stack runs and tests pass | ✅ |
| 9 | Verify backend logic matches paper_thesis.docx | ✅ |
| 10–14 | Add PostgreSQL layer (5 sub-tasks) | ✅ |
| 15 | Build SQLite→Postgres migration script | ✅ |

**Commits (most recent first):**
```
db8b515 Add Postgres SQLAlchemy layer + 7 DB tests (109 total, 92.46% coverage)
2381ca4 Add PostgreSQL layer: docker-compose + SQLite→Postgres migration (2534 legacy interactions migrated)
2227d1e Add docs/comparison.md (new web app vs legacy thai_arts_webapp)
53436f5 Add README, CLAUDE.md updates, backend README, docs/api.md (e2e validation passed)
034d160 Add Next.js + TypeScript frontend (App Router, 6 pages prerendered)
138482d Verify backend logic vs paper_thesis.docx sections 2.3-2.5
6c3fe72 Add pytest suite with 102 tests and 96.85% coverage
012bba8 Add FastAPI backend: services, routers, Pydantic schemas, ArtifactLoader
3765ce5 Update ADR + pipeline: split artifacts into models/ and outputs/
55f25ce Add ADR for web app refactor (FastAPI + Next.js)
```

---

## How to run (verified working)

### Generate artifacts (offline)
```bash
cd C:\Users\Pichaya\Downloads\web_appRS1
python pipelines/train_or_generate_artifacts.py \
    --source-root "C:/Users/Pichaya/Downloads/web_appRS/source_data_2569/code for paper/4.recommendation/input" \
    --output-dir artifacts \
    --synthetic-embeddings
```

### Run Postgres + migrate legacy data
```bash
cd C:\Users\Pichaya\Downloads\web_appRS1
docker compose up -d postgres
python pipelines/migrate_sqlite_to_postgres.py \
    --sqlite "C:/Users/Pichaya/Downloads/web_appRS/thai_arts_webapp/db.sqlite3" \
    --target-url "postgresql+psycopg://postgres:postgres@127.0.0.1:5432/web_rs_thaiarts"
```

### Start backend
```bash
cd C:\Users\Pichaya\Downloads\web_appRS1\backend
pip install -r requirements.txt
python -m uvicorn app.main:app --reload --port 8080
```
Swagger: http://localhost:8080/docs

### Start frontend
```bash
cd C:\Users\Pichaya\Downloads\web_appRS1\frontend
npm install
npm run dev
```
App: http://localhost:3000

### Run tests (≥90% coverage enforced)
```bash
cd C:\Users\Pichaya\Downloads\web_appRS1\backend
pytest --cov=app --cov-report=term-missing --cov-fail-under=90
```

---

## Architecture invariants (must be respected)

1. **Backend never reads CSV at runtime.** Loads artifacts once in lifespan, reads in-memory.
2. **Frontend never imports Python, reads CSV, or opens `artifacts/`.** Only HTTP to backend via `lib/api.ts`.
3. **Pipeline is offline.** Only code that touches source CSVs.
4. **Legacy project at `../web_appRS/thai_arts_webapp/` is read-only.** `git diff` against its HEAD must remain clean.
5. **Algorithm matches thesis.** Don't tweak eligibility, CBF, CF, hybrid, or explanation unless ADR is updated.

---

## Known ports (in use on this machine)

- **5432** — Postgres (Docker, container `thai_arts_postgres`, existed before this project)
- **8080** — FastAPI backend
- **3000** — Next.js frontend

If you need to bind new ports, check `D:\Hermes Vault\04. Hermes System\09_Port-Registry\port-registry.md` first (script not currently available on this path, see CLAUDE.md global instructions).

---

## Endpoints (12 total, all with summary + description)

| Method | Path | Purpose |
|---|---|---|
| GET  | `/health` | Liveness + artifact build metadata |
| GET  | `/db/health` | Postgres reachability |
| POST | `/recommendations` | Generate top-K |
| GET  | `/items`, `/items/{item_id}` | Catalog browse |
| GET  | `/items/{item_id}/legacy-stats` | Live ratings from Postgres |
| GET  | `/contexts` | List sub-contexts |
| GET  | `/keywords` | List keywords (optional `?search=`) |
| GET  | `/metrics` | Corpus + CF stats |
| GET  | `/docs`, `/redoc`, `/openapi.json` | Swagger / ReDoc / schema |

---

## What's NOT done (Out of Scope per ADR §11)

- ❌ Login / authentication / user accounts
- ❌ Live user personalization (no Like/Save/Rate writes — only reads legacy data)
- ❌ Researcher dashboard + CSV export
- ❌ Multi-encoder (only E5 used), multi-CF (only ItemKNN + popularity), multi-hybrid (only WeightedSum)
- ❌ Fuzzy context matching, keyword leakage protection
- ❌ HR@K / MRR@K / nDCG@K evaluation endpoint
- ❌ Alembic migrations (uses `CREATE TABLE IF NOT EXISTS` instead)
- ❌ CI/CD, Docker production setup, cloud storage/DB
- ❌ Live user action tables (Like, Rating, SavedItem) in Postgres — only LegacyInteraction exists

---

## Notes for next session

- The `legacy_user_id` from SQLite is wrapped as `legacy:<id>` when merged into CF index (see `services/cf_service.py::_merged_cf_index`).
- The `pipelines/migrate_sqlite_to_postgres.py` opens SQLite with `mode=ro` URI mode — safe but verifies access.
- Frontend uses `NEXT_PUBLIC_API_BASE_URL` (default `http://localhost:8080`); set in `.env.local` for production.
- Backend tests use synthetic artifacts in `tmp_path` — no real CSVs or DB needed. `conftest.py` sets `RECSYS_DB_ENABLED=0` by default for unit tests.
- Postgres container `thai_arts_postgres` was already running on this machine (from legacy project); new project reuses it via `docker-compose.yml`.
- Artifacts split: `artifacts/models/` (embeddings + CF indices) vs `artifacts/outputs/` (catalog.parquet + metadata.json).
- Test data uses 5-item synthetic corpus (ระบำพรหมาสตร์, โขน, ลิเก, หุ่นกระบอก, วงดนตรีไทย).
- For real E5 embeddings, drop `--synthetic-embeddings` flag (downloads ~2.5 GB on first run).

---

## Verification commands (smoke tests)

```bash
# Backend health
curl http://localhost:8080/health
curl http://localhost:8080/db/health
curl http://localhost:8080/metrics
curl http://localhost:8080/items/1/legacy-stats

# Recommendation
curl -X POST http://localhost:8080/recommendations \
    -H "Content-Type: application/json" \
    -d '{"context_id": 142863314, "keyword_ids": [], "top_k": 5, "user_key": ""}'

# Frontend
curl http://localhost:3000/
curl http://localhost:3000/recommend
curl http://localhost:3000/results
```

---

**End of handoff.** Next session: start by reading `CLAUDE.md`, then `docs/adr.md`.