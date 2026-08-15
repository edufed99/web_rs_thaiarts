"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { ApiClientError, postGoogleLoginExchange } from "@/lib/api";
import { setSessionUser } from "@/lib/auth";

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

function exchangeGoogleLoginCode(code: string, state: string) {
  if (latestExchange?.code !== code) {
    latestExchange = {
      code,
      request: postGoogleLoginExchange({ code, state }),
    };
  }
  return latestExchange.request;
}

function safeNextPath(value: string): string {
  return value.startsWith("/") && !value.startsWith("//") ? value : "/recommend";
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
    const state = search.get("state") ?? "";
    const nextPath = safeNextPath(search.get("next") ?? "/recommend");
    let active = true;

    if (code) {
      // Legacy direct-code path: the code was handed to this page, so exchange
      // it through the JSON contract and store the returned member.
      exchangeGoogleLoginCode(code, state)
        .then((out) => {
          if (!active) return;
          setSessionUser(out.user);
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
    }

    // Server-side flow: the Next.js callback route already verified the
    // Google identity and set the HttpOnly session cookie; read the member
    // and continue to the requested page.
    fetch("/api/auth/me", { credentials: "same-origin", cache: "no-store" })
      .then(async (res) => {
        if (!active) return;
        if (!res.ok) {
          setMessage("ไม่พบเซสชันที่สร้างจาก Google กรุณาเข้าสู่ระบบใหม่อีกครั้ง");
          return;
        }
        const user = await res.json();
        setSessionUser(user);
        router.replace(user.is_admin ? "/admin" : nextPath);
      })
      .catch(() => {
        if (!active) return;
        setMessage("เชื่อมต่อระบบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
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
