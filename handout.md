# Handoff Document — Thai Arts Recommender Web App

## File location

`C:\Users\Pichaya\Downloads\web_appRS1\handoff.md`

(Also accessible as `handoff.md` at the project root when next session opens here.)

## Where to start next session

1. **Open the project root**: `C:\Users\Pichaya\Downloads\web_appRS1`
2. **Read `CLAUDE.md`** first — it has the architecture invariants, repo layout, and run commands.
3. **Read this file (`handoff.md`)** for the in-flight context.
4. **Run dev servers** (see Commands section below) and verify the latest feature in a real browser before touching anything.

The user is the admin on this app and uses the running dev server at `http://localhost:3000` against backend at `http://127.0.0.1:8001`. Always reload the browser with `Ctrl+Shift+R` after frontend changes — Next.js HMR sometimes serves stale chunks.

## Current status — Phase 3 (admin dashboard) front + back complete

Phase 3 (Dashboard redesign per `imageRS/dashboard.png`) is **complete**:

- **M1 + M2 (backend)**: migration 0007, `EvaluationRun` ORM, dashboard Pydantic
  schemas, `dashboard_query` service, `GET /metrics/dashboard`,
  recommendation persist + online recompute, offline eval pipeline. 323
  backend tests pass; coverage 86.13% (below the 90% threshold — see
  caveats).
- **M3 (frontend scaffolding)**: `recharts@2.13.0` installed; full Pydantic
  mirror added to `frontend/lib/types.ts`; `getDashboard()` API call with
  admin auth headers in `frontend/lib/api.ts`; full rewrite of
  `frontend/app/(admin)/dashboard/page.tsx` to drive the 6-tile KPI strip
  and the composed Sessions/Searches/Ratings trend chart.
- **M4 (all remaining sections + footer)**: user growth stacked bars + 7×24
  heatmap, categories donut + sub-context horizontal bars, top search table
  + 1-5 star distribution, model quality 5-tile strip + 3-line quality trend
  + 4-bullet checklist, top keywords + search→detail funnel + page quality
  progress bars, recent activity table, footer. ~280 lines of new CSS using
  the existing design tokens. Mobile breakpoints at 1080 / 760 / 480 px.

`tsc --noEmit` is clean across the rewrite; the dev server compiles the new
chunk without errors.

### What changed in this session

1. **`frontend/package.json`** — added `recharts@2.13.0`.
2. **`frontend/lib/types.ts`** — added ~150 lines mirroring backend
   `DashboardOut` and its 14 nested section models (`KpiTile`, `KpiStripOut`,
   `TrendOut`, `UserGrowthOut`, `HeatmapOut`, `CategoryItem/Out`,
   `SubContextItem/Out`, `TopSearchRow/Out`, `RatingDistributionBucket/Out`,
   `ModelQualityOut`, `AlgorithmKpiOut`, `KeywordRow/Out`,
   `PageQualityMetric/Out`, `RecentActivityRow/Out`, top-level `DashboardOut`).
3. **`frontend/lib/api.ts`** — exported `getDashboard(range)` (default `30d`,
   accepts `7d`/`30d`/`90d`/`365d`). Sends `getAuthHeaders()` so the backend
   rejects anonymous callers with 401.
4. **`frontend/app/(admin)/dashboard/page.tsx`** — full rewrite. The previous
   page fetched 6 endpoints in parallel; this one calls a single
   `getDashboard()` and renders all 14 sections through small in-file
   components (kept inline — the existing CSS already names them, so a
   component split buys nothing). Kept the existing
   `.dashboard-hero.researcher-hero` + `.admin-mode-tabs` admin-auth gate,
   added a range selector dropdown to the hero actions.
5. **`frontend/app/globals.css`** — added a `Admin dashboard (Phase 3)` block
   and extended the existing responsive breakpoints to cover the new sections.
   Token colors kept (`--navy-*`, `--gold-*`, `--teal`, `--ink`); no design
   system changes.
6. **Backend process restart** — the running uvicorn (PID 32628) had been
   started before `/metrics/dashboard` was committed. Killed it and restarted
   `python -m uvicorn app.main:app --host 127.0.0.1 --port 8001` so the new
   route is registered. If you see a 404 on `/metrics/dashboard`, restart.

### Working tree status (uncommitted)

```
 M frontend/app/(admin)/dashboard/page.tsx
 M frontend/lib/api.ts
 M frontend/lib/types.ts
 M frontend/app/globals.css
 M handoff.md (this file)
```

Backend Phase 3 changes remain uncommitted in the working tree (same files
noted in the previous handoff). The Phase 3 frontend work above is additive
to that.

### What to verify when the next session opens

1. Backend on `:8001`, frontend on `:3000` — both should already be up.
   If `/metrics/dashboard` returns 404, the backend needs a restart.
2. `cd backend && python -m pytest --no-cov -q` should still show 323 passed.
3. `cd frontend && npx tsc --noEmit` should exit 0.
4. `curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8001/metrics/dashboard | python -m json.tool`
   should return all 14 sections with `source: "postgres"` and
   `range_days: 30`.
5. `python pipelines/run_offline_evaluation.py` from the repo root seeds
   `model_quality.source = "offline"` with real nDCG / HR / MRR / Coverage
   / Violation numbers.
6. **Manual browser smoke** at `http://localhost:3000/dashboard` (login as
   admin first if redirected) — Ctrl+Shift+R to bust HMR cache. Confirm:
   - 6 KPI tiles render with `—` placeholders (live DB has zero telemetry yet)
   - Trend composed chart renders with empty axes and the
     "ยังไม่มีข้อมูล" notice
   - Range selector toggles between 7d/30d/90d/365d and refetches
   - Heatmap renders the 7×6 grid (24h grouped into 4-hour buckets)
   - Donut shows category percentages; sub-context bars show percentages
   - Top search table, rating distribution, recent activity all show
     "ยังไม่มีข้อมูล" placeholders cleanly
   - Quality tiles show `—` until offline eval is run
7. **Next phases** are out of scope for this handoff — Phase 3 acceptance
   is the gate. Wait for direction.

## Commands

### Dev servers

- **Backend** (port 8001): `cd backend && python -m uvicorn app.main:app --host 127.0.0.1 --port 8001`
  (logs go to `backend-dev.log` / `backend-dev.err.log` at repo root when
  started via the project's previous helper, or default stderr otherwise).
- **Frontend** (port 3000): `cd frontend && npm run dev`
- Both should already be running. PID changes after each restart; check
  `netstat -ano | grep :8001` and `:3000` if a server seems hung.

### Tests

- Backend: `cd backend && python -m pytest --no-cov -q` (323 passed, 86.13% coverage)
- Backend with coverage report: `cd backend && python -m pytest --cov=app --cov-report=term-missing -q`
- Frontend type-check: `cd frontend && npx tsc --noEmit`
- Frontend build: `cd frontend && npm run build` (slow on Windows — allow 5+ minutes)

### Offline evaluation

```bash
# from repo root, requires RECSYS_DB_ENABLED=1 in backend/.env
python pipelines/run_offline_evaluation.py
# writes 1 evaluation_runs row + artifacts/outputs/eval/last_offline.json
```

### Backend smoke (Phase 3)

```bash
TOKEN=$(curl -s -X POST http://127.0.0.1:8001/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"hunter22"}' | python -c "import json,sys; print(json.load(sys.stdin)['access_token'])")
curl -s -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:8001/metrics/dashboard?range=30d" | python -m json.tool
```

## Known infra caveats

- **Postgres sequence drift**: `item_contexts.id_seq` out of sync with existing rows (preexisting, not a Phase 2 regression). Re-use existing items when smoke-testing admin actions.
- **Postgres connection timeouts**: dashboard's `recommendation_requests` write sometimes times out; online eval falls back to no-op (no row written).
- **Next.js route groups in Git Bash**: `mv` mishandles paren-named paths — use `PYTHONIOENCODING=utf-8 python -c "import shutil; shutil.move(...)"` instead, or the Windows `cmd //c "move ..."` form.
- **`npm run build` is slow on Windows**: allow 5+ minutes.
- **SQLite test DB lacks `recommendation_request_id` column** (added in migration 0006 to live Postgres only). Tests for `_compute_online_eval_in_session` body cannot exercise the SQL path; cover via the metric math tests in `test_evaluation.py` instead.
- **Coverage threshold 90%** is currently breached (86.13%). Options: add 2-3 more tests in `test_dashboard.py` mocking the SQL fetch, or relax the threshold in `pytest.ini` to 85% with a TODO to restore when 0006 columns are mapped to the ORM.
- **RecommendationService.persist** writes one `evaluation_runs` row per `POST /recommendations`. ~50 ms overhead on 10k recs — acceptable but documented. If it becomes a bottleneck, move recompute to a throttled lazy-recompute on `/metrics/dashboard` read.
- **Zero-state dashboard is the live state** in this session: telemetry is still being seeded, so KPI tiles show `—`, most lists are empty, and `model_quality.source = "unavailable"`. The dashboard renders gracefully; running `pipelines/run_offline_evaluation.py` once will populate the quality tiles with real numbers.
- **uvicorn was not running with `--reload`** when Phase 3 backend work landed, so route additions required a manual process restart. If you add new routes and don't see them, restart `app.main:app` to pick up the registration.
