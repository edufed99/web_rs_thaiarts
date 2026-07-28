# เปรียบเทียบ Web App ใหม่ กับ งานเดิม

| หัวข้อ | งานใหม่ — `C:\Users\Pichaya\Downloads\web_appRS1\` | งานเดิม — `C:\Users\Pichaya\Downloads\web_appRS\thai_arts_webapp\` |
|---|---|---|
| **สถานะ** | สร้างใหม่ห้ามแก้เดิม | อ่านอย่างเดียว (ไม่ถูกแก้) |
| **Git** | repo `edufed99/web_rs_thaiarts` (private) | ไม่ใช่ repo แยก |
| **Framework หลัก** | Next.js 14 + TypeScript (frontend), Python FastAPI (backend) | Django 6.0 + templates + JSON APIs |
| **ภาษา** | Python 3.10+ (backend/pipeline), TypeScript (frontend) | Python 3.12 (Django) |
| **Python LOC** | 4,047 (backend) + 825 (pipeline) = **4,872** | **5,530** |
| **TypeScript LOC** | **1,510** (frontend) | 0 (Django templates) |
| **จำนวนไฟล์ source** (ไม่รวม deps/venv/node_modules) | ~71 (backend 55 + frontend 15 + pipeline 1) | ~120 (Django apps + templates + management commands) |
| **Database (ML model)** | Static artifacts เท่านั้น — pipeline เป็นคน build ครั้งเดียว | PostgreSQL (default) + SQLite (fallback) — อ่าน DB ตอน runtime |
| **Database (live user actions)** | ✅ PostgreSQL 16 (Docker) + SQLAlchemy 2.x + Alembic — มี `likes` / `saved_items` / `ratings` / `interaction_logs` + bridge `items.artifact_item_id` | ✅ `Like` / `SavedItem` / `Rating` / `InteractionLog` จากต้นฉบับ |
| **Database file size** | Postgres data volume (~tens of MB ตอนนี้ — 2534 legacy interactions + live actions) | `db.sqlite3` ≈ 2.6 MB (development cache) |
| **Artifact files** | 7 files ≈ 26 KB (parquet + npz + 5 JSON) | ไม่มี — อ่าน DB ตอน runtime |
| **Migrations** | Alembic (3 revisions: `0001_baseline`, `0002_artifact_item_id`, `0003_live_actions`) | Django `manage.py migrate` |
| **Runtime deps (backend)** | fastapi, uvicorn, pydantic, pydantic-settings, pandas, numpy, pyarrow, sqlalchemy, psycopg[binary], alembic, passlib[bcrypt], httpx, pytest, pytest-cov, pytest-asyncio, aiosqlite | django 6, pandas, numpy, scikit-learn, psycopg, sentence-transformers |
| **Heavy ML model** | Embeddings คำนวณครั้งเดียวใน pipeline → เก็บใน `.npz` | `intfloat/multilingual-e5-large-instruct` โหลดทุกครั้งที่ web worker เริ่ม (lru_cache) |
| **Frontend stack** | App Router, fetch API, TS strict mode | Django templates + jQuery-like scripts + form POST |
| **Identity model** | Opaque `anon:<uuid>` ใน `localStorage` (key `recsys_user_key`) — ไม่มี users table | Django `auth_user` + `Consent` text + role-based permissions |
| **API surface** | REST/JSON ผ่าน FastAPI (มี OpenAPI/Swagger) | REST/JSON เฉพาะ 3 endpoint (`/api/recommendations/`, `/api/item-action/`, `/api/metrics/`); ไม่มี OpenAPI |
| **Swagger UI** | ✅ `/docs`, `/redoc`, `/openapi.json` | ❌ ไม่มี |
| **API endpoints** | **13 endpoints** (health, db/health, recommendations, items, items/{id}, items/{id}/legacy-stats, contexts, keywords, metrics, actions/{like,save,rating} + 3 doc routes) | 6 endpoints (recommend form, results, item-action, 3 JSON APIs, admin) |
| **Tests** | **135 pytest tests, coverage 92.79%** enforced ≥ 90% | Django `manage.py test` มีอยู่แต่ไม่ได้ enforce coverage |
| **Configuration** | `RECSYS_*` env vars + `NEXT_PUBLIC_*` frontend var | `os.environ` ใน `.env` + `config/settings.py` |
| **CORS** | Configurable, default `http://localhost:3000` | ไม่จำเป็น (same-origin Django templates) |
| **Recommendation algorithm** | เหมือนเดิม — Eligibility → CBF (E5 cosine + boost) → CF (ItemKNN ผสม live positive history) → Hybrid WeightedSum (z-score + alpha 0.7) → apply_negative_penalty → Explanation | ต้นฉบับ |
| **Algorithm fidelity** | 1:1 port — verified กับ paper_thesis.docx (Sections 2.3–2.5); CF merge รวม legacy positive + live user history ผ่าน artifact-id translation | ต้นฉบับ |
| **Personalization ตอน runtime** | ✅ — `POST/DELETE /actions/like`, `POST/DELETE /actions/save`, `PUT /actions/rating` + `user_key` ในทุก request + `cf_service` ผสม legacy + live positive history (artifact-id space) | ✅ — `personalized_recommendations_from_history` + live Like/Save/Rating writes |
| **Interaction logging ตอน runtime** | ✅ — `interaction_logs` table (Alembic revision `0003_live_actions`); ทุก `/actions/*` เขียน row + `metadata_json` (TEXT/JSONB) | ✅ — `InteractionLog` table ทุก action |
| **`UserState` ต่อ item ใน response** | ✅ — `ItemOut.user_state` populated จาก `likes` / `saved_items` / `ratings` สำหรับทั้ง `/recommendations`, `/items`, `/items/{id}` (optional `?user_key=`) | ❌ |
| **User accounts / consent** | ❌ (opaque `anon:<uuid>` เท่านั้น — ตาม ADR §11) | ✅ — Django auth + consent text + role-based permissions |
| **Researcher dashboard** | ❌ (out of scope) | ✅ — top keywords, clicked/liked/rated tables, CSV export |
| **Embedding model ตอน runtime** | ❌ — ใช้ precomputed vectors เท่านั้น | ✅ — โหลด `intfloat/multilingual-e5-large-instruct` (~2.5 GB) ใน web process |
| **CSV read ตอน runtime** | ❌ | ✅ (ผ่าน management commands) |
| **Build time (clean cold install)** | Backend: ~30s (pip), Frontend: ~54s (npm), Pipeline: ~2s (synthetic) | Django + PostgreSQL setup: หลายนาที + ต้อง `migrate`, `import_project_data`, `build_item_embeddings` |
| **Cold start latency** | Backend ~2s (load artifacts); Frontend instant | Django ~3-5s + E5 model loading (~10-30s first time) |
| **Memory footprint per worker** | ~150 MB (artifacts only) | ~2.5 GB+ (E5 model in memory) |
| **Production-ready concerns** | ต้องเพิ่ม auth, deployment, CI/CD, monitoring (ตาม ADR §11) | ต้องเพิ่ม WSGI/gunicorn, HTTPS, secret key, allowed hosts |

## ขนาด source code (เฉพาะ production code)

| Metric | ใหม่ | เดิม |
|---|---|---|
| Python LOC (backend + pipeline) | 4,872 | 5,530 |
| TypeScript LOC | 1,510 | 0 |
| Total source LOC | 6,382 | 5,530 |
| Python test LOC | **~2,194 (135 tests)** | มีแต่ไม่ได้นับใน task นี้ |

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

## สิ่งที่ตัดออกตาม ADR §11 (out of scope)

- ❌ Login / authentication / consent (opaque `anon:<uuid>` เท่านั้น — ไม่มี users table)
- ❌ Researcher dashboard + CSV export
- ❌ EASE_R, BiasedMF, BiasedMF-BPR, SimpleX CF models
- ❌ BGE-M3, WangchanBERTa, Phayathaibert encoders
- ❌ WeightedProduct, RRF, ReliabilityGate hybrid strategies
- ❌ HR@K, MRR@K, nDCG@K evaluation endpoint
- ❌ Fuzzy context matching
- ❌ Keyword leakage protection
- ❌ CI/CD, Docker production (dev compose เท่านั้น), cloud storage, cloud DB

## ข้อดีของระบบใหม่

1. **Runtime separation** — backend ไม่โหลด ML model หนัก ๆ ตอน serving, ไม่แตะ CSV
2. **Reproducible artifacts** — artifacts เป็นไฟล์ stable ที่ version-control ได้
3. **Modern API contract** — Swagger UI เปิดได้ทันที, OpenAPI schema machine-readable, 13 endpoints ครอบคลุม live actions + health + catalog + metrics
4. **Strict typing** — TypeScript strict + Pydantic v2 catch error ก่อน runtime
5. **Test coverage enforced** — pytest `cov-fail-under=90` ป้องกัน regression (135 tests / 92.79%)
6. **Frontend decoupled** — เปลี่ยน frontend framework ได้โดยไม่กระทบ backend
7. **Algorithm preserved** — ผลลัพธ์ตรง thesis Tables 5, 7 สำหรับ single-model config + live history ผสานเข้า CF ผ่าน artifact-id space
8. **Live personalization** — `Like` / `Save` / `Rating` ติดต่อ DB จริง, `ItemKNN` merge กับ legacy positive history ทันทีหลัง action, `ItemActionBar` UI optimistic + persist
9. **Schema เปลี่ยนผ่าน Alembic** — revision `0001` / `0002` / `0003` เป็นแหล่งความจริงเดียว, ไม่มี `CREATE TABLE IF NOT EXISTS` ใน service code

## ข้อจำกัดของระบบใหม่

1. ไม่มี user accounts จริง → ใช้ opaque `anon:<uuid>` เท่านั้น (ไม่มี login / consent / role)
2. ต้อง regenerate artifacts เมื่อ source CSV เปลี่ยน (manual — ไม่มี hot-reload model)
3. Frontend โหลดช้ากว่า Django templates ในการ render ครั้งแรก (Next.js client-side fetch)
4. Alembic revisions เขียนมือ — ไม่มี autogenerate (ตาม ADR §11); ต้องเขียน revision ใหม่ทุกครั้งที่แก้ ORM
5. Live actions degrade gracefully เมื่อ DB ปิด (`is_db_enabled=0` → actions ตอบ 503, recommendations + catalog ยัง 200 ด้วย `user_state` ว่าง) — ไม่ fail แบบ hard