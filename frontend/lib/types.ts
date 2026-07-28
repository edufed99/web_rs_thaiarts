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