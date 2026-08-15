import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { apiError } from "@/lib/server/api-response";
import { adminJsonMutation } from "@/lib/server/admin-route";
import { deleteAdminItem, updateAdminItem } from "@/lib/server/admin-items";
import { itemMutationCaughtError } from "@/lib/server/admin-items-errors";
import { integerInRange } from "@/lib/server/request-values";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface ItemRouteContext {
  params: { id: string };
}

/**
 * Edit / delete one catalogue item by its immutable Artifact Item
 * Identifier (issue #8). Parity with the legacy ``PUT/DELETE
 * /admin/items/{item_id}``. Edits never touch ``artifact_item_id`` —
 * the DB trigger from migration 0004 rejects any attempt — and every
 * successful mutation marks the row unavailable to personalized scoring
 * until an explicit Artifact Publication succeeds.
 */
export async function PUT(request: NextRequest, context: ItemRouteContext): Promise<Response> {
  const artifactId = integerInRange(context.params.id, 1, Number.MAX_SAFE_INTEGER);
  if (artifactId === undefined) {
    return apiError(422, "validation_error", "path.id: Input should be a valid integer");
  }
  const authenticated = await adminJsonMutation(request);
  if (authenticated instanceof Response) return authenticated;
  const { admin, body } = authenticated;
  try {
    return NextResponse.json(await updateAdminItem(admin, artifactId, body));
  } catch (error) {
    return itemMutationCaughtError(error);
  }
}

export async function DELETE(request: NextRequest, context: ItemRouteContext): Promise<Response> {
  const artifactId = integerInRange(context.params.id, 1, Number.MAX_SAFE_INTEGER);
  if (artifactId === undefined) {
    return apiError(422, "validation_error", "path.id: Input should be a valid integer");
  }
  const authenticated = await adminJsonMutation(request);
  if (authenticated instanceof Response) return authenticated;
  const { admin } = authenticated;
  try {
    return NextResponse.json(await deleteAdminItem(admin, artifactId));
  } catch (error) {
    return itemMutationCaughtError(error);
  }
}
