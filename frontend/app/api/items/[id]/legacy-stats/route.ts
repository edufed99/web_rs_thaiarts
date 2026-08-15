import { NextResponse } from "next/server";
import { apiError } from "@/lib/server/api-response";
import { legacyStatsForItem } from "@/lib/server/live-stats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";


/**
 * ``GET /api/items/{id}/legacy-stats`` — count and average rating of
 * legacy interactions for one item (artifact id space), sourced from the
 * live ``legacy_interactions`` table when present. Anonymous, matching the
 * legacy endpoint. Unknown ids return zeros.
 */
export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const raw = Number(params.id);
  if (!Number.isSafeInteger(raw) || raw <= 0) {
    return apiError(422, "validation_error", "Invalid item id.");
  }
  return NextResponse.json(await legacyStatsForItem(raw));
}
