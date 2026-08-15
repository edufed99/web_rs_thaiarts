import { EntitySchema } from "typeorm";

/**
 * One snapshot of a recommendation request served by the Application
 * Backend. Mirrors the legacy Alembic 0006 table so the existing dashboard
 * trend queries (``/metrics/requests``) keep reading the same rows the
 * legacy FastAPI used to write.
 */
interface RecommendationRequestRow {
  id: number;
  userId: number | null;
  selectedContextId: number;
  candidateCount: number;
  topK: number;
  method: string;
  metadataJson: string;
  createdAt: Date;
}

interface RecommendationRequestSelectedKeywordRow {
  id: number;
  requestId: number;
  keywordId: number;
}

/** One ranked result inside a ``RecommendationRequest``. */
interface RecommendationResultRow {
  id: number;
  requestId: number;
  itemId: number;
  rank: number;
  cbfScore: number;
  cfScore: number;
  hybridScore: number;
  isContextValid: boolean;
  matchedKeywordsJson: string;
  explanation: string;
}

export const RecommendationRequestEntity = new EntitySchema<RecommendationRequestRow>({
  name: "RecommendationRequest",
  tableName: "recommendation_requests",
  columns: {
    id: { type: "bigint", primary: true, generated: "increment" },
    userId: { name: "user_id", type: "bigint", nullable: true },
    selectedContextId: { name: "selected_context_id", type: "bigint" },
    candidateCount: { name: "candidate_count", type: "int" },
    topK: { name: "top_k", type: "int" },
    method: { type: String, length: 80 },
    metadataJson: { name: "metadata_json", type: "text", default: "" },
    createdAt: { name: "created_at", type: "timestamptz", createDate: true },
  },
});

export const RecommendationRequestSelectedKeywordEntity = new EntitySchema<RecommendationRequestSelectedKeywordRow>({
  name: "RecommendationRequestSelectedKeyword",
  tableName: "recommendation_request_selected_keywords",
  columns: {
    id: { type: "bigint", primary: true, generated: "increment" },
    requestId: { name: "request_id", type: "bigint" },
    keywordId: { name: "keyword_id", type: "bigint" },
  },
});

export const RecommendationResultEntity = new EntitySchema<RecommendationResultRow>({
  name: "RecommendationResult",
  tableName: "recommendation_results",
  columns: {
    id: { type: "bigint", primary: true, generated: "increment" },
    requestId: { name: "request_id", type: "bigint" },
    itemId: { name: "item_id", type: "bigint" },
    rank: { type: "int" },
    cbfScore: { name: "cbf_score", type: "float" },
    cfScore: { name: "cf_score", type: "float" },
    hybridScore: { name: "hybrid_score", type: "float" },
    isContextValid: { name: "is_context_valid", type: Boolean, default: true },
    matchedKeywordsJson: { name: "matched_keywords_json", type: "text", default: "[]" },
    explanation: { type: "text", default: "" },
  },
});
