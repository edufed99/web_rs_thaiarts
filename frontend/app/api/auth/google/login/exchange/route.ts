import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { getDataSource } from "@/db/connection";
import { ApplicationUserEntity } from "@/db/entities/Members";
import { apiError } from "@/lib/server/api-response";
import { sameOriginJson } from "@/lib/server/member-route";
import { rotateSession, setSessionCookie, userOut } from "@/lib/server/sessions";

export const runtime = "nodejs";

interface CompatibilityUser {
  id?: unknown;
  username?: unknown;
}

interface CompatibilityToken {
  user?: CompatibilityUser;
}

function compatibilityBaseUrl(): string {
  return (
    process.env.COMPATIBILITY_SERVICE_URL ||
    process.env.MODEL_SERVICE_URL ||
    "http://127.0.0.1:8001"
  ).replace(/\/+$/, "");
}

export async function POST(request: NextRequest): Promise<Response> {
  const body = await sameOriginJson(request);
  if (body instanceof Response) return body;
  const code = typeof body.code === "string" ? body.code.trim() : "";
  if (!code || code.length > 2048) {
    return apiError(422, "validation_error", "Invalid Google login code.");
  }

  let compatibility: Response;
  try {
    compatibility = await fetch(`${compatibilityBaseUrl()}/auth/google/login/exchange`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
      cache: "no-store",
    });
  } catch {
    return apiError(502, "google_login_unavailable", "Google login is temporarily unavailable.");
  }
  if (!compatibility.ok) {
    const responseBody = await compatibility.text();
    return new Response(responseBody, {
      status: compatibility.status,
      headers: { "Content-Type": compatibility.headers.get("content-type") || "application/json" },
    });
  }

  let exchanged: CompatibilityToken;
  try {
    exchanged = (await compatibility.json()) as CompatibilityToken;
  } catch {
    return apiError(502, "invalid_google_exchange", "Google login returned an invalid response.");
  }
  const userId = Number(exchanged.user?.id);
  const username = typeof exchanged.user?.username === "string" ? exchanged.user.username : "";
  if (!Number.isSafeInteger(userId) || userId <= 0 || !username) {
    return apiError(502, "invalid_google_exchange", "Google login returned an invalid user.");
  }

  const dataSource = await getDataSource();
  const user = await dataSource.getRepository(ApplicationUserEntity).findOneBy({ id: userId });
  if (!user || user.username !== username) {
    return apiError(401, "google_account_not_persisted", "Google account was not persisted.");
  }

  const token = await rotateSession(Number(user.id));
  const response = NextResponse.json({ expires_in_seconds: 604800, user: userOut(user) });
  setSessionCookie(response, token);
  return response;
}
