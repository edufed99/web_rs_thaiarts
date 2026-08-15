# API Tour

Human walkthrough of the FastAPI endpoints exposed by the recommender backend.
Base URL during development: `http://127.0.0.1:8001`.

For the full machine-readable contract, see `/openapi.json` (every endpoint
carries a `summary` and `description`).

---

## `GET /health`

Liveness probe. Returns 200 with build metadata when artifacts are loaded.

```bash
curl http://127.0.0.1:8001/health
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
curl -X POST http://127.0.0.1:8001/recommendations \
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
curl -X POST http://127.0.0.1:8001/recommendations \
    -H "Content-Type: application/json" \
    -d '{"context_id": 1, "keyword_ids": [], "top_k": 0}'

# {"error": {"code": "validation_error", "message": "body.top_k: Input should be greater than or equal to 1"}}

# 404 — unknown context
curl -X POST http://127.0.0.1:8001/recommendations \
    -H "Content-Type: application/json" \
    -d '{"context_id": 99999999, "keyword_ids": [], "top_k": 5}'

# {"error": {"code": "context_not_found", "message": "Context id 99999999 is not known.", "context_id": 99999999}}

# 503 — artifacts not loaded
curl http://127.0.0.1:8001/health
# {"status": "degraded", ...}
```

---

## `GET /items`

List active catalog items. Supports two modes:

**Browse mode** (default) — paginated, optional substring search across
`name`, `description`, and `keyword_names`. Returns up to `limit` items
starting at `offset`, with the unfiltered `total` reported alongside.

**Ranked mode** (`?context=<id>`) — mirrors the legacy
`catalog.views.item_list` ranked behaviour: returns the top-10 items
valid for the selected sub-context, sorted by `match_percent` desc, with
the legacy suitability label on each row. `limit` and `offset` are
ignored in this mode.

`match_percent` and `suitability_label` are populated on **every** row
in both modes; they are purely presentational and never influence the
recommendation ranking.

```bash
# browse mode
curl 'http://127.0.0.1:8001/items?limit=5'
curl 'http://127.0.0.1:8001/items?search=ระบำ'
curl 'http://127.0.0.1:8001/items?limit=10&offset=20&user_key=anon:abc'

# ranked mode (legacy top-10 by context)
curl 'http://127.0.0.1:8001/items?context=142863314'
```

Response (browse mode):

```json
{
  "items": [
    {
      "id": 222445941,
      "name": "ระบำพรหมาสตร์",
      "keywords": [...],
      "contexts": [...],
      "user_state": {"liked": false, "saved": false, "rating": 0},
      "match_percent": 88,
      "suitability_label": "เหมาะสม"
    }
  ],
  "total": 114
}
```

Response (ranked mode) — same shape but `items` length is `<= 10` and
already sorted by `match_percent` desc; `total` reflects the returned
size.

| Query param | Type | Default | Notes |
|---|---|---|---|
| `search` | string | — | Substring match against `name`, `description`, and `keyword_names` |
| `limit` | int 1-200 | 20 | Ignored in ranked mode |
| `offset` | int ≥ 0 | 0 | Ignored in ranked mode |
| `context` | int > 0 | — | When set, switches to ranked mode (legacy top-10) |
| `user_key` | string ≤ 150 | — | When provided, populates `user_state` on each item |

404 if `context` is unknown:

```bash
curl 'http://127.0.0.1:8001/items?context=99999'
# {"error": {"code": "context_not_found", "message": "Context id 99999 is not known.", "context_id": 99999}}
```

---

## `GET /items/{item_id}`

One item with its keywords, contexts, per-user state, and suitability hint.

```bash
curl 'http://127.0.0.1:8001/items/45123'
curl 'http://127.0.0.1:8001/items/45123?user_key=anon:abc'
```

404 if the id is unknown:

```bash
curl http://127.0.0.1:8001/items/99999
# {"error": {"code": "item_not_found", "message": "Item id 99999 not found.", "item_id": 99999}}
```

---

## `GET /contexts`

All filterable sub-contexts, ordered by group then name.

```bash
curl http://127.0.0.1:8001/contexts
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
curl 'http://127.0.0.1:8001/keywords'
curl 'http://127.0.0.1:8001/keywords?search=ผู้หญิง'
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
curl http://127.0.0.1:8001/metrics
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

Start the backend and open `http://127.0.0.1:8001/docs` — Swagger UI has a
"Try it out" button on every endpoint, with the request/response schema
inline.
---

## Live user actions (Like / Save / Rate)

The backend persists per-user actions to Postgres and uses them to
personalize the next `/recommendations` call. All endpoints return the
updated item with its resolved `user_state` so the client can re-render
optimistically.

Authentication is intentionally absent — clients send an opaque
`user_key` like `anon:<uuid>` (the frontend stores one in `localStorage`
on first load). See `frontend/lib/user.ts`.

### `POST /actions/like`

Likes an item. Idempotent.

```bash
curl -X POST http://127.0.0.1:8001/actions/like \
    -H "Content-Type: application/json" \
    -d '{"user_key":"anon:7f3a","item_id":222445941}'
```

```json
{
  "item": {
    "id": 222445941,
    "name": "ระบำพรหมาสตร์",
    "user_state": {"liked": true, "saved": false, "rating": 0},
    "..."
  },
  "action": "liked",
  "rating": null,
  "metadata": {"liked": true}
}
```

### `DELETE /actions/like`

Removes the like. Idempotent.

```bash
curl -X DELETE http://127.0.0.1:8001/actions/like \
    -H "Content-Type: application/json" \
    -d '{"user_key":"anon:7f3a","item_id":222445941}'
```

### `POST /actions/save` / `DELETE /actions/save`

Same shape as the like endpoints, but writes to the `saved_items` table.

### `PUT /actions/rating`

Upserts a 1..5 rating. `rating` must be supplied in the body.

```bash
curl -X PUT http://127.0.0.1:8001/actions/rating \
    -H "Content-Type: application/json" \
    -d '{"user_key":"anon:7f3a","item_id":222445941,"rating":4}'
```

The next `/recommendations` call from the same `user_key` will:

* Include the item in the live positive history (ItemKNN picks it up
  via `live_user_positive_items`).
* Apply `apply_negative_penalty` for items the user rated < 4.

### Error codes

| Code | Status | When |
|---|---|---|
| `item_not_found` | 404 | `item_id` has no catalog row in Postgres (missing `artifact_item_id` backfill). |
| `invalid_action` | 400 | Unknown action or out-of-range rating. |
| `db_disabled` | 503 | `RECSYS_DB_ENABLED=0` — actions require a live DB. |
| `validation_error` | 422 | Pydantic validation on the request body (e.g. `rating: 0`). |

---

## Member authentication flows (Next.js Application Backend)

Issue #6 migrated member sign-in, password recovery, and the admin Gmail
sender authorization from the FastAPI compatibility service into Next.js
route handlers. All flows keep the documented `{ error: { code, message } }`
envelope. Mutating JSON endpoints require the same-origin CSRF headers that
the browser sends automatically (`Origin`, `Sec-Fetch-Site: same-origin`,
`X-CSRF-Token: same-origin`).

### `POST /auth/signup` / `POST /auth/login` / `GET|PATCH /auth/me`

Password accounts. Responses carry the HttpOnly `thai_arts_session` cookie
(seven-day lifetime) instead of a JWT; `access_token` is absent.

### Google Login (member OpenID Connect)

Three endpoints use the **separate** `google_login_client` OAuth client
(identity scopes only, never persisted):

1. `GET /api/auth/google/login/start?next=<path>` — 303 to Google with a
   signed PKCE state cookie bound to the browser.
2. `GET /api/auth/google/login/callback?code&state` — the Google redirect
   **terminates in Next.js**. Verifies the ID token (JWKS + audience +
   issuer + `email_verified`), resolves or creates the member, rotates a
   fresh server session, and 303s to `/auth/google/callback?next=<path>`
   (errors redirect with `?error=<code>`).
3. `POST /api/auth/google/login/exchange` — JSON contract (`{ code, state }`)
   for the callback page's legacy direct-code path; same verification, returns
   `{ expires_in_seconds, user }` plus the session cookie.

Callback page error codes: `google_access_denied`, `invalid_google_state`,
`google_login_failed`, `ambiguous_google_email`, `google_account_not_persisted`.

### Password recovery

- `POST /api/auth/password-reset/request` — body `{ username, email }`.
  Returns the documented `PasswordResetRequestOut` shape
  (`accepted`, `credentials_valid`, `email_sent`, `delivery_configured`,
  `message`). Tokens are single-use, expire per
  `PASSWORD_RESET_TOKEN_MINUTES`, and a one-minute resend cooldown applies.
  Delivery goes through the admin Gmail sender API when authorized, else SMTP.
- `POST /api/auth/password-reset/confirm` — body
  `{ username, token, new_password }`. Consumes the token once, sets the new
  bcrypt password, strips the legacy `must_reset|` / `legacy:` display
  markers, and **revokes every server session** for the account. Invalid,
  expired, or reused tokens → 400 `invalid_reset_token`.

### Admin Gmail sender authorization

Uses the **separate** `google_oauth_client` (admin Gmail sender, `gmail.send`
scope) with its own callback — never shared with member login.

- `GET /api/admin/gmail-oauth/status` — admin-only (401 anonymous, 403 member).
- `POST /api/admin/gmail-oauth/start` — admin-only; returns
  `{ authorization_url }` and sets the signed state cookie.
- `GET /api/admin/gmail-oauth/callback?code&state` — Google redirect that
  terminates in Next.js at `/api/admin/gmail-oauth/callback`, persists the
  refresh token to `GMAIL_OAUTH_TOKEN_FILE` / `GMAIL_OAUTH_REFRESH_TOKEN`,
  and 303s to `/admin/email-settings?oauth=success|error`.

### Environment variables (server-only, see `frontend/.env.example`)

| variable | purpose |
|---|---|
| `GOOGLE_LOGIN_CLIENT_FILE/ID/SECRET` | member OpenID Connect client |
| `GOOGLE_LOGIN_REDIRECT_URI` | must match the Google Console registration, e.g. `https://host/api/auth/google/login/callback` |
| `GOOGLE_LOGIN_STATE_TTL_SECONDS` | pending-flow lifetime (default 600) |
| `GMAIL_OAUTH_CLIENT_FILE/ID/SECRET` | admin Gmail sender client |
| `GMAIL_OAUTH_REDIRECT_URI` | must match Google Console, e.g. `https://host/api/admin/gmail-oauth/callback` |
| `GMAIL_OAUTH_TOKEN_FILE` / `GMAIL_OAUTH_REFRESH_TOKEN` | sender refresh token store |
| `GMAIL_SENDER_EMAIL` | sender identity in reset emails |
| `SMTP_*` | SMTP fallback for reset delivery |
| `FRONTEND_BASE_URL` | public origin used to build callback/reset URLs |
| `PASSWORD_RESET_TOKEN_MINUTES` | reset token lifetime (default 30) |
| `OAUTH_STATE_SECRET` | HMAC secret signing both PKCE state cookies |

---

# Admin API (Next.js Application Backend)

Administrative user and catalogue management (issue #8) lives in the
Next.js Application Backend, not FastAPI. All admin endpoints require a
same-origin session for an `is_admin=True` user; anonymous callers get
`401 unauthorized` and non-admins get `403 forbidden`. Mutations also
require the CSRF contract (`Origin`, `Sec-Fetch-Site: same-origin`,
`X-CSRF-Token: same-origin`).

| Method | Path | Purpose |
|---|---|---|
| GET  | `/api/admin/users` | List users (max 500, id order) |
| POST | `/api/admin/users` | Create user (bcrypt password) |
| PUT  | `/api/admin/users/{id}` | Update user (self-demotion guard) |
| DELETE | `/api/admin/users/{id}` | Delete user (self-delete guard) |
| POST | `/api/admin/items/draft` | Layer A keyword grounding + context resolution |
| POST | `/api/admin/items` | Create item from a grounded draft |
| GET  | `/api/admin/items/facets` | Distinct category/performance values for form dropdowns |
| PUT  | `/api/admin/items/{artifactId}` | Edit item (artifact id immutable) |
| DELETE | `/api/admin/items/{artifactId}` | Delete item + linked rows |
| POST | `/api/admin/items/{artifactId}/image` | Cover image upload (JPEG/PNG/WebP, max 5 MB) |
| POST | `/api/admin/items/{artifactId}/video` | Video upload (MP4/WebM/MOV, max 100 MB) |
| GET  | `/api/admin/publication` | Artifact Publication status |
| POST | `/api/admin/publication` | Execute an Artifact Publication |

## Artifact Publication

Catalogue edits are visible in browsing immediately, but rows edited
after the last published build are excluded from personalized scoring
(model-service similarity/inference) until an explicit Artifact
Publication succeeds:

1. Every admin mutation marks the row `items.published_at = NULL`.
2. `GET /api/admin/publication` reports the latest recorded build, the
   pending rows, and what the Private Model Service says it is serving.
3. `POST /api/admin/publication` (admin) verifies the Private Model
   Service is reachable, records an `artifact_publications` audit row
   (build id, coverage count, acting admin, note), and marks every
   pending row published. It returns `503 model_service_unavailable`
   when the model service is down.

The build identity comes from the model service's own
`/internal/v1/health` report (`artifact_version:item_count`) so a
publication can never claim a build the scoring process is not actually
serving. Rebuilding artifacts is the offline pipeline's job
(`pipelines/train_or_generate_artifacts.py`), run before publishing.
