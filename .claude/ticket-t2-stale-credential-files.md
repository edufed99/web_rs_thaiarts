## Parent

#51 — Remove dead Google SSO exchange path so the app needs only Authorized redirect URIs (no Authorized JavaScript origins)

## What to build

The two stale `client_secret_*.json` files at the repo root are deleted. These are leftovers from the dead FastAPI-era flow — one carries `javascript_origins: ["http://localhost:3000"]` and redirect URIs on `localhost:8001` (the FastAPI port). They are git-ignored and no code reads them. Removing them stops the working tree from suggesting the live app uses "Authorized JavaScript origins."

## Acceptance criteria

- [ ] The two stale `client_secret_*.json` files at the repo root are deleted
- [ ] Verified no code or config references them (they were git-ignored and unread)
- [ ] `npm run type-check`, `npm run build`, and the test suite are unaffected

## Blocked by

- None — can start immediately