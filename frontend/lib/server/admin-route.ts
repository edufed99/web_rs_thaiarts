import type { NextRequest } from "next/server";

import type { ApplicationUser } from "@/db/entities/Members";
import { apiError } from "@/lib/server/api-response";
import { authenticatedUser, mutationIsSameOrigin } from "@/lib/server/sessions";

/**
 * Admin-only authorization boundary for the Application Backend.
 *
 * Every administrative route handler funnels through these helpers so
 * the rejection contract is uniform: anonymous callers receive 401 and
 * authenticated non-admins receive 403 — enforced server-side, never
 * only in the UI.
 */

export async function requireAdmin(
  request: NextRequest,
): Promise<ApplicationUser | Response> {
  const user = await authenticatedUser(request);
  if (!user) {
    return apiError(401, "unauthorized", "Authentication required.");
  }
  if (!user.isAdmin) {
    return apiError(403, "forbidden", "Administrator privileges are required.");
  }
  return user;
}

/**
 * CSRF + admin + JSON body in one boundary, for admin write endpoints.
 * Returns either the authenticated admin plus parsed body, or the error
 * response to return directly.
 *
 * Authorization is checked before the body is parsed so that bodyless
 * mutations (e.g. DELETE) still reject non-admins with 403 rather than
 * a misleading 400.
 */
// fallow-ignore-next-line complexity -- CSRF, authorization, and body parsing are one security boundary.
export async function adminJsonMutation(
  request: NextRequest,
): Promise<{ admin: ApplicationUser; body: Record<string, unknown> } | Response> {
  if (!mutationIsSameOrigin(request)) {
    return apiError(403, "csrf_failed", "This request must originate from this application.");
  }
  const admin = await requireAdmin(request);
  if (admin instanceof Response) return admin;
  // Bodyless mutations (DELETE) legitimately have no JSON payload.
  const raw = await request.text();
  let body: Record<string, unknown> = {};
  if (raw.length > 0) {
    try {
      body = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return apiError(400, "invalid_json", "Request body must be JSON.");
    }
  }
  return { admin, body };
}

export function isAdminResponse(value: ApplicationUser | Response): value is Response {
  return value instanceof Response;
}
