# API Tour

Human walkthrough of the **public** API surface of the Thai Arts
Recommender web application. Since issue #10 the public API is served
entirely by the **Next.js Application Backend** — the browser talks only
to the same origin (`/api/*`), and FastAPI exists solely as the private
model-scoring process (see `private-model-service.md`).

Base URL in development: `http://localhost:3000` (all paths below start
with `/api`).

Every endpoint carries a `summary` and `description` in the Next.js route
handlers, and every error response uses the same envelope:

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
| `validation_error` | bad request body / query (422) |
| `context_not_found` | unknown context_id (404) |
| `item_not_found` | unknown item_id (404) |
| `model_service_unavailable` | the Private Model Service is unreachable (503) |
| `unauthorized` | missing/invalid session (401) |
| `forbidden` | authenticated but not an admin (403) |
| `internal_server_error` | unexpected failure (500) |

---

## `GET /api/health`

Liveness probe. Returns `{ status, database }`; `503` when the database
layer is not ready.

## `GET /api/contexts` / `GET /api/keywords`

Filterable sub-contexts and keywords for the recommendation UI.

## `GET /api/items`

List active catalogue items. Two modes:

**Browse mode** (default) — paginated (`limit` 1–200, `offset` ≥ 0),
optional `search` across `name`, `description`, and `keyword_names`.

**Ranked mode** (`?context=<id>`) — the top-10 context-valid items sorted
by the display-only suitability `match_percent` desc, mirroring the legacy
`catalog.views.item_list` behaviour. `limit`/`offset` are ignored.

Every row carries `match_percent` + `suitability_label` — presentational
only, never a ranking input — plus per-session `user_state`.

## `GET /api/items/{id}` / `/api/items/batch` / `/api/items/{id}/similar`

Item detail (keywords, contexts, user state), batch fetch (`?ids=`, max
200), and model-similar items (`/similar?limit=` up to 20; 503
`model_service_unavailable` when the model service is down).

## `GET /api/items/{id}/legacy-stats` / `/api/legacy-stats` / `/api/items/engagement`

Legacy rating aggregates and live engagement counters (likes + saves +
positive ratings), reading the same Postgres tables the legacy dashboard
used. Anonymous; degrade to zeros when the data is unavailable.

## `GET /api/uploads/[...]`

User-uploaded media (item covers, avatars) served by Next.js with
symlink-escape protection.

---

## Recommendations

### `POST /api/recommendations`

Context + optional keywords + top-K. The Application Backend performs the
eligibility gate, maps identifiers into immutable Artifact Item Identifier
space, and calls the Private Model Service `/internal/v1/inference` with
live personalization inputs (session likes/saves/ratings). Enriched
results carry catalogue details, media, member state, Thai explanations,
and the suitability hint; `scores.final` is surfaced as `hybrid`. When the
model service errors or times out the route answers **200** with
non-personalized context-valid results, zero model scores, a fallback
explanation, and `metadata.fallback: true`.

### `GET /api/recommendations/profile`

Session-gated (401 anonymous) profile recommendations; falls back to
content affinity (catalogue overlap) when the model service is unavailable.

---

## Live user actions (Like / Save / Rate / View)

`POST /api/actions/like`, `DELETE /api/actions/like`,
`POST|DELETE /api/actions/save`, `PUT /api/actions/rating`,
`POST /api/actions/view` (fire-and-forget telemetry, 30-minute dedupe).
Anonymous browsers identify themselves with an opaque `user_key` in the
body; signed-in members are resolved from the session cookie server-side
— credentials never reach Python.

---

## Member journeys (`/api/me/*`)

Session-gated (401 anonymous). `GET /api/me/profile`,
`PATCH /api/me/profile`, `POST|DELETE /api/me/profile/avatar`,
`GET /api/me/dashboard`, `/api/me/history`, `/api/me/summary`,
`/api/me/liked`, `/api/me/saved`, `/api/me/rated`,
`/api/me/rating-summary`, `/api/me/recent-views`.

---

## Member authentication flows

All flows keep the `{ error: { code, message } }` envelope. Mutating JSON
endpoints require the same-origin CSRF headers that the browser sends
automatically (`Origin`, `Sec-Fetch-Site: same-origin`,
`X-CSRF-Token: same-origin`).

### `POST /api/auth/signup` / `POST /api/auth/login` / `GET|PATCH /api/auth/me`

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
| `PRIVATE_MODEL_SERVICE_URL` / `MODEL_SERVICE_SHARED_SECRET` | private model service address + Internal Service Credential |

---

# Admin API

Administrative user and catalogue management lives in the Next.js
Application Backend. All admin endpoints require a same-origin session for
an `is_admin=True` user; anonymous callers get `401 unauthorized` and
non-admins get `403 forbidden`. Mutations also require the CSRF contract.

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

# Analytics

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/metrics` | Corpus + live-table counts (anonymous) |
| GET | `/api/metrics/requests` | Monthly recommendation-request trend (anonymous) |
| GET | `/api/metrics/config` | Active recommender config, derived from `RECSYS_*` env (anonymous) |
| GET | `/api/metrics/dashboard` | Admin dashboard payload (14 sections, admin-only) |
| GET | `/api/metrics/analytics` | Funnel + audience segments + rule insights (admin-only) |
| GET | `/api/metrics/dashboard/export` | Styled multi-sheet Excel snapshot (admin-only) |

## Artifact Publication

Catalogue edits are visible in browsing immediately, but rows edited
after the last published build are excluded from personalized scoring
(model-service inference/similarity) until an explicit Artifact
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

---

# The FastAPI side is private

The only FastAPI process is the **Private Model Service** (`app/private_main`):
`GET /internal/v1/health`, `POST /internal/v1/inference`, and
`POST /internal/v1/similarity`, all authenticated with the Internal Service
Credential. It is database-free, serves no browser-facing content, and is
never exposed by the host reverse proxy. See `private-model-service.md`
for its complete contract.
