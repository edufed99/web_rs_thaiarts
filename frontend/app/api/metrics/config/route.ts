import { NextResponse } from "next/server";
import { activeModelConfig } from "@/lib/server/metrics";

export const runtime = "nodejs";

/**
 * ``GET /api/metrics/config`` — the active recommender configuration the
 * Application Backend serves (from ``RECSYS_*`` env overrides). Anonymous,
 * matching the legacy endpoint's authorization boundary.
 */
export async function GET() {
  return NextResponse.json(activeModelConfig());
}
