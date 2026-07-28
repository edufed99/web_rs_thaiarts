# เปรียบเทียบ Web App ใหม่ กับ งานเดิม

| หัวข้อ | งานใหม่ — `C:\Users\Pichaya\Downloads\web_appRS1\` | งานเดิม — `C:\Users\Pichaya\Downloads\web_appRS\thai_arts_webapp\` |
|---|---|---|
| **สถานะ** | สร้างใหม่ห้ามแก้เดิม | อ่านอย่างเดียว (ไม่ถูกแก้) |
| **Git** | repo `edufed99/web_rs_thaiarts` (private) | ไม่ใช่ repo แยก |
| **Framework หลัก** | Next.js 14 + TypeScript (frontend), Python FastAPI (backend) | Django 6.0 + templates + JSON APIs |
| **ภาษา** | Python 3.10+ (backend/pipeline), TypeScript (frontend) | Python 3.12 (Django) |
| **Python LOC** | 3,138 (backend) + 504 (pipeline) = **3,642** | **5,530** |
| **TypeScript LOC** | **1,064** (frontend) | 0 (Django templates) |
| **จำนวนไฟล์ source** (ไม่รวม deps/venv/node_modules) | ~52 (backend 30 + frontend 17 + pipeline 1 + docs) | ~120 (Django apps + templates + management commands) |
| **Database** | ไม่มี runtime DB — ใช้ static artifacts | PostgreSQL (default) + SQLite (fallback) |
| **Database file size** | 0 | `db.sqlite3` ≈ 2.6 MB (development cache) |
| **Artifact files** | 7 files ≈ 26 KB (parquet + npz + 5 JSON) | ไม่มี — อ่าน DB ตอน runtime |
| **Runtime deps** | fastapi, uvicorn, pydantic, pandas, numpy, pyarrow, httpx | django 6, pandas, numpy, scikit-learn, psycopg, sentence-transformers |
| **Heavy ML model** | Embeddings คำนวณครั้งเดียวใน pipeline → เก็บใน `.npz` | `intfloat/multilingual-e5-large-instruct` โหลดทุกครั้งที่ web worker เริ่ม (lru_cache) |
| **Frontend stack** | App Router, fetch API, TS strict mode | Django templates + jQuery-like scripts + form POST |
| **API surface** | REST/JSON ผ่าน FastAPI (มี OpenAPI/Swagger) | REST/JSON เฉพาะ 3 endpoint (`/api/recommendations/`, `/api/item-action/`, `/api/metrics/`); ไม่มี OpenAPI |
| **Swagger UI** | ✅ `/docs`, `/redoc`, `/openapi.json` | ❌ ไม่มี |
| **API endpoints** | 10 endpoints (health, recommendations, items, contexts, keywords, metrics, docs, redoc, openapi) | 6 endpoints (recommend form, results, item-action, 3 JSON APIs, admin) |
| **Tests** | **102 pytest tests, coverage 96.85%** enforced ≥ 90% | Django `manage.py test` มีอยู่แต่ไม่ได้ enforce coverage |
| **Configuration** | `RECSYS_*` env vars + `NEXT_PUBLIC_*` frontend var | `os.environ` ใน `.env` + `config/settings.py` |
| **CORS** | Configurable, default `http://localhost:3000` | ไม่จำเป็น (same-origin Django templates) |
| **Recommendation algorithm** | เหมือนเดิม — Eligibility → CBF (E5 cosine + boost) → CF (ItemKNN) → Hybrid WeightedSum → Explanation | ต้นฉบับ |
| **Algorithm fidelity** | 1:1 port — verified กับ paper_thesis.docx (Sections 2.3–2.5) | ต้นฉบับ |
| **Personalization ตอน runtime** | ❌ — ใช้ static CF index | ✅ — `personalized_recommendations_from_history` + live Like/Save/Rating writes |
| **Interaction logging ตอน runtime** | ❌ — ไม่เขียน log | ✅ — `InteractionLog` table ทุก action |
| **User accounts / consent** | ❌ (out of scope) | ✅ — Django auth + consent text + role-based permissions |
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
| Python LOC (backend + pipeline) | 3,642 | 5,530 |
| TypeScript LOC | 1,064 | 0 |
| Total source LOC | 4,706 | 5,530 |
| Python test LOC | ~1,800 (102 tests) | มีแต่ไม่ได้นับใน task นี้ |

## สิ่งที่ port ตรง 1:1 (algorithm)

- ✅ Eligibility gate (context filter + keyword prioritization)
- ✅ CBF (E5 cosine + keyword boost = 0.05)
- ✅ CF ItemKNN (cosine with shrinkage = 50, top-K = 10)
- ✅ Hybrid WeightedSum (z-score + alpha = 0.7)
- ✅ Negative penalty
- ✅ Same candidate set invariant (ทุก model รับ candidate เดียวกัน)
- ✅ Thai explanation builder (matches `recommender/explanations.py`)

## สิ่งที่ตัดออกตาม ADR §11 (out of scope)

- ❌ Login / authentication / consent
- ❌ Live personalization (live Like/Save/Rating writes)
- ❌ Researcher dashboard + CSV export
- ❌ EASE_R, BiasedMF, BiasedMF-BPR, SimpleX CF models
- ❌ BGE-M3, WangchanBERTa, Phayathaibert encoders
- ❌ WeightedProduct, RRF, ReliabilityGate hybrid strategies
- ❌ HR@K, MRR@K, nDCG@K evaluation endpoint
- ❌ Fuzzy context matching
- ❌ Keyword leakage protection
- ❌ CI/CD, Docker, cloud storage, cloud DB

## ข้อดีของระบบใหม่

1. **Runtime separation** — backend ไม่โหลด ML model หนัก ๆ ตอน serving, ไม่แตะ DB
2. **Reproducible artifacts** — artifacts เป็นไฟล์ stable ที่ version-control ได้
3. **Modern API contract** — Swagger UI เปิดได้ทันที, OpenAPI schema machine-readable
4. **Strict typing** — TypeScript strict + Pydantic v2 catch error ก่อน runtime
5. **Test coverage enforced** — pytest `cov-fail-under=90` ป้องกัน regression
6. **Frontend decoupled** — เปลี่ยน frontend framework ได้โดยไม่กระทบ backend
7. **Algorithm preserved** — ผลลัพธ์ตรง thesis Tables 5, 7 สำหรับ single-model config

## ข้อจำกัดของระบบใหม่

1. ไม่มี user accounts → ใช้แค่ anonymous + opaque `user_key`
2. ไม่มี live interaction log → CF ต้องพึ่ง precomputed positive index
3. ต้อง regenerate artifacts เมื่อ source CSV เปลี่ยน (manual)
4. Frontend โหลดช้ากว่า Django templates ในการ render ครั้งแรก (Next.js client-side fetch)