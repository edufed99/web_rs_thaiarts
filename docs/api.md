# API Tour

Human walkthrough of the FastAPI endpoints exposed by the recommender backend.
Base URL during development: `http://localhost:8080`.

For the full machine-readable contract, see `/openapi.json` (every endpoint
carries a `summary` and `description`).

---

## `GET /health`

Liveness probe. Returns 200 with build metadata when artifacts are loaded.

```bash
curl http://localhost:8080/health
```

```json
{
  "status": "ok",
  "version": "1.0.0",
  "artifacts_loaded_at": "2026-07-28T07:55:01.488652+00:00",
  "item_count": 114,
  "context_count": 25,
  "embedding_dim": 1024
}
```

Returns `status: "degraded"` and zeros when artifacts are missing.

---

## `POST /recommendations`

The main workflow. Accepts a context + optional keywords + top-K. Returns the
top-K items with per-model scores, matched keywords, and a Thai explanation.

```bash
curl -X POST http://localhost:8080/recommendations \
    -H "Content-Type: application/json" \
    -d '{
        "context_id": 142863314,
        "keyword_ids": [],
        "top_k": 5,
        "user_key": "user:u1"
    }'
```

Response (truncated):

```json
{
  "request_id": "9e8a6e90-...",
  "selected_context": {
    "id": 142863314,
    "name": "งานบวช",
    "group": "พิธีกรรม",
    "description": "",
    "active_item_count": 3
  },
  "selected_keywords": [],
  "candidate_count": 3,
  "top_k": 5,
  "method": "Hybrid-WeightedSum",
  "metadata": {
    "cbf_model": "precomputed-E5",
    "cf_model": "ItemKNN",
    "hybrid_alpha": 0.7,
    "cbf_keyword_boost": 0.05,
    "itemknn_k": 10,
    "itemknn_shrink": 50.0,
    "user_key_provided": true
  },
  "results": [
    {
      "rank": 1,
      "item": {
        "id": 45123,
        "name": "หุ่นกระบอก",
        "category_group": "หุ่นกระบอก",
        "performance_type": "การแสดง",
        "keywords": [{"id": ..., "name": "...", "taxonomy_path": "..."}],
        "contexts": [{"id": ..., "name": "...", "group": "", "description": "", "active_item_count": 0}],
        "user_state": {"liked": false, "saved": false, "rating": 0}
      },
      "scores": {"cbf": 0.42, "cf": 0.13, "hybrid": 0.55},
      "is_context_valid": true,
      "matched_keywords": [],
      "explanation": "รายการนี้ผ่านเงื่อนไขบริบท \"งานบวช\" …"
    }
  ]
}
```

### Error responses

```bash
# 422 — invalid input (top_k out of range, negative keyword id, malformed JSON)
curl -X POST http://localhost:8080/recommendations \
    -H "Content-Type: application/json" \
    -d '{"context_id": 1, "keyword_ids": [], "top_k": 0}'

# {"error": {"code": "validation_error", "message": "body.top_k: Input should be greater than or equal to 1"}}

# 404 — unknown context
curl -X POST http://localhost:8080/recommendations \
    -H "Content-Type: application/json" \
    -d '{"context_id": 99999999, "keyword_ids": [], "top_k": 5}'

# {"error": {"code": "context_not_found", "message": "Context id 99999999 is not known.", "context_id": 99999999}}

# 503 — artifacts not loaded
curl http://localhost:8080/health
# {"status": "degraded", ...}
```

---

## `GET /items`

Paginated list of active items. Optional `search` substring filter.

```bash
curl 'http://localhost:8080/items?limit=5'
curl 'http://localhost:8080/items?search=ระบำ'
curl 'http://localhost:8080/items?limit=10&offset=20'
```

Response:

```json
{
  "items": [{"id": 1, "name": "...", "keywords": [...], "contexts": [...], "user_state": {...}}],
  "total": 114
}
```

---

## `GET /items/{item_id}`

One item with its keywords, contexts, and per-user state.

```bash
curl http://localhost:8080/items/45123
```

404 if the id is unknown:

```bash
curl http://localhost:8080/items/99999
# {"error": {"code": "item_not_found", "message": "Item id 99999 not found.", "item_id": 99999}}
```

---

## `GET /contexts`

All filterable sub-contexts, ordered by group then name.

```bash
curl http://localhost:8080/contexts
```

```json
{
  "contexts": [
    {
      "id": 142863314,
      "name": "งานบวช",
      "group": "",
      "description": "",
      "active_item_count": 12
    }
  ]
}
```

---

## `GET /keywords`

All keywords found across the catalog. Optional substring filter.

```bash
curl 'http://localhost:8080/keywords'
curl 'http://localhost:8080/keywords?search=ผู้หญิง'
```

```json
{
  "keywords": [
    {"id": 58341234, "name": "ผู้หญิง", "taxonomy_path": "ผู้แสดง"},
    {"id": 58456789, "name": "ชุดไทย", "taxonomy_path": "เครื่องแต่งกาย"}
  ]
}
```

---

## `GET /metrics`

High-level corpus + CF index stats plus the build timestamp and config hash.

```bash
curl http://localhost:8080/metrics
```

```json
{
  "item_count": 114,
  "context_count": 25,
  "keyword_count": 574,
  "positive_user_count": 152,
  "unique_item_user_edges": 980,
  "embedding_dim": 1024,
  "artifacts_loaded_at": "2026-07-28T07:55:01.488652+00:00",
  "config_hash": "3b7bf287ae67"
}
```

---

## Error envelope

Every error response uses the same shape:

```json
{
  "error": {
    "code": "context_not_found",
    "message": "Context id 99999999 is not known.",
    "context_id": 99999999
  }
}
```

Stable `code` strings you can branch on:

| code | when |
|---|---|
| `validation_error` | bad request body (Pydantic) |
| `context_not_found` | unknown context_id |
| `item_not_found` | unknown item_id |
| `keyword_not_found` | unknown keyword_id (reserved) |
| `invalid_request` | business-rule violation |
| `artifacts_not_loaded` | artifacts missing on disk |
| `bad_request` | generic 400 |
| `http_error` | fallback for non-domain errors |

---

## Try it interactively

Start the backend and open `http://localhost:8080/docs` — Swagger UI has a
"Try it out" button on every endpoint, with the request/response schema
inline.