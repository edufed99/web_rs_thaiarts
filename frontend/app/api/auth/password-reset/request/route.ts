import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { sameOriginJson, trimField } from "@/lib/server/member-route";
import {
  createPasswordResetToken,
  findUserByUsernameAndEmail,
  revokePasswordResetToken,
} from "@/lib/server/password-reset";
import { deliveryConfigured, sendPasswordResetEmail } from "@/lib/server/mailer";

export const runtime = "nodejs";

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// fallow-ignore-next-line complexity -- Each response branch preserves the documented recovery contract.
export async function POST(request: NextRequest): Promise<Response> {
  const body = await sameOriginJson(request);
  if (body instanceof Response) return body;
  const username = trimField(body.username);
  const email = trimField(body.email).toLowerCase();
  if (username.length < 3 || username.length > 64 || !EMAIL_PATTERN.test(email)) {
    return NextResponse.json({
      accepted: false,
      credentials_valid: false,
      email_sent: false,
      delivery_configured: await deliveryConfigured(),
      message: "ชื่อผู้ใช้หรืออีเมลไม่ถูกต้อง กรุณาตรวจสอบข้อมูลอีกครั้ง",
    });
  }

  const account = await findUserByUsernameAndEmail(username, email);
  const deliveryReady = await deliveryConfigured();
  if (!account) {
    return NextResponse.json({
      accepted: false,
      credentials_valid: false,
      email_sent: false,
      delivery_configured: deliveryReady,
      message: "ชื่อผู้ใช้หรืออีเมลไม่ถูกต้อง กรุณาตรวจสอบข้อมูลอีกครั้ง",
    });
  }

  const ttlMinutes = Math.max(1, Number(process.env.PASSWORD_RESET_TOKEN_MINUTES) || 30);
  const created = await createPasswordResetToken(username, email, ttlMinutes);
  if (!created) {
    return NextResponse.json({
      accepted: false,
      credentials_valid: true,
      email_sent: false,
      delivery_configured: deliveryReady,
      message: "มีการส่งคำขอสำหรับบัญชีนี้แล้ว กรุณารอ 1 นาทีก่อนส่งใหม่",
    });
  }

  if (!(await sendPasswordResetEmail(account.email, account.username, created.rawToken))) {
    // A token that was never delivered must not remain usable.
    await revokePasswordResetToken(created.rawToken);
    return NextResponse.json({
      accepted: false,
      credentials_valid: true,
      email_sent: false,
      delivery_configured: deliveryReady,
      message: "ข้อมูลถูกต้อง แต่ระบบส่งอีเมลไม่สำเร็จ กรุณาลองใหม่หรือติดต่อผู้ดูแลระบบ",
    });
  }

  return NextResponse.json({
    accepted: true,
    credentials_valid: true,
    email_sent: true,
    delivery_configured: deliveryReady,
    message: "ระบบได้ส่งคำขอเปลี่ยนรหัสผ่านไปยังอีเมลที่กำหนดแล้ว กรุณาตรวจสอบกล่องจดหมาย",
  });
}
