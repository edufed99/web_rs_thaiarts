import { NextResponse } from "next/server";
import { corpusMetrics } from "@/lib/server/metrics";

export const runtime = "nodejs";

/**
 * ``GET /api/metrics`` — corpus + live-table metrics for the homepage and
 * researcher tooling. Anonymous, like the legacy endpoint it replaces.
 * Item/context/keyword counts come from the live tables; artifact-owned
 * CF fields are zeroed (the Application Backend never opens artifacts).
 */
export async function GET() {
  return NextResponse.json(await corpusMetrics());
}
