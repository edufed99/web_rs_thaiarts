# Handoff Document — Thai Arts Recommender Web App

## File location

`C:\Users\Pichaya\Downloads\web_appRS1\handoff.md`

(Also accessible as `handoff.md` at the project root when next session opens here.)

## What we just finished

A series of UI / API / data-quality fixes on the `/admin/items/new` form, ending with **a complete end-to-end image-upload pipeline** for cover photos.

All work has been committed / is in the working tree of `C:\Users\Pichaya\Downloads\web_appRS1`. Use `git status` and `git diff` from that root to see what's pending.

## Where to start next session

1. **Open the project root**: `C:\Users\Pichaya\Downloads\web_appRS1`
2. **Read `CLAUDE.md`** first — it has the architecture invariants, repo layout, and run commands.
3. **Read this file (`handoff.md`)** for the in-flight context.
4. **Run dev servers** (see Commands section below) and verify the latest feature in a real browser before touching anything.

The user is the admin on this app and uses the running dev server at `http://localhost:3000` against backend at `http://127.0.0.1:8001`. Always reload the browser with `Ctrl+Shift+R` after frontend changes — Next.js HMR sometimes serves stale chunks.

## Current state — what's working

- **Backend** (`http://127.0.0.1:8001`):
  - `GET /health` returns 200 with `item_count=115`, `embedding_dim=1024`.
  - JWT auth works (user `admin` / password `hunter22` is seeded as admin via `RECSYS_ADMIN_USERNAMES=admin`).
  - All routers mounted: `health`, `recommendations`, `catalog`, `metrics`, `legacy`, `actions`, `auth`, `admin` + static `StaticFiles` mount on `/uploads/`.
  - New endpoint: `POST /admin/items/{artifact_id}/image` (admin-only, multipart) accepts JPEG/PNG/WebP ≤ 5 MB, persists `items.image_url`, returns `{url, size_bytes, mime, item_id}`.
  - Image files are saved under `<repo_root>/data/uploads/items/<artifact_id>_<uuid>.<ext>` (NOT under `artifacts/` — that's reserved for the offline pipeline per `CLAUDE.md`).
  - `/uploads/items/<filename>` is served by FastAPI's `StaticFiles`.
  - 276 tests pass (`pytest --no-cov`); coverage threshold is 90% but current run skips coverage.

- **Frontend** (`http://localhost:3000`):
  - `/admin/items/new` Step 1 has the full form: name, description, category, performance_type (cascade dropdown), performers_count, duration_minutes, price_text, context (single-select dropdown labeled "โอกาสการแสดง"), keywords, **cover-image file picker with preview**.
  - Two submit buttons: "บันทึกข้อมูล" (direct commit, no Step 2) and "ดูคำสำคัญที่เสนอ" (goes to Step 2 keyword review).
  - Both paths upload the picked image after a successful commit; admin is alerted via `window.alert` if the upload fails (the item is still created).
  - Admin landing page has Top Context Coverage, KPI cards, Artifact Status, Model Parameter sliders, Catalog Coverage Watchlist, and the recommendation trend chart.

## Last user actions / decisions (chronological)

1. Dashboard 401 fix — added `getAuthHeaders()` to `getItems` / `getItem` in `frontend/lib/api.ts`.
2. Dashboard Rules-of-Hooks fix — moved `useMemo(watchlistRows)` above early returns in `frontend/app/dashboard/page.tsx`.
3. Added `performers_count`, `duration_minutes`, `price_text` to the admin create flow (was previously hardcoded to 0/0/"" in `ingest_new_item`):
   - Backend: `ItemDraft` + `ItemCreate` schemas (`backend/app/schemas/admin.py`).
   - Router: `backend/app/routers/admin.py` `_save_draft` + `commit_item` forward these fields.
   - Service: `backend/app/services/ingestion.py` persists them on the `Item` row and on the loader append.
   - Cleanup: `_clean_int` / `_coerce_int` helpers added to `routers/catalog.py` and `routers/admin.py` to coerce pandas NaN / numpy scalars to `int | None` so Pydantic v2.12's `finite_number` validator doesn't reject them.
   - Frontend: `frontend/lib/types.ts` adds the fields; `frontend/components/AdminItemForm.tsx` adds three number/text inputs + a `parseCount` helper.
4. Converted หมวดหมู่ / ประเภทการแสดง / บริบท to dropdowns:
   - Backend: new endpoint `GET /admin/items/facets` (admin-only) returns `category_groups`, `performance_types`, and `category_groups_by_performance_type` cascade map. DB-first, artifact fallback.
   - Frontend: `getItemFacets()` + `ItemFacetsOut` type. Form dropdowns consume it. Defensive fallback to full category list if cascade key missing.
5. Sorted dropdown order so **ประเภทการแสดง comes first**; **หมวดหมู่ cascades** by selected performance_type; auto-clear category if combo becomes stale.
6. Fixed empty-category bug from cascade (Next.js HMR cache) — defensive fallback + restart of Next.js dev server.
7. Converted "โอกาสการแสดง" from `<select multiple>` (Ctrl/⌘ required) to **single-select** matching the ประเภทการแสดง pattern.
8. Removed `· group` suffix from context dropdown — now shows sub-context name only.
9. **Image upload pipeline** (this last batch — the one to verify):
   - `backend/requirements.txt`: `python-multipart>=0.0.7` added.
   - `backend/app/core/config.py`: `upload_dir` (default `<repo_root>/data/uploads`), `max_upload_bytes=5*1024*1024`, `allowed_upload_mime={image/jpeg,image/png,image/webp}`, `IMGHDR_TO_MIME` mapping.
   - `backend/app/services/storage.py` (new): `sniff_mime`, `save_upload`, `delete_upload` (path-traversal safe).
   - `backend/app/schemas/admin.py`: `ItemImageUploadOut`.
   - `backend/app/routers/admin.py`: `POST /admin/items/{artifact_id}/image`. Also calls `_update_loader_row` with `image_url` (fixes pre-existing loader-drift bug where the legacy `PUT /admin/items/{id}` silently dropped `image_url` into the in-memory catalog).
   - `backend/app/main.py`: `app.mount("/uploads", StaticFiles(...))` + lifespan creates `upload_dir/items/` at startup.
   - `frontend/lib/types.ts`: `ItemImageUploadOut`.
   - `frontend/lib/api.ts`: `uploadItemImage(artifactId, file)` (FormData + `getAuthHeaders()`, no Content-Type override).
   - `frontend/components/AdminItemForm.tsx`: file picker with `accept="image/jpeg,image/png,image/webp"`, client-side size + MIME pre-check, thumbnail via `URL.createObjectURL`, revoke on unmount, post-commit upload round-trip in both `handleSave` and `handleCommit`.
   - `backend/tests/test_admin.py`: 3 new tests (`test_upload_image_rejects_oversize`, `test_upload_image_rejects_wrong_magic`, `test_upload_image_succeeds`).

## Known infra caveats (not bugs in our code)

- **Postgres sequence drift**: DB instance has `item_contexts.id_seq` out of sync with existing rows — newly-ingested items sometimes hit `duplicate key value violates unique constraint "item_contexts_pkey"`. Workaround when smoke-testing: re-use existing items, or reset the sequence. Not a regression from any change in this session.
- **Connection timeouts**: Postgres at `127.0.0.1:5432` sometimes times out when the backend tries to write `recommendation_requests` from the dashboard. The chart falls back to zero-filled buckets and the UI stays usable.
- **`curl` multipart on Git Bash**: `curl` 8.7 on Git Bash fails with error 26 when posting multipart via `-F` to localhost. Use `urllib.request` (Python) or `curl` from cmd.exe for smoke tests instead.

## Commands

### Dev servers

- **Backend** (port 8001): from `backend/`, `python -m uvicorn app.main:app --port 8001` (the user prefers a background process; check the latest PID via `netstat -ano | grep :8001` if it seems hung).
- **Frontend** (port 3000): from `frontend/`, `npm run dev`.
- Restart either by killing the PID (`cmd //c "taskkill /PID <pid> /F"`) and re-launching from the right cwd.

### Tests

- Backend: `cd backend && python -m pytest tests/test_admin.py --no-cov -q` (or drop `--no-cov` to satisfy the 90% threshold; current full suite = 276 passed).
- Frontend type-check: `cd frontend && npx tsc --no-emit`.

### Smoke test (curl)

```
TOKEN=$(curl -s -X POST -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"hunter22"}' \
  http://127.0.0.1:8001/auth/login | python -c "import json,sys;print(json.load(sys.stdin)['access_token'])")
curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8001/admin/items/facets
```

For multipart upload tests, prefer Python `urllib.request` over `curl -F` (see infra caveat above).

## What to verify first thing in the new session

1. Both dev servers still running and reachable (`/health` on backend, `http://localhost:3000/` on frontend).
2. Open `http://localhost:3000/admin/items/new` in a browser — confirm the file picker renders under "โอกาสการแสดง".
3. Try uploading a small JPEG/PNG/WebP and clicking "บันทึกข้อมูล" — verify redirect to `/items/{id}` and the image renders.
4. Try a 6 MB file or a `.exe` renamed to `.jpg` — verify the inline error message appears before submit, and the backend rejects it with the right code if the upload does reach the server.

If anything is broken, fix forward — the architecture and code paths are stable; only the live DB and dev-server processes may have drifted.