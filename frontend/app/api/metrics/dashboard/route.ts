import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/admin-route";
import { buildDashboardPayload, parseRangeDays } from "@/lib/server/dashboard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";


/**
 * ``GET /api/metrics/dashboard?range=30d`` — full admin dashboard payload
 * (KPI strip, trends, heatmap, categories, quality, recent activity),
 * computed from the persisted Application Backend tables (issue #9).
 * Admin-only: anonymous callers get 401, authenticated non-admins 403 —
 * the same boundary the legacy FastAPI enforced with the admin JWT.
 */
export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (admin instanceof Response) return admin;
  const range = parseRangeDays(request.nextUrl.searchParams.get("range") ?? "30d");
  return NextResponse.json(await buildDashboardPayload(range));
}
