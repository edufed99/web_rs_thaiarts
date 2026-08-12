// lib/types.ts — TypeScript mirrors of the backend Pydantic schemas.
//
// These types are hand-aligned with backend/app/schemas/. They are the contract
// that the typed fetch client (lib/api.ts) and the React components share.

export interface ContextOut {
  id: number;
  name: string;
  group: string;
  description: string;
  active_item_count: number;
}

export interface KeywordOut {
  id: number;
  name: string;
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
  description: string;
  category_group: string;
  performance_type: string;
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

// --- Auth + Admin ingest ----------------------------------------------------

// --- Member summary (member_user sidebar) ----------------------------------

export interface InterestBucket {
  name: string;
  percent: number;
  is_top: boolean;
}

export interface UserSummaryOut {
  user_key: string;
  liked_count: number;
  saved_count: number;
  rated_count: number;
  recent_view_count: number;
  interests: InterestBucket[];
  has_activity: boolean;
  source: "postgres" | "disabled";
}

export interface RatingBucketOut {
  stars: number;
  count: number;
}

export interface RatingSummaryOut {
  average: number;
  total: number;
  distribution: RatingBucketOut[];
}

export interface HistoryEntryOut {
  log_id: number;
  item_id: number;
  item_name: string;
  context_name: string;
  action_type: string;
  rating: number | null;
  created_at: string;
}

export interface HistoryListOut {
  items: HistoryEntryOut[];
  total: number;
}

export interface SavedItemsOut {
  items: number[];
  total: number;
}

export interface LikedItemsOut {
  items: number[];
  total: number;
}

export interface RatedItemOut {
  item_id: number;
  rating: number;
  updated_at: string;
}

export interface RatedItemsOut {
  items: RatedItemOut[];
  total: number;
}

export interface RecentViewOut {
  item_id: number;
  item_name: string;
  viewed_at: string;
}

export interface RecentViewsOut {
  items: RecentViewOut[];
  total: number;
  window_days: number;
}

export type MemberRole = "user" | "super_admin";

export interface MemberProfileOut {
  user_id: number;
  username: string;
  email: string;
  display_name: string;
  avatar_url: string;
  bio: string;
  role: MemberRole;
  created_at: string | null;
  last_login_at: string | null;
  updated_at: string | null;
}

export interface MemberProfileUpdate {
  display_name?: string | null;
  avatar_url?: string | null;
  bio?: string | null;
}

export interface MemberDashboardOut {
  profile: MemberProfileOut;
  summary: UserSummaryOut;
  recent_activity: HistoryListOut;
  recent_views: RecentViewsOut;
}

export interface UserOut {
  id: number;
  username: string;
  email: string;
  display_name: string;
  is_admin: boolean;
  role: MemberRole;
  created_at: string | null;
  last_login_at: string | null;
}

export interface AdminUserCreate {
  username: string;
  email?: string | null;
  password: string;
  display_name?: string | null;
  is_admin: boolean;
}

export interface AdminUserUpdate {
  username?: string | null;
  email?: string | null;
  password?: string | null;
  display_name?: string | null;
  is_admin?: boolean | null;
}

export interface AdminUserListOut {
  users: UserOut[];
  total: number;
}

export interface AdminUserDeleteOut {
  deleted: boolean;
  user_id: number;
}

export interface UserSignup {
  username: string;
  email?: string | null;
  password: string;
  display_name?: string | null;
}

export interface UserProfileUpdate {
  username?: string | null;
  email?: string | null;
  display_name?: string | null;
  current_password?: string | null;
  new_password?: string | null;
}

export interface PasswordResetRequest {
  username: string;
  email: string;
}

export interface PasswordResetRequestOut {
  accepted: boolean;
  credentials_valid: boolean;
  email_sent: boolean;
  delivery_configured: boolean;
  message: string;
}

export interface PasswordResetConfirm {
  username: string;
  token: string;
  new_password: string;
}

export interface PasswordResetConfirmOut {
  reset: boolean;
  message: string;
}

export interface GmailOAuthStatusOut {
  client_configured: boolean;
  authorized: boolean;
  delivery_configured: boolean;
  sender_email: string;
  redirect_uri: string;
}

export interface GmailOAuthStartOut {
  authorization_url: string;
}

export interface UserLogin {
  username: string;
  password: string;
}

export interface TokenOut {
  access_token: string;
  token_type: "bearer" | string;
  expires_in_seconds: number;
  user: UserOut;
}

export interface KeywordProposal {
  id: number;
  name: string;
  source: "auto" | "llm" | "human";
  confidence: number;
}

export interface ItemDraft {
  name: string;
  description?: string;
  category_group?: string;
  performance_type?: string;
  performers_count?: number | null;
  duration_minutes?: number | null;
  price_text?: string;
  context_names: string[];
  keyword_names: string[];
}

export interface ItemDraftOut {
  draft_id: string;
  proposals: KeywordProposal[];
  context_ids: number[];
  warnings: string[];
}

export interface ItemCreate {
  name: string;
  description?: string;
  category_group?: string;
  performance_type?: string;
  performers_count?: number | null;
  duration_minutes?: number | null;
  price_text?: string;
  context_names: string[];
  keyword_ids: number[];
}

export interface ItemCommit {
  draft_id: string;
  additional_keyword_ids: number[];
  removed_keyword_ids: number[];
}

export interface ItemCommitOut {
  item: ItemOut;
  warnings: string[];
}

export interface ItemKeywordReassign {
  keyword_ids: number[];
}

export interface ItemReassignOut {
  item: ItemOut;
  warnings: string[];
}

export interface ItemUpdate {
  name?: string;
  description?: string;
  category_group?: string;
  performance_type?: string;
  performers_count?: number | null;
  duration_minutes?: number | null;
  price_text?: string;
  image_url?: string;
  video_url?: string;
  is_active?: boolean;
  context_names?: string[];
  keyword_ids?: number[];
  new_keyword_names?: string[];
}

export interface ItemDeleteOut {
  item_id: number;
  deleted: boolean;
  warnings: string[];
}

export interface ItemFacetsOut {
  category_groups: string[];
  performance_types: string[];
  /**
   * Cascade map: ``หมวดหมู่`` dropdown options filtered by the
   * selected ``ประเภทการแสดง``. Keys are performance_type strings;
   * values are the category_groups seen with that performance_type
   * in the corpus.
   */
  category_groups_by_performance_type: Record<string, string[]>;
  source: "db" | "artifact";
}

export interface ItemImageUploadOut {
  /** Public URL where the image is served (e.g. ``/uploads/items/abc.jpg``). */
  url: string;
  size_bytes: number;
  /** Sniffed MIME type (``image/jpeg`` | ``image/png`` | ``image/webp``). */
  mime: string;
  item_id: number;
}

export interface ItemVideoUploadOut {
  /** Public URL where the video is served (e.g. ``/uploads/items/abc.mp4``). */
  url: string;
  size_bytes: number;
  /** Sniffed MIME type (MP4, WebM, or QuickTime). */
  mime: string;
  item_id: number;
}

// --- Admin dashboard payload (Phase 3 /metrics/dashboard) ------------------

/**
 * One tile in the 6-tile KPI strip rendered above the trend chart.
 *
 * ``value`` is pre-formatted by the backend for direct display
 * (``"1,248"``, ``"8.6%"``). ``raw_value`` is the unformatted number
 * (or ratio for percentages) so client-side tools can re-format.
 *
 * ``tone`` drives the tile's accent color:
 *  ``neutral`` (default), ``positive``, ``warning``, ``danger``.
 */
export interface KpiTile {
  label: string;
  value: string;
  raw_value: number;
  delta_pct: number | null;
  tone: "neutral" | "positive" | "warning" | "danger";
  hint: string;
}

/** Six-tile KPI strip on the dashboard. */
export interface KpiStripOut {
  members: KpiTile;
  performances: KpiTile;
  indices: KpiTile;
  points: KpiTile;
  active_users: KpiTile;
  sessions: KpiTile;
}

/**
 * Generic time-series bucket container used both for the activity
 * trend (sessions/searches/ratings per day) and the quality trend
 * (nDCG/HR/MRR per day). When used for the activity trend, the
 * ``*_10`` arrays are empty.
 */
export interface TrendOut {
  labels: string[];
  sessions: number[];
  searches: number[];
  ratings: number[];
  ndcg10: number[];
  hr10: number[];
  mrr10: number[];
}

export interface UserGrowthOut {
  labels: string[];
  new_users: number[];
  active_users: number[];
}

/**
 * 7×24 usage heatmap. ``matrix[weekday][hour]`` is the count of
 * interaction events in that bucket. ``weekday_labels`` is 7 short
 * Thai day labels (อา. / จ. / อ. / etc.), ``hour_labels`` is the
 * hour ticks on the x-axis.
 */
export interface HeatmapOut {
  weekday_labels: string[];
  hour_labels: string[];
  matrix: number[][];
  max_value: number;
}

export interface CategoryItem {
  name: string;
  count: number;
  pct: number;
}

export interface CategoryListOut {
  items: CategoryItem[];
  total_items: number;
}

export interface SubContextItem {
  name: string;
  count: number;
  pct: number;
}

export interface SubContextListOut {
  items: SubContextItem[];
  total_requests: number;
}

/** One row of the top-search-terms table. */
export interface TopSearchRow {
  rank: number;
  term: string;
  searches: number;
  views: number;
  ratings: number;
  likes: number;
  score: number;
}
export interface TopSearchListOut {
  items: TopSearchRow[];
}

/** One bucket in the 1-5 star rating distribution. */
export interface RatingDistributionBucket {
  star: number;
  count: number;
  pct: number;
}
export interface RatingDistributionOut {
  buckets: RatingDistributionBucket[];
  average: number;
  total: number;
}

/**
 * Five quality tiles for the "ประสิทธิภาพการแนะนำแบบเข้าใจ" row.
 * ``source`` indicates provenance of the numbers: ``"online"`` (most
 * recent live recompute), ``"offline"`` (holdout run from the
 * offline evaluation pipeline), ``"unavailable"`` (no evaluation
 * row yet — UI shows zeros).
 */
export interface ModelQualityOut {
  ndcg10: number;
  hr10: number;
  mrr10: number;
  coverage: number;
  violation_rate: number;
  source: "online" | "offline" | "unavailable";
  ran_at: string;
  test_user_count: number;
  test_interaction_count: number;
}

/** Funnel summary for the recommendation click-through card. */
export interface AlgorithmKpiOut {
  search_total: number;
  search_to_detail_total: number;
  search_to_detail_pct: number;
  items_shown_total: number;
  ctr_pct: number;
  delta_pct: number | null;
}

export interface KeywordRow {
  rank: number;
  term: string;
  count: number;
}

export interface KeywordListOut {
  items: KeywordRow[];
}

/** One progress bar in the data-quality summary card. */
export interface PageQualityMetric {
  name: string;
  value: number;
  target: number;
  tone: "success" | "warning" | "danger";
}
export interface PageQualityOut {
  metrics: PageQualityMetric[];
  open_issues: number;
}

/** One row in the recent activity feed table. */
export interface RecentActivityRow {
  log_id: number;
  time: string;
  action: string;
  target: string;
  user: string;
  type: string;
}
export interface RecentActivityListOut {
  items: RecentActivityRow[];
}

/**
 * Top-level dashboard payload from ``GET /metrics/dashboard``. Mirrors
 * the backend Pydantic ``DashboardOut``. The frontend never reads
 * from DB tables directly — it consumes this single round-trip
 * payload and renders the 14 sections above.
 */
export interface DashboardOut {
  range_days: number;
  generated_at: string;
  source: "postgres" | "disabled";

  kpis: KpiStripOut;
  trend_30d: TrendOut;
  user_growth: UserGrowthOut;
  usage_heatmap: HeatmapOut;
  popular_categories: CategoryListOut;
  popular_subcontexts: SubContextListOut;
  top_search_terms: TopSearchListOut;
  rating_distribution: RatingDistributionOut;
  model_quality: ModelQualityOut;
  quality_trend_30d: TrendOut;
  algorithm_kpis: AlgorithmKpiOut;
  top_keywords: KeywordListOut;
  page_quality: PageQualityOut;
  recent_activity: RecentActivityListOut;
}

export interface FunnelStep {
  key: string;
  label: string;
  count: number;
  rate_from_previous: number;
  conversion_from_start: number;
}

export interface ActionBreakdownRow {
  action: string;
  label: string;
  count: number;
  pct: number;
}

export interface KeywordPairRow {
  left: string;
  right: string;
  count: number;
}

export interface AudienceSegment {
  key: string;
  label: string;
  count: number;
  pct: number;
  definition: string;
}

export interface BehaviorAnalyticsOut {
  funnel: FunnelStep[];
  actions: ActionBreakdownRow[];
  keyword_pairs: KeywordPairRow[];
  audience_segments: AudienceSegment[];
  active_users: number;
  returning_users: number;
  engaged_users: number;
  engagement_rate: number;
}

export interface InsightCard {
  id: string;
  title: string;
  summary: string;
  evidence: string[];
  recommendation: string;
  confidence: number;
  tone: "positive" | "neutral" | "warning" | "danger";
}

export interface AIInsightsOut {
  engine: "rules" | "gemini";
  generated_at: string;
  cached: boolean;
  cache_ttl_seconds: number;
  privacy_notice: string;
  items: InsightCard[];
}

export interface AnalyticsOut {
  range_days: number;
  generated_at: string;
  source: "postgres" | "disabled";
  trends: DashboardOut;
  behavior: BehaviorAnalyticsOut;
  ai_insights: AIInsightsOut;
}
