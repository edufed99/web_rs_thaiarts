"use client";

import { useRouter } from "next/navigation";
import React, { useEffect, useState } from "react";

import { ErrorState } from "@/components/ErrorState";
import { LoadingState } from "@/components/LoadingState";
import { MemberHero } from "@/components/MemberHero";
import {
  ApiClientError,
  deleteMemberAvatar,
  getMemberProfile,
  patchMe,
  patchMemberProfile,
  resolveImageUrl,
  uploadMemberAvatar,
} from "@/lib/api";
import { getCurrentUser, getReadableUserName, updateStoredUser } from "@/lib/auth";
import type { MemberProfileOut } from "@/lib/types";

export default function EditMemberProfilePage() {
  const router = useRouter();
  const [profile, setProfile] = useState<MemberProfileOut | null>(null);
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [bio, setBio] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [currentUser, setCurrentUser] = useState(getCurrentUser());
  const [savingConsent, setSavingConsent] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const user = getCurrentUser();
    if (!user) {
      router.replace("/login?next=/profile/edit");
      return;
    }
    setCurrentUser(user);
    getMemberProfile()
      .then((data) => {
        setProfile(data);
        setUsername(data.username);
        setEmail(data.email);
        setDisplayName(getReadableUserName(data));
        setBio(data.bio);
      })
      .catch((reason: unknown) => setError(errorMessage(reason)));
  }, [router]);

  async function saveProfile(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setSavingProfile(true);
    try {
      let updated = await patchMemberProfile({
        display_name: displayName,
        bio,
      });
      if (avatarFile) {
        updated = await uploadMemberAvatar(avatarFile);
        setAvatarFile(null);
        if (avatarPreview?.startsWith("blob:")) URL.revokeObjectURL(avatarPreview);
        setAvatarPreview(null);
      }
      setProfile(updated);
      const current = getCurrentUser();
      if (current) updateStoredUser({ ...current, display_name: updated.display_name });
      setMessage("บันทึกข้อมูลส่วนตัวเรียบร้อยแล้ว");
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setSavingProfile(false);
    }
  }

  function chooseAvatar(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setError(null);
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setError("รองรับเฉพาะไฟล์ JPEG, PNG หรือ WebP");
      event.target.value = "";
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError("รูปโปรไฟล์ต้องมีขนาดไม่เกิน 5 MB");
      event.target.value = "";
      return;
    }
    if (avatarPreview?.startsWith("blob:")) URL.revokeObjectURL(avatarPreview);
    setAvatarFile(file);
    setAvatarPreview(URL.createObjectURL(file));
  }

  async function removeAvatar() {
    setError(null);
    setMessage(null);
    setSavingProfile(true);
    try {
      const updated = await deleteMemberAvatar();
      setProfile(updated);
      setAvatarFile(null);
      if (avatarPreview?.startsWith("blob:")) URL.revokeObjectURL(avatarPreview);
      setAvatarPreview(null);
      setMessage("ลบรูปโปรไฟล์เรียบร้อยแล้ว");
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setSavingProfile(false);
    }
  }

  async function saveCredentials(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    if (!profile) return;
    const nextUsername = username.trim();
    const nextEmail = email.trim().toLowerCase();
    const usernameChanged = nextUsername !== profile.username;
    const emailChanged = nextEmail !== profile.email;
    const passwordChanged = Boolean(newPassword || confirmPassword);
    if (nextUsername.length < 3) {
      setError("ชื่อผู้ใช้ต้องมีอย่างน้อย 3 ตัวอักษร");
      return;
    }
    if (!nextEmail || !nextEmail.includes("@")) {
      setError("กรุณากรอกอีเมลให้ถูกต้อง");
      return;
    }
    if (!usernameChanged && !emailChanged && !passwordChanged) {
      setError("ยังไม่มีการเปลี่ยนแปลงชื่อผู้ใช้ อีเมล หรือรหัสผ่าน");
      return;
    }
    if (!currentPassword) {
      setError("กรุณากรอกรหัสผ่านปัจจุบันเพื่อยืนยันการเปลี่ยนแปลง");
      return;
    }
    if (passwordChanged && (!newPassword || !confirmPassword)) {
      setError("กรุณากรอกรหัสผ่านใหม่และยืนยันรหัสผ่านให้ครบ");
      return;
    }
    if (passwordChanged && newPassword !== confirmPassword) {
      setError("รหัสผ่านใหม่และการยืนยันไม่ตรงกัน");
      return;
    }
    setSavingPassword(true);
    try {
      const updatedUser = await patchMe({
        username: usernameChanged ? nextUsername : undefined,
        email: emailChanged ? nextEmail : undefined,
        current_password: currentPassword,
        new_password: passwordChanged ? newPassword : undefined,
      });
      updateStoredUser(updatedUser);
      setUsername(updatedUser.username);
      setEmail(updatedUser.email);
      setProfile((current) => current ? {
        ...current,
        username: updatedUser.username,
        email: updatedUser.email,
      } : current);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setMessage(
        (usernameChanged || emailChanged) && passwordChanged
          ? "เปลี่ยนข้อมูลบัญชีและรหัสผ่านเรียบร้อยแล้ว"
          : usernameChanged
            ? "เปลี่ยนชื่อผู้ใช้เรียบร้อยแล้ว"
            : emailChanged
              ? "เปลี่ยนอีเมลเรียบร้อยแล้ว"
            : "เปลี่ยนรหัสผ่านเรียบร้อยแล้ว",
      );
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setSavingPassword(false);
    }
  }

  if (error && !profile) return <ErrorState message={error} onRetry={() => window.location.reload()} />;
  if (!profile) return <LoadingState message="กำลังโหลดข้อมูลส่วนตัว..." />;

  return (
    <div className="section-stack">
      <MemberHero title="แก้ไขข้อมูลส่วนตัว" subtitle="จัดการข้อมูลที่แสดงบนแดชบอร์ดของคุณ โดยระดับผู้ใช้ไม่สามารถแก้ไขได้จากหน้านี้" />

      {error ? <div role="alert" className="error-panel">{error}</div> : null}
      {message ? <div role="status" className="panel" style={{ background: "#edf7f5" }}>{message}</div> : null}

      <form onSubmit={saveProfile} className="form-panel" style={{ maxWidth: 720 }}>
        <h2 style={{ margin: 0 }}>ข้อมูลโปรไฟล์</h2>
        <div className="panel" style={{ boxShadow: "none" }}>
          <p className="muted" style={{ margin: 0 }}>ชื่อผู้ใช้: <strong>{profile.username}</strong></p>
          <p className="muted" style={{ margin: "0.5rem 0 0" }}>อีเมล: <strong>{profile.email}</strong></p>
          <p className="muted" style={{ margin: "0.5rem 0 0" }}>
            ระดับผู้ใช้: <strong>{profile.role === "super_admin" ? "super_admin" : "user"}</strong>
          </p>
        </div>
        <label className="field">
          <span>ชื่อที่แสดง</span>
          <input maxLength={120} value={displayName} onChange={(event) => setDisplayName(event.target.value)} required />
        </label>
        <div className="field">
          <span>รูปโปรไฟล์</span>
          <div style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
            {(avatarPreview || profile.avatar_url) ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={avatarPreview || resolveImageUrl(profile.avatar_url) || ""}
                alt="ตัวอย่างรูปโปรไฟล์"
                style={{ width: 88, height: 88, borderRadius: "50%", objectFit: "cover" }}
              />
            ) : <div className="member-avatar" style={{ width: 88, height: 88 }}>{(displayName || profile.username).charAt(0)}</div>}
            <div style={{ display: "grid", gap: "0.5rem" }}>
              <input type="file" accept="image/jpeg,image/png,image/webp" onChange={chooseAvatar} />
              <small className="muted">JPEG, PNG หรือ WebP ขนาดไม่เกิน 5 MB</small>
              {profile.avatar_url ? <button type="button" className="secondary" onClick={removeAvatar} disabled={savingProfile}>ลบรูปปัจจุบัน</button> : null}
            </div>
          </div>
        </div>
        <label className="field">
          <span>ข้อมูลแนะนำตัว</span>
          <textarea maxLength={1000} rows={5} value={bio} onChange={(event) => setBio(event.target.value)} placeholder="แนะนำตัวหรือบอกความสนใจด้านนาฏศิลป์ของคุณ" />
        </label>
        <button type="submit" disabled={savingProfile}>{savingProfile ? "กำลังบันทึก..." : "บันทึกข้อมูลส่วนตัว"}</button>
      </form>

      <form id="credentials" onSubmit={saveCredentials} className="form-panel" style={{ maxWidth: 720 }}>
        <h2 style={{ margin: 0 }}>ข้อมูลเข้าสู่ระบบ</h2>
        <p className="muted" style={{ margin: 0 }}>
          เปลี่ยนชื่อผู้ใช้ อีเมล รหัสผ่าน หรือหลายรายการพร้อมกัน โดยต้องยืนยันด้วยรหัสผ่านปัจจุบัน
        </p>
        <label className="field">
          <span>ชื่อผู้ใช้</span>
          <input
            type="text"
            minLength={3}
            maxLength={64}
            autoComplete="username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            required
          />
        </label>
        <label className="field">
          <span>อีเมล</span>
          <input
            type="email"
            maxLength={320}
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </label>
        <label className="field">
          <span>รหัสผ่านปัจจุบัน</span>
          <input type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} />
        </label>
        <label className="field">
          <span>รหัสผ่านใหม่ <small className="muted">(เว้นว่างหากไม่ต้องการเปลี่ยน)</small></span>
          <input type="password" minLength={8} maxLength={128} autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
        </label>
        <label className="field">
          <span>ยืนยันรหัสผ่านใหม่</span>
          <input type="password" minLength={8} maxLength={128} autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
        </label>
        <button type="submit" disabled={savingPassword}>{savingPassword ? "กำลังบันทึก..." : "บันทึกข้อมูลเข้าสู่ระบบ"}</button>
      </form>

      <section className="form-panel" style={{ maxWidth: 720 }} aria-label="ความยินยอมในการใช้ข้อมูล">
        <h2 style={{ margin: 0 }}>ความยินยอมและการคุ้มครองข้อมูลส่วนบุคคล (PDPA)</h2>
        <p className="muted" style={{ margin: 0 }}>
          คุณสามารถจัดการความยินยอมในการให้ระบบเก็บข้อมูลความสนใจและการประเมินเพื่อการศึกษาวิจัยและปรับปรุงระบบแนะนำได้ตลอดเวลา
        </p>
        <div className="panel" style={{ boxShadow: "none" }}>
          <p style={{ margin: "0 0 0.5rem" }}>
            สถานะความยินยอม:{" "}
            <strong>
              {profile?.consent_accepted ? "✅ ยินยอมแล้ว" : "❌ ไม่ยินยอม / ถอนความยินยอมแล้ว"}
            </strong>
          </p>
          {profile?.consent_accepted_at ? (
            <p className="muted" style={{ margin: "0.25rem 0", fontSize: 13 }}>
              ยินยอมเมื่อ: {formatDate(profile.consent_accepted_at)} (เวอร์ชัน {profile.consent_version || "1.0"})
            </p>
          ) : null}
          {profile?.consent_withdrawn_at ? (
            <p className="muted" style={{ margin: "0.25rem 0", fontSize: 13, color: "#b33a3a" }}>
              ถอนความยินยอมเมื่อ: {formatDate(profile.consent_withdrawn_at)}
            </p>
          ) : null}
        </div>
        <div>
          {profile?.consent_accepted ? (
            <button
              type="button"
              className="secondary"
              disabled={savingConsent}
              onClick={handleWithdrawConsent}
              style={{ color: "#b33a3a", borderColor: "#f0c4c4" }}
            >
              {savingConsent ? "กำลังบันทึก..." : "ถอนความยินยอม (Withdraw Consent)"}
            </button>
          ) : (
            <button
              type="button"
              disabled={savingConsent}
              onClick={handleAcceptConsent}
            >
              {savingConsent ? "กำลังบันทึก..." : "ให้ความยินยอมเพื่อการวิจัย"}
            </button>
          )}
        </div>
      </section>
    </div>
  );

  async function handleWithdrawConsent() {
    setError(null);
    setMessage(null);
    setSavingConsent(true);
    try {
      const updated = await patchMemberProfile({ withdraw_consent: true });
      setProfile(updated);
      setMessage("ถอนความยินยอมเรียบร้อยแล้ว");
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setSavingConsent(false);
    }
  }

  async function handleAcceptConsent() {
    setError(null);
    setMessage(null);
    setSavingConsent(true);
    try {
      const updated = await patchMemberProfile({ accept_consent: true });
      setProfile(updated);
      setMessage("บันทึกการให้ความยินยอมเรียบร้อยแล้ว");
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setSavingConsent(false);
    }
  }
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  try {
    return new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  } catch {
    return value;
  }
}

function errorMessage(reason: unknown): string {
  return reason instanceof ApiClientError || reason instanceof Error ? reason.message : String(reason);
}
