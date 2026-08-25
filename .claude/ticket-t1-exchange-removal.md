## Parent

#51 — Remove dead Google SSO exchange path so the app needs only Authorized redirect URIs (no Authorized JavaScript origins)

## What to build

The member Google SSO flow becomes honestly single-path. The dead `POST /api/auth/google/login/exchange` JSON route is removed entirely. The Google callback page keeps only the server-session branch (the one that reads `/api/auth/me`); the legacy direct-code branch, its exchange memo, and the `exchangeGoogleLoginCode` helper are removed, along with the now-unused imports. The `postGoogleLoginExchange` client helper (and its re-export from the API barrel) and the `GoogleLoginExchange` request type are removed — only if used solely by the exchange path; verify no other caller first. The exchange-specific tests and the routing-test entry are removed. The live sign-in flow (start → Google → callback → DB-backed server session) is unchanged and must still pass end-to-end.

This slice is atomic: removing only part of it leaves dangling imports that fail `type-check`/`build`, so it lands as one change.

## Acceptance criteria

- [ ] `POST /api/auth/google/login/exchange` no longer exists (the route directory is gone; the request 404s)
- [ ] The Google callback page has only the server-session branch; no legacy direct-code branch, exchange memo, or exchange helper remains
- [ ] The `postGoogleLoginExchange` client helper, its API-barrel re-export, and the `GoogleLoginExchange` request type are removed (verified no other callers first)
- [ ] The exchange-specific tests in `auth-flows.test.mjs` and `members.test.mjs` are removed
- [ ] The `api/auth/google/login/exchange` entry is removed from the `deployment-routing.test.mjs` route list
- [ ] `npm run type-check` and `npm run build` pass with no dangling references
- [ ] The existing end-to-end Google login tests (start → callback → session) still pass

## Blocked by

- None — can start immediately