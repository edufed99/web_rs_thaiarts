import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { adminJsonMutation, isAdminResponse, requireAdmin } from "@/lib/server/admin-route";
import { adminUserError, createAdminUser, listAdminUsers } from "@/lib/server/admin-users";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// fallow-ignore-next-line complexity -- Admin user listing keeps the bounded list contract and the authorization boundary together.
export async function GET(request: NextRequest): Promise<Response> {
  const admin = await requireAdmin(request);
  if (isAdminResponse(admin)) return admin;
  return NextResponse.json(await listAdminUsers());
}

// fallow-ignore-next-line complexity -- Body coercion and user creation share one admin boundary.
export async function POST(request: NextRequest): Promise<Response> {
  const authenticated = await adminJsonMutation(request);
  if (authenticated instanceof Response) return authenticated;
  const { body } = authenticated;
  try {
    const user = await createAdminUser({
      username: typeof body.username === "string" ? body.username : "",
      email: body.email === null || body.email === undefined ? undefined : String(body.email),
      password: typeof body.password === "string" ? body.password : "",
      display_name: body.display_name === null || body.display_name === undefined ? undefined : String(body.display_name),
      is_admin: body.is_admin === true,
    });
    return NextResponse.json(user);
  } catch (error) {
    return adminUserError(error);
  }
}
