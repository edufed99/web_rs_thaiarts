## Problem Statement

The member Google SSO flow appeared to require "Authorized JavaScript origins" in the Google Cloud Console, suggesting a client-side Google Identity Services script. In reality the live (Next.js) flow is already a pure server-side Authorization Code + PKCE redirect flow needing only "Authorized redirect URIs" — but a dead legacy `POST /api/auth/google/login/exchange` endpoint and its callback-page branch pattern-match a client-handled-code flow, and stale FastAPI-era credential files at the repo root carry `javascript_origins`. This dead code and stale config create the false impression that the app depends on client-side Google script and "Authorized JavaScript origins," confusing maintainers and obscuring the true server-side security posture.

## Solution

Remove the dead legacy exchange path from the Next.js Application Backend so the codebase honestly reflects the single, pure server-side Google SSO flow; delete the stale FastAPI-era credential files; correct the domain glossary; and confirm the Google Cloud Console needs no "Authorized JavaScript origins." The live sign-in flow is unchanged.

## User Stories

1. As a member, I want to sign in with Google via a pure server-side redirect flow, so that my browser never loads a third-party Google script.
2. As a member, I want the "Sign in with Google" button to navigate me to Google directly, so that I authenticate without any client-side Google library.
3. As a member, after Google redirects me back, I want the Application Backend to verify my identity and issue my session cookie server-side, so that no OAuth code or token is handled in the browser.
4. As a member, I want the Google callback page to read my session via the server-session branch only, so that the legacy direct-code path cannot interfere with my sign-in.
5. As a maintainer, I want the codebase to contain only the server-side Google SSO flow, so that I don't mistake a dead exchange endpoint for a client-side flow.
6. As a maintainer, I want the stale FastAPI-era Google client JSON files removed from the repo root, so that their `javascript_origins` stops misleading me about the app's OAuth requirements.
7. As a maintainer, I want the API documentation to list only the two live Google Login endpoints, so that docs match the code.
8. As a maintainer, I want the domain glossary to describe the Server Session model accurately, so that the stale "Single-Use Exchange Code → JWT" term no longer contradicts it.
9. As a maintainer, I want the Google Cloud Console for member login to require only "Authorized redirect URIs," so that I don't maintain "Authorized JavaScript origins."
10. As a security reviewer, I want no `POST /api/auth/google/login/exchange` route exposed, so that the unused JSON code-exchange surface is eliminated.
11. As a developer, I want `npm run type-check` and `npm run build` to pass after the removal, so that no dangling references to the removed helper/type remain.
12. As a developer, I want the existing end-to-end Google login tests (start → callback → session) to keep passing, so that the unchanged live flow is regression-protected.
13. As a developer, I want the exchange-specific tests removed, so that the suite doesn't test a non-existent endpoint.
14. As a developer, I want the deployment routing test to no longer reference the exchange path, so that the routing assertion list matches the live routes.
15. As a member, I want sign-in to keep working under the IIS reverse proxy with the `/api` prefix, so that the production topology is unaffected by this cleanup.
16. As a maintainer, I want the dead FastAPI Google-login code in the backend to be flagged as a separate follow-up, so that this cleanup doesn't expand into a legacy-app-removal refactor.

## Implementation Decisions

- Remove the `POST /api/auth/google/login/exchange` Next.js route handler entirely (the route directory).
- In the Google callback page, remove the legacy direct-code branch (the `if (code)` block), the module-level exchange memo, and the `exchangeGoogleLoginCode` helper; keep only the server-session branch that reads `/api/auth/me`. Remove the now-unused `postGoogleLoginExchange` and `ApiClientError` imports from that page; the `setSessionUser` import stays.
- Remove the `postGoogleLoginExchange` client helper from the auth client module and its re-export from the API barrel; remove the `GoogleLoginExchange` request type from the auth types module — only if used solely by the removed helper (verify before deleting).
- Delete the two stale FastAPI-era credential files at the repo root (the `client_secret_*.json` files carrying `javascript_origins` / `localhost:8001` redirect URIs). They are git-ignored and unread by any code.
- Update the API documentation's Google Login section from "Three endpoints" to "Two endpoints," dropping the exchange bullet.
- Delete the stale "Single-Use Exchange Code" term from the domain glossary (`CONTEXT.md`); the canonical "Server Session" term already describes the live model (DB-backed HttpOnly session cookie; _Avoid_: local-storage JWT). This corrects a pre-existing contradiction — the term claimed a "JWT access token" that issue #6 already removed.
- No schema changes, no new API contracts, no changes to the live `start`/`callback` route handlers, or to the shared token-exchange / ID-token verification service module.
- The Google-facing `redirect_uri` remains the fixed `GOOGLE_LOGIN_REDIRECT_URI` env var; "Authorized redirect URIs" (one per environment) remain required. No change to redirect-URI construction.

## Testing Decisions

- Good tests exercise external behavior at the public HTTP boundary, not implementation details. The single seam is the existing public-API boundary used by the node `--test` suites in `frontend/tests/` (`auth-flows.test.mjs`, `members.test.mjs`, `deployment-routing.test.mjs`), which `fetch` against the running Next.js app.
- Subtractive strategy: (a) remove the three exchange-specific tests; (b) remove the `api/auth/google/login/exchange` entry from the `deployment-routing.test.mjs` route list; (c) keep the existing end-to-end Google login tests (start → callback → session cookie) as the regression guard for the unchanged live flow; (d) add no new test — the endpoint's absence is proven by the static gate.
- Static gate: `npm run type-check` and `npm run build` must pass, ensuring no dangling imports of the removed helper/type. Prior art: the existing `auth-flows.test.mjs` Google login tests and the `deployment-routing.test.mjs` route list.

## Out of Scope

- Removing the dead FastAPI Google-login code in `backend/` (`app/routers/auth.py`, `app/services/google_login_oauth.py`, `tests/test_google_login_oauth.py`, Alembic migration `0012`). This belongs to the separate "retire the legacy `main.py` public app" decision (ADR 0001/0004 + Alembic→TypeORM schema-authority scope). To be filed as a follow-up issue.
- Removing the legacy JWT compatibility shims in the auth client (`storeToken`, `getAuthHeaders`, `LEGACY_JWT_KEY`) — issue #6's bearer→session migration territory, not the exchange path.
- Making the Google-facing `redirect_uri` dynamic. "Authorized redirect URIs" must remain registered per environment; inherent to OAuth web clients.
- Any change to the live `start`/`callback` handlers, PKCE, ID-token verification, session issuance, or cookie paths.

## Further Notes

- Manual action (not code): in the Google Cloud Console, confirm the `thaiperform-member-login` client has an empty "Authorized JavaScript origins" list (the deployed `google_login_client.json` already has no `javascript_origins`). Only "Authorized redirect URIs" is required.
- No ADR warranted: the change removes dead code and fixes a stale glossary entry — reversible from git, unsurprising, not the product of a real trade-off.
- The dead backend Google-login code is the source of the stale `client_secret_940939312136-lcna…json` (`javascript_origins: ["http://localhost:3000"]`, redirect URIs on `localhost:8001`); deleting the stale JSON files severs that link in the working tree.