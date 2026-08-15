import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { apiError, internalApiError } from "@/lib/server/api-response";
import {
  generateRecommendations,
  RecommendationError,
} from "@/lib/server/recommendations";
import { authenticatedUser } from "@/lib/server/sessions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RecommendationBody {
  context_id?: unknown;
  keyword_ids?: unknown;
  top_k?: unknown;
  user_key?: unknown;
}

// fallow-ignore-next-line complexity -- Public input validation, session translation, and error mapping stay visible at the HTTP boundary.
export async function POST(request: NextRequest): Promise<Response> {
  let body: RecommendationBody;
  try {
    body = (await request.json()) as RecommendationBody;
  } catch {
    return apiError(400, "invalid_json", "Request body must be JSON.");
  }

  const contextId = Number(body.context_id);
  if (!Number.isSafeInteger(contextId) || contextId <= 0) {
    return apiError(422, "validation_error", "context_id must be a positive integer.");
  }
  if (body.keyword_ids !== undefined && !Array.isArray(body.keyword_ids)) {
    return apiError(422, "validation_error", "keyword_ids must be an array of positive integers.");
  }
  const keywordIds = (body.keyword_ids ?? []).map((value) => Number(value));
  if (keywordIds.some((value) => !Number.isSafeInteger(value) || value <= 0)) {
    return apiError(422, "validation_error", "keyword_ids must be positive integers.");
  }
  const topK = body.top_k === undefined ? 10 : Number(body.top_k);
  if (!Number.isSafeInteger(topK) || topK < 1 || topK > 50) {
    return apiError(422, "validation_error", "top_k must be between 1 and 50.");
  }
  const rawUserKey = body.user_key === undefined ? "" : String(body.user_key);
  if (rawUserKey.length > 150) {
    return apiError(422, "validation_error", "user_key must be at most 150 characters.");
  }

  try {
    // Session members personalize under ``user:<id>`` (their live actions
    // are recorded there); the body ``user_key`` applies only to anonymous
    // visitors, mirroring the legacy JWT-overrides-body rule.
    const user = await authenticatedUser(request);
    const userKey = user ? `user:${Number(user.id)}` : rawUserKey;
    const result = await generateRecommendations({
      contextId,
      keywordIds,
      topK,
      userKey,
      userId: user ? Number(user.id) : null,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof RecommendationError) {
      return apiError(error.status, error.code, error.message, error.extra);
    }
    return internalApiError();
  }
}
