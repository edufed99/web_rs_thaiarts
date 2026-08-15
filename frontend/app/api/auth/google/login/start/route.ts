import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { apiError } from "@/lib/server/api-response";
import {
  LOGIN_STATE_COOKIE,
  GoogleLoginOAuthError,
  loadLoginClient,
  safeNextPath,
  startAuthorization,
  stateTtl,
} from "@/lib/server/google-login-oauth";
import { setStateCookie } from "@/lib/server/oauth-state-cookie";

export const runtime = "nodejs";

/**
 * Start member Google OpenID Connect: bind a signed PKCE flow cookie to this
 * browser, then send it to accounts.google.com. The redirect terminates in
 * Next.js at ``/api/auth/google/login/callback``.
 */
export async function GET(request: NextRequest): Promise<Response> {
  let authorizationUrl: string;
  let flow: { state: string; verifier: string; nextPath: string };
  try {
    ({ authorizationUrl, flow } = startAuthorization(request.nextUrl.searchParams.get("next")));
    // Verify the client is fully configured so unset deployments fail fast
    // with a structured error instead of a broken redirect.
    loadLoginClient();
  } catch (error) {
    if (error instanceof GoogleLoginOAuthError) {
      return apiError(400, "google_login_not_configured", error.message);
    }
    return apiError(400, "google_login_not_configured", "Google member login is not configured.");
  }
  const ttl = stateTtl();
  const response = NextResponse.redirect(authorizationUrl, 303);
  setStateCookie(response, LOGIN_STATE_COOKIE, {
    state: flow.state,
    verifier: flow.verifier,
    next: safeNextPath(flow.nextPath),
    iat: Math.floor(Date.now() / 1000),
  }, ttl);
  response.headers.set("Cache-Control", "no-store");
  return response;
}
