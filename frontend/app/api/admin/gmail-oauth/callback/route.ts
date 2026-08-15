import type { NextRequest } from "next/server";

import { completeAuthorization, GMAIL_STATE_COOKIE } from "@/lib/server/gmail-oauth";
import { frontendBaseUrl, oauthRedirect, readStateCookie, timingSafeEqualText } from "@/lib/server/oauth-state-cookie";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";


const PENDING_TTL_MS = 10 * 60 * 1000;

function adminSettingsPage(result: "success" | "error"): string {
  return `${frontendBaseUrl()}/admin/email-settings?oauth=${result}`;
}

/**
 * Admin-only Gmail sender callback — the second, separate OAuth callback in
 * this application. Only the browser that started the admin flow (state
 * cookie) can complete it; the completed refresh token is persisted to a
 * private file/env value and never returned in a redirect query string.
 */
// fallow-ignore-next-line complexity -- Error, mismatched-state, and exchange-failure branches share one redirect boundary.
export async function GET(request: NextRequest): Promise<Response> {
  const search = request.nextUrl.searchParams;
  const code = (search.get("code") ?? "").trim();
  const state = (search.get("state") ?? "").trim();
  const error = search.get("error");

  let result: "success" | "error" = "error";
  if (!error && code && state) {
    const pending = readStateCookie(request, GMAIL_STATE_COOKIE);
    if (pending && timingSafeEqualText(pending.state, state) && Date.now() - pending.iat * 1000 <= PENDING_TTL_MS) {
      try {
        await completeAuthorization(code, pending.verifier);
        result = "success";
      } catch {
        result = "error";
      }
    }
  }

  return oauthRedirect(adminSettingsPage(result), GMAIL_STATE_COOKIE);
}
