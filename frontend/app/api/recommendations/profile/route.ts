import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { apiError, internalApiError } from "@/lib/server/api-response";
import { isResponse, requireUser } from "@/lib/server/member-route";
import { generateProfileRecommendations } from "@/lib/server/recommendations";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// fallow-ignore-next-line complexity -- Session requirement and top-K bounds are checked before the profile service runs.
export async function GET(request: NextRequest): Promise<Response> {
  const user = await requireUser(request);
  if (isResponse(user)) return user;
  const rawTopK = request.nextUrl.searchParams.get("top_k");
  const topK = rawTopK === null ? 10 : Number(rawTopK);
  if (!Number.isSafeInteger(topK) || topK < 1 || topK > 50) {
    return apiError(422, "validation_error", "top_k must be between 1 and 50.");
  }
  try {
    return NextResponse.json(await generateProfileRecommendations(user, topK));
  } catch {
    return internalApiError();
  }
}
