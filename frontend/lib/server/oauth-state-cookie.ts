// Signed, tamper-evident OAuth state cookies (PKCE verifier + return path).
//
// Both Google flows (member OpenID Connect and the admin Gmail sender) must
// remember the random ``state`` and PKCE ``verifier`` across a round trip to
// accounts.google.com. The Application Backend is stateless per request, so
// the pending flow lives in a short-lived HttpOnly cookie whose payload is
// HMAC-signed with a server-only secret. Nothing sensitive ever reaches the
// browser bundle: the cookie is HttpOnly and the payload is opaque to script.
import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

export interface OAuthStatePayload {
  state: string;
  verifier: string;
  /** Optional same-site continuation path (member Google Login only). */
  next?: string;
  /** Unix epoch seconds when the flow started (used for TTL checks). */
  iat: number;
}

const SECRET_ENV = "OAUTH_STATE_SECRET";
const DEV_SECRET = "dev-only-oauth-state-secret";

function stateSecret(): string {
  const configured = (process.env[SECRET_ENV] ?? "").trim();
  return configured || DEV_SECRET;
}

function sign(payload: string): string {
  return createHmac("sha256", stateSecret()).update(payload, "utf8").digest("base64url");
}

function encodeStateCookie(payload: OAuthStatePayload): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${body}.${sign(body)}`;
}

// fallow-ignore-next-line complexity -- Format, signature, and payload checks each reject a distinct forgery vector.
function decodeStateCookie(value: string | undefined): OAuthStatePayload | null {
  if (!value) return null;
  const separator = value.lastIndexOf(".");
  if (separator <= 0) return null;
  const body = value.slice(0, separator);
  const signature = value.slice(separator + 1);
  if (!body || !signature) return null;
  const expected = Buffer.from(sign(body), "ascii");
  const provided = Buffer.from(signature, "ascii");
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as OAuthStatePayload;
    if (typeof parsed.state !== "string" || typeof parsed.verifier !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function readStateCookie(request: NextRequest, cookieName: string): OAuthStatePayload | null {
  return decodeStateCookie(request.cookies.get(cookieName)?.value);
}

/** Constant-time comparison for OAuth state strings. */
export function timingSafeEqualText(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function cookieAttributes(ttlSeconds: number): Record<string, string | number | boolean> {
  return {
    httpOnly: true,
    secure: process.env.SESSION_COOKIE_SECURE !== "0",
    sameSite: "lax",
    path: "/",
    maxAge: ttlSeconds,
  };
}

export function setStateCookie(
  response: NextResponse,
  cookieName: string,
  payload: OAuthStatePayload,
  ttlSeconds: number,
): void {
  response.cookies.set(cookieName, encodeStateCookie(payload), cookieAttributes(ttlSeconds));
}

export function clearStateCookie(response: NextResponse, cookieName: string): void {
  response.cookies.set(cookieName, "", cookieAttributes(0));
}

/**
 * Redirect after an OAuth round trip, always clearing the pending flow cookie
 * and never allowing the browser to cache the exchange response.
 */
export function oauthRedirect(target: string, cookieName: string): NextResponse {
  const response = NextResponse.redirect(target, 303);
  clearStateCookie(response, cookieName);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

/** Public origin of this Next.js application (used to build callback URLs). */
export function frontendBaseUrl(): string {
  return (process.env.FRONTEND_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
}
