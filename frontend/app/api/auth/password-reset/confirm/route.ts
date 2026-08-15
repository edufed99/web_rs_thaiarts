import bcrypt from "bcryptjs";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { apiError } from "@/lib/server/api-response";
import { sameOriginJson, trimField } from "@/lib/server/member-route";
import { consumePasswordResetToken } from "@/lib/server/password-reset";
import { revokeAllSessions } from "@/lib/server/sessions";

export const runtime = "nodejs";

// fallow-ignore-next-line complexity -- Token consumption, password change, and session revocation are one atomic security boundary.
export async function POST(request: NextRequest): Promise<Response> {
  const body = await sameOriginJson(request);
  if (body instanceof Response) return body;
  const username = trimField(body.username);
  const token = trimField(body.token);
  const newPassword = typeof body.new_password === "string" ? body.new_password : "";
  if (username.length < 3 || username.length > 64 || token.length < 20 || token.length > 256) {
    return apiError(422, "validation_error", "Invalid reset fields.");
  }
  if (newPassword.length < 8 || newPassword.length > 128) {
    return apiError(422, "validation_error", "Invalid password.");
  }
  const passwordHash = await bcrypt.hash(newPassword, 12);
  const updated = await consumePasswordResetToken(username, token, passwordHash);
  if (!updated) {
    return apiError(400, "invalid_reset_token", "Reset link is invalid, expired, or already used.");
  }
  // Every device must sign in again after the password changes.
  await revokeAllSessions(Number(updated.id));
  return NextResponse.json({ reset: true, message: "ตั้งรหัสผ่านใหม่เรียบร้อยแล้ว กรุณาเข้าสู่ระบบ" });
}
