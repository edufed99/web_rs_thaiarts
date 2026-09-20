"use client";

import { useRouter } from "next/navigation";
import React, { useEffect, useState } from "react";

import { ErrorState } from "@/components/ErrorState";
import { LoadingState } from "@/components/LoadingState";
import { MemberHero } from "@/components/MemberHero";
import { useTranslation } from "@/contexts/LanguageContext";
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
  const { t, locale } = useTranslation();
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
        setDisplayName(getReadableUserName(data, locale));
        setBio(data.bio);
      })
      .catch((reason: unknown) => setError(errorMessage(reason)));
  }, [router, locale]);

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
      setMessage(locale === "en" ? "Profile updated successfully" : "บันทึกข้อมูลส่วนตัวเรียบร้อยแล้ว");
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
      setError(locale === "en" ? "Only JPEG, PNG, or WebP files are supported" : "รองรับเฉพาะไฟล์ JPEG, PNG หรือ WebP");
      event.target.value = "";
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError(locale === "en" ? "Avatar image must be smaller than 5 MB" : "รูปโปรไฟล์ต้องมีขนาดไม่เกิน 5 MB");
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
      setMessage(locale === "en" ? "Profile avatar removed successfully" : "ลบรูปโปรไฟล์เรียบร้อยแล้ว");
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
      setError(locale === "en" ? "Username must be at least 3 characters" : "ชื่อผู้ใช้ต้องมีอย่างน้อย 3 ตัวอักษร");
      return;
    }
    if (!nextEmail || !nextEmail.includes("@")) {
      setError(locale === "en" ? "Please provide a valid email address" : "กรุณากรอกอีเมลให้ถูกต้อง");
      return;
    }
    if (!usernameChanged && !emailChanged && !passwordChanged) {
      setError(locale === "en" ? "No changes to username, email, or password" : "ยังไม่มีการเปลี่ยนแปลงชื่อผู้ใช้ อีเมล หรือรหัสผ่าน");
      return;
    }
    if (!currentPassword) {
      setError(locale === "en" ? "Please enter your current password to confirm changes" : "กรุณากรอกรหัสผ่านปัจจุบันเพื่อยืนยันการเปลี่ยนแปลง");
      return;
    }
    if (passwordChanged && (!newPassword || !confirmPassword)) {
      setError(locale === "en" ? "Please enter and confirm your new password" : "กรุณากรอกรหัสผ่านใหม่และยืนยันรหัสผ่านให้ครบ");
      return;
    }
    if (passwordChanged && newPassword !== confirmPassword) {
      setError(locale === "en" ? "New password and confirmation do not match" : "รหัสผ่านใหม่และการยืนยันไม่ตรงกัน");
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
      if (locale === "en") {
        setMessage(
          (usernameChanged || emailChanged) && passwordChanged
            ? "Account information and password updated successfully"
            : usernameChanged
              ? "Username updated successfully"
              : emailChanged
                ? "Email updated successfully"
                : "Password updated successfully",
        );
      } else {
        setMessage(
          (usernameChanged || emailChanged) && passwordChanged
            ? "เปลี่ยนข้อมูลบัญชีและรหัสผ่านเรียบร้อยแล้ว"
            : usernameChanged
              ? "เปลี่ยนชื่อผู้ใช้เรียบร้อยแล้ว"
              : emailChanged
                ? "เปลี่ยนอีเมลเรียบร้อยแล้ว"
              : "เปลี่ยนรหัสผ่านเรียบร้อยแล้ว",
        );
      }
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setSavingPassword(false);
    }
  }

  if (error && !profile) return <ErrorState message={error} onRetry={() => window.location.reload()} />;
  if (!profile) return <LoadingState message={t("profileEdit.loading")} />;

  return (
    <div className="section-stack">
      <MemberHero title={t("profileEdit.title")} subtitle={t("profileEdit.subtitle")} />

      {error ? <div role="alert" className="error-panel">{error}</div> : null}
      {message ? <div role="status" className="panel" style={{ background: "#edf7f5" }}>{message}</div> : null}

      <form onSubmit={saveProfile} className="form-panel" style={{ maxWidth: 720 }}>
        <h2 style={{ margin: 0 }}>{t("profileEdit.profileInfoTitle")}</h2>
        <div className="panel" style={{ boxShadow: "none" }}>
          <p className="muted" style={{ margin: 0 }}>{t("profileEdit.usernameLabel")}: <strong>{profile.username}</strong></p>
          <p className="muted" style={{ margin: "0.5rem 0 0" }}>{t("profileEdit.emailLabel")}: <strong>{profile.email}</strong></p>
          <p className="muted" style={{ margin: "0.5rem 0 0" }}>
            {t("profileEdit.roleLabel")}: <strong>{profile.role === "super_admin" ? "super_admin" : "user"}</strong>
          </p>
        </div>
        <label className="field">
          <span>{t("profileEdit.displayNameLabel")}</span>
          <input maxLength={120} value={displayName} onChange={(event) => setDisplayName(event.target.value)} required />
        </label>
        <div className="field">
          <span>{t("profileEdit.avatarLabel")}</span>
          <div style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
            {(avatarPreview || profile.avatar_url) ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={avatarPreview || resolveImageUrl(profile.avatar_url) || ""}
                alt={t("profileEdit.avatarPreviewAlt")}
                style={{ width: 88, height: 88, borderRadius: "50%", objectFit: "cover" }}
              />
            ) : <div className="member-avatar" style={{ width: 88, height: 88 }}>{(displayName || profile.username).charAt(0)}</div>}
            <div style={{ display: "grid", gap: "0.5rem" }}>
              <input type="file" accept="image/jpeg,image/png,image/webp" onChange={chooseAvatar} />
              <small className="muted">{t("profileEdit.avatarHint")}</small>
              {profile.avatar_url ? <button type="button" className="secondary" onClick={removeAvatar} disabled={savingProfile}>{t("profileEdit.removeAvatar")}</button> : null}
            </div>
          </div>
        </div>
        <label className="field">
          <span>{t("profileEdit.bioLabel")}</span>
          <textarea maxLength={1000} rows={5} value={bio} onChange={(event) => setBio(event.target.value)} placeholder={t("profileEdit.bioPlaceholder")} />
        </label>
        <button type="submit" disabled={savingProfile}>{savingProfile ? t("profileEdit.savingBtn") : t("profileEdit.saveProfileBtn")}</button>
      </form>

      <form id="credentials" onSubmit={saveCredentials} className="form-panel" style={{ maxWidth: 720 }}>
        <h2 style={{ margin: 0 }}>{t("profileEdit.credentialsTitle")}</h2>
        <p className="muted" style={{ margin: 0 }}>
          {t("profileEdit.credentialsDesc")}
        </p>
        <label className="field">
          <span>{t("profileEdit.usernameLabel")}</span>
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
          <span>{t("profileEdit.emailLabel")}</span>
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
          <span>{t("profileEdit.currentPasswordLabel")}</span>
          <input type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} />
        </label>
        <label className="field">
          <span>{t("profileEdit.newPasswordLabel")} <small className="muted">{t("profileEdit.newPasswordHint")}</small></span>
          <input type="password" minLength={8} maxLength={128} autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
        </label>
        <label className="field">
          <span>{t("profileEdit.confirmPasswordLabel")}</span>
          <input type="password" minLength={8} maxLength={128} autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
        </label>
        <button type="submit" disabled={savingPassword}>{savingPassword ? t("profileEdit.savingBtn") : t("profileEdit.saveCredentialsBtn")}</button>
      </form>

      <section className="form-panel" style={{ maxWidth: 720 }} aria-label={t("profileEdit.pdpaTitle")}>
        <h2 style={{ margin: 0 }}>{t("profileEdit.pdpaTitle")}</h2>
        <p className="muted" style={{ margin: 0 }}>
          {t("profileEdit.pdpaDesc")}
        </p>
        <div className="panel" style={{ boxShadow: "none" }}>
          <p style={{ margin: "0 0 0.5rem" }}>
            {t("profileEdit.consentStatus")}{" "}
            <strong>
              {profile?.consent_accepted ? t("profileEdit.consentAccepted") : t("profileEdit.consentWithdrawn")}
            </strong>
          </p>
          {profile?.consent_accepted_at ? (
            <p className="muted" style={{ margin: "0.25rem 0", fontSize: 13 }}>
              {t("profileEdit.consentedAt").replace("{date}", formatDate(profile.consent_accepted_at, locale)).replace("{version}", profile.consent_version || "1.0")}
            </p>
          ) : null}
          {profile?.consent_withdrawn_at ? (
            <p className="muted" style={{ margin: "0.25rem 0", fontSize: 13, color: "#b33a3a" }}>
              {t("profileEdit.withdrawnAt").replace("{date}", formatDate(profile.consent_withdrawn_at, locale))}
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
              {savingConsent ? t("profileEdit.savingBtn") : t("profileEdit.withdrawBtn")}
            </button>
          ) : (
            <button
              type="button"
              disabled={savingConsent}
              onClick={handleAcceptConsent}
            >
              {savingConsent ? t("profileEdit.savingBtn") : t("profileEdit.acceptBtn")}
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
      setMessage(locale === "en" ? "Consent withdrawn successfully" : "ถอนความยินยอมเรียบร้อยแล้ว");
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
      setMessage(locale === "en" ? "Consent granted successfully" : "บันทึกการให้ความยินยอมเรียบร้อยแล้ว");
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setSavingConsent(false);
    }
  }
}

function formatDate(value: string | null, locale: string = "th"): string {
  if (!value) return "—";
  try {
    return new Intl.DateTimeFormat(locale === "en" ? "en-US" : "th-TH", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  } catch {
    return value;
  }
}

function errorMessage(reason: unknown): string {
  return reason instanceof ApiClientError || reason instanceof Error ? reason.message : String(reason);
}
