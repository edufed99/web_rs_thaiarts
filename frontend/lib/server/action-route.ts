import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { apiError } from "@/lib/server/api-response";
import { authenticatedJsonMutation } from "@/lib/server/member-route";
import { logView, setStateAction } from "@/lib/server/members";

// fallow-ignore-next-line complexity -- Validation and five member-action branches preserve one stable public contract.
export async function actionRoute(
  request: NextRequest,
  action: "like" | "unlike" | "save" | "unsave" | "rate" | "view",
): Promise<Response> {
  const authenticated = await authenticatedJsonMutation(request);
  if (authenticated instanceof Response) return authenticated;
  const { user, body } = authenticated;
  const itemId = Number(body.item_id);
  if (!Number.isSafeInteger(itemId) || itemId <= 0) return apiError(422, "validation_error", "Invalid item id.");
  if (action === "rate") {
    const rating = Number(body.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) return apiError(422, "validation_error", "Rating must be between 1 and 5.");
    const output = await setStateAction(user, itemId, action, rating);
    return output ? NextResponse.json(output) : apiError(404, "item_not_found", `Item id ${itemId} is not known.`);
  }
  if (action === "view") {
    const output = await logView(user, itemId);
    return output ? NextResponse.json(output) : apiError(404, "item_not_found", `Item id ${itemId} is not known.`);
  }
  const output = await setStateAction(user, itemId, action);
  return output ? NextResponse.json(output) : apiError(404, "item_not_found", `Item id ${itemId} is not known.`);
}
