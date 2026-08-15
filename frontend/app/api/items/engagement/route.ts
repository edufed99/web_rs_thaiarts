import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { apiError } from "@/lib/server/api-response";
import { engagementForArtifactIds } from "@/lib/server/live-stats";

export const runtime = "nodejs";

const RANGE_ALIASES: Record<string, number | undefined> = {
  all: undefined,
  "7d": 7,
  "30d": 30,
  "90d": 90,
  "365d": 365,
};

/**
 * ``GET /api/items/engagement?ids=...&range=30d`` — batch live-engagement
 * counters (likes + saves + positive ratings) per artifact item id,
 * sorted by engagement score descending with one zero row per requested
 * id that has no engagement. Anonymous, matching the legacy endpoint.
 */
// fallow-ignore-next-line complexity -- Range validation and the batch dispatch stay one public contract.
export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get("ids") ?? "";
  const ids = raw
    .split(",")
    .map((chunk) => Number(chunk.trim()))
    .filter((id) => Number.isSafeInteger(id) && id > 0);
  if (ids.length === 0) {
    return apiError(422, "validation_error", "At least one item id is required.");
  }
  if (ids.length > 200) {
    return apiError(422, "validation_error", "At most 200 item ids are allowed.");
  }
  const range = request.nextUrl.searchParams.get("range") ?? "all";
  const windowDays = RANGE_ALIASES[range.toLowerCase()];
  if (windowDays === undefined && range.toLowerCase() !== "all") {
    return apiError(422, "validation_error", `Unknown range: ${range}`);
  }
  return NextResponse.json(await engagementForArtifactIds(ids, windowDays));
}
