import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { apiError } from "@/lib/server/api-response";
import { adminJsonMutation } from "@/lib/server/admin-route";
import {
  adminUserError,
  deleteAdminUser,
  updateAdminUser,
} from "@/lib/server/admin-users";
import { integerInRange } from "@/lib/server/request-values";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface UserRouteContext {
  params: { id: string };
}

// fallow-ignore-next-line complexity -- Field-by-field coercion keeps the parity contract explicit.
export async function PUT(request: NextRequest, context: UserRouteContext): Promise<Response> {
  const userId = integerInRange(context.params.id, 1, Number.MAX_SAFE_INTEGER);
  if (userId === undefined) {
    return apiError(422, "validation_error", "path.id: Input should be a valid integer");
  }
  const authenticated = await adminJsonMutation(request);
  if (authenticated instanceof Response) return authenticated;
  const { admin, body } = authenticated;
  try {
    const user = await updateAdminUser(userId, Number(admin.id), {
      username: body.username === undefined ? undefined : body.username === null ? null : String(body.username),
      email: body.email === undefined ? undefined : body.email === null ? null : String(body.email),
      display_name: body.display_name === undefined ? undefined : body.display_name === null ? null : String(body.display_name),
      password: body.password === undefined ? undefined : body.password === null ? null : String(body.password),
      is_admin: body.is_admin === undefined ? undefined : Boolean(body.is_admin),
    });
    return NextResponse.json(user);
  } catch (error) {
    return adminUserError(error);
  }
}

export async function DELETE(request: NextRequest, context: UserRouteContext): Promise<Response> {
  const userId = integerInRange(context.params.id, 1, Number.MAX_SAFE_INTEGER);
  if (userId === undefined) {
    return apiError(422, "validation_error", "path.id: Input should be a valid integer");
  }
  const authenticated = await adminJsonMutation(request);
  if (authenticated instanceof Response) return authenticated;
  const { admin } = authenticated;
  try {
    return NextResponse.json(await deleteAdminUser(userId, Number(admin.id)));
  } catch (error) {
    return adminUserError(error);
  }
}
