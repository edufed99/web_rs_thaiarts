# Backend — Private Model Service

FastAPI process that loads pre-built recommender artifacts at startup and
scores exactly the candidate sets the Next.js Application Backend sends it.
Since issue #10 the FastAPI package contains **only** the authenticated
private model contract — the public application surface (auth, catalogue,
media, member, admin, actions, metrics, analytics, compatibility) has been
retired and is served by the Next.js Application Backend.

This process never connects to PostgreSQL, never reads CSV, and never
serves browser-facing responses.

## Requirements

- Python 3.10+ (developed with 3.12)
- Artifacts already generated under `../artifacts/` (see the offline
  pipeline `../pipelines/train_or_generate_artifacts.py`)

## Setup

```bash
cd backend
pip install -r requirements.txt
```

## Run

```bash
# The Internal Service Credential is required: an unset secret makes the
# private contract unavailable (503) instead of weakening auth.
RECSYS_INTERNAL_SERVICE_SECRET=<long-random-secret> \
  RECSYS_ARTIFACT_DIR=../artifacts \
  uvicorn app.private_main:app --port 8001
```

The app intentionally disables `/docs`, `/redoc`, and `/openapi.json` — it
is an internal service, not a public API.

## Endpoints (all require `Authorization: Bearer <secret>`)

| Method | Path | Purpose |
|---|---|---|
| GET  | `/internal/v1/health` | Loaded artifact schema version + item count |
| POST | `/internal/v1/inference` | Score an Eligible Candidate Set (CBF + ItemKNN + Hybrid) |
| POST | `/internal/v1/similarity` | Rank supplied candidates against a reference item |

See `../docs/private-model-service.md` for the full request/response
contract and `../docs/api.md` for the public (Next.js) API tour.

## Tests

```bash
pytest                                            # default with --cov-fail-under=90
pytest --cov=app --cov-report=term-missing        # show missing lines
pytest --cov=app --cov-report=html --open         # HTML report
```

Coverage threshold is enforced by `pytest.ini` (≥ 90%). Current: **95.01%** (108 tests).

## Configuration

All settings are env vars prefixed `RECSYS_`. See `app/core/config.py` for
the full list. Common ones for the model service:

| Var | Default | Purpose |
|---|---|---|
| `RECSYS_ARTIFACT_DIR` | `<repo>/artifacts` | Where to load artifacts from |
| `RECSYS_INTERNAL_SERVICE_SECRET` | — | Internal Service Credential (no default) |
| `RECSYS_HYBRID_ALPHA` | 0.7 | CBF weight in hybrid |
| `RECSYS_CBF_KEYWORD_BOOST` | 0.05 | Additive boost on keyword hit |
| `RECSYS_ITEMKNN_K` | 10 | Top-K neighbours for ItemKNN |
| `RECSYS_ITEMKNN_SHRINK` | 50.0 | Shrinkage term in ItemKNN cosine |
| `RECSYS_POSITIVE_THRESHOLD` | 4 | Minimum rating to count as positive |
| `RECSYS_NEGATIVE_PENALTY_ALPHA` | 1.0 | Additive negative-rating penalty strength |
| `RECSYS_MIN_CANDS` / `RECSYS_MAX_CANDS` | 10 / — | Eligibility-gate caps (mirrored by Next.js) |
| `RECSYS_E5_ENABLED` | 1 | 0 to skip E5 model load |
| `RECSYS_PRELOAD_E5` | 0 | 1 to warm the E5 model during lifespan |

## Layout

```
backend/
├── app/
│   ├── private_main.py        ASGI entry point (the only app)
│   ├── model_loader.py        ArtifactLoader (loads artifact set at startup)
│   ├── core/
│   │   ├── config.py          Settings (RECSYS_* env vars)
│   │   └── exceptions.py      DomainError hierarchy + handlers
│   ├── schemas/
│   │   └── inference.py       Pydantic v2 private-contract models
│   ├── services/
│   │   ├── cbf_service.py     E5 cosine + keyword boost
│   │   ├── hybrid_service.py  z-score weighted sum + negative penalty
│   │   ├── model_inference.py Candidate-set scoring (ItemKNN inside)
│   │   ├── model_similarity.py Artifact similarity ranking
│   │   └── embedding.py       Lazy E5 loader
│   └── routers/
│       └── private_model.py   /internal/v1/* routes + credential check
├── tests/                     108 pytest tests
├── pytest.ini                 enforces ≥90% coverage
└── requirements.txt
```
