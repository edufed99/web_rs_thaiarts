"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import React, { Suspense, useState } from "react";

import {
  ApiClientError,
  postPasswordResetConfirm,
  postPasswordResetRequest,
} from "@/lib/api";


function PasswordResetForm() {
  const search = useSearchParams();
  const linkUsername = (search?.get("username") ?? "").trim();
  const linkToken = (search?.get("token") ?? "").trim();
  const confirming = Boolean(linkUsername && linkToken);
  const [username, setUsername] = useState(linkUsername);
  const [email, setEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [complete, setComplete] = useState(false);

  async function requestReset(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setSubmitting(true);
    try {
      const result = await postPasswordResetRequest({
        username: username.trim(),
        email: email.trim().toLowerCase(),
      });
      if (!result.credentials_valid || !result.email_sent) {
        setError(result.message);
      } else {
        setMessage(result.message);
      }
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setSubmitting(false);
    }
  }

  async function confirmReset(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (newPassword !== confirmPassword) {
      setError("รหัสผ่านใหม่และการยืนยันไม่ตรงกัน");
      return;
    }
    setSubmitting(true);
    try {
      const result = await postPasswordResetConfirm({
        username: linkUsername,
        token: linkToken,
        new_password: newPassword,
      });
      setMessage(result.message);
      setComplete(true);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={confirming ? confirmReset : requestReset}
      className="form-panel"
      style={{ maxWidth: 480, margin: "0 auto" }}
    >
      <div>
        <p className="eyebrow">Account recovery</p>
        <h2 style={{ margin: 0, color: "#102044" }}>
          {confirming ? "ตั้งรหัสผ่านใหม่" : "ลืมรหัสผ่าน / ตั้งรหัสผ่านครั้งแรก"}
        </h2>
        <p className="muted" style={{ margin: "0.25rem 0 0" }}>
          {confirming
            ? `กำหนดรหัสผ่านใหม่สำหรับบัญชี ${linkUsername}`
            : "กรอกชื่อผู้ใช้และอีเมลที่ผูกกับบัญชี ระบบจะส่งลิงก์ที่ใช้ได้ครั้งเดียวให้คุณ"}
        </p>
      </div>

      {!confirming ? (
        <>
          <label className="field">
            <span>ชื่อผู้ใช้</span>
            <input required minLength={3} maxLength={64} autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} />
          </label>
          <label className="field">
            <span>อีเมล</span>
            <input required type="email" maxLength={320} autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} />
          </label>
        </>
      ) : (
        <>
          <PasswordField
            id="reset-new-password"
            label="รหัสผ่านใหม่"
            value={newPassword}
            visible={showNewPassword}
            onChange={setNewPassword}
            onToggle={() => setShowNewPassword((current) => !current)}
          />
          <PasswordField
            id="reset-confirm-password"
            label="ยืนยันรหัสผ่านใหม่"
            value={confirmPassword}
            visible={showConfirmPassword}
            onChange={setConfirmPassword}
            onToggle={() => setShowConfirmPassword((current) => !current)}
          />
        </>
      )}

      {error ? <div role="alert" className="error-panel">{error}</div> : null}
      {message ? <div role="status" className="panel" style={{ background: "#edf7f5" }}>{message}</div> : null}

      {!complete ? (
        <button type="submit" disabled={submitting}>
          {submitting ? "กำลังดำเนินการ..." : confirming ? "ตั้งรหัสผ่านใหม่" : "ส่งลิงก์ตั้งรหัสผ่าน"}
        </button>
      ) : null}
      <div className="muted" style={{ textAlign: "center" }}>
        <Link href="/login" style={{ color: "#8a5b17", fontWeight: 800 }}>กลับไปหน้าเข้าสู่ระบบ</Link>
      </div>
    </form>
  );
}


interface PasswordFieldProps {
  id: string;
  label: string;
  value: string;
  visible: boolean;
  onChange: (value: string) => void;
  onToggle: () => void;
}


function PasswordField({
  id,
  label,
  value,
  visible,
  onChange,
  onToggle,
}: PasswordFieldProps) {
  return (
    <div className="field auth-password-field">
      <label htmlFor={id}>{label}</label>
      <div className="auth-password-control">
        <input
          id={id}
          required
          type={visible ? "text" : "password"}
          minLength={8}
          maxLength={128}
          autoComplete="new-password"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        <button
          type="button"
          className="auth-password-toggle"
          aria-label={visible ? `ซ่อน${label}` : `แสดง${label}`}
          aria-pressed={visible}
          onClick={onToggle}
        >
          <svg
            className="auth-password-toggle-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
            <circle cx="12" cy="12" r="2.75" />
            {visible ? <path d="m4 4 16 16" /> : null}
          </svg>
          <span>{visible ? "ซ่อน" : "แสดง"}</span>
        </button>
      </div>
    </div>
  );
}


export default function PasswordResetPage() {
  return (
    <div style={{ paddingTop: "1rem" }}>
      <Suspense fallback={<div>กำลังโหลด...</div>}>
        <PasswordResetForm />
      </Suspense>
    </div>
  );
}


function errorMessage(reason: unknown): string {
  return reason instanceof ApiClientError || reason instanceof Error ? reason.message : String(reason);
}
