# Release procedure — Thai Arts Recommender (issue #11)

This directory is the executable release procedure for the production
deployment on `thaiperform` (`C:\Apps\ThaiArtsRecommender`). It locks the
public boundary to the Next.js Application Backend and makes every release
backed up, verified, smoke-tested, and rollback-able.

## Topology being released

```
Browser ──HTTPS──> IIS (web.config) ──> http://127.0.0.1:3000  Next.js (public API + DB + media)
                                          │  internal network + Bearer secret
                                          ▼
                                   backend:8001  Private Model Service (no host port)
                                   postgres:5432 PostgreSQL (no host port)
```

- IIS publishes **only** Next.js (`deployment/web.config` rewrites every
  path to port 3000; nothing targets 8001).
- PostgreSQL and the Private Model Service have **no host-published ports**
  (`deployment/docker-compose.prod.yml` — `expose` only for the model
  service, nothing for postgres). They are reachable only over the internal
  Docker network.
- The `uploads_data` volume is mounted **only** by the Next.js service; the
  model service has no database or media configuration.
- The model service requires the Internal Service Credential
  (`MODEL_SERVICE_SHARED_SECRET` → `RECSYS_INTERNAL_SERVICE_SECRET`); an
  unset secret disables the private contract (503).

## Files

| File | Purpose |
|---|---|
| `backup-and-migrate.ps1` | Pre-release gate: pg_dump + uploads + `.env` backups, TypeORM `migration:run` + `seed` + `migration:verify` |
| `smoke-test.ps1` | Post-deploy gate: model contract, public surface, model-backed recommendation, **fallback check**, network boundary |
| `ROLLBACK.md` | Image / IIS / database / uploads rollback procedure |
| `../web.config` | Version-controlled IIS routing (applied to the IIS site by ops) |
| `../docker-compose.prod.yml` | Deployable topology (postgres + backend + frontend + migrate tool) |

## Release phases

### Phase 0 — Pre-flight (operator)

1. Confirm the stack is running: `docker compose ps`.
2. Record the current image digests and tag them (rollback target):
   ```powershell
   docker compose images --format json > images-before-<date>.json
   docker tag pichaya5502/web_rs_thaiarts-frontend:latest pichaya5502/web_rs_thaiarts-frontend:pre-<date>
   docker tag pichaya5502/web_rs_thaiarts-backend:latest  pichaya5502/web_rs_thaiarts-backend:pre-<date>
   ```
3. Confirm `.env` has a strong `MODEL_SERVICE_SHARED_SECRET` and the
   `POSTGRES_*` credentials.

### Phase 1 — Backup + migrate + verify (BEFORE any routing change)

```powershell
powershell -ExecutionPolicy Bypass -File deployment\release\backup-and-migrate.ps1
```

This produces `backups\thaiarts-db-<stamp>.dump` (custom-format pg_dump),
`backups\thaiarts-uploads-<stamp>.tar.gz`, a `.env` copy, then applies
TypeORM migrations + seed and runs `migration:verify`. **The script fails
when any migration is still pending** — the release must not proceed.

### Phase 2 — Deploy the new images

```powershell
docker compose pull
docker compose up -d
```

`docker compose up -d` recreates only changed containers; PostgreSQL and
`uploads_data` are untouched. The frontend waits for postgres and the model
service to be healthy (`depends_on: condition: service_healthy`).

### Phase 3 — Smoke test (BEFORE routing public traffic)

```powershell
powershell -ExecutionPolicy Bypass -File deployment\release\smoke-test.ps1
```

Checks, in order:

1. Model service `/internal/v1/health` with the credential → 200; without
   the credential → 401.
2. `GET /api/health` → `{status: ok, database: connected}`.
3. `GET /api/items?limit=5` → at least one item.
4. `GET /api/contexts` → at least one context.
5. `POST /api/recommendations` with the model up → 200,
   `metadata.fallback: false`.
6. **Fallback check**: the script stops the model service, re-runs the
   recommendation → 200 with `metadata.fallback: true`, then restarts the
   model service and waits for it to be healthy again.
7. Network boundary: no host listeners on 8001 or 5432.

### Phase 4 — Flip IIS routing (the only public-facing change)

1. Apply the version-controlled `deployment/web.config` to the IIS site
   (URL Rewrite rules: `api/*` and everything else → `http://127.0.0.1:3000`).
2. Recycle the site / `iisreset`.
3. Re-run the smoke test against the public URL
   (`smoke-test.ps1 -FrontendPort 3000` still applies — IIS proxies to the
   same loopback port) and spot-check the site in a browser.

### Phase 5 — Acceptance

Release is accepted when: Phase 1 completed without failure, Phase 3 smoke
test passed, Phase 4 public checks passed. Record the release (image
digests, backup stamps, web.config applied) in the release notes.

### Phase 6 — Rollback

If any phase fails, follow `ROLLBACK.md` (restore previous images, revert
IIS routing, restore the database/uploads backup only if data must be
reverted, re-run the smoke test).

## Notes

- **Never** run `db:rebuild` or `ALLOW_DATABASE_RESET=1` in production —
  the CLI refuses when `NODE_ENV=production`.
- The `migrate` compose service is the only schema-mutation path in
  production; it runs the compiled CLI (`node .db-dist/cli.js`) from the
  frontend image, keeping TypeORM the sole schema authority.
- The smoke test's boundary check (ports 8001/5432) is meaningful only on
  the production host; dev machines with WSL PostgreSQL on 5432 must pass
  `-SkipBoundaryCheck`.
