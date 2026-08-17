import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requestTrend } from "@/lib/server/metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";


/**
 * ``GET /api/metrics/requests?months=N`` — monthly recommendation-request
 * trend aggregated from the persisted ``recommendation_requests`` /
 * ``recommendation_results`` rows (issue #9). Anonymous, matching the
 * legacy endpoint's authorization boundary.
 */
export async function GET(request: NextRequest) {
  const raw = Number(request.nextUrl.searchParams.get("months"));
  const months = Number.isSafeInteger(raw) ? raw : 12;
  return NextResponse.json(await requestTrend(months));
}
