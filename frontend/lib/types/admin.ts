// lib/types/admin.ts — Admin users, Gmail OAuth, item ingest/draft, and
// dashboard/analytics payload types.
//
// Domain subset of the backend Pydantic contract (see ``lib/types.ts`` barrel).
// Covers the admin user management endpoints, the Gmail sender OAuth setup,
// the admin item ingest/draft journey and Artifact Publication (issue #8), and
// the admin-only dashboard (``/metrics/dashboard``) and analytics
// (``/metrics/analytics``) payloads.

import type { UserOut } from "./auth";
import type { ItemOut } from "./catalog";

// --- Admin user management --------------------------------------------------

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

// --- Gmail sender OAuth (admin) --------------------------------------------

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

// --- Item ingest / draft (admin) -------------------------------------------

export interface KeywordProposal {
  id: number;
  name: string;
  source: "auto" | "llm" | "human";
  confidence: number;
  taxonomy_path?: string;
  is_new?: boolean;
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
  new_keywords?: { name: string; taxonomy_path?: string }[];
}

export interface ItemCommitOut {
  item: ItemOut;
  warnings: string[];
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

export interface ContextCreateIn {
  name: string;
  group_name?: string;
  description?: string;
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

// --- Artifact Publication (issue #8) ----------------------------------------

export interface ArtifactPublicationOut {
  id: number;
  build_id: string;
  published_at: string;
  item_count: number;
  created_by: number;
  note: string;
}

export interface PublicationModelHealth {
  reachable: boolean;
  artifact_version: string;
  artifact_item_count: number;
  error?: string;
}

export interface PublicationStatusOut {
  /** Latest recorded publication, or null when none has succeeded yet. */
  published: ArtifactPublicationOut | null;
  /** Catalogue rows edited after the last publication (pending). */
  pending: {
    count: number;
    items: { id: number; name: string }[];
  };
  /** What the Private Model Service reports it is serving. */
  model: PublicationModelHealth;
}

export interface PublicationExecuteOut {
  publication: ArtifactPublicationOut;
  pending_after: number;
  warnings: string[];
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

/**
 * Top-keywords table inside the dashboard payload (``top_keywords``).
 * Kept separate from ``KeywordListOut`` (the keyword picker contract) —
 * the two mirror distinct backend schemas and must not merge.
 */
export interface TopKeywordListOut {
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
  top_keywords: TopKeywordListOut;
  page_quality: PageQualityOut;
  recent_activity: RecentActivityListOut;
}

// --- Admin analytics payload (/metrics/analytics) --------------------------

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
