// lib/types/catalog.ts — Catalogue, recommendation, and health/metrics types.
//
// Domain subset of the backend Pydantic contract (see ``lib/types.ts`` barrel).
// Covers the public catalogue endpoints (``/items``, ``/contexts``, ``/keywords``),
// the recommendation endpoints (``/recommendations``), the live user actions
// (``/actions``), and the compatibility metrics endpoints
// (``/health``, ``/metrics*``, ``/items/engagement``, ``/items/{id}/legacy-stats``).

export interface ContextOut {
  id: number;
  name: string;
  name_en?: string | null;
  group: string;
  description: string;
  description_en?: string | null;
  active_item_count: number;
}

export interface KeywordOut {
  id: number;
  name: string;
  name_en?: string | null;
  taxonomy_path: string;
}

export interface UserState {
  liked: boolean;
  saved: boolean;
  rating: number;
}

export interface ItemOut {
  id: number;
  name: string;
  name_en?: string | null;
  description: string;
  description_en?: string | null;
  category_group: string;
  category_group_en?: string | null;
  performance_type: string;
  performance_type_en?: string | null;
  performers_count: number | null;
  duration_minutes: number | null;
  price_text: string;
  image_url: string;
  video_url: string;
  keywords: KeywordOut[];
  contexts: ContextOut[];
  user_state: UserState;
  /**
   * Display-only match percent in [82, 98] (legacy catalog heuristic).
   * Populated by ``GET /items`` (browse + ranked modes), ``GET /items/{id}``,
   * and every row of ``POST /recommendations``. Mirrors the legacy
   * ``catalog.views.catalog_match_percent`` formula — it never affects the
   * recommendation ranking itself.
   */
  match_percent: number | null;
  suitability_label: string | null;
  suitability_label_en?: string | null;
}

export interface ScoresOut {
  cbf: number;
  cf: number;
  hybrid: number;
}

export interface RecommendationResultOut {
  rank: number;
  item: ItemOut;
  scores: ScoresOut;
  is_context_valid: boolean;
  matched_keywords: string[];
  explanation: string;
  match_percent: number;
  suitability_label: string;
  suitability_label_en?: string | null;
}

export interface RecommendationRequestIn {
  context_id: number;
  keyword_ids: number[];
  top_k: number;
  user_key?: string;
}

export interface RecommendationResponseOut {
  request_id: string;
  selected_context: ContextOut;
  selected_keywords: KeywordOut[];
  candidate_count: number;
    top_k: number;
    method: string;
    embedding_backend: "e5" | "proxy";
    embedding_latency_ms: number;
    metadata: Record<string, unknown>;
  results: RecommendationResultOut[];
}

export interface ProfileRecommendationResponseOut {
  request_id: string;
  top_k: number;
  method: string;
  history_count: number;
  metadata: Record<string, unknown>;
  results: RecommendationResultOut[];
}

export interface ItemListOut {
  items: ItemOut[];
  total: number;
}

export interface KeywordListOut {
  keywords: KeywordOut[];
}

export interface ContextListOut {
  contexts: ContextOut[];
}

export interface HealthOut {
  status: "ok" | "degraded";
  version: string;
  artifacts_loaded_at: string | null;
  item_count: number;
  context_count: number;
  embedding_dim: number;
}

// --- Live user actions ------------------------------------------------------

export interface ActionRequestIn {
  user_key: string;
  item_id: number;
  request_id?: string | null;
  context_id?: number | null;
  rating?: number | null;
}

export interface ItemActionOut {
  item: ItemOut;
  action: "liked" | "unliked" | "saved" | "unsaved" | "rated";
  rating: number | null;
  metadata: Record<string, unknown>;
}

/** Body for POST /actions/view (ADR-002 §3.1). No rating — a view has no undo. */
export interface ViewRequestIn {
  user_key: string;
  item_id: number;
  /** Recommendation id, when the view came from a recommendation. */
  request_id?: string | null;
  context_id?: number | null;
}

export interface ItemViewOut {
  action: "viewed";
  item_id: number;
  /** True when an identical view already existed inside the dedupe window. */
  deduped: boolean;
}

export interface MetricsOut {
  item_count: number;
  context_count: number;
  keyword_count: number;
  positive_user_count: number;
  unique_item_user_edges: number;
  embedding_dim: number;
  artifacts_loaded_at: string;
  config_hash: string;
}

/**
 * Real per-item stats from the live ``legacy_interactions`` Postgres table.
 * Surfaced via ``GET /items/{id}/legacy-stats``. When the DB is disabled
 * the endpoint returns zeros — components should treat ``count`` as
 * "no legacy feedback yet" and fall back to a neutral display.
 */
export interface LegacyStatsOut {
  item_id: number;
  count: number;
  avg_rating: number;
  source: "postgres" | "disabled";
}

/**
 * Per-item engagement counters surfaced via ``GET /items/engagement``.
 * Combines ``likes`` + ``saved_items`` + positive (rating ≥ 4)
 * ``ratings`` rows from the live Postgres tables. ``engagement_score``
 * is the simple sum used as a primary sort key for the homepage
 * "ชุดการแสดงยอดนิยม" section. Unrated items come back with all zeros.
 */
export interface EngagementOut {
  item_id: number;
  like_count: number;
  save_count: number;
  rating_count: number;
  engagement_score: number;
}

export interface EngagementListOut {
  engagements: EngagementOut[];
  source: "postgres" | "disabled";
}

/**
 * One month-bucket of the dashboard trend chart. Surface via
 * ``GET /metrics/requests?months=12``.
 */
export interface RequestTrendBucket {
  year: number;
  month: number;
  label: string;
  request_count: number;
  shown_count: number;
}

export interface RequestTrendOut {
  months: number;
  total_requests: number;
  total_shown: number;
  source: "postgres" | "disabled";
  buckets: RequestTrendBucket[];
}

/**
 * Active recommender configuration served by the backend — mirrors
 * ``artifacts/outputs/best_model_config.json`` plus runtime env overrides.
 * Surface via ``GET /metrics/config``. Used by the dashboard so the model
 * sliders show real values instead of placeholders.
 */
export interface ModelConfigOut {
  cbf_model: string;
  cf_model: string;
  hybrid_method: string;
  hybrid_alpha: number | null;
  candidate_strategy: string;
  embedding_dim: number | null;
  itemknn_k: number | null;
  itemknn_shrink: number | null;
  cbf_keyword_boost: number | null;
  positive_threshold: number | null;
  extra: Record<string, unknown>;
}

export interface ApiError {
  code: string;
  message: string;
  [key: string]: unknown;
}
