## Parent

#51 — Remove dead Google SSO exchange path so the app needs only Authorized redirect URIs (no Authorized JavaScript origins)

## What to build

Documentation and the domain glossary no longer reference the removed exchange path or the stale JWT-exchange model. The API docs' Google Login section lists the two live endpoints (`start`, `callback`) instead of three. The glossary's "Single-Use Exchange Code" term — which contradicted the canonical "Server Session" term (it claimed a "JWT access token" that the code no longer mints) — is deleted, leaving "Server Session" as the sole canonical login model.

This is blocked on the code removal so the docs and glossary never describe a route that still exists.

## Acceptance criteria

- [ ] `docs/api.md` Google Login section says "Two endpoints" and drops the `POST /api/auth/google/login/exchange` bullet
- [ ] The "Single-Use Exchange Code" term is removed from `CONTEXT.md`; the "Server Session" term remains the canonical login model
- [ ] No remaining doc or glossary reference to the exchange endpoint, or to a JWT access token issued by Google login

## Blocked by

- #53 — Remove the dead Google SSO exchange code path and its tests