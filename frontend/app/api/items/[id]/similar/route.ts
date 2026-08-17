import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { apiError, internalApiError } from "@/lib/server/api-response";
import { getSimilarItems } from "@/lib/server/catalogue";
import { ModelServiceUnavailableError } from "@/lib/server/model-service";
import { integerInRange } from "@/lib/server/request-values";
import { authenticatedUser } from "@/lib/server/sessions";
import { personalizeItems } from "@/lib/server/members";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface SimilarItemsRouteContext {
  params: { id: string };
}

// fallow-ignore-next-line complexity -- Route preserves validation, not-found, and database error contracts.
export async function GET(
  request: NextRequest,
  context: SimilarItemsRouteContext,
): Promise<Response> {
  const itemId = integerInRange(context.params.id, 1, Number.MAX_SAFE_INTEGER);
  const limit = integerInRange(request.nextUrl.searchParams.get("limit") ?? "4", 1, 20);
  if (itemId === undefined || limit === undefined) {
    return apiError(422, "validation_error", "Invalid similar-items request.");
  }
  try {
    const result = await getSimilarItems(itemId, limit);
    if (!result) {
      return apiError(404, "item_not_found", `Item id ${itemId} not found.`, {
        item_id: itemId,
      });
    }
    const user = await authenticatedUser(request);
    return NextResponse.json(user ? { ...result, items: await personalizeItems(user, result.items) } : result);
  } catch (error) {
    if (error instanceof ModelServiceUnavailableError) {
      return apiError(503, "model_service_unavailable", error.message);
    }
    return internalApiError();
  }
}
