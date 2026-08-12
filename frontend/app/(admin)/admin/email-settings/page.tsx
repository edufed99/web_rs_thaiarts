"use client";

import { useRouter } from "next/navigation";
import React, { useEffect, useState } from "react";

import { ApiClientError, getGmailOAuthStatus, startGmailOAuth } from "@/lib/api";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import type { GmailOAuthStatusOut } from "@/lib/types";

export default function EmailSettingsPage() {
  const router = useRouter();
  const [status, setStatus] = useState<GmailOAuthStatusOut | null>(null);
  const [notice, setNotice] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const user = getCurrentUser();
    if (!user) {
      router.replace("/login?next=/admin/email-settings");
      return;
    }
    if (!isAdmin()) {
      router.replace("/?denied=admin_only");
      return;
    }

    const oauth = new URLSearchParams(window.location.search).get("oauth");
    if (oauth === "success") {
      setNotice("เชื่อมบัญชี Gmail สำเร็จแล้ว ระบบพร้อมส่งอีเมลรีเซ็ตรหัสผ่าน");
    } else if (oauth === "error") {
      setError("เชื่อมบัญชี Gmail ไม่สำเร็จหรือคำขอหมดอายุ กรุณาลองใหม่");
    }

    getGmailOAuthStatus()
      .then(setStatus)
      .catch((reason: unknown) => {
        setError(
          reason instanceof ApiClientError || reason instanceof Error
            ? reason.message
            : "ตรวจสอบสถานะอีเมลไม่สำเร็จ",
        );
      });
  }, [router]);

  async function authorize() {
    setBusy(true);
    setError("");
    try {
      const result = await startGmailOAuth();
      window.location.assign(result.authorization_url);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "เริ่ม OAuth ไม่สำเร็จ");
      setBusy(false);
    }
  }

  return (
    <section className="panel" style={{ maxWidth: 820, margin: "2rem auto" }}>
      <p className="eyebrow">ADMIN EMAIL DELIVERY</p>
      <h1>ตั้งค่าการส่งอีเมลด้วย Gmail OAuth</h1>
      <p>
        เชื่อมเฉพาะบัญชีผู้ส่งของระบบ ผู้ใช้ทั่วไปไม่ต้องอนุญาต Gmail
        และระบบขอสิทธิ์เพียงส่งอีเมลเท่านั้น
      </p>

      {notice ? <div className="success-panel" role="status">{notice}</div> : null}
      {error ? <div className="error-panel" role="alert">{error}</div> : null}

      <dl style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: "0.75rem", margin: "1.5rem 0" }}>
        <dt>บัญชีผู้ส่ง</dt>
        <dd>{status?.sender_email ?? "กำลังตรวจสอบ..."}</dd>
        <dt>OAuth Client</dt>
        <dd>{status ? (status.client_configured ? "พร้อม" : "ยังไม่ตั้งค่า") : "—"}</dd>
        <dt>การอนุญาต Gmail</dt>
        <dd>{status ? (status.authorized ? "เชื่อมแล้ว" : "ยังไม่ได้เชื่อม") : "—"}</dd>
        <dt>ส่งอีเมลรีเซ็ต</dt>
        <dd>{status ? (status.delivery_configured ? "พร้อมใช้งาน" : "ยังไม่พร้อม") : "—"}</dd>
        <dt>Callback URL</dt>
        <dd><code>{status?.redirect_uri ?? "—"}</code></dd>
      </dl>

      <button
        className="primary"
        type="button"
        disabled={busy || !status?.client_configured}
        onClick={authorize}
      >
        {busy ? "กำลังเปิด Google..." : status?.authorized ? "เชื่อมบัญชี Gmail ใหม่" : "เชื่อมบัญชี Gmail"}
      </button>
      <p style={{ marginTop: "1rem", color: "#5f6470" }}>
        เมื่อ Google ถาม ให้เลือก <strong>{status?.sender_email || "อีเมลผู้ส่งที่ตั้งค่าไว้"}</strong> และกดอนุญาต
      </p>
    </section>
  );
}
