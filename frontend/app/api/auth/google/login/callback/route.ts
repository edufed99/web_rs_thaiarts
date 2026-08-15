import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { LOGIN_STATE_COOKIE } from "@/lib/server/google-login-oauth";
import { completeGoogleLogin } from "@/lib/server/google-login-completion";
import { clearStateCookie, frontendBaseUrl, oauthRedirect, readStateCookie } from "@/lib/server/oauth-state-cookie";
import { setSessionCookie } from "@/lib/server/sessions";

export const runtime = "nodejs";

function frontendPageUrl(path: string): string {
  return `${frontendBaseUrl()}${path}`;
}

function callbackPage(errorCode: string): string {
  return frontendPageUrl(`/auth/google/callback?error=${encodeURIComponent(errorCode)}`);
}

/**
 * Next.js termination point for the member Google Login redirect. Exchanges
 * the one-time code with Google, verifies the ID token, resolves or creates
 * the local member, and establishes the Server Session. Errors are surfaced
 * as a same-origin redirect with a stable ``error`` code so the callback page
 * can render the Thai message without exposing any Google token material.
 */
// fallow-ignore-next-line complexity -- Each error branch maps one stable code; the success branch issues the session.
export async function GET(request: NextRequest): Promise<Response> {
  const search = request.nextUrl.searchParams;
  const code = (search.get("code") ?? "").trim();
  const state = (search.get("state") ?? "").trim();
  const error = search.get("error");

  if (error) {
    return oauthRedirect(callbackPage("google_access_denied"), LOGIN_STATE_COOKIE);
  }
  if (!code || !state) {
    return oauthRedirect(callbackPage("invalid_google_state"), LOGIN_STATE_COOKIE);
  }

  const outcome = await completeGoogleLogin(code, state, readStateCookie(request, LOGIN_STATE_COOKIE));
  if (!outcome.ok) {
    return oauthRedirect(callbackPage(outcome.error), LOGIN_STATE_COOKIE);
  }

  const response = NextResponse.redirect(
    frontendPageUrl(`/auth/google/callback?next=${encodeURIComponent(outcome.nextPath)}`),
    303,
  );
  // Issue the session cookie before expiring the pending-flow cookie so the
  // Set-Cookie order is stable for clients that read the first cookie.
  setSessionCookie(response, outcome.token);
  clearStateCookie(response, LOGIN_STATE_COOKIE);
  response.headers.set("Cache-Control", "no-store");
  return response;
}
