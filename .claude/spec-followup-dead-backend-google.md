## Context

Follow-up to #51 (Remove dead Google SSO exchange path). During that work we confirmed the live member Google SSO is the Next.js Application Backend's pure server-side Authorization Code + PKCE flow. The **legacy FastAPI public app** (`backend/app/main.py`) still contains a complete, separate Google-login implementation that is **dead in production** — `private_main.py` (the only deployed ASGI entry) mounts only `private_model.router`. This dead code is the source of the stale `client_secret_940939312136-lcna…json` at the repo root, which carries `javascript_origins: ["http://localhost:3000"]` and redirect URIs on `localhost:8001` (the FastAPI port) — i.e. the "Authorized JavaScript origins" that originally suggested a client-side flow.

## Problem

The dead FastAPI Google-login code (and the broader unmounted `main.py` public app) misleads maintainers about the system's OAuth surface and keeps stale credential config and tests alive. It also intersects with two architecture invariants: ADR 0001/0004 ("FastAPI is the Private Model Service only") and the Alembic→TypeORM schema-authority migration (TypeORM under `frontend/db/` is the sole schema authority; the backend Alembic migration `0012_google_member_login.py` is legacy).

## Scope (to be decided in its own session)

Candidate code to remove, pending confirmation that it is truly unreachable and that no tooling imports it:
- `backend/app/routers/auth.py` — Google-login routes (`google_login_start`, `complete_authorization`, etc.) and the rest of the legacy auth router.
- `backend/app/services/google_login_oauth.py` — the FastAPI-era OAuth service.
- `backend/tests/test_google_login_oauth.py` and the Google-login cases in `backend/tests/test_auth.py`.
- `backend/migrations/versions/0012_google_member_login.py` — legacy Alembic migration (coordinate with the Alembic→TypeORM schema-authority decision).
- Possibly the entire unmounted `backend/app/main.py` public app and its routers (auth, member, admin, catalog, metrics, legacy, actions, recommendations, health) — a larger decision under ADR 0001/0004.

## Out of Scope for this issue

- The live Next.js Google SSO flow (handled in #51).
- Any change to `private_main.py` or the Private Model Service.

## Further Notes

- This is a decision issue, not a ready spec. It needs its own design session before `ready-for-agent` — the removal surface intersects ADR 0001/0004 and the schema-authority migration, so the scope (just Google-login code vs. the whole legacy `main.py` app) must be settled first.
- Verify `backend/app/main.py` is not referenced by any deployed entrypoint, CI, or tooling before removal.