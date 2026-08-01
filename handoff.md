# Handoff — Thai Arts Recommender Web App

## Full file location

`C:\Users\Pichaya\Downloads\web_appRS1\handoff.md`

## Start here in the next session

1. Open `C:\Users\Pichaya\Downloads\web_appRS1`.
2. Read project `CLAUDE.md` and this file.
3. **Both servers should already be running.** If `http://127.0.0.1:3000` shows `ERR_CONNECTION_REFUSED`, start them per the recipe below.
4. Postgres runs in **WSL Ubuntu** (not native Windows). Check it before assuming DB queries should work.

## Immediate status: servers running, DB seeded

Verified at end of last session (2026-08-01):

| Component | Where | Status | Verified |
|---|---|---|---|
| Frontend (3000) | Windows + Next.js dev | ✅ running, PID 26720 | HTTP 200, 20KB HTML, all 11 routes render |
| Backend (8001) | Windows + uvicorn --reload | ✅ running | `/health`, `/items`, `/items/{id}`, `/contexts`, `/keywords`, `/metrics`, `/recommendations` all 200 |
| Postgres 18.4 | **WSL Ubuntu**, port 5432 | ✅ running | 19 tables, 114 items, 2534 legacy_interactions, 25 contexts, 574 keywords seeded |
| Port-registry | `C:\Users\Pichaya\.claude\port-registry\` | ✅ recreated | 3 files: `port-registry.md`, `ports.json`, `check-port.ps1` |

## Recipe to restart everything from a cold boot

```bash
# 1. Start Postgres in WSL (if stopped)
powershell -NoProfile -Command "wsl -d Ubuntu -u root -- bash -lc 'service postgresql start'"
# If cluster was never initialized:
powershell -NoProfile -Command "wsl -d Ubuntu -u root -- bash -lc 'pg_lsclusters'"

# 2. Make sure NAT mirror / port routing works from Windows → WSL
powershell -NoProfile -Command "Test-NetConnection -ComputerName 127.0.0.1 -Port 5432"
# If this times out: see "WSL NAT mirror caveat" below.

# 3. Start backend (terminal A)
cd C:\Users\Pichaya\Downloads\web_appRS1\backend
python -m uvicorn app.main:app --reload --port 8001

# 4. Start frontend (terminal B)
cd C:\Users\Pichaya\Downloads\web_appRS1\frontend
npm run dev
```

**`.env` note**: `backend/.env` has `RECSYS_DATABASE_URL=...@172.27.137.178:5432/web_rs_thaiarts`, but `app/db.py` reads env via `os.environ.get` before `pydantic-settings` loads `.env`, so the running backend currently uses the **hardcoded default** `127.0.0.1:5432` (relying on the WSL NAT mirror). Both paths reach the same DB, but if NAT mirror flakes, override on the command line:

```bash
RECSYS_DATABASE_URL="postgresql+psycopg://postgres:postgres@172.27.137.178:5432/web_rs_thaiarts" \
  python -m uvicorn app.main:app --reload --port 8001
```

## WSL NAT mirror caveat (IMPORTANT)

The WSL2 NAT mirror that lets Windows reach WSL Postgres via `127.0.0.1:5432` is **not stable on this machine**. Symptoms:

- `Test-NetConnection -ComputerName 127.0.0.1 -Port 5432` returns `TcpTestSucceeded: False`
- Backend `/items` endpoint times out at exactly 15s (psycopg `connect_timeout=5` × pool retries)
- `netstat -ano` on Windows still shows port 5432 LISTENING, but no packets get through

**Recover by restarting WSL Postgres**:

```bash
powershell -NoProfile -Command "wsl -d Ubuntu -u root -- bash -lc 'service postgresql restart'"
```

Then re-verify:
```bash
powershell -NoProfile -Command "Test-NetConnection -ComputerName 127.0.0.1 -Port 5432"
```

**Permanent fix (not yet applied)**: create `C:\Users\Pichaya\.wslconfig` with:
```ini
[wsl2]
networkingMode=mirrored
```
Then `wsl --shutdown`. This eliminates NAT mirror but requires a WSL restart and may affect other dev tools.

**Alternative**: use `netsh interface portproxy add v4tov4 listenport=5432 listenaddress=127.0.0.1 connectport=5432 connectaddress=172.27.137.178` (requires admin shell). The WSL IP can change on WSL restart, so re-derive with `wsl -d Ubuntu hostname -I`.

## Postgres bootstrap (one-time, already done)

If you ever wipe the DB and need to re-create:

```bash
# Install (WSL Ubuntu)
wsl -d Ubuntu -u root -- bash -c "apt-get install -y postgresql"

# Allow TCP from any host
wsl -d Ubuntu -u root -- bash /mnt/c/Users/Pichaya/Downloads/web_appRS1/artifacts/pg_reconfigure.sh

# Create DB + set password
powershell -NoProfile -Command "wsl -d Ubuntu -u root -- bash -lc 'sudo -u postgres psql -f /mnt/c/Users/Pichaya/Downloads/web_appRS1/artifacts/setup_db.sql'"

# Stamp alembic + create tables + migrate data
cd C:\Users\Pichaya\Downloads\web_appRS1\backend
python -m alembic stamp 0001_baseline
python -c "from app.models_db import Base; from sqlalchemy import create_engine; \
  e=create_engine('postgresql+psycopg://postgres:postgres@127.0.0.1:5432/web_rs_thaiarts', future=True); \
  Base.metadata.create_all(e)"
# Stamp remaining revisions (DDL no-ops because create_all covered it)
for rev in 0002_artifact_item_id 0003_live_actions 0004_admin_users 0005_legacy_autoincrement \
           0006_recommender_history 0007_evaluation_runs 0008_popularity_weights; do
  python -m alembic stamp "$rev"
done

# Drop NOT NULL on artifact_item_id so migrate can insert
powershell -NoProfile -Command "wsl -d Ubuntu -u root -- bash -lc 'sudo -u postgres psql -d web_rs_thaiarts -f /mnt/c/Users/Pichaya/Downloads/web_appRS1/artifacts/fix_artifact_col.sql'"

# Seed legacy data
cd C:\Users\Pichaya\Downloads\web_appRS1
python pipelines/migrate_sqlite_to_postgres.py \
  --sqlite "C:/Users/Pichaya/Downloads/web_appRS/thai_arts_webapp/db.sqlite3" \
  --target-url "postgresql+psycopg://postgres:postgres@127.0.0.1:5432/web_rs_thaiarts" \
  --skip-alembic

# Backfill artifact_item_id + restore NOT NULL
python -c "
from sqlalchemy import create_engine, text
e = create_engine('postgresql+psycopg://postgres:postgres@127.0.0.1:5432/web_rs_thaiarts', future=True)
with e.begin() as c:
    c.execute(text('UPDATE items SET artifact_item_id = id WHERE artifact_item_id IS NULL'))
    c.execute(text('ALTER TABLE items ALTER COLUMN artifact_item_id SET NOT NULL'))
print('OK')
"
```

Expected counts: contexts 25, taxonomy_nodes 48, keywords 574, items 114, item_contexts 993, item_keywords 1077, legacy_interactions 2534.

## Backend bug fix from previous session (already committed)

The previously failing test was fixed in commit `a0b94da4`:
- `PUT /admin/items/{item_id}` now raises `ItemNotFoundError` → HTTP 404 (was `InvalidRequestError` → HTTP 400).
- Coverage 90.43% (gate ≥90% met).
- 433 tests passed.

Do not amend/reset that commit without explicit user instruction. It has not been pushed.

## Alembic schema divergence (warning)

`0001_baseline` is **stamp-only** (no DDL); 0002-0008 expect tables created by legacy `ensure_schema`. We bootstrapped by stamping all revisions after running `Base.metadata.create_all()`, then disabling `NOT NULL` on `items.artifact_item_id` via ad-hoc `ALTER TABLE` before `migrate_sqlite_to_postgres.py` could insert.

**Implication**: the running schema matches the SQLAlchemy models, not the migrations. `alembic upgrade head` is currently a no-op (every revision is stamped). If a future contributor adds a real migration, the schema will be ahead of the migration history. To fix properly, either (a) rewrite `0001_baseline.py` to include full `CREATE TABLE` DDL, or (b) `alembic stamp base` then re-record migrations from the live schema.

## Working-tree state

The repository still has the very large set of pre-existing modified/untracked files from before this session. The artifacts/ subdirectory has 9 new SQL + shell files added by this session (listed below under "New session artifacts"). The `.claude/port-registry/` lives **outside** the repo at `C:\Users\Pichaya\.claude\port-registry\` (global path, do not commit).

Do not use destructive cleanup, reset, or broad staging in this session.

## Product status

Phase B popularity work is complete. **Phase C** remains next, per the prior handoff:

1. Fix the `/items` client-side default `name-asc` sort overriding the server's `match_percent` ranked order.
2. Add the Thai "เรียงตามความนิยม" sort option.
3. Later implement the separate lists: popular, trending, and personalized recommendations.

Do not begin Phase C until the frontend/backend are verified in a real browser. HTTP-level verification passed at end of session; visual verification (open `http://127.0.0.1:3000`) was not performed.

## New session artifacts

Created in `C:\Users\Pichaya\Downloads\web_appRS1\artifacts\`:
- `setup_db.sql` — creates `web_rs_thaiarts` db + sets postgres password
- `fix_artifact_col.sql` — drops `NOT NULL` on `items.artifact_item_id`
- `list_db.sql` — lists databases (used to verify db creation)
- `pg_allow_tcp.sql` — inspects Postgres `config_file` / `hba_file` paths
- `pg_inspect.sh` — pg_hba rules + listen_addresses + TCP connect test
- `pg_reconfigure.sh` — sets `listen_addresses='*'`, adds md5 host rules, restarts cluster
- `pg_tcp_test.sh` — tests TCP connection with `PGPASSWORD`
- `pg_conns.sh` — inspects `pg_stat_activity`

## Port registry

Created at `C:\Users\Pichaya\.claude\port-registry\`:
- `port-registry.md` — human-readable allocation table
- `ports.json` — machine-readable sidecar
- `check-port.ps1` — `FREE | ALLOCATED | IN_USE | CONFLICT` checker

Currently registered: port 3000 (web_appRS1 frontend), port 8001 (web_appRS1 backend).