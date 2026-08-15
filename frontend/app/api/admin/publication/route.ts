import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { apiError } from "@/lib/server/api-response";
import { adminJsonMutation, isAdminResponse, requireAdmin } from "@/lib/server/admin-route";
import { ModelServiceUnavailableError } from "@/lib/server/model-service";
import {
  executePublication,
  publicationStatus,
} from "@/lib/server/publication";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Artifact Publication workflow (issue #8).
 *
 * GET — current publication state: latest recorded build, the list of
 *       catalogue rows waiting for a publication, and what the Private
 *       Model Service reports it is serving.
 * POST — execute an explicit Artifact Publication. Requires admin and a
 *        reachable, authenticated Private Model Service; every pending
 *        row becomes covered by the recorded build.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const admin = await requireAdmin(request);
  if (isAdminResponse(admin)) return admin;
  return NextResponse.json(await publicationStatus());
}

// fallow-ignore-next-line complexity -- Authorization, note parsing, and model-service failures are one admin boundary.
export async function POST(request: NextRequest): Promise<Response> {
  const authenticated = await adminJsonMutation(request);
  if (authenticated instanceof Response) return authenticated;
  const { admin, body } = authenticated;
  const note = typeof body.note === "string" ? body.note.trim() : "";
  try {
    return NextResponse.json(await executePublication(admin, note));
  } catch (error) {
    if (error instanceof ModelServiceUnavailableError) {
      return apiError(503, "model_service_unavailable", error.message);
    }
    return apiError(500, "internal_server_error", "The server could not complete this request.");
  }
}
