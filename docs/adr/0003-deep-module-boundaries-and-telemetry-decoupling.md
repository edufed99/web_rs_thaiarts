# ADR-0003: Deep Module Boundaries and Telemetry Decoupling

**Status:** Accepted  
**Date:** 2026-08-16  
**Scope:** Re-architect shallow query modules, recommendation telemetry, item ingestion, and member identity into deep modules with clean seams.

---

## 1. Context and Problem

The Python backend in `web_rs_thaiarts` (`backend/app/`) accumulated architectural friction during iterative feature additions:

1. **Scoring Pipeline Coupled to Telemetry Persistence:** `recommendation_service.py` directly executes relational queries on 5 database tables (`RecommendationRequest`, `RecommendationResult`, `RecommendationRequestSelectedKeyword`, `Context`, `Item`), translates dual ID spaces inline, and synchronously triggers online evaluation recalculation during request serving.
2. **Fragmented Read-side Queries:** Read operations are split across `db_query.py`, `member_query.py`, `popularity.py`, and `user_query.py`, while the `routers/catalog.py` router carries 918 lines containing in-memory TTL caches, raw SQL joins, and recursive taxonomy tree traversal.
3. **Multi-module Coordination in Ingestion:** Admin item drafting and committing is orchestrated by `routers/admin.py` across `grounding.py`, `ingestion.py`, and `embedding.py`, leaking thread locking and vector encoding concerns into the HTTP router.
4. **Member State Leaks:** Account states such as password reset flags (`"must_reset|"`) and imported legacy accounts (`"legacy:"`) are stored and parsed as string prefixes inside `User.display_name`.

---

## 2. Decisions

We adopt a **Deep Modules** architecture with four cohesive modules placed at clean seams:

### 2.1 Recommendation Telemetry Seam (Candidate 1)
* Define a `RecommendationTelemetry` interface with two adapters:
  1. `PostgresTelemetryAdapter` (production): Translates artifact IDs, writes `RecommendationRequest` / `RecommendationResult` rows under non-blocking error handling, and dispatches online evaluation recomputation.
  2. `InMemoryTelemetryAdapter` / `NullTelemetryAdapter` (testing): Fast, zero-database in-memory recorder.
* `generate_recommendations(...)` accepts a telemetry adapter and remains 100% database-agnostic.

### 2.2 Deep Catalogue Module (Candidate 2)
* Consolidate read queries and caching into a unified `CatalogueModule` (in `services/catalogue.py`).
* Expose artifact-native queries (`get_item(artifact_id)`, `list_items(...)`).
* Encapsulate TTL caching, media attachment, live user state overlay, and transparent offline-fallback when PostgreSQL is disabled.
* Reduce `routers/catalog.py` to a thin HTTP mapping layer.

### 2.3 Consolidated Item Ingestion Module (Candidate 3)
* Deepen `ItemIngestionModule` to provide a 2-method interface: `draft_item(...)` and `commit_item(...)`.
* Encapsulate Layer A Jaccard matching, Layer B Gemini LLM schema generation, E5 text embedding (outside lock), Postgres commit, and in-memory `ArtifactLoader` update (under lock).

### 2.4 Unified Member Identity Module (Candidate 4)
* Consolidate account persistence, Google OAuth linking, and password reset token management into `MemberIdentityModule`.
* Parse legacy markers (`"must_reset|"`, `"legacy:"`) into typed domain attributes (`requires_password_reset: bool`, `is_legacy: bool`) at the repository boundary.

---

## 3. Consequences and Invariants

* **Testability:** Core scoring and catalogue logic can be tested with zero database mocks or live DB fixtures using in-memory adapters.
* **Locality:** Dual ID translation (`artifact_item_id` &harr; `items.id`) exists only inside `CatalogueModule` and `TelemetryModule`.
* **Reliability:** Telemetry write errors or database timeouts never block recommendation serving.
* **Universal ID Convention:** External callers and HTTP routes communicate exclusively via `artifact_item_id`.
