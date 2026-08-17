// lib/recommendations.ts — POST /recommendations + profile recommendations.

import type {
  ProfileRecommendationResponseOut,
  RecommendationRequestIn,
  RecommendationResponseOut,
} from "./types";
import { baseUrl, handle, mutationHeaders } from "./http";

export async function postRecommendations(
  body: RecommendationRequestIn,
  extraHeaders: Record<string, string> = {},
): Promise<RecommendationResponseOut> {
  const res = await fetch(`${baseUrl()}/recommendations`, {
    method: "POST",
    headers: mutationHeaders({ "Content-Type": "application/json", ...extraHeaders }),
    credentials: "same-origin",
    body: JSON.stringify(body),
    cache: "no-store",
  });
  return handle<RecommendationResponseOut>(res);
}

export async function getProfileRecommendations(
  opts?: { topK?: number; extraHeaders?: Record<string, string> },
): Promise<ProfileRecommendationResponseOut> {
  const params = new URLSearchParams();
  if (opts?.topK !== undefined) params.set("top_k", String(opts.topK));
  const url = `${baseUrl()}/recommendations/profile${params.toString() ? `?${params.toString()}` : ""}`;
  const res = await fetch(url, {
    headers: { ...(opts?.extraHeaders ?? {}) },
    cache: "no-store",
  });
  return handle<ProfileRecommendationResponseOut>(res);
}
