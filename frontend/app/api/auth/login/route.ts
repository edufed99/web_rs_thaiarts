import bcrypt from "bcryptjs";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { getDataSource } from "@/db/connection";
import { ApplicationUserEntity } from "@/db/entities/Members";
import { apiError } from "@/lib/server/api-response";
import { sameOriginJson } from "@/lib/server/member-route";
import { rotateSession, setSessionCookie, userOut } from "@/lib/server/sessions";

export const runtime = "nodejs";

// fallow-ignore-next-line complexity -- Login keeps validation, provider enforcement, password verification, and rotation explicit.
export async function POST(request: NextRequest): Promise<Response> {
  const body = await sameOriginJson(request);
  if (body instanceof Response) return body;
  const username = typeof body.username === "string" ? body.username.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const dataSource = await getDataSource();
  const user = await dataSource.getRepository(ApplicationUserEntity).findOneBy({ username });
  if (!user || user.authProvider !== "password" || !(await bcrypt.compare(password, user.passwordHash))) {
    return apiError(401, "invalid_credentials", "Invalid username or password.");
  }
  user.lastLoginAt = new Date();
  await dataSource.getRepository(ApplicationUserEntity).save(user);
  const token = await rotateSession(Number(user.id));
  const response = NextResponse.json({ expires_in_seconds: 604800, user: userOut(user) });
  setSessionCookie(response, token);
  return response;
}
