import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { csrfFailure } from "@/lib/server/member-route";
import { clearSessionCookie, revokeSession, sessionToken } from "@/lib/server/sessions";

export async function POST(request: NextRequest): Promise<Response> {
  const csrf = csrfFailure(request);
  if (csrf) return csrf;
  await revokeSession(sessionToken(request));
  const response = NextResponse.json({ logged_out: true });
  clearSessionCookie(response);
  return response;
}
