import type { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/server/admin-route";
import { buildDashboardPayload, parseRangeDays } from "@/lib/server/dashboard";
import { buildDashboardReport } from "@/lib/server/dashboard-export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";


/**
 * ``GET /api/metrics/dashboard/export?range=30d`` — styled multi-sheet
 * Excel snapshot of the admin dashboard (issue #9). The selected range is
 * preserved and the download is restricted to authenticated
 * administrators; anonymous callers receive 401, non-admins 403.
 */
// fallow-ignore-next-line complexity -- Authorization, payload build, and workbook serialization are one export boundary.
export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (admin instanceof Response) return admin;
  const range = parseRangeDays(request.nextUrl.searchParams.get("range") ?? "30d");
  const payload = await buildDashboardPayload(range);
  const workbook = await buildDashboardReport(payload, admin.displayName || admin.username || "Admin");
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:]/g, "").replace("T", "_");
  const filename = `thai_arts_dashboard_${stamp}_${range}d.xlsx`;
  return new Response(workbook, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
