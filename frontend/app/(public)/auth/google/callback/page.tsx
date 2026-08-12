"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { ApiClientError, postGoogleLoginExchange } from "@/lib/api";
import { storeToken } from "@/lib/auth";

const GOOGLE_ERRORS: Record<string, string> = {
  google_access_denied: "คุณยกเลิกการอนุญาตบัญชี Google",
  invalid_google_state: "คำขอเข้าสู่ระบบหมดอายุหรือไม่ตรงกับเบราว์เซอร์นี้ กรุณาลองใหม่",
  ambiguous_google_email:
    "อีเมลนี้ตรงกับบัญชีเดิมมากกว่าหนึ่งบัญชี ระบบจึงไม่ผูกบัญชีให้อัตโนมัติ กรุณาติดต่อผู้ดูแลระบบ",
  google_login_failed: "Google ไม่สามารถยืนยันตัวตนได้ กรุณาลองใหม่",
  google_account_not_persisted: "ระบบไม่สามารถบันทึกบัญชีสมาชิกได้",
};

// React Strict Mode replays effects in development. Keep the exchange request
// outside the component so a single-use login code is never posted twice.
let latestExchange:
  | {
      code: string;
      request: ReturnType<typeof postGoogleLoginExchange>;
    }
  | undefined;

function exchangeGoogleLoginCode(code: string) {
  if (latestExchange?.code !== code) {
    latestExchange = {
      code,
      request: postGoogleLoginExchange({ code }),
    };
  }
  return latestExchange.request;
}

function CallbackContent() {
  const router = useRouter();
  const search = useSearchParams();
  const [message, setMessage] = useState("กำลังตรวจสอบบัญชี Google...");

  useEffect(() => {
    const error = search.get("error");
    if (error) {
      setMessage(GOOGLE_ERRORS[error] ?? "เข้าสู่ระบบด้วย Google ไม่สำเร็จ");
      return;
    }
    const code = search.get("code") ?? "";
    const requestedNext = search.get("next") ?? "/recommend";
    const nextPath =
      requestedNext.startsWith("/") && !requestedNext.startsWith("//")
        ? requestedNext
        : "/recommend";
    if (!code) {
      setMessage("ไม่พบรหัสยืนยันจาก Google กรุณาลองเข้าสู่ระบบใหม่");
      return;
    }
    let active = true;
    exchangeGoogleLoginCode(code)
      .then((out) => {
        if (!active) return;
        storeToken(out.access_token, out.expires_in_seconds, out.user);
        router.replace(out.user.is_admin ? "/admin" : nextPath);
      })
      .catch((err) => {
        if (!active) return;
        setMessage(
          err instanceof ApiClientError
            ? err.message
            : "เข้าสู่ระบบด้วย Google ไม่สำเร็จ กรุณาลองใหม่",
        );
      });
    return () => {
      active = false;
    };
  }, [router, search]);

  return (
    <main className="page-shell">
      <section className="form-panel" style={{ maxWidth: 520, margin: "2rem auto" }}>
        <p className="eyebrow">Google account</p>
        <h1 style={{ margin: 0 }}>เข้าสู่ระบบด้วย Google</h1>
        <p role="status" className="muted">{message}</p>
        {!message.startsWith("กำลัง") ? (
          <a href="/login" style={{ color: "#8a5b17", fontWeight: 800 }}>
            กลับไปหน้าเข้าสู่ระบบ
          </a>
        ) : null}
      </section>
    </main>
  );
}

export default function GoogleLoginCallbackPage() {
  return (
    <Suspense fallback={<p className="page-shell">กำลังตรวจสอบบัญชี Google...</p>}>
      <CallbackContent />
    </Suspense>
  );
}
