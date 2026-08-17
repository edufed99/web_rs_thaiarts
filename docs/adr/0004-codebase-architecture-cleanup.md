# ADR-0004: Codebase Architecture Cleanup — Cluster Extraction, Shim Removal, and Cross-Cutting Deduplication

**Status:** Accepted
**Date:** 2026-08-16
**Scope:** Reduce maintainability friction in `backend/app/` and `frontend/lib/` by extracting misplaced clusters, removing backward-compatibility shims, and deduplicating cross-cutting helpers — without changing observable behaviour.

---

## 1. Context and Problem

ADR-0003 consolidated the Python backend into deep modules (`CatalogueModule`, `MemberIdentityModule`, etc.). That pass left the codebase with new structural friction:

1. **Over-grown deep modules.** `identity.py` (1,102 lines) mixes three unrelated concerns: remote-avatar media caching (`mirror_google_avatar`), schema mapping (`user_to_out`, `_profile_payload`), and FastAPI dependency glue (`get_current_user`, `get_current_admin`).
2. **Backward-compatibility shims.** `services/user_query.py` is a pure 76-line re-export of `identity.py` (33 symbols), retained only so old callers keep working. `identity.py` further layers a monkeypatch-detection indirection over `user_query` → `db` for `session_scope`/`is_db_enabled`, the most fragile coupling in the service layer.
3. **Cross-cutting duplication.** ItemOut assembly exists in three near-copies (`ingestion._item_out_from_session`, `catalogue._db_row_to_item_out`/`_row_to_item_out`, `recommendation_service._build_item_out`); `_taxonomy_paths_by_id` is duplicated verbatim in `catalogue.py` and `routers/metrics.py`.
4. **Misplaced concerns.** `recompute_online_eval` (an evaluation/telemetry concern) lives in `dashboard_query.py`; `routers/metrics.py` (docstring: "auxiliary read-only endpoints") contains inline SQL and a write endpoint (`PUT /metrics/popularity/weights`).
5. **Frontend monoliths.** `lib/api.ts` (920 lines, 63 exports across 10 endpoint domains) and `lib/types.ts` (838 lines) grew organically; `types.ts` declares `KeywordListOut` twice (L102/L716), and TypeScript interface merging silently combines them into a wrong type for both consumers.
6. **Stale documentation.** `CLAUDE.md` claims "102 tests" (actual: 624) and omits the auth/admin/member/actions subsystems added since it was written.

---

## 2. Decisions

We adopt a **cluster-extraction, not wholesale-module-split** strategy: only extract where a clean seam already exists, and keep each deep module coherent per ADR-0003.

### 2.1 Backend — remove the `user_query.py` shim (do this first)
* Delete `services/user_query.py` and update its four app-code importers (`routers/member.py`, `routers/admin.py`, `routers/auth.py`, `services/auth.py`) and five test files to import from `services/identity` directly.
* This is sequenced as expand–contract: nothing new is introduced; callers migrate in one batch, then the shim is deleted.

### 2.2 Backend — standardize session dispatch
* Replace `identity.py`'s monkeypatch-detection `session_scope`/`is_db_enabled` with the same direct `db.session_scope()`/`db.is_db_enabled()` delegation `catalogue.py` already uses.
* Move test monkeypatching of these two symbols to `app.db` (already the dominant pattern — 11 test files patch `app.db` today).

### 2.3 Backend — extract misplaced clusters from `identity.py`
* `mirror_google_avatar` → `services/storage.py` (it already calls `storage.save_remote_image`/`delete_upload`/`is_allowed_remote_image_url`).
* `user_to_out`/`_profile_payload` → the schemas layer (schema mapping, not identity domain logic).
* `get_current_user`/`get_current_admin` → auth-router dependency module (FastAPI `Depends`/`Header` glue).
* The remaining 1,100-line module stays a deep module per ADR-0003; no further subdivision.

### 2.4 Backend — shared `ItemOut` mapper
* Consolidate the three ItemOut-assembly implementations into one shared mapper (e.g. in `schemas/item.py` or a small `services/item_out.py`), keyed by Artifact Item Identifier, and have `ingestion`, `catalogue`, and `recommendation_service` call it.

### 2.5 Backend — `_taxonomy_paths_by_id` single source
* Move the verbatim duplicate from `routers/metrics.py` into the shared read side (`catalogue.py` or `db_query.py`) and import it.

### 2.6 Backend — `metrics.py` router cleanup
* Relocate inline SQL helpers (`_db_metric_counts`, `_db_keywords`, `_context_metadata_by_name`, `_taxonomy_paths_by_id`) into `db_query.py`/`catalogue.py`.
* Move `recompute_online_eval` (and `_compute_online_eval_in_session`, `_log2`) from `dashboard_query.py` into an evaluation/telemetry module (its callers are the recommendations router, not the dashboard read path).
* Split the write endpoint (`PUT /metrics/popularity/weights`) out of the read-only metrics surface into the admin router.

### 2.7 Frontend — split `lib/api.ts` by endpoint domain
* Extract `lib/catalog.ts`, `lib/member.ts`, `lib/admin.ts`, `lib/auth.ts`; the core `api.ts` keeps the shared fetch helpers (`baseUrl`, `handle`, `actionBody`, `memberParams`) and **re-exports** every public symbol so the 30 importing pages/components need no import changes.
* Move `resolveImageUrl`/`getBaseUrl` → `lib/urls.ts`; `ApiClientError` → `lib/errors.ts`.

### 2.8 Frontend — fix `KeywordListOut` collision and split `types.ts`
* Fix the duplicate `KeywordListOut` declaration immediately (rename the dashboard one to e.g. `TopKeywordListOut`).
* Split `types.ts` into domain files mirroring the api.ts split (catalog, member, auth, admin, dashboard, analytics), re-exporting from a barrel so consumers need no changes.

### 2.9 Frontend — extract sub-components
* `AdminItemForm.tsx` (776 lines): extract a `useCoverImage` hook and `DraftStep`/`ReviewStep` render units (the two steps render completely different forms).
* `AdminContextSelector.tsx` (425 lines): extract the self-contained create-context form (`CreateContextForm`).

### 2.10 Documentation
* Update `CLAUDE.md` (test counts, repository layout, auth/admin/member/actions subsystems, endpoint tables) in the same change set.

---

## 3. Consequences and Invariants

* **Behaviour-neutral refactor.** No endpoint, schema, or ranking behaviour changes; 613+ backend tests + ≥90% coverage + frontend type-check + production build must stay green at every step.
* **Import stability for the frontend.** Re-export barrels keep all 30 `lib/api` consumers compiling without edit; only new code uses the domain modules directly.
* **One source of truth.** ItemOut assembly, taxonomy-path resolution, and session dispatch each have exactly one implementation.
* **Cleaner layering.** Routers no longer contain inline SQL; write endpoints leave the read-only metrics surface; telemetry/evaluation leaves the dashboard query module.
* **Removed indirection.** The `user_query` shim and `identity.py`'s monkeypatch-detection layer are gone; tests patch `app.db` uniformly.
* **Non-goals.** This ADR does not re-open ADR-0001 (Next.js application-backend / private model service) or ADR-0003 (deep-module boundaries). Cluster extraction here operates *within* the deep modules ADR-0003 created.
