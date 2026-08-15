import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/admin-route";
import { buildAnalyticsPayload } from "@/lib/server/analytics";
import { parseRangeDays } from "@/lib/server/dashboard";

export const runtime = "nodejs";

/**
 * ``GET /api/metrics/analytics?range=30d`` — aggregate admin analytics:
 * trends, recommendation funnel and audience segments, and
 * evidence-grounded rule insights. Only aggregate statistics are included;
 * user identifiers never leave the application (issue #9). Admin-only.
 */
export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (admin instanceof Response) return admin;
  const range = parseRangeDays(request.nextUrl.searchParams.get("range") ?? "30d");
  return NextResponse.json(await buildAnalyticsPayload(range));
}
