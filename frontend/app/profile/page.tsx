"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { ErrorState } from "@/components/ErrorState";
import { LoadingState } from "@/components/LoadingState";
import { ApiClientError, getMe, patchMe } from "@/lib/api";
import {
  getCurrentUser,
  getReadableUserName,
  updateStoredUser,
} from "@/lib/auth";
import type { UserOut } from "@/lib/types";

function editableDisplayName(user: UserOut): string {
  const raw = (user.display_name || "").trim();
  if (!raw || raw.startsWith("must_reset|")) {
    return getReadableUserName(user);
  }
  return raw;
}

function formatDate(value: string | null): string {
  if (!value) return "-";
  try {
    return new Intl.DateTimeFormat("th-TH", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

export default function ProfilePage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<UserOut | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const storedUser = getCurrentUser();
    if (!storedUser) {
      router.replace("/login?next=/profile");
      return;
    }
    setUser(storedUser);
    setDisplayName(editableDisplayName(storedUser));
    setReady(true);

    let cancelled = false;
    getMe()
      .then((freshUser) => {
        if (cancelled) return;
        updateStoredUser(freshUser);
        setUser(freshUser);
        setDisplayName(editableDisplayName(freshUser));
      })
      .catch(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    setError(null);
    setMessage(null);

    const wantsPasswordChange = currentPassword || newPassword || confirmPassword;
    if (wantsPasswordChange) {
      if (!currentPassword || !newPassword || !confirmPassword) {
        setError("กรุณากรอกรหัสผ่านเดิม รหัสผ่านใหม่ และยืนยันรหัสผ่านให้ครบ");
        return;
      }
      if (newPassword !== confirmPassword) {
        setError("รหัสผ่านใหม่และการยืนยันรหัสผ่านไม่ตรงกัน");
        return;
      }
      if (newPassword.length < 8) {
        setError("รหัสผ่านใหม่ต้องมีอย่างน้อย 8 ตัวอักษร");
        return;
      }
    }

    setSubmitting(true);
    try {
      const updated = await patchMe({
        display_name: displayName.trim(),
        current_password: wantsPasswordChange ? currentPassword : null,
        new_password: wantsPasswordChange ? newPassword : null,
      });
      updateStoredUser(updated);
      setUser(updated);
      setDisplayName(editableDisplayName(updated));
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setMessage("บันทึกข้อมูลผู้ใช้เรียบร้อยแล้ว");
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  if (!ready) {
    return <LoadingState message="กำลังตรวจสอบข้อมูลผู้ใช้..." />;
  }

  if (!user) {
    return (
      <ErrorState
        title="ยังไม่ได้เข้าสู่ระบบ"
        message="กรุณาเข้าสู่ระบบก่อนเปิดหน้าข้อมูลผู้ใช้"
        onRetry={() => router.push("/login?next=/profile")}
      />
    );
  }

  return (
    <div className="section-stack">
      <section className="page-hero">
        <div>
          <p className="eyebrow">Account profile</p>
          <h1>ข้อมูลผู้ใช้</h1>
          <p className="muted">
            จัดการชื่อที่แสดงและรหัสผ่านของบัญชีที่ใช้รับคำแนะนำเฉพาะคุณ
          </p>
        </div>
      </section>

      <form onSubmit={handleSubmit} className="form-panel" style={{ maxWidth: 620 }}>
        <div className="panel" style={{ boxShadow: "none" }}>
          <p className="muted" style={{ margin: 0 }}>
            ชื่อผู้ใช้: <strong>{user.username}</strong>
          </p>
          <p className="muted" style={{ margin: "0.5rem 0 0 0" }}>
            สถานะ: <strong>{user.is_admin ? "ผู้ดูแลระบบ" : "ผู้ใช้งานทั่วไป"}</strong>
          </p>
          <p className="muted" style={{ margin: "0.5rem 0 0 0" }}>
            เข้าใช้ล่าสุด: <strong>{formatDate(user.last_login_at)}</strong>
          </p>
        </div>

        <label className="field">
          <span>ชื่อที่แสดง</span>
          <input
            maxLength={120}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="ชื่อที่ต้องการให้ระบบแสดง"
          />
        </label>

        <div>
          <p className="form-label" style={{ marginBottom: "0.5rem" }}>เปลี่ยนรหัสผ่าน</p>
          <p className="muted" style={{ margin: 0, fontSize: "0.9rem" }}>
            เว้นว่างไว้หากยังไม่ต้องการเปลี่ยนรหัสผ่าน
          </p>
        </div>

        <label className="field">
          <span>รหัสผ่านเดิม</span>
          <input
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
          />
        </label>

        <label className="field">
          <span>รหัสผ่านใหม่</span>
          <input
            type="password"
            minLength={8}
            maxLength={128}
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
        </label>

        <label className="field">
          <span>ยืนยันรหัสผ่านใหม่</span>
          <input
            type="password"
            minLength={8}
            maxLength={128}
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />
        </label>

        {error ? <div role="alert" className="error-panel">{error}</div> : null}
        {message ? (
          <div
            role="status"
            className="panel"
            style={{
              borderColor: "rgba(49, 92, 89, 0.28)",
              background: "#edf7f5",
              boxShadow: "none",
            }}
          >
            {message}
          </div>
        ) : null}

        <button type="submit" disabled={submitting} style={{ justifySelf: "start" }}>
          {submitting ? "กำลังบันทึก..." : "บันทึกข้อมูลผู้ใช้"}
        </button>
      </form>
    </div>
  );
}
