// Password-reset email delivery (issue #6).
//
// Delivers through the admin Gmail sender API when its OAuth refresh token is
// available, otherwise falls back to plain SMTP. Returns false (never throws)
// when delivery is unavailable or fails, so the caller can revoke the token
// that was never delivered.
import nodemailer from "nodemailer";
import { authorized as gmailOAuthAuthorized, sendWithGmailApi } from "./gmail-oauth";
import { frontendBaseUrl } from "./oauth-state-cookie";

function envValue(name: string): string {
  return (process.env[name] ?? "").trim();
}

// fallow-ignore-next-line complexity -- Every SMTP credential is required; the from-address has one documented fallback.
function smtpReady(): boolean {
  return Boolean(
    envValue("SMTP_HOST") &&
    envValue("SMTP_USERNAME") &&
    envValue("SMTP_PASSWORD") &&
    (envValue("SMTP_FROM_EMAIL") || envValue("SMTP_USERNAME")),
  );
}

export async function deliveryConfigured(): Promise<boolean> {
  return (await gmailOAuthAuthorized()) || smtpReady();
}

/** RFC 2047 encoded-word so Thai subjects survive non-UTF-8 relays. */
function encodeHeader(value: string): string {
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

// fallow-ignore-next-line complexity -- Header encoding, reset URL, and Thai body are one raw-message boundary.
function buildRawMessage(email: string, username: string, token: string): string {
  const minutes = Math.max(1, Number(envValue("PASSWORD_RESET_TOKEN_MINUTES")) || 30);
  const sender = envValue("GMAIL_SENDER_EMAIL") || envValue("SMTP_FROM_EMAIL") || envValue("SMTP_USERNAME");
  const resetUrl = `${frontendBaseUrl()}/reset-password?${new URLSearchParams({
    username,
    token,
  }).toString()}`;
  const body = [
    "มีคำขอตั้งรหัสผ่านใหม่สำหรับบัญชี",
    username,
    "",
    `เปิดลิงก์นี้ภายใน ${minutes} นาที:`,
    resetUrl,
    "",
    "หากคุณไม่ได้เป็นผู้ขอ สามารถเพิกเฉยต่ออีเมลนี้ได้",
  ].join("\n");
  return [
    `From: ${sender}`,
    `To: ${email}`,
    `Subject: ${encodeHeader("ตั้งรหัสผ่านใหม่ — Thai Performing Arts")}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "MIME-Version: 1.0",
    "",
    body,
    "",
  ].join("\r\n");
}

// fallow-ignore-next-line complexity -- Delivery must try exactly one channel (Gmail API or SMTP) and never throw.
export async function sendPasswordResetEmail(email: string, username: string, token: string): Promise<boolean> {
  const oauthReady = await gmailOAuthAuthorized();
  if (!oauthReady && !smtpReady()) return false;
  const raw = buildRawMessage(email, username, token);
  if (oauthReady) return sendWithGmailApi(raw);
  const from = envValue("GMAIL_SENDER_EMAIL") || envValue("SMTP_FROM_EMAIL") || envValue("SMTP_USERNAME");
  return sendWithSmtp(raw, from, email);
}

// fallow-ignore-next-line complexity -- Transport lifecycle plus the raw/envelope contract are one bounded SMTP boundary.
async function sendWithSmtp(rawMessage: string, from: string, to: string): Promise<boolean> {
  let transport: nodemailer.Transporter | undefined;
  try {
    transport = nodemailer.createTransport({
      host: envValue("SMTP_HOST"),
      port: Number(envValue("SMTP_PORT")) || 587,
      secure: false,
      // SMTP_USE_TLS=1 forces STARTTLS (Gmail convention); otherwise the
      // upgrade is opportunistic and skipped when the relay never advertises it.
      requireTLS: envValue("SMTP_USE_TLS") === "1",
      auth: { user: envValue("SMTP_USERNAME"), pass: envValue("SMTP_PASSWORD") },
      connectionTimeout: 15_000,
      socketTimeout: 15_000,
    });
    await transport.sendMail({ raw: rawMessage, envelope: { from, to: [to] } });
    return true;
  } catch {
    return false;
  } finally {
    if (transport) {
      try {
        transport.close();
      } catch {
        // Best-effort teardown only.
      }
    }
  }
}
