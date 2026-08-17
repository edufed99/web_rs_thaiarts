import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { apiError } from "@/lib/server/api-response";
import { csrfFailure, isResponse, requireAdmin } from "@/lib/server/member-route";
import {
  GMAIL_STATE_COOKIE,
  GmailOAuthError,
  pendingTtlSeconds,
  startAuthorization,
} from "@/lib/server/gmail-oauth";
import { setStateCookie } from "@/lib/server/oauth-state-cookie";

export const runtime = "nodejs";

/** Admin-only: create a short-lived Google consent URL for the sender mailbox. */
// fallow-ignore-next-line complexity -- CSRF, admin authorization, and configuration failures each fail closed.
export async function POST(request: NextRequest): Promise<Response> {
  const csrf = csrfFailure(request);
  if (csrf) return csrf;
  const admin = await requireAdmin(request);
  if (isResponse(admin)) return admin;

  let authorizationUrl: string;
  let state: string;
  let verifier: string;
  try {
    ({ authorizationUrl, state, verifier } = await startAuthorization());
  } catch (error) {
    if (error instanceof GmailOAuthError) {
      return apiError(400, "gmail_oauth_not_configured", error.message);
    }
    return apiError(400, "gmail_oauth_not_configured", "Google OAuth client is not configured.");
  }
  const ttl = pendingTtlSeconds();
  const response = NextResponse.json({ authorization_url: authorizationUrl });
  setStateCookie(response, GMAIL_STATE_COOKIE, {
    state,
    verifier,
    iat: Math.floor(Date.now() / 1000),
  }, ttl);
  return response;
}
