import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import type { ApplicationUser } from "@/db/entities/Members";
import { apiError } from "@/lib/server/api-response";
import { authenticatedUser, mutationIsSameOrigin } from "@/lib/server/sessions";

export function csrfFailure(request: NextRequest): Response | undefined {
  return mutationIsSameOrigin(request)
    ? undefined
    : apiError(403, "csrf_failed", "This request must originate from this application.");
}

export async function requireUser(request: NextRequest): Promise<ApplicationUser | Response> {
  const user = await authenticatedUser(request);
  return user ?? apiError(401, "unauthorized", "Authentication required.");
}

export async function requireAdmin(request: NextRequest): Promise<ApplicationUser | Response> {
  const user = await requireUser(request);
  if (isResponse(user)) return user;
  if (!user.isAdmin) return apiError(403, "admin_required", "Administrator privileges required.");
  return user;
}

export async function sameOriginJson(request: NextRequest): Promise<Record<string, unknown> | Response> {
  const csrf = csrfFailure(request);
  if (csrf) return csrf;
  try {
    return await request.json() as Record<string, unknown>;
  } catch {
    return apiError(400, "invalid_json", "Request body must be JSON.");
  }
}

export async function authenticatedJsonMutation(request: NextRequest): Promise<{ user: ApplicationUser; body: Record<string, unknown> } | Response> {
  const body = await sameOriginJson(request);
  if (body instanceof Response) return body;
  const user = await requireUser(request);
  return isResponse(user) ? user : { user, body };
}

export function isResponse(value: ApplicationUser | Response): value is Response {
  return value instanceof Response;
}

/** Trim a string body field; non-strings become the empty string. */
export function trimField(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

// fallow-ignore-next-line complexity -- Database constraint codes are normalized without exposing internals.
export function jsonError(error: unknown): NextResponse {
  const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
  if (code === "23505") return apiError(409, "already_exists", "That username or email is already in use.");
  return apiError(500, "internal_server_error", "The server could not complete this request.");
}
