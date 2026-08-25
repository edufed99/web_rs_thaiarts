import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { apiError } from "@/lib/server/api-response";
import { adminJsonMutation, isAdminResponse, requireAdmin } from "@/lib/server/admin-route";
import { runBenchmarkEvaluation } from "@/lib/server/evaluation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Recommender Model Quality Benchmark API.
 *
 * POST — Execute an online benchmark evaluation from live interactions and
 *        telemetry, persisting the new row into ``evaluation_runs``.
 */
export async function POST(request: NextRequest): Promise<Response> {
  const authenticated = await adminJsonMutation(request).catch(async () => {
    const admin = await requireAdmin(request);
    if (isAdminResponse(admin)) return admin;
    return { admin, body: {} };
  });

  if (authenticated instanceof Response) return authenticated;
  const { admin } = authenticated;

  try {
    const quality = await runBenchmarkEvaluation(admin);
    return NextResponse.json({
      success: true,
      message: "Benchmark evaluation completed successfully.",
      quality,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to run benchmark evaluation.";
    return apiError(500, "evaluation_failed", message);
  }
}
