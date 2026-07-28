"use client";

import React, { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { ApiClientError, postLogin, postSignup } from "@/lib/api";
import { storeToken } from "@/lib/auth";

export interface AuthFormProps {
  /** "login" shows an existing-user form; "signup" includes a display_name. */
  mode: "login" | "signup";
}

export function AuthForm({ mode }: AuthFormProps) {
  const router = useRouter();
  const search = useSearchParams();
  const nextPath = (search?.get("next") ?? "").trim() || (mode === "signup" ? "/admin/items/new" : "/");

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
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
              password,
              display_name: displayName.trim() || null,
            })
          : await postLogin({ username: trimmedUsername, password });
      storeToken(out.access_token, out.expires_in_seconds, out.user);
      router.push(nextPath);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  const isSignup = mode === "signup";
  const title = isSignup ? "สมัครสมาชิก" : "เข้าสู่ระบบ";
  const subtitle = isSignup
    ? "สร้างบัญชีผู้ดูแลเพื่อเพิ่มการแสดงใหม่"
    : "ใช้ชื่อผู้ใช้และรหัสผ่านที่ลงทะเบียนไว้";
  const ctaLabel = submitting
    ? "กำลังดำเนินการ..."
    : isSignup
      ? "สมัครสมาชิก"
      : "เข้าสู่ระบบ";
  const altPrompt = isSignup ? "มีบัญชีอยู่แล้ว?" : "ยังไม่มีบัญชี?";
  const altHref = isSignup ? "/login" : "/signup";

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        maxWidth: 420,
        margin: "0 auto",
        display: "grid",
        gap: "1rem",
        padding: "1.5rem",
        backgroundColor: "#fff",
        border: "1px solid #e3e3e3",
        borderRadius: "8px",
      }}
    >
      <div>
        <h2 style={{ margin: 0 }}>{title}</h2>
        <p style={{ margin: "0.25rem 0 0 0", color: "#555", fontSize: "0.9rem" }}>
          {subtitle}
        </p>
      </div>

      <label style={{ display: "grid", gap: "0.35rem" }}>
        <span style={{ fontWeight: 600 }}>ชื่อผู้ใช้</span>
        <input
          required
          minLength={3}
          maxLength={64}
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          style={{
            padding: "0.5rem",
            fontSize: "1rem",
            border: "1px solid #ccc",
            borderRadius: "4px",
          }}
        />
      </label>

      <label style={{ display: "grid", gap: "0.35rem" }}>
        <span style={{ fontWeight: 600 }}>รหัสผ่าน</span>
        <input
          required
          minLength={isSignup ? 8 : 1}
          maxLength={128}
          type="password"
          autoComplete={isSignup ? "new-password" : "current-password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={{
            padding: "0.5rem",
            fontSize: "1rem",
            border: "1px solid #ccc",
            borderRadius: "4px",
          }}
        />
      </label>

      {isSignup ? (
        <label style={{ display: "grid", gap: "0.35rem" }}>
          <span style={{ fontWeight: 600 }}>ชื่อที่แสดง (ไม่บังคับ)</span>
          <input
            maxLength={120}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            style={{
              padding: "0.5rem",
              fontSize: "1rem",
              border: "1px solid #ccc",
              borderRadius: "4px",
            }}
          />
        </label>
      ) : null}

      {error ? (
        <div
          role="alert"
          style={{
            color: "#7a1f1f",
            backgroundColor: "#fdecec",
            border: "1px solid #f5c2c2",
            borderRadius: "4px",
            padding: "0.5rem 0.75rem",
            fontSize: "0.9rem",
          }}
        >
          {error}
        </div>
      ) : null}

      <button
        type="submit"
        disabled={submitting}
        style={{
          padding: "0.75rem 1rem",
          backgroundColor: submitting ? "#999" : "#1e6fd9",
          color: "#fff",
          border: "none",
          borderRadius: "4px",
          fontSize: "1rem",
          fontWeight: 600,
          cursor: submitting ? "not-allowed" : "pointer",
        }}
      >
        {ctaLabel}
      </button>

      <div style={{ textAlign: "center", fontSize: "0.9rem", color: "#555" }}>
        {altPrompt}{" "}
        <a href={altHref} style={{ color: "#1e6fd9" }}>
          {isSignup ? "เข้าสู่ระบบ" : "สมัครสมาชิก"}
        </a>
      </div>
    </form>
  );
}