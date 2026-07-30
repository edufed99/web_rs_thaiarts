"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { CatalogItemCard } from "@/components/CatalogItemCard";
import { ErrorState } from "@/components/ErrorState";
import { LoadingState } from "@/components/LoadingState";
import { ApiClientError, getItems, getMe, patchMe } from "@/lib/api";
import {
  getCurrentUser,
  getReadableUserName,
  updateStoredUser,
} from "@/lib/auth";
import type { ItemOut, UserOut, UserState } from "@/lib/types";
import { useAuthHeaders } from "@/lib/useAuthHeaders";
import { getUserKey } from "@/lib/user";

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
  const authHeaders = useAuthHeaders();
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<UserOut | null>(null);
  const [activeSection, setActiveSection] = useState<"profile" | "saved" | "history" | "settings">("profile");
  const [savedItems, setSavedItems] = useState<ItemOut[] | null>(null);
  const [savedError, setSavedError] = useState<string | null>(null);
  const [historyItems, setHistoryItems] = useState<ItemOut[] | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [userKey, setUserKey] = useState("");
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
    setActiveSection(sectionFromHash(window.location.hash));
    setUserKey(getUserKey());
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

  useEffect(() => {
    function onHashChange() {
      setActiveSection(sectionFromHash(window.location.hash));
    }

    onHashChange();
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    if (!ready || !user || activeSection !== "saved") return;

    let cancelled = false;
    setSavedItems(null);
    setSavedError(null);
    getItems({ limit: 200, userKey, extraHeaders: authHeaders })
      .then((resp) => {
        if (cancelled) return;
        setSavedItems(resp.items.filter((item) => item.user_state.saved));
      })
      .catch((e) => {
        if (cancelled) return;
        setSavedError(e instanceof ApiClientError ? e.message : String(e));
        setSavedItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, [activeSection, authHeaders, ready, user, userKey]);

  useEffect(() => {
    if (!ready || !user || activeSection !== "history") return;

    let cancelled = false;
    setHistoryItems(null);
    setHistoryError(null);
    getItems({ limit: 200, userKey, extraHeaders: authHeaders })
      .then((resp) => {
        if (cancelled) return;
        setHistoryItems(resp.items.filter(hasAnyUserInterest));
      })
      .catch((e) => {
        if (cancelled) return;
        setHistoryError(e instanceof ApiClientError ? e.message : String(e));
        setHistoryItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, [activeSection, authHeaders, ready, user, userKey]);

  function handleSavedItemStateChange(itemId: number, next: UserState) {
    setSavedItems((current) => {
      if (!current) return current;
      if (!next.saved) return current.filter((item) => item.id !== itemId);
      return current.map((item) =>
        item.id === itemId ? { ...item, user_state: next } : item,
      );
    });
  }

  function handleHistoryItemStateChange(itemId: number, next: UserState) {
    setHistoryItems((current) => {
      if (!current) return current;
      if (!hasAnyUserStateInterest(next)) return current.filter((item) => item.id !== itemId);
      return current.map((item) =>
        item.id === itemId ? { ...item, user_state: next } : item,
      );
    });
    setSavedItems((current) => {
      if (!current) return current;
      if (!next.saved) return current.filter((item) => item.id !== itemId);
      return current.map((item) =>
        item.id === itemId ? { ...item, user_state: next } : item,
      );
    });
  }

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
          <h1>{profileTitle(activeSection)}</h1>
          <p className="muted">
            {profileSubtitle(activeSection)}
          </p>
        </div>
      </section>

      <nav className="profile-tabs" aria-label="เมนูข้อมูลผู้ใช้">
        <a className={activeSection === "profile" ? "active" : undefined} href="/profile">
          ข้อมูลผู้ใช้
        </a>
        <a className={activeSection === "saved" ? "active" : undefined} href="/profile#saved">
          รายการที่บันทึกไว้
        </a>
        <a className={activeSection === "history" ? "active" : undefined} href="/profile#history">
          ประวัติความสนใจ
        </a>
      </nav>

      {activeSection === "saved" ? (
        <SavedItemsSection
          items={savedItems}
          error={savedError}
          userKey={userKey}
          onUserStateChange={handleSavedItemStateChange}
        />
      ) : activeSection === "history" ? (
        <HistoryItemsSection
          items={historyItems}
          error={historyError}
          userKey={userKey}
          onUserStateChange={handleHistoryItemStateChange}
        />
      ) : (
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
      )}
    </div>
  );
}

function sectionFromHash(hash: string): "profile" | "saved" | "history" | "settings" {
  if (hash === "#saved") return "saved";
  if (hash === "#history") return "history";
  if (hash === "#settings") return "settings";
  return "profile";
}

function profileTitle(section: "profile" | "saved" | "history" | "settings"): string {
  if (section === "saved") return "รายการที่บันทึกไว้";
  if (section === "history") return "ประวัติความสนใจ";
  if (section === "settings") return "ตั้งค่าระบบ";
  return "ข้อมูลผู้ใช้";
}

function profileSubtitle(section: "profile" | "saved" | "history" | "settings"): string {
  if (section === "saved") return "ชุดการแสดงที่คุณเคยกดบันทึกไว้";
  if (section === "history") return "สรุปสัญญาณความสนใจจากการถูกใจ บันทึก และให้คะแนน";
  if (section === "settings") return "ตั้งค่าบัญชีและประสบการณ์ใช้งาน";
  return "จัดการชื่อที่แสดงและรหัสผ่านของบัญชีที่ใช้รับคำแนะนำเฉพาะคุณ";
}

function SavedItemsSection({
  items,
  error,
  userKey,
  onUserStateChange,
}: {
  items: ItemOut[] | null;
  error: string | null;
  userKey: string;
  onUserStateChange: (itemId: number, next: UserState) => void;
}) {
  if (error) {
    return <ErrorState title="โหลดรายการที่บันทึกไว้ไม่ได้" message={error} />;
  }

  if (items === null) {
    return <LoadingState message="กำลังโหลดรายการที่บันทึกไว้..." />;
  }

  if (items.length === 0) {
    return (
      <section className="empty-panel">
        <h2>ยังไม่มีรายการที่บันทึกไว้</h2>
        <p className="muted" style={{ marginBottom: 0 }}>
          เมื่อกดปุ่ม “บันทึก” บนชุดการแสดง รายการนั้นจะแสดงที่หน้านี้
        </p>
      </section>
    );
  }

  return (
    <section className="profile-item-grid">
      {items.map((item) => (
        <CatalogItemCard
          key={item.id}
          item={item}
          userKey={userKey}
          descriptionLimit={140}
          onUserStateChange={onUserStateChange}
        />
      ))}
    </section>
  );
}

function HistoryItemsSection({
  items,
  error,
  userKey,
  onUserStateChange,
}: {
  items: ItemOut[] | null;
  error: string | null;
  userKey: string;
  onUserStateChange: (itemId: number, next: UserState) => void;
}) {
  if (error) {
    return <ErrorState title="โหลดประวัติความสนใจไม่ได้" message={error} />;
  }

  if (items === null) {
    return <LoadingState message="กำลังโหลดประวัติความสนใจ..." />;
  }

  if (items.length === 0) {
    return (
      <section className="empty-panel">
        <h2>ยังไม่มีประวัติความสนใจ</h2>
        <p className="muted" style={{ marginBottom: 0 }}>
          เมื่อกดถูกใจ บันทึก หรือให้คะแนนดาว ชุดการแสดงนั้นจะแสดงที่หน้านี้
        </p>
      </section>
    );
  }

  const likedCount = items.filter((item) => item.user_state.liked).length;
  const savedCount = items.filter((item) => item.user_state.saved).length;
  const ratedCount = items.filter((item) => item.user_state.rating > 0).length;

  return (
    <div className="section-stack">
      <section className="profile-history-summary" aria-label="สรุปประวัติความสนใจ">
        <div>
          <span>ถูกใจ</span>
          <strong>{likedCount}</strong>
        </div>
        <div>
          <span>บันทึกไว้</span>
          <strong>{savedCount}</strong>
        </div>
        <div>
          <span>ให้คะแนน</span>
          <strong>{ratedCount}</strong>
        </div>
      </section>

      <section className="profile-item-grid">
        {items.map((item) => (
          <div key={item.id} className="profile-history-card">
            <div className="profile-history-tags">
              {item.user_state.liked ? <span className="interest-chip liked">ถูกใจ</span> : null}
              {item.user_state.saved ? <span className="interest-chip saved">บันทึกไว้</span> : null}
              {item.user_state.rating > 0 ? (
                <span className="interest-chip rated">{item.user_state.rating} ดาว</span>
              ) : null}
            </div>
            <CatalogItemCard
              item={item}
              userKey={userKey}
              descriptionLimit={140}
              onUserStateChange={onUserStateChange}
            />
          </div>
        ))}
      </section>
    </div>
  );
}

function hasAnyUserInterest(item: ItemOut): boolean {
  return hasAnyUserStateInterest(item.user_state);
}

function hasAnyUserStateInterest(state: UserState): boolean {
  return state.liked || state.saved || state.rating > 0;
}
