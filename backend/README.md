# Backend — Thai Arts Recommender API

FastAPI service that loads pre-built recommender artifacts at startup and
serves recommendations over HTTP. Optionally connects to a Postgres DB for
live user-interaction data (legacy ratings imported from the old system).

## Requirements

- Python 3.10+ (developed with 3.12)
- Artifacts already generated under `../artifacts/`
- (Optional) Postgres 16 via Docker Compose (see `../docker-compose.yml`)

## Setup

```bash
cd backend
pip install -r requirements.txt
```

## Run

### Without DB (artifacts only)
```bash
RECSYS_DB_ENABLED=0 uvicorn app.main:app --reload --port 8001
```

### With Postgres
```bash
# Start Postgres
cd ..
docker compose up -d postgres

# Import legacy data
python pipelines/migrate_sqlite_to_postgres.py \
    --sqlite "C:/Users/Pichaya/Downloads/web_appRS/thai_arts_webapp/db.sqlite3" \
    --target-url "postgresql+psycopg://postgres:postgres@127.0.0.1:5432/web_rs_thaiarts"

# Start backend (auto-detects DB via RECSYS_DATABASE_URL)
cd backend
uvicorn app.main:app --reload --port 8001
```

Open:
- Swagger UI: http://127.0.0.1:8001/docs
- ReDoc:      http://127.0.0.1:8001/redoc
- OpenAPI:    http://127.0.0.1:8001/openapi.json
- DB health:  http://127.0.0.1:8001/db/health

## Tests

```bash
pytest                                            # default with --cov-fail-under=90
pytest --cov=app --cov-report=term-missing        # show missing lines
pytest --cov=app --cov-report=html --open         # HTML report
pytest tests/test_db.py -v                        # DB integration tests
```

Coverage threshold is enforced by `pytest.ini` (≥ 90%). Current: **92.46%** (109 tests).

## Configuration

All settings are env vars prefixed `RECSYS_`. See `app/core/config.py` for
the full list. Common ones:

| Var | Default | Purpose |
|---|---|---|
| `RECSYS_ARTIFACT_DIR` | `<repo>/artifacts` | Where to load artifacts from |
| `RECSYS_DATABASE_URL` | `postgresql+psycopg://postgres:postgres@127.0.0.1:5432/web_rs_thaiarts` | Postgres URL |
| `RECSYS_DB_ENABLED` | `1` | `0` to skip DB and run on artifacts only |
| `RECSYS_HYBRID_ALPHA` | 0.7 | CBF weight in hybrid |
| `RECSYS_CBF_KEYWORD_BOOST` | 0.05 | Additive boost on keyword hit |
| `RECSYS_CORS_ORIGINS` | `["http://localhost:3000"]` | Allowed CORS origins |

## Layout

```
backend/
├── app/
│   ├── main.py                FastAPI entry, lifespan, CORS, exception handlers
│   ├── model_loader.py        ArtifactLoader (loads 7 files at startup)
│   ├── db.py                  SQLAlchemy engine + session factory
│   ├── models_db.py           ORM models (Context, Item, Keyword, LegacyInteraction, ...)
│   ├── explanations.py        Thai explanation builder
│   ├── core/
│   │   ├── config.py          Settings (RECSYS_* env vars)
│   │   └── exceptions.py      DomainError hierarchy + handlers
│   ├── schemas/               Pydantic v2 request/response models
│   ├── services/              Algorithm + DB queries
│   │   ├── eligibility.py     context + keyword filter
│   │   ├── cbf_service.py     E5 cosine + keyword boost
│   │   ├── cf_service.py      ItemKNN + popularity + live-DB merge
│   │   ├── hybrid_service.py  z-score weighted sum
│   │   ├── db_query.py        live DB queries (live_positive_users_per_item)
│   │   └── recommendation_service.py
│   └── routers/               FastAPI routers
│       ├── health.py
│       ├── recommendations.py
│       ├── catalog.py
│       ├── metrics.py
│       └── legacy.py          /items/{id}/legacy-stats, /db/health
├── tests/                     109 pytest tests (incl. DB)
├── pytest.ini                 enforces ≥90% coverage
└── requirements.txt
```