# Rollback procedure — Thai Arts Recommender (issue #11)

This document is the release rollback plan. It is executed by the operator
on the production host (`thaiperform`, target `C:\Apps\ThaiArtsRecommender`)
when a release fails acceptance (smoke test failure, regression, or
incident) and the previous release must be restored.

## 0. Principles

- **Retain prior images before every deploy.** `docker compose pull` replaces
  the local `:latest` tags, so the previous release must be captured *before*
  pulling. The pre-release procedure (see `README.md` in this directory)
  records image digests; keep the recorded digests with the release notes.
- **The database is the crown jewel.** A rollback that restores old images
  against a migrated database is usually fine (TypeORM migrations are
  additive); a rollback that needs the pre-release data uses the
  `pg_dump` backup from `backup-and-migrate.ps1`.
- **The public reverse proxy is the last thing to change and the first
  thing to revert.** nginx + certbot (Docker) is the live proxy on host
  80/443; `deployment/web.config` is the IIS-rollback artifact kept in the
  repo. Keep a dated copy of the applied configuration on the server.

## 1. Before every deploy (pre-flight, mandatory)

```powershell
# Record the currently running image digests — this is the rollback target.
docker compose images --format json > images-before-<date>.json
# Optionally tag the running images so the previous release survives a pull.
docker tag pichaya5502/web_rs_thaiarts-frontend:latest pichaya5502/web_rs_thaiarts-frontend:pre-<date>
docker tag pichaya5502/web_rs_thaiarts-backend:latest  pichaya5502/web_rs_thaiarts-backend:pre-<date>
# Keep a dated copy of the applied IIS configuration (only if IIS is still
# the live proxy — skipped once nginx is the proxy).
Copy-Item C:\Windows\System32\inetsrv\config\applicationHost.config .\iis-applicationHost-<date>.config
```

Then run `deployment\release\backup-and-migrate.ps1` (database + uploads +
`.env` backups, migrations, `migration:verify`).

## 2. Rollback triggers

Roll back when any of these fails after a deploy:

1. `deployment\release\smoke-test.ps1` reports failures.
2. The public site (through nginx) returns 5xx for core journeys
   (`/api/health`, catalogue browse, recommendations).
3. A regression is confirmed in auth, member journeys, admin, or analytics.

## 3. Rollback steps

### 3.1 Revert the application images

```powershell
cd C:\Apps\ThaiArtsRecommender

# Option A — pinned tags were created in pre-flight (recommended):
docker tag pichaya5502/web_rs_thaiarts-frontend:pre-<date> pichaya5502/web_rs_thaiarts-frontend:latest
docker tag pichaya5502/web_rs_thaiarts-backend:pre-<date>  pichaya5502/web_rs_thaiarts-backend:latest
docker compose up -d

# Option B — no tags were created: re-pull the previous digests recorded in
# images-before-<date>.json, then re-tag them as :latest and `up -d`.
```

`docker compose up -d` recreates only the containers whose image changed;
PostgreSQL and the `uploads_data` volume are untouched.

### 3.2 Revert the public reverse proxy (nginx → IIS) — only if the proxy itself is at fault

The default rollback keeps nginx (it proxies to `frontend:3000`, so reverting
the app images in 3.1 is enough). Revert the proxy to IIS only when nginx or
the cert is the cause of the incident:

```powershell
cd C:\Apps\ThaiArtsRecommender
docker compose stop nginx
# Re-enable IIS W3SVC so it reclaims host 80/443.
Set-Service W3SVC -StartupType Automatic
Start-Service W3SVC
# If the http.sys sslcert binding on 0.0.0.0:443 was deleted during the
# nginx cutover, re-bind it (netsh http add sslcert …) or re-add the cert
# via the IIS manager before starting W3SVC.
```

`deployment/web.config` is unchanged in the repo and on the server
(`C:\inetpub\wwwroot\web.config`): it rewrites every path to
`http://127.0.0.1:3000` (Next.js) and never to 8001, so re-enabling IIS
restores the previous routing. Verify with
`deployment\release\smoke-test.ps1`.

> Note: IIS HTTPS used a now-broken cert (the reason nginx+certbot replaced
> it). Reverting to IIS restores HTTP only until a valid IIS cert is bound.

### 3.3 Restore the database (only when data must be reverted)

TypeORM migrations are additive and the Application Backend is
backward-compatible with the previous image, so **most rollbacks do not
need a database restore**. Restore only when the release corrupted or
migrated data that must be undone:

```powershell
# From the backup produced by backup-and-migrate.ps1:
$Dump = Get-ChildItem .\backups\thaiarts-db-*.dump | Sort-Object Name -Descending | Select-Object -First 1

# Option A — restore into the existing database (drops and recreates objects):
docker compose exec -T postgres pg_restore -U postgres -d web_rs_thaiarts --clean --if-exists -Fc < $Dump.FullName

# Option B — full reset (recommended when the schema itself must be reverted):
docker compose exec -T postgres psql -U postgres -c "DROP DATABASE IF EXISTS web_rs_thaiarts WITH (FORCE);"
docker compose exec -T postgres psql -U postgres -c "CREATE DATABASE web_rs_thaiarts OWNER postgres;"
docker compose exec -T postgres pg_restore -U postgres -d web_rs_thaiarts -Fc < $Dump.FullName
```

> Note: `pg_restore` reads the dump from stdin; on Windows PowerShell use
> `cmd /c "docker compose exec -T postgres pg_restore ... < dump.dump"` if
> redirection misbehaves, or copy the dump into the container first
> (`docker compose cp dump.dump postgres:/tmp/` then restore from
> `/tmp/dump.dump`).

### 3.4 Restore the uploads volume (only when media must be reverted)

```powershell
$Tar = Get-ChildItem .\backups\thaiarts-uploads-*.tar.gz | Sort-Object Name -Descending | Select-Object -First 1
docker run --rm -v thaiarts_uploads_data:/data -v "$(Resolve-Path .\backups):/backup" alpine sh -c "rm -rf /data/* && tar xzf /backup/$($Tar.Name) -C /data"
```

### 3.5 Verify the rollback

```powershell
powershell -ExecutionPolicy Bypass -File deployment\release\smoke-test.ps1
```

The smoke test must pass (model contract, public surface, fallback, network
boundary) before the rollback is declared complete.

## 4. Post-rollback

- Record the rollback in the release notes: date, trigger, images reverted
  to (digests), whether the database/uploads were restored.
- Do not re-attempt the failed release until the root cause is fixed and
  re-tested; a rollback is not a fix.
