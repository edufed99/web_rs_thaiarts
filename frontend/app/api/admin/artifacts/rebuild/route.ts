import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { apiError, internalApiError } from "@/lib/server/api-response";
import { isAdminResponse, requireAdmin } from "@/lib/server/admin-route";
import { ModelServiceUnavailableError } from "@/lib/server/model-service";
import { triggerArtifactRebuild } from "@/lib/server/artifact-rebuild";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest): Promise<Response> {
  const admin = await requireAdmin(request);
  if (isAdminResponse(admin)) return admin;

  let body: { synthetic?: boolean } = {};
  try {
    const raw = await request.text();
    if (raw.trim()) {
      body = JSON.parse(raw);
    }
  } catch {
    return apiError(400, "invalid_json", "Malformed JSON body.");
  }

  try {
    const result = await triggerArtifactRebuild({ synthetic: body.synthetic });
    return NextResponse.json({
      status: "ok",
      rebuild: result,
    });
  } catch (error) {
    if (error instanceof ModelServiceUnavailableError) {
      return apiError(503, "model_service_unavailable", error.message);
    }
    return internalApiError();
  }
}
