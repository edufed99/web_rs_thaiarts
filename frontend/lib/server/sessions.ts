import { createHash, randomBytes } from "node:crypto";

import type { NextRequest, NextResponse } from "next/server";

import { getDataSource } from "@/db/connection";
import { ApplicationUserEntity, UserSessionEntity, type ApplicationUser } from "@/db/entities/Members";

const SESSION_COOKIE = "thai_arts_session";
const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;
const CSRF_HEADER = "x-csrf-token";
const CSRF_VALUE = "same-origin";

function tokenHash(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export async function rotateSession(userId: number): Promise<string> {
  const dataSource = await getDataSource();
  return dataSource.transaction(async (manager) => {
    await manager.getRepository(UserSessionEntity).delete({ userId });
    const token = randomBytes(32).toString("base64url");
    const now = Date.now();
    await manager.getRepository(UserSessionEntity).save({
      userId,
      tokenHash: tokenHash(token),
      createdAt: new Date(now),
      lastSeenAt: new Date(now),
      expiresAt: new Date(now + SESSION_MAX_AGE_SECONDS * 1000),
    });
    return token;
  });
}

export async function revokeSession(token: string | undefined): Promise<void> {
  if (!token) return;
  const dataSource = await getDataSource();
  await dataSource.getRepository(UserSessionEntity).delete({ tokenHash: tokenHash(token) });
}

/** Revoke every server session for a user (password reset / account takeover). */
export async function revokeAllSessions(userId: number): Promise<void> {
  const dataSource = await getDataSource();
  await dataSource.getRepository(UserSessionEntity).delete({ userId });
}

// fallow-ignore-next-line complexity -- Session expiry, revocation, missing-user, and valid-user paths are separate security checks.
export async function authenticatedUser(request: NextRequest): Promise<ApplicationUser | undefined> {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return undefined;
  const dataSource = await getDataSource();
  const session = await dataSource.getRepository(UserSessionEntity).findOneBy({
    tokenHash: tokenHash(token),
  });
  if (!session || session.expiresAt.getTime() <= Date.now()) {
    if (session) await dataSource.getRepository(UserSessionEntity).delete({ id: session.id });
    return undefined;
  }
  const user = await dataSource.getRepository(ApplicationUserEntity).findOneBy({ id: session.userId });
  if (!user) {
    await dataSource.getRepository(UserSessionEntity).delete({ id: session.id });
    return undefined;
  }
  return user;
}

export function sessionToken(request: NextRequest): string | undefined {
  return request.cookies.get(SESSION_COOKIE)?.value;
}

export function setSessionCookie(response: NextResponse, token: string): void {
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.SESSION_COOKIE_SECURE !== "0",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

export function clearSessionCookie(response: NextResponse): void {
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.SESSION_COOKIE_SECURE !== "0",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

function expectedOrigin(request: NextRequest): string {
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",", 1)[0]?.trim();
  const host = forwardedHost || request.headers.get("host") || request.nextUrl.host;
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",", 1)[0]?.trim();
  const protocol = forwardedProto || request.nextUrl.protocol.replace(":", "");
  return `${protocol}://${host}`;
}

// fallow-ignore-next-line complexity -- Each header/origin clause rejects a distinct CSRF bypass.
export function mutationIsSameOrigin(request: NextRequest): boolean {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin") return false;
  if (request.headers.get(CSRF_HEADER) !== CSRF_VALUE) return false;
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(expectedOrigin(request)).origin;
  } catch {
    return false;
  }
}

// fallow-ignore-next-line complexity -- Explicit serialization prevents password/session fields from crossing the boundary.
export function userOut(user: ApplicationUser) {
  return {
    id: Number(user.id),
    username: user.username,
    email: user.email,
    display_name: user.displayName,
    is_admin: user.isAdmin,
    role: user.isAdmin ? "super_admin" : "user",
    auth_provider: user.authProvider,
    email_verified: user.emailVerified,
    created_at: user.createdAt?.toISOString?.() ?? null,
    last_login_at: user.lastLoginAt?.toISOString?.() ?? null,
  };
}
