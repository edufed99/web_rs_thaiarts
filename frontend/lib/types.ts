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

export interface ApiError {
  code: string;
  message: string;
  [key: string]: unknown;
}

// --- Auth + Admin ingest ----------------------------------------------------

export interface UserOut {
  id: number;
  username: string;
  display_name: string;
  is_admin: boolean;
  created_at: string | null;
  last_login_at: string | null;
}

export interface UserSignup {
  username: string;
  password: string;
  display_name?: string | null;
}

export interface UserProfileUpdate {
  display_name?: string | null;
  current_password?: string | null;
  new_password?: string | null;
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
