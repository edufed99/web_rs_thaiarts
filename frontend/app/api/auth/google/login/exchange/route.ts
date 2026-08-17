import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { LOGIN_STATE_COOKIE } from "@/lib/server/google-login-oauth";
import { completeGoogleLogin } from "@/lib/server/google-login-completion";
import { apiError } from "@/lib/server/api-response";
import { sameOriginJson } from "@/lib/server/member-route";
import { clearStateCookie, readStateCookie } from "@/lib/server/oauth-state-cookie";
import { setSessionCookie, userOut } from "@/lib/server/sessions";

export const runtime = "nodejs";

const EXPIRES_IN_SECONDS = 7 * 24 * 60 * 60;

/**
 * Consume a browser-bound Google login flow and return the session payload.
 *
 * The primary flow terminates at ``GET /api/auth/google/login/callback``;
 * this JSON contract is kept for the callback page's legacy direct-code path
 * and for clients that exchange through fetch. The signed state cookie set by
 * ``/api/auth/google/login/start`` carries the PKCE verifier; without it the
 * code cannot be exchanged, so replay against another browser fails closed.
 */
export async function POST(request: NextRequest): Promise<Response> {
  const body = await sameOriginJson(request);
  if (body instanceof Response) return body;
  const code = typeof body.code === "string" ? body.code.trim() : "";
  const state = typeof body.state === "string" ? body.state.trim() : "";
  if (!code || code.length > 2048) {
    return apiError(422, "validation_error", "Invalid Google login code.");
  }
  const pending = readStateCookie(request, LOGIN_STATE_COOKIE);
  if (!pending || !state) {
    return apiError(401, "invalid_google_state", "Google login state is invalid or expired.");
  }
  const outcome = await completeGoogleLogin(code, state, pending);
  if (!outcome.ok) {
    const status = outcome.error === "ambiguous_google_email" ? 409 : 401;
    return apiError(status, outcome.error, "Google login could not be completed.");
  }
  const response = NextResponse.json({
    expires_in_seconds: EXPIRES_IN_SECONDS,
    user: userOut(outcome.user),
  });
  setSessionCookie(response, outcome.token);
  clearStateCookie(response, LOGIN_STATE_COOKIE);
  return response;
}
