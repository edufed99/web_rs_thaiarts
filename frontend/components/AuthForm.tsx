"use client";

import React, { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { ApiClientError, googleLoginStartUrl, postLogin, postSignup } from "@/lib/api";
import { setSessionUser } from "@/lib/auth";

export interface AuthFormProps {
  /** "login" shows an existing-user form; "signup" includes a display_name. */
  mode: "login" | "signup";
}

export function AuthForm({ mode }: AuthFormProps) {
  const router = useRouter();
  const search = useSearchParams();
  const requestedNextPath = (search?.get("next") ?? "").trim();
  const safeNextPath =
    requestedNextPath.startsWith("/") && !requestedNextPath.startsWith("//")
      ? requestedNextPath
      : "/recommend";

  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const trimmedUsername = username.trim();
      const out =
        mode === "signup"
          ? await postSignup({
              username: trimmedUsername,
              email: email.trim().toLowerCase(),
              password,
              display_name: displayName.trim() || null,
            })
          : await postLogin({ username: trimmedUsername, password });
      setSessionUser(out.user);
      // Admin access always lands on the admin dashboard, even if login was
      // opened with a member-only `next` URL. Members still return to the
      // protected page that initiated login, or /recommend by default.
      const nextPath = out.user.is_admin
        ? "/admin"
        : safeNextPath;
      router.replace(nextPath);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  const isSignup = mode === "signup";
  const title = isSignup ? "สมัครสมาชิก" : "เข้าสู่ระบบ";
  const subtitle = isSignup
    ? "สร้างบัญชีเพื่อรับคำแนะนำเฉพาะคุณและบันทึกความสนใจของคุณ"
    : "เข้าสู่ระบบเพื่อให้ระบบตรวจโปรไฟล์และคำนวณคำแนะนำเฉพาะคุณ";
  const ctaLabel = submitting
    ? "กำลังดำเนินการ..."
    : isSignup
      ? "สมัครสมาชิก"
      : "เข้าสู่ระบบ";
  const altPrompt = isSignup ? "มีบัญชีอยู่แล้ว?" : "ยังไม่มีบัญชี?";
  const altBaseHref = isSignup ? "/login" : "/signup";
  const altHref = requestedNextPath
    ? `${altBaseHref}?next=${encodeURIComponent(requestedNextPath)}`
    : altBaseHref;

  return (
    <form
      onSubmit={handleSubmit}
      className="form-panel"
      style={{
        maxWidth: 420,
        margin: "0 auto",
      }}
    >
      <div>
        <p className="eyebrow">Account access</p>
        <h2 style={{ margin: 0, color: "#102044" }}>{title}</h2>
        <p className="muted" style={{ margin: "0.25rem 0 0 0", fontSize: "0.9rem" }}>
          {subtitle}
        </p>
      </div>

      <a
        href={googleLoginStartUrl(safeNextPath)}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "0.65rem",
          minHeight: 48,
          border: "1px solid #c8ccd4",
          borderRadius: 8,
          background: "#fff",
          color: "#24324a",
          fontWeight: 800,
          textDecoration: "none",
        }}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
          <path fill="#4285F4" d="M22.6 12.2c0-.7-.1-1.5-.2-2.2H12v4.2h6c-.3 1.3-1 2.4-2.1 3.1V20h3.4c2-1.9 3.3-4.6 3.3-7.8Z" />
          <path fill="#34A853" d="M12 23c3 0 5.5-1 7.3-3l-3.4-2.7c-.9.6-2.2 1-3.9 1-3 0-5.5-2-6.4-4.7H2.1v2.7A11 11 0 0 0 12 23Z" />
          <path fill="#FBBC05" d="M5.6 13.6a6.5 6.5 0 0 1 0-4.2V6.7H2.1a11 11 0 0 0 0 9.6l3.5-2.7Z" />
          <path fill="#EA4335" d="M12 4.7c1.8 0 3.3.6 4.6 1.8L19.7 3A10.5 10.5 0 0 0 12 0 11 11 0 0 0 2.1 6.7l3.5 2.7C6.5 6.7 9 4.7 12 4.7Z" />
        </svg>
        ดำเนินการต่อด้วย Google
      </a>

      <div className="muted" style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ height: 1, flex: 1, background: "#ddd5c5" }} />
        <span>หรือใช้ชื่อผู้ใช้และรหัสผ่าน</span>
        <span style={{ height: 1, flex: 1, background: "#ddd5c5" }} />
      </div>

      <label className="field">
        <span>ชื่อผู้ใช้</span>
        <input
          required
          minLength={3}
          maxLength={64}
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
      </label>

      <div className="field auth-password-field">
        <label htmlFor="auth-password">รหัสผ่าน</label>
        <div className="auth-password-control">
          <input
            id="auth-password"
            required
            minLength={isSignup ? 8 : 1}
            maxLength={128}
            type={showPassword ? "text" : "password"}
            autoComplete={isSignup ? "new-password" : "current-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button
            type="button"
            className="auth-password-toggle"
            aria-label={showPassword ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน"}
            aria-pressed={showPassword}
            onClick={() => setShowPassword((visible) => !visible)}
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
              {showPassword ? <path d="m4 4 16 16" /> : null}
            </svg>
            <span>{showPassword ? "ซ่อน" : "แสดง"}</span>
          </button>
        </div>
      </div>

      {isSignup ? (
        <label className="field">
          <span>อีเมล</span>
          <input
            required
            maxLength={320}
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
      ) : (
        <div style={{ textAlign: "right", marginTop: "-0.5rem" }}>
          <a href="/reset-password" style={{ color: "#8a5b17", fontWeight: 800 }}>
            ลืมรหัสผ่าน / ตั้งรหัสผ่านครั้งแรก
          </a>
        </div>
      )}

      {isSignup ? (
        <label className="field">
          <span>ชื่อที่แสดง (ไม่บังคับ)</span>
          <input
            maxLength={120}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </label>
      ) : null}

      {error ? (
        <div role="alert" className="error-panel">
          {error}
        </div>
      ) : null}

      <button
        type="submit"
        disabled={submitting}
      >
        {ctaLabel}
      </button>

      <div className="muted" style={{ textAlign: "center", fontSize: "0.9rem" }}>
        {altPrompt}{" "}
        <a href={altHref} style={{ color: "#8a5b17", fontWeight: 800 }}>
          {isSignup ? "เข้าสู่ระบบ" : "สมัครสมาชิก"}
        </a>
      </div>
    </form>
  );
}
