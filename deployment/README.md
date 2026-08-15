# Production deployment handoff

The production application directory, `C:\Apps\ThaiArtsRecommender`, retains
only the deployed `docker-compose.yml`, `.env`, and persistent Docker volumes.
Do not copy repository source, tests, or IIS configuration into that directory.

[`web.config`](web.config) is the version-controlled source for the host-IIS
routing rules. Since issue #10 the Next.js Application Backend owns the
entire public API surface: every `api/*` request is rewritten to port 3000
and nothing targets the FastAPI port (8001). FastAPI runs as the Private
Model Service on the internal Docker network only — it is never exposed by
the host reverse proxy and requires the Internal Service Credential.

Since issue #11 the network boundary is locked in the compose topology
itself: [`docker-compose.prod.yml`](docker-compose.prod.yml) publishes **no
host ports** for PostgreSQL or the model service (internal network only;
the model service uses `expose`), and the `uploads_data` volume is mounted
only by the Next.js service. The model service does not load the shared
`.env` — every variable it reads is declared explicitly, so it provably has
no database or media configuration. The only host-published port is
`127.0.0.1:3000` for the IIS reverse proxy.

## Release procedure (issue #11)

The executable release procedure lives in [`release/`](release/README.md):

1. **Pre-flight** — record image digests, tag the running images as the
   rollback target.
2. **Backup + migrate + verify** — `release/backup-and-migrate.ps1`
   (pg_dump + uploads + `.env` backups, TypeORM `migration:run` + `seed` +
   `migration:verify`; fails while any migration is pending).
3. **Deploy** — `docker compose pull && docker compose up -d`.
4. **Smoke test** — `release/smoke-test.ps1` (model contract with/without
   the credential, public surface, model-backed recommendation, **fallback
   check** with the model service stopped, network boundary).
5. **Flip IIS routing** — apply `web.config` to the IIS site.
6. **Rollback** — `release/ROLLBACK.md` (previous images, IIS revert,
   database/uploads restore only when data must be reverted).

The FastAPI container's health check verifies the private contract
(`/internal/v1/health` with the shared secret) instead of a public probe.
