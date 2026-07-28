# Handoff Document — Thai Arts Recommender Web App Refactor

**Saved to:** `C:\Users\Pichaya\Downloads\web_appRS1\handoff.md`

**Date:** 2026-07-28 (session 4 — admin ingest + auth + layered grounding)
**From:** Claude Code session (preceding conversation)
**To:** Next Claude Code session — **เริ่มทำ phase H**

---

## What this project is

A **new web app** at `C:\Users\Pichaya\Downloads\web_appRS1\` that refactors the legacy Django prototype at `C:\Users\Pichaya\Downloads\web_appRS\thai_arts_webapp\` (read-only — never modify). The new app uses **Next.js 14 + TypeScript** (frontend) and **Python FastAPI** (backend) with **PostgreSQL** (live user data) and pre-built **artifacts** (static ML model files).

The thesis paper (`C:\Users\Pichaya\Downloads\web_appRS\paper_thesis.docx`) prescribes an **Eligibility-Gated Hybrid** recommender with Gemini-based stopword filtering, taxonomy construction, exact-token grounding, and Hybrid-WeightedSum scoring. See `docs/adr.md` for the full Architecture Decision Record.

---

## What changed in session 4 (this handoff)

| Slice | Status |
|---|---|
| **Auth** — `users` table + bcrypt + JWT (HS256, 7-day) + `POST /auth/{signup,login}` + `GET /auth/me` | ✅ |
| **Live ingest** — admin form (1 item at a time) → `services/ingestion.ingest_new_item` orchestrator | ✅ |
| **E5 embedding runtime** — lazy-loaded `multilingual-e5-large-instruct` (downloads ~2.5 GB on first ingest) | ✅ |
| **Layer A** rule grounding — exact + substring + token-set Jaccard (≥ 0.34) | ✅ |
| **Layer B** LLM grounding — Gemini API with JSON-schema response | ✅ |
| **ArtifactLoader.append_item()** — in-process mutation under `threading.Lock()` | ✅ |
| **`POST /admin/items/draft`** — returns `draft_id` + Layer A/B proposals | ✅ |
| **`POST /admin/items`** — Layer C commit (admin edits + ingest) | ✅ |
| **`POST /admin/items/{id}/keywords`** — Layer C re-edit existing | ✅ |
| **JWT swap** — `actions`, `catalog` routers accept `Authorization: Bearer <jwt>` | ✅ |
| **Tests** — 248 tests, **90.48% coverage** (gate ≥ 90% ✅) | ✅ |
| **Docs** — ADR §3 + §11.1 update (admin ingest + auth in scope) | ⏳ deferred to Phase I |

**Tests:** **248 passing**, **90.48% coverage** (was 161 / 93.05%).

**Uncommitted:** see `git status` — many new files (see "Files to start with" below).

---

## Where to start (next session — Phase H frontend)

The next session will execute **Phase H (frontend)** from the plan at `C:\Users\Pichaya\.claude\plans\bubbly-finding-patterson.md`. Read that plan first; the relevant Phase H steps are 25-35:

1. `frontend/lib/auth.ts` — JWT storage + `getCurrentUser` + `getAuthHeaders`
2. `frontend/lib/types.ts` additions — 7 new types mirroring backend
3. `frontend/lib/api.ts` — `postSignup`, `postLogin`, `getMe`, `postItemDraft`, `postItemCommit`, `putItemKeywords`
4. `frontend/components/AuthForm.tsx` — username/password form
5. `frontend/components/AdminItemForm.tsx` — two-step draft + commit
6. `frontend/app/login/page.tsx`, `frontend/app/signup/page.tsx`
7. `frontend/app/admin/items/new/page.tsx` — auth-guarded wrapper
8. `frontend/app/admin/items/page.tsx` — list view
9. `frontend/app/layout.tsx` + new `frontend/components/FrontendNav.tsx` — conditional nav
10. `frontend/components/ItemActionBar.tsx` + 4 pages — pass `authHeaders()`

After Phase H, Phase I (docs) updates ADR §3 + §11.1.

---

## Architecture invariants being relaxed (in this session)

- **ADR §3 line 97** ("backend reads artifacts") → **broadened**: admin ingest may rebuild embeddings at runtime via `services.embedding.encode_item_text` and call `ArtifactLoader.append_item()` under a `threading.Lock()`. CSV files are never read at serving or ingest time. **Update still pending in `docs/adr.md` (Phase I).**
- **ADR §11.1** ("authentication out of scope") → **inverted**: auth is now in scope. Catalog browse still accepts `anon:<uuid>`. All writes (`/actions/*`, `/admin/*`) require `Authorization: Bearer <jwt>`. **Update still pending in `docs/adr.md` (Phase I).**
- **CLAUDE.md** schema rules preserved: every new column/table goes through Alembic; `models_db.py` mirrors the latest revision. `BigAutoPK` rule applies to the new `users` table.
- **`ArtifactLoader` mutability**: the existing `@dataclass` lacks `frozen=True`, so `append_item()` is legal. All existing properties continue to return copies; lifespan path of `main.py:35-56` is unchanged.

---

## Critical files to know

**Backend — new**

- `backend/migrations/versions/0004_admin_users.py` — `users` table (BigAutoPK PK, unique username, password_hash, display_name, is_admin, created_at, last_login_at) + `ix_users_username` index. Down-revision: `0003_live_actions`.
- `backend/app/schemas/user.py` — `UserSignup`, `UserLogin`, `UserOut`, `TokenOut`. Validators strip whitespace.
- `backend/app/schemas/admin.py` — `ItemDraft`, `ItemCreate`, `KeywordProposal`, `ItemDraftOut`, `ItemCommit`, `ItemCommitOut`, `ItemKeywordReassign`, `ItemReassignOut`.
- `backend/app/routers/auth.py` — `POST /auth/signup`, `POST /auth/login`, `GET /auth/me`. 1st user (or `RECSYS_ADMIN_USERNAMES` members) → `is_admin=True`.
- `backend/app/routers/admin.py` — `POST /admin/items/draft`, `POST /admin/items`, `POST /admin/items/{id}/keywords`. Drafts cached in module-level `_drafts: Dict[str, Dict]` (TTL 30 min).
- `backend/app/routers/_user_key.py` — `resolve_user_key(user, body_user_key)` translates JWT → `"user:<id>"` or anon → `"anon:<uuid>"`.
- `backend/app/services/auth.py` — bcrypt (`hash_password`/`verify_password`) + PyJWT (`create_token`/`decode_token`). `get_current_user` (Optional) + `get_current_admin` (raises 403).
- `backend/app/services/embedding.py` — `_ensure_model()` lazy-loads E5 (~2.5 GB). `encode_text`/`encode_query`/`encode_item_text` prepend `passage:` / `query:` per E5 instruct. `build_item_text` mirrors `pipelines/train_or_generate_artifacts.build_item_text` byte-for-byte.
- `backend/app/services/grounding.py` — `load_vocab`, `auto_ground_keywords` (Layer A), `llm_ground_keywords` (Layer B), `ground_keywords` (combined). Module-level vocab cache.
- `backend/app/services/ingestion.py` — `ingest_new_item(item_create, *, admin_user)`: compute embedding OUTSIDE lock → acquire `get_lock()` → DB insert → `loader.append_item` → release.
- `backend/app/services/user_query.py` — `find_user_by_username`, `create_user`, `set_last_login`, `find_user_by_id`, `list_users`. First-user-bootstrap rule: no `admin_usernames` allow-list → first user becomes admin.

**Backend — modified**

- `backend/app/main.py` — register `auth.router` + `admin.router`.
- `backend/app/model_loader.py` — added `append_item(...)` mutation method + module-level `_loader_lock = threading.Lock()` + `get_lock()` helper.
- `backend/app/core/config.py` — new fields: `jwt_secret`, `jwt_expiry_days=7`, `admin_usernames=[]`, `e5_model_name`, `e5_max_length=512`, `e5_local_path`, `e5_enabled=True`, `gemini_api_key`, `gemini_model="gemini-3-flash-preview"`, `grounding_use_llm=True`.
- `backend/app/core/exceptions.py` — added `AuthError(401)` + `ForbiddenError(403)`.
- `backend/app/models_db.py` — appended `User` ORM.
- `backend/app/routers/actions.py` — all 5 endpoints accept `Depends(get_current_user_dep)`; translate to `user_key = f"user:<id>"` when authenticated; fallback to `anon:<uuid>` body.
- `backend/app/routers/catalog.py` — `GET /items`, `GET /items/{id}` resolve JWT or anon via `_user_key.resolve_user_key`.
- `backend/requirements.txt` — added `bcrypt>=4.1.0`, `pyjwt>=2.8.0`, `cryptography>=42.0.0`, `sentence-transformers>=3.0.0`, `torch>=2.1.0`, `google-generativeai>=0.7.0`, `pythainlp>=4.0.0`.

**Tests — new**

- `backend/tests/test_user_query.py` (10) — DB-layer CRUD + first-user-admin + allow-list mode + disabled-DB no-ops.
- `backend/tests/test_auth.py` (12) — bcrypt round-trip, JWT round-trip + expired/bad-sig, signup/login/me flows, duplicate username.
- `backend/tests/test_user_key.py` (9) — JWT-vs-anon resolution edge cases.
- `backend/tests/test_embedding.py` (10) — shape/L2/format/lazy-cache; embedding mocked via `_FakeModel`.
- `backend/tests/test_grounding.py` (18) — Layer A (exact/substring/Jaccard/dedup/stopword-skip), Layer B (no-key/use-llm-false/happy/malformed/exception), merged flow, vocab loader.
- `backend/tests/test_ingestion.py` (7) — DB insert, loader append, duplicate name, empty name, missing context, DB disabled, loader not loaded, keyword join rows.
- `backend/tests/test_admin.py` (12) — auth required, draft returns proposals, commit creates item, unknown draft, draft expired, reassign keywords, non-admin user rejected.

**Tests — modified**

- `backend/tests/test_core.py` — `cors_origins` default updated to `[localhost:3000, 127.0.0.1:3000]`.
- `backend/tests/test_catalog.py` — all `/items` + `/items/{id}` calls now pass `?user_key=anon:test` (because of JWT gate).

---

## Repository layout (current — top-level)

```
.
├── README.md / CLAUDE.md / handoff.md
├── docs/                          adr.md (needs update — Phase I), api.md, comparison.md
├── pipelines/
│   ├── train_or_generate_artifacts.py
│   └── migrate_sqlite_to_postgres.py
├── artifacts/                     (gitignored) + paper_text.txt (extracted for analysis)
├── backend/
│   ├── alembic.ini
│   ├── migrations/                (4 revisions: 0001_baseline, 0002_artifact_item_id, 0003_live_actions, 0004_admin_users)
│   ├── requirements.txt           (+7 new deps — E5 + bcrypt + JWT + Gemini + PyThaiNLP)
│   ├── app/
│   │   ├── main.py                (registers auth + admin routers)
│   │   ├── model_loader.py        (append_item + threading.Lock + get_lock)
│   │   ├── db.py
│   │   ├── models_db.py           (User appended)
│   │   ├── core/{config,exceptions}.py
│   │   ├── schemas/{item,recommendation,context,keyword,action,metrics,user,admin}.py
│   │   ├── services/
│   │   │   ├── auth.py            (NEW — bcrypt + JWT helpers)
│   │   │   ├── embedding.py       (NEW — E5 lazy loader)
│   │   │   ├── grounding.py       (NEW — Layer A + Layer B)
│   │   │   ├── ingestion.py       (NEW — orchestrator)
│   │   │   ├── user_query.py      (NEW — users table CRUD)
│   │   │   ├── actions.py         (modified — JWT-aware)
│   │   │   ├── db_query.py
│   │   │   ├── cf_service.py
│   │   │   ├── cbf_service.py
│   │   │   ├── hybrid_service.py
│   │   │   ├── recommendation_service.py
│   │   │   ├── eligibility.py
│   │   │   ├── suitability.py
│   │   │   └── _ids.py
│   │   └── routers/
│   │       ├── actions.py         (modified)
│   │       ├── admin.py           (NEW)
│   │       ├── auth.py            (NEW)
│   │       ├── _user_key.py       (NEW — JWT/anon translator)
│   │       ├── catalog.py         (modified)
│   │       ├── health.py
│   │       ├── legacy.py
│   │       ├── metrics.py
│   │       └── recommendations.py
│   └── tests/                     248 tests, 90.48% coverage
│       ├── conftest.py
│       ├── test_admin.py          (NEW)
│       ├── test_auth.py           (NEW)
│       ├── test_user_key.py       (NEW)
│       ├── test_embedding.py      (NEW)
│       ├── test_grounding.py      (NEW)
│       ├── test_ingestion.py      (NEW)
│       ├── test_user_query.py     (NEW)
│       ├── test_core.py           (modified — CORS)
│       ├── test_catalog.py        (modified — user_key param)
│       └── test_*.py              (rest unchanged)
└── frontend/                      (Phase H pending)
    ├── lib/{api,types,user}.ts
    ├── components/
    └── app/{layout,page,recommend,results,items/}.tsx
```

---

## Endpoints (now 16 total — added 4 new)

| Method | Path | Purpose | Auth |
|---|---|---|---|
| POST | `/auth/signup` | Create user (1st user → admin) | – |
| POST | `/auth/login` | Verify password → JWT | – |
| GET  | `/auth/me` | Echo current user | JWT |
| POST | `/admin/items/draft` | Layer A+B grounding (returns draft_id + proposals) | admin JWT |
| POST | `/admin/items` | Layer C commit + ingest | admin JWT |
| POST | `/admin/items/{id}/keywords` | Layer C re-edit | admin JWT |
| GET  | `/health` | Liveness + artifact metadata | – |
| GET  | `/db/health` | Postgres reachability | – |
| POST | `/recommendations` | Generate top-K | – |
| GET  | `/items` | Browse + ranked mode (existing) | JWT or anon |
| GET  | `/items/{id}` | Detail (existing) | JWT or anon |
| GET  | `/items/{id}/legacy-stats` | Postgres ratings | – |
| GET  | `/contexts` | Sub-contexts | – |
| GET  | `/keywords` | Keywords | – |
| GET  | `/metrics` | Corpus + CF index stats | – |
| POST/DELETE | `/actions/like` | Like / unlike | JWT or anon |
| POST/DELETE | `/actions/save` | Save / unsave | JWT or anon |
| PUT  | `/actions/rating` | Set 1..5 rating | JWT or anon |

---

## How to run (Phase H continuation)

```bash
# Backend (already running in this session, background task byrfsv2vm on :8080)
cd "C:/Users/Pichaya/Downloads/web_appRS1/backend"
export RECSYS_DB_ENABLED=1
export RECSYS_JWT_SECRET=dev-secret-change-in-prod
export RECSYS_ADMIN_USERNAMES=admin  # or leave empty to bootstrap first signup
export RECSYS_GEMINI_API_KEY=<your-key>  # optional; Layer B skipped if empty
python -m uvicorn app.main:app --host 127.0.0.1 --port 8080

# Run tests
python -m pytest --cov=app --cov-report=term --cov-fail-under=90 -q
# 248 passed / 90.48% coverage (gate ≥ 90% ✅)

# Apply new migration (one-time)
alembic upgrade head   # adds users table

# Frontend (Phase H — work in progress)
cd "C:/Users/Pichaya/Downloads/web_appRS1/frontend"
npm run dev    # http://localhost:3000

# End-to-end smoke (after Phase H)
# 1. http://localhost:3000/signup → admin / hunter22 → JWT
# 2. http://localhost:3000/admin/items/new → fill form → "ดูคำสำคัญที่เสนอ"
# 3. submit → redirect to /items/{new_id}
# 4. /items → new item appears in catalog (loader was hot-reloaded)
# 5. /recommend → new item appears in top-K
```

---

## Known ports (in use on this machine)

- **5432** — Postgres (Docker container `thai_arts_postgres`, DB name `web_rs_thaiarts`)
- **8080** — FastAPI backend
- **3000** — Next.js frontend (Phase H)

---

## Notes for the next session

- **JWT secret** — defaults to `"dev-only-change-me"` for tests; **rotate before any production deployment** (`RECSYS_JWT_SECRET` env var). HS256 — no JWKS needed.
- **First-user-admin bootstrap** — when `RECSYS_ADMIN_USERNAMES` env is empty, the very first `POST /auth/signup` becomes admin. When non-empty, only members of the allow-list become admins.
- **E5 model download** — first ingest triggers `~2.5 GB` HuggingFace download (CPU build). Set `RECSYS_E5_ENABLED=0` to skip; set `RECSYS_E5_LOCAL_PATH` to preload from a local snapshot.
- **In-process reload** — every successful ingest appends to the in-memory `ArtifactLoader` under `get_lock()`. All in-flight requests see the new state immediately (no versioning). Documented in `ingestion.py` docstring.
- **DB + loader non-atomicity** — if ingest crashes between DB insert and loader mutation, the DB has the row but the loader doesn't. Re-running the same admin POST would surface a duplicate-name 400; the operator can re-trigger a full reload via `python -m uvicorn ...` restart as a last resort. Window is small (~50 ms) and bounded by the lock.
- **Reassign route** — `POST /admin/items/{id}/keywords` is exercised by `test_admin.py::test_reassign_keywords_updates_item`. The route looks up by `Item.artifact_item_id` (not `Item.id`) so callers must pass the artifact id from `/items` responses.
- **Frontend nav (Phase H)** — the conditional nav lives in a new `FrontendNav.tsx` (extracted from `layout.tsx`). Reads `getCurrentUser()` on mount; listens to `storage` event for cross-tab logout sync.
- **Article coverage drop** — when you add the new frontend pages, the test count stays at 248 (no backend tests added). Frontend has its own type-check + build (`npm run type-check && npm run build`).

---

## Suggested commit messages (uncommitted work)

```
1. Alembic 0004_admin_users: users table + ix_users_username
2. Settings: jwt_secret, jwt_expiry_days, admin_usernames, e5_*, gemini_*, grounding_use_llm
3. ORM: append User model (BigAutoPK + bcrypt hash + is_admin)
4. Auth service: bcrypt + PyJWT + get_current_user/admin FastAPI deps
5. Auth router: POST /auth/signup, /auth/login, GET /auth/me
6. Schemas: user.py (Signup/Login/Out/TokenOut) + admin.py (Draft/Create/Proposal/Commit)
7. Exceptions: AuthError(401) + ForbiddenError(403)
8. Embedding: lazy E5 loader + encode_text/query/item_text (+ build_item_text mirrors pipeline)
9. Grounding: Layer A (rule) + Layer B (Gemini JSON schema) + combined ground_keywords
10. Loader mutation: append_item + threading.Lock + get_lock helper
11. Ingestion orchestrator: compute embedding outside lock → DB insert → loader.append
12. Admin router: draft → commit → reassign keywords (with TTL draft store)
13. JWT swap: actions + catalog routers accept Authorization header → user_key translate
14. Test slices: +test_auth +test_user_query +test_user_key +test_embedding +test_grounding +test_ingestion +test_admin (87 new tests, 248 total / 90.48%)
15. Update test_catalog: every /items call now sends ?user_key=anon:test
16. Update test_core: cors_origins default includes 127.0.0.1:3000
17. Update requirements.txt: bcrypt + pyjwt + sentence-transformers + google-generativeai + pythainlp
```

---

**End of handoff.** Next session: start by reading `C:\Users\Pichaya\.claude\plans\bubbly-finding-patterson.md` (Phase H section, steps 25-35), then `frontend/lib/api.ts` + `frontend/lib/user.ts` + `frontend/app/layout.tsx` for context. Run `เริ่มทำ phase H` to begin.