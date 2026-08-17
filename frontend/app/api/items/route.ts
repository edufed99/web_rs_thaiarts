import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { apiError, internalApiError } from "@/lib/server/api-response";
import { listItems } from "@/lib/server/catalogue";
import { integerInRange, integerWithDefault } from "@/lib/server/request-values";
import { authenticatedUser } from "@/lib/server/sessions";
import { personalizeItems } from "@/lib/server/members";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// fallow-ignore-next-line complexity -- Route preserves validation, not-found, and database error contracts.
export async function GET(request: NextRequest): Promise<Response> {
  const params = request.nextUrl.searchParams;
  const limit = integerWithDefault(params.get("limit"), 20, 1, 200);
  const offset = integerWithDefault(params.get("offset"), 0, 0, Number.MAX_SAFE_INTEGER);
  const contextId = params.has("context")
    ? integerInRange(params.get("context"), 1, Number.MAX_SAFE_INTEGER)
    : undefined;
  if (
    limit === undefined ||
    offset === undefined ||
    (params.has("context") && contextId === undefined)
  ) {
    return apiError(422, "validation_error", "Invalid catalogue query parameters.");
  }
  try {
    const result = await listItems({
      search: params.get("search") ?? undefined,
      limit,
      offset,
      contextId: contextId ?? undefined,
    });
    if (!result && contextId !== undefined) {
      return apiError(
        404,
        "context_not_found",
        `Context id ${contextId} is not known.`,
        { context_id: contextId },
      );
    }
    const user = await authenticatedUser(request);
    return NextResponse.json(user && result ? { ...result, items: await personalizeItems(user, result.items) } : result);
  } catch {
    return internalApiError();
  }
}
