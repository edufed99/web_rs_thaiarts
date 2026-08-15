import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { isResponse, requireAdmin } from "@/lib/server/member-route";
import { authorized as gmailAuthorized, clientConfigured } from "@/lib/server/gmail-oauth";
import { deliveryConfigured } from "@/lib/server/mailer";

export const runtime = "nodejs";

/** Admin-only: report sender setup state without returning credential material. */
export async function GET(request: NextRequest): Promise<Response> {
  const admin = await requireAdmin(request);
  if (isResponse(admin)) return admin;
  return NextResponse.json({
    client_configured: await clientConfigured(),
    authorized: await gmailAuthorized(),
    delivery_configured: await deliveryConfigured(),
    sender_email: process.env.GMAIL_SENDER_EMAIL || "",
    redirect_uri: process.env.GMAIL_OAUTH_REDIRECT_URI || "",
  });
}
