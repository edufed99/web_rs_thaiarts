import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { apiError, internalApiError } from "@/lib/server/api-response";
import { listKeywords } from "@/lib/server/catalogue";
import { integerInRange } from "@/lib/server/request-values";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// fallow-ignore-next-line complexity -- Optional context validation is kept visible at the public HTTP boundary.
export async function GET(request: NextRequest): Promise<Response> {
  const params = request.nextUrl.searchParams;
  const limit = integerInRange(params.get("limit") ?? "200", 1, 1000);
  const contextId = params.has("context_id")
    ? integerInRange(params.get("context_id") ?? "", 1, Number.MAX_SAFE_INTEGER)
    : undefined;
  if (limit === undefined || (params.has("context_id") && contextId === undefined)) {
    return apiError(422, "validation_error", "Invalid keyword query parameters.");
  }
  try {
    return NextResponse.json({
      keywords: await listKeywords({
        search: params.get("search") ?? undefined,
        limit,
        contextId,
      }),
    });
  } catch {
    return internalApiError();
  }
}
