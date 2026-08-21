# Production deployment handoff

The production application directory, `C:\Apps\ThaiArtsRecommender`, retains
only the deployed `docker-compose.yml`, `.env`, nginx config under `nginx\`,
and persistent Docker volumes. Do not copy repository source or tests into
that directory.

The public reverse proxy is **nginx + certbot in Docker**
([`nginx/`](nginx/README.md)): nginx publishes host `80`/`443`, terminates
HTTPS with a Let's Encrypt cert (for `thaiperform.fed.bpi.ac.th`) managed by
certbot, and proxies every path — pages and `/api/*` — to the Next.js
frontend over the internal Docker network (`frontend:3000`). Since issue #10
the Next.js Application Backend owns the entire public API surface; nothing
targets the FastAPI port (8001). FastAPI runs as the Private Model Service on
the internal Docker network only — it is never reached by the reverse proxy
and requires the Internal Service Credential. IIS `W3SVC` is stopped and
disabled on the host (`ftpsvc`/FTP on port 990 is left running);
[`web.config`](web.config) is kept in the repo as the **IIS-rollback
artifact** (see [`release/ROLLBACK.md`](release/ROLLBACK.md)).

Since issue #11 the network boundary is locked in the compose topology
itself: [`docker-compose.prod.yml`](docker-compose.prod.yml) publishes **no
host ports** for PostgreSQL or the model service (internal network only;
the model service uses `expose`), and the `uploads_data` volume is mounted
only by the Next.js service. The model service does not load the shared
`.env` — every variable it reads is declared explicitly, so it provably has
no database or media configuration. The host-published ports are nginx
`80`/`443` (public) and Next.js `127.0.0.1:3000` (loopback, IIS-rollback
path).

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
5. **Flip the public reverse proxy** — if nginx is not yet deployed, follow
   [`nginx/README.md`](nginx/README.md) (stop+disable IIS W3SVC, start
   `nginx`, issue the Let's Encrypt cert, swap to steady-state, start
   `certbot`). For app-only releases nginx already proxies to `frontend:3000`
   and needs no change.
6. **Rollback** — `release/ROLLBACK.md` (previous images, nginx/IIS revert,
   database/uploads restore only when data must be reverted).

The FastAPI container's health check verifies the private contract
(`/internal/v1/health` with the shared secret) instead of a public probe.
