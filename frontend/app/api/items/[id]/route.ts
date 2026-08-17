import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { apiError, internalApiError } from "@/lib/server/api-response";
import { getItem } from "@/lib/server/catalogue";
import { integerInRange } from "@/lib/server/request-values";
import { authenticatedUser } from "@/lib/server/sessions";
import { personalizeItems } from "@/lib/server/members";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface ItemRouteContext {
  params: { id: string };
}

// fallow-ignore-next-line complexity -- Route preserves validation, not-found, and database error contracts.
export async function GET(
  request: NextRequest,
  context: ItemRouteContext,
): Promise<Response> {
  const itemId = integerInRange(context.params.id, 1, Number.MAX_SAFE_INTEGER);
  if (itemId === undefined) {
    return apiError(422, "validation_error", "path.id: Input should be a valid integer");
  }
  try {
    const item = await getItem(itemId);
    if (!item) {
      return apiError(404, "item_not_found", `Item id ${itemId} not found.`, {
        item_id: itemId,
      });
    }
    const user = await authenticatedUser(request);
    return NextResponse.json(user ? (await personalizeItems(user, [item]))[0] : item);
  } catch {
    return internalApiError();
  }
}
