import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { isAdminResponse, requireAdmin } from "@/lib/server/admin-route";
import { itemFacets } from "@/lib/server/admin-items";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Distinct ``category_group`` + ``performance_type`` values for the
 * admin form dropdowns (issue #8). Admin-only, DB-backed; parity with
 * the legacy ``GET /admin/items/facets``.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const admin = await requireAdmin(request);
  if (isAdminResponse(admin)) return admin;
  return NextResponse.json(await itemFacets());
}
