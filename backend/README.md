# Backend — Thai Arts Recommender API

FastAPI service that loads pre-built recommender artifacts at startup and
serves recommendations over HTTP.

## Requirements

- Python 3.10+ (developed with 3.12)
- Artifacts already generated under `../artifacts/`

## Setup

```bash
cd backend
pip install -r requirements.txt
```

## Run

```bash
uvicorn app.main:app --reload --port 8080
```

Open:
- Swagger UI: http://localhost:8080/docs
- ReDoc:      http://localhost:8080/redoc
- OpenAPI:    http://localhost:8080/openapi.json

## Tests

```bash
pytest                                            # default with --cov-fail-under=90
pytest --cov=app --cov-report=term-missing        # show missing lines
pytest --cov=app --cov-report=html --open         # HTML report
pytest tests/test_recommendations.py -v           # one module
```

Coverage threshold is enforced by `pytest.ini` (≥ 90%). Current: 96.85%.

## Configuration

All settings are env vars prefixed `RECSYS_`. See `app/core/config.py` for
the full list. Common ones:

| Var | Default |
|---|---|
| `RECSYS_ARTIFACT_DIR` | `<repo>/artifacts` (auto-detected) |
| `RECSYS_HYBRID_ALPHA` | 0.7 |
| `RECSYS_CBF_KEYWORD_BOOST` | 0.05 |
| `RECSYS_CORS_ORIGINS` | `["http://localhost:3000"]` |

## Layout

```
backend/
├── app/
│   ├── main.py                FastAPI entry, lifespan, CORS, exception handlers
│   ├── model_loader.py        ArtifactLoader (loads 7 files at startup)
│   ├── explanations.py        Thai explanation builder
│   ├── core/
│   │   ├── config.py          Settings (RECSYS_* env vars)
│   │   └── exceptions.py      DomainError hierarchy + handlers
│   ├── schemas/               Pydantic v2 request/response models
│   ├── services/              Algorithm (eligibility, cbf, cf, hybrid, orchestrator)
│   └── routers/               FastAPI routers (health, recommendations, catalog, metrics)
├── tests/                     102 pytest tests
├── pytest.ini                 enforces ≥90% coverage
└── requirements.txt
```