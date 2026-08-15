import bcrypt from "bcryptjs";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { getDataSource } from "@/db/connection";
import { ApplicationUserEntity } from "@/db/entities/Members";
import { apiError } from "@/lib/server/api-response";
import { authenticatedJsonMutation, isResponse, jsonError, requireUser } from "@/lib/server/member-route";
import { rotateSession, setSessionCookie, userOut } from "@/lib/server/sessions";

export async function GET(request: NextRequest): Promise<Response> {
  const user = await requireUser(request);
  return isResponse(user) ? user : NextResponse.json(userOut(user));
}

// fallow-ignore-next-line complexity -- Credential changes require explicit per-field validation and session rotation.
export async function PATCH(request: NextRequest): Promise<Response> {
  const authenticated = await authenticatedJsonMutation(request);
  if (authenticated instanceof Response) return authenticated;
  const { user, body } = authenticated;
  const changesCredentials = body.username !== undefined || body.email !== undefined || body.new_password !== undefined;
  if (changesCredentials) {
    if (typeof body.current_password !== "string" || !(await bcrypt.compare(body.current_password, user.passwordHash))) {
      return apiError(401, "invalid_current_password", "Current password is incorrect.");
    }
  }
  if (typeof body.username === "string") {
    const value = body.username.trim();
    if (value.length < 3 || value.length > 64) return apiError(422, "validation_error", "Invalid username.");
    user.username = value;
  }
  if (typeof body.email === "string") {
    const value = body.email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) return apiError(422, "validation_error", "Invalid email.");
    user.email = value;
  }
  if (typeof body.display_name === "string") user.displayName = body.display_name.trim().slice(0, 120);
  if (typeof body.new_password === "string") {
    if (body.new_password.length < 8 || body.new_password.length > 128) return apiError(422, "validation_error", "Invalid password.");
    user.passwordHash = await bcrypt.hash(body.new_password, 12);
  }
  try {
    const dataSource = await getDataSource();
    const updated = await dataSource.getRepository(ApplicationUserEntity).save(user);
    const response = NextResponse.json(userOut(updated));
    if (changesCredentials) setSessionCookie(response, await rotateSession(Number(user.id)));
    return response;
  } catch (error) { return jsonError(error); }
}
