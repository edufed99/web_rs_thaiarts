# เปรียบเทียบ Web App ใหม่ กับ งานเดิม

> **ปรับปรุงล่าสุด:** 2026-07-29 (session 10) — ตัวเลขทั้งหมดวัดจาก working tree จริงที่ commit `8ff1621`
> ตัวเลขฝั่ง "งานเดิม" ยกมาจากการวัดครั้งก่อน (โปรเจกต์นั้นเป็น read-only ไม่มีการเปลี่ยนแปลง)

| หัวข้อ | งานใหม่ — `C:\Users\Pichaya\Downloads\web_appRS1\` | งานเดิม — `C:\Users\Pichaya\Downloads\web_appRS\thai_arts_webapp\` |
|---|---|---|
| **สถานะ** | สร้างใหม่ห้ามแก้เดิม | อ่านอย่างเดียว (ไม่ถูกแก้) |
| **Git** | repo `edufed99/web_rs_thaiarts` (private) | ไม่ใช่ repo แยก |
| **Framework หลัก** | Next.js 14 + TypeScript (frontend), Python FastAPI (backend) | Django 6.0 + templates + JSON APIs |
| **ภาษา** | Python 3.10+ (backend/pipeline), TypeScript (frontend) | Python 3.12 (Django) |
| **Python LOC** | 5,294 (backend app) + 701 (migrations) + 1,478 (pipelines) = **7,473** | **5,530** |
| **TypeScript LOC** | **3,650** (frontend) | 0 (Django templates) |
| **จำนวนไฟล์ source** (ไม่รวม deps/venv/node_modules/tests) | **81** (backend app 43 + migrations 9 + pipelines 3 + frontend 26) | ~120 (Django apps + templates + management commands) |
| **Database (ML model)** | Static artifacts เท่านั้น — pipeline เป็นคน build; **ยกเว้น** admin ingest ที่ encode E5 ตอน runtime (ADR §3) | PostgreSQL (default) + SQLite (fallback) — อ่าน DB ตอน runtime |
| **Database (live user actions)** | ✅ PostgreSQL 16 (Docker `thai_arts_postgres`) + SQLAlchemy 2.x + Alembic — **17 tables** รวม `users` / `likes` / `saved_items` / `ratings` / `interaction_logs` / `recommendation_requests` + bridge `items.artifact_item_id` | ✅ `Like` / `SavedItem` / `Rating` / `InteractionLog` จากต้นฉบับ |
| **ข้อมูลจริงใน DB** | items 115, contexts 25, keywords 604, taxonomy_nodes 48, item_contexts 1005, item_keywords 1083, legacy_interactions 2534, users 158, interaction_logs 2563 (import ครบจาก CSV export 2026-07-28) | `db.sqlite3` ≈ 2.6 MB (development cache) |
| **Artifact files** | 8 files ≈ 545 KB (parquet + npz 1024-dim/114 items + JSON indices + paper_text) | ไม่มี — อ่าน DB ตอน runtime |
| **Migrations** | Alembic **6 revisions**: `0001_baseline`, `0002_artifact_item_id`, `0003_live_actions`, `0004_admin_users`, `0005_legacy_autoincrement`, `0006_recommender_history` | Django `manage.py migrate` |
| **Runtime deps (backend)** | fastapi, uvicorn, pydantic, pydantic-settings, pandas, numpy, pyarrow, sqlalchemy, psycopg[binary], alembic, **bcrypt, pyjwt, cryptography** (auth), **sentence-transformers, torch, google-generativeai, pythainlp** (admin ingest), httpx, pytest, pytest-cov, pytest-asyncio, aiosqlite | django 6, pandas, numpy, scikit-learn, psycopg, sentence-transformers |
| **Heavy ML model** | Embeddings คำนวณครั้งเดียวใน pipeline → `.npz`; E5 โหลดแบบ lazy เฉพาะตอน admin ingest (`RECSYS_E5_ENABLED=0` ปิดได้) | `intfloat/multilingual-e5-large-instruct` โหลดทุกครั้งที่ web worker เริ่ม (lru_cache) |
| **Frontend stack** | App Router, fetch API, TS strict mode, Tailwind | Django templates + jQuery-like scripts + form POST |
| **Identity model** | ✅ **JWT auth จริง** (`users` table, bcrypt hash, `/auth/signup`+`/auth/login`+`/auth/me`) + admin role ผ่าน `RECSYS_ADMIN_USERNAMES`; รองรับ anon `anon:<uuid>` ควบคู่ (`resolve_user_key`) | Django `auth_user` + `Consent` text + role-based permissions |
| **API surface** | REST/JSON ผ่าน FastAPI (มี OpenAPI/Swagger) | REST/JSON เฉพาะ 3 endpoint (`/api/recommendations/`, `/api/item-action/`, `/api/metrics/`); ไม่มี OpenAPI |
| **Swagger UI** | ✅ `/docs`, `/redoc`, `/openapi.json` | ❌ ไม่มี |
| **API endpoints** | **20 endpoints** + 3 doc routes (health, db/health, recommendations, items, items/{id}, items/{id}/legacy-stats, contexts, keywords, metrics, actions/{like,save,rating} × POST/DELETE/PUT, auth/{signup,login,me}, admin/items{,/draft,/{id}/keywords}) | 6 endpoints (recommend form, results, item-action, 3 JSON APIs, admin) |
| **Admin content ingest** | ✅ 3-layer pipeline: Layer A+B grounding (`POST /admin/items/draft` — pythainlp + Gemini optional) → Layer C commit (`POST /admin/items`) → re-edit keywords; encode E5 + `ArtifactLoader.append_item` (thread-safe) | ✅ Django admin + management commands |
| **Tests** | **248 pytest tests, coverage 90.45%** enforced ≥ 90% (test LOC 3,824 / 25 ไฟล์) | Django `manage.py test` มีอยู่แต่ไม่ได้ enforce coverage |
| **Configuration** | `RECSYS_*` env vars (`.env` + `.env.example` tracked) + `NEXT_PUBLIC_*` frontend var | `os.environ` ใน `.env` + `config/settings.py` |
| **CORS** | Configurable ผ่าน `RECSYS_CORS_ORIGINS` (CSV string → `cors_origins_list`), default `http://localhost:3000` | ไม่จำเป็น (same-origin Django templates) |
| **Recommendation algorithm** | เหมือนเดิม — Eligibility → CBF (E5 cosine + boost) → CF (ItemKNN ผสม live positive history) → Hybrid WeightedSum (z-score + alpha 0.7) → apply_negative_penalty → Explanation | ต้นฉบับ |
| **Algorithm fidelity** | 1:1 port — verified กับ paper_thesis.docx (Sections 2.3–2.5); CF merge รวม legacy positive + live user history ผ่าน artifact-id translation | ต้นฉบับ |
| **Personalization ตอน runtime** | ✅ — `POST/DELETE /actions/like`, `POST/DELETE /actions/save`, `PUT /actions/rating` + JWT/`user_key` ในทุก request + `cf_service` ผสม legacy + live positive history (artifact-id space) | ✅ — `personalized_recommendations_from_history` + live Like/Save/Rating writes |
| **Interaction logging ตอน runtime** | ✅ — `interaction_logs` (2,563 rows) + `recommendation_requests` / `recommendation_results` / `recommendation_request_selected_keywords` (revision `0006`) | ✅ — `InteractionLog` table ทุก action |
| **`UserState` ต่อ item ใน response** | ✅ — `ItemOut.user_state` populated จาก `likes` / `saved_items` / `ratings` สำหรับทั้ง `/recommendations`, `/items`, `/items/{id}` | ❌ |
| **Suitability hint** | ✅ — `match_percent` (int 82..98) + `suitability_label` (`เหมาะมาก`/`เหมาะสม`/`เหมาะใช้ได้`) บนทุก item row — **display-only ไม่มีผลกับ ranking** | ✅ (heuristic เดิมใน `catalog.views`) |
| **User accounts / consent** | ✅ auth ครบ (signup/login/JWT/admin role) — ❌ ยังไม่มี consent text + password reset | ✅ — Django auth + consent text + role-based permissions |
| **Researcher dashboard** | ❌ (out of scope) | ✅ — top keywords, clicked/liked/rated tables, CSV export |
| **Embedding model ตอน runtime** | ⚠️ เฉพาะ admin ingest เท่านั้น (lazy load, ปิดได้ด้วย env) — request path ปกติใช้ precomputed vectors | ✅ — โหลด `intfloat/multilingual-e5-large-instruct` (~2.5 GB) ใน web process ตลอด |
| **CSV read ตอน runtime** | ❌ | ✅ (ผ่าน management commands) |
| **Build time (clean cold install)** | Backend: ~30s (pip, ไม่รวม torch), Frontend: ~54s (npm), Pipeline: ~2s (synthetic) | Django + PostgreSQL setup: หลายนาที + ต้อง `migrate`, `import_project_data`, `build_item_embeddings` |
| **Cold start latency** | Backend ~2s (load artifacts, วัดจริง session 10); Frontend instant | Django ~3-5s + E5 model loading (~10-30s first time) |
| **Memory footprint per worker** | ~150 MB (artifacts only) — จะพุ่งชั่วคราวตอน admin ingest ครั้งแรก | ~2.5 GB+ (E5 model in memory) |
| **Production-ready concerns** | ต้องหมุน JWT secret, เพิ่ม password reset, deployment, CI/CD, monitoring (ตาม ADR §11) | ต้องเพิ่ม WSGI/gunicorn, HTTPS, secret key, allowed hosts |

## ขนาด source code (เฉพาะ production code)

| Metric | ใหม่ | เดิม |
|---|---|---|
| Python LOC (backend app + migrations + pipelines) | 7,473 | 5,530 |
| TypeScript LOC | 3,650 | 0 |
| Total source LOC | **11,123** | 5,530 |
| Python test LOC | **3,824 (248 tests / 25 ไฟล์)** | มีแต่ไม่ได้นับใน task นี้ |

### รายละเอียด LOC ฝั่งใหม่

| ส่วน | ไฟล์ | LOC |
|---|---|---|
| `backend/app/` (routers, services, schemas, core) | 43 | 5,294 |
| `backend/migrations/` (6 revisions + env) | 9 | 701 |
| `pipelines/` (artifacts + 2 migration loaders) | 3 | 1,478 |
| `frontend/` (app + components + lib) | 26 | 3,650 |
| `backend/tests/` | 25 | 3,824 |

## สิ่งที่ port ตรง 1:1 (algorithm)

- ✅ Eligibility gate (context filter + keyword prioritization)
- ✅ CBF (E5 cosine + keyword boost = 0.05)
- ✅ CF ItemKNN (cosine with shrinkage = 50, top-K = 10)
- ✅ Hybrid WeightedSum (z-score + alpha = 0.7)
- ✅ Negative penalty (`factor = (rating / 5) ** alpha`)
- ✅ Same candidate set invariant (ทุก model รับ candidate เดียวกัน)
- ✅ Thai explanation builder (matches `recommender/explanations.py`)
- ✅ Live action semantics (Like / Save / Rating ↔ `perform_item_action` + `personalized_recommendations_from_history`)
- ✅ Artifact-id bridge (`items.artifact_item_id` ตรงกับ `stable_id("item", name)` ของ pipeline) — legacy→artifact translation 1:1 ผ่าน `db_query.artifact_id_to_django_id`
- ✅ Suitability heuristic (`catalog_match_percent`) + ranked mode ของ `/items?context=`

## สิ่งที่ตัดออกตาม ADR §11 (out of scope)

- ❌ Consent text + researcher dashboard + CSV export
- ❌ Password reset flow (ผู้ใช้ที่ import มาจึงยังล็อกอินไม่ได้ — ดู "ข้อจำกัด" ข้อ 1)
- ❌ EASE_R, BiasedMF, BiasedMF-BPR, SimpleX CF models
- ❌ BGE-M3, WangchanBERTa, Phayathaibert encoders
- ❌ WeightedProduct, RRF, ReliabilityGate hybrid strategies
- ❌ HR@K, MRR@K, nDCG@K evaluation endpoint
- ❌ Fuzzy context matching
- ❌ Keyword leakage protection
- ❌ CI/CD, Docker production (dev compose เท่านั้น), cloud storage, cloud DB

> **หมายเหตุ:** login/authentication เคยอยู่ใน out-of-scope แต่ถูก **flip เป็น in-scope** ที่ commit `1220eef` (Phase I) — ตอนนี้ implement แล้ว

## ข้อดีของระบบใหม่

1. **Runtime separation** — request path ปกติไม่โหลด ML model หนัก, ไม่แตะ CSV (E5 โผล่เฉพาะตอน admin ingest และปิดได้)
2. **Reproducible artifacts** — artifacts เป็นไฟล์ stable ที่ version-control ได้
3. **Modern API contract** — Swagger UI เปิดได้ทันที, OpenAPI schema machine-readable, 20 endpoints ครอบคลุม auth + admin ingest + live actions + catalog + metrics
4. **Strict typing** — TypeScript strict + Pydantic v2 catch error ก่อน runtime
5. **Test coverage enforced** — pytest `cov-fail-under=90` ป้องกัน regression (248 tests / 90.45%)
6. **Frontend decoupled** — เปลี่ยน frontend framework ได้โดยไม่กระทบ backend
7. **Algorithm preserved** — ผลลัพธ์ตรง thesis Tables 5, 7 สำหรับ single-model config + live history ผสานเข้า CF ผ่าน artifact-id space
8. **Live personalization** — `Like` / `Save` / `Rating` ติดต่อ DB จริง, `ItemKNN` merge กับ legacy positive history ทันทีหลัง action
9. **Schema เปลี่ยนผ่าน Alembic** — 6 revisions เป็นแหล่งความจริงเดียว, ไม่มี `CREATE TABLE IF NOT EXISTS` ใน service code
10. **Auth + admin ingest** — JWT + bcrypt + admin role; เพิ่ม item ใหม่ผ่าน UI ได้โดยไม่ต้องรัน pipeline ใหม่
11. **ข้อมูลครบจาก export จริง** — 17 tables ตรงกับ `manifest.csv` 100%, 0 FK orphans

## ข้อจำกัดของระบบใหม่

1. **Password reset ยังไม่มี** — user ที่ import มา (id 2..158) มี `password_hash = "!redacted!<random>"` และ `display_name = "must_reset|legacy:<username>"` จึงล็อกอินไม่ได้; ตอนนี้ล็อกอินได้แค่ bootstrap admin (id=1)
2. **ArtifactLoader ไม่ persist การ append** — DB มี 115 items แต่ `/health` รายงาน 114 หลัง restart เพราะ item ที่ admin ingest เข้ามาอยู่ในหน่วยความจำอย่างเดียว; ต้อง re-run pipeline ให้ artifacts sync
3. **Context ที่ admin สร้างใหม่ไม่เข้า loader vocab** — `/recommendations` ด้วย context ใหม่จะได้ `context_not_found` จนกว่าจะ regenerate artifacts
4. ต้อง regenerate artifacts เมื่อ source CSV เปลี่ยน (manual — ไม่มี hot-reload model)
5. Frontend โหลดช้ากว่า Django templates ในการ render ครั้งแรก (Next.js client-side fetch); **ยังไม่เคยรัน `npm run dev` ในสาขานี้ — UI ยังไม่ผ่านการทดสอบด้วยตาจริง**
6. Alembic revisions เขียนมือ — ไม่มี autogenerate (ตาม ADR §11)
7. Live actions degrade gracefully เมื่อ DB ปิด (`RECSYS_DB_ENABLED=0` → actions ตอบ 503, recommendations + catalog ยัง 200 ด้วย `user_state` ว่าง)
8. `RECSYS_JWT_SECRET` ยังเป็น `dev-secret-change-in-prod` — ต้องหมุนก่อนใช้นอกเครื่อง
9. `users.id` ไม่ตรงกับ `auth_user.id` ของ CSV (offset เพื่อสงวน admin=1) — join ภายนอกต้องใช้ `display_name` แทน
