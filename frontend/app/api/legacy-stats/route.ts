import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { apiError } from "@/lib/server/api-response";
import { legacyStatsBatch } from "@/lib/server/live-stats";

export const runtime = "nodejs";

/**
 * ``GET /api/legacy-stats?ids=...`` — batch form of the per-item legacy
 * stats endpoint (max 200 ids, unknown ids return zeros). Mounted at
 * ``/legacy-stats`` rather than ``/items/legacy-stats`` because the
 * catalogue router registers ``/items/{id}`` first, which would shadow a
 * literal sibling segment. Anonymous, matching the legacy endpoint.
 */
export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get("ids") ?? "";
  const ids = raw
    .split(",")
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => Number(chunk))
    .filter((id) => Number.isSafeInteger(id));
  if (ids.length === 0) {
    return apiError(422, "validation_error", "At least one item id is required.");
  }
  const result = await legacyStatsBatch(ids);
  return NextResponse.json({ stats: result.stats });
}
