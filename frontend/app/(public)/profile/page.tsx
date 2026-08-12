"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import React, { useEffect, useState } from "react";

import { CatalogItemCard } from "@/components/CatalogItemCard";
import { ErrorState } from "@/components/ErrorState";
import { LoadingState } from "@/components/LoadingState";
import { MemberHero } from "@/components/MemberHero";
import { MemberHistoryTable } from "@/components/MemberHistoryTable";
import { MemberStats } from "@/components/MemberStats";
import { getMemberDashboard, getProfileRecommendations, resolveImageUrl } from "@/lib/api";
import { getCurrentUser, getReadableUserName, userNeedsPasswordReset } from "@/lib/auth";
import { MEMBER_ACTIVITY_CHANGED_EVENT } from "@/lib/memberEvents";
import type { MemberDashboardOut, ProfileRecommendationResponseOut } from "@/lib/types";
import { useAuthHeaders } from "@/lib/useAuthHeaders";
import { getUserKey } from "@/lib/user";

export default function MemberDashboardPage() {
  const router = useRouter();
  const authHeaders = useAuthHeaders();
  const [dashboard, setDashboard] = useState<MemberDashboardOut | null>(null);
  const [recommendations, setRecommendations] = useState<ProfileRecommendationResponseOut | null>(null);
  const [userKey, setUserKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const reload = () => setReloadKey((value) => value + 1);
    window.addEventListener(MEMBER_ACTIVITY_CHANGED_EVENT, reload);
    return () => window.removeEventListener(MEMBER_ACTIVITY_CHANGED_EVENT, reload);
  }, []);

  useEffect(() => {
    if (!getCurrentUser()) {
      router.replace("/login?next=/profile");
      return;
    }
    setUserKey(getUserKey());
    let cancelled = false;
    setError(null);
    Promise.all([
      getMemberDashboard(),
      getProfileRecommendations({ topK: 4, extraHeaders: authHeaders }).catch(() => null),
    ])
      .then(([memberData, recommendationData]) => {
        if (cancelled) return;
        setDashboard(memberData);
        setRecommendations(recommendationData);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      cancelled = true;
    };
  }, [router, authHeaders, reloadKey]);

  if (error) {
    return <ErrorState message={error} onRetry={() => setReloadKey((value) => value + 1)} />;
  }
  if (!dashboard) return <LoadingState message="กำลังโหลดแดชบอร์ดสมาชิก..." />;

  const { profile, summary, recent_activity: activity, recent_views: recentViews } = dashboard;
  const displayName = getReadableUserName(profile);
  const needsPasswordReset = userNeedsPasswordReset(profile);

  return (
    <div className="section-stack">
      <MemberHero
        title={`สวัสดี ${displayName}`}
        subtitle="ภาพรวมโปรไฟล์ ความสนใจ และกิจกรรมของคุณในระบบแนะนำการแสดงนาฏศิลป์ไทย"
      />

      <section className="panel" style={{ display: "grid", gap: "1rem" }} aria-label="โปรไฟล์สมาชิก">
        <div style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
          {profile.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={resolveImageUrl(profile.avatar_url) ?? undefined}
              alt={`รูปโปรไฟล์ ${displayName}`}
              style={{ width: 76, height: 76, borderRadius: "50%", objectFit: "cover" }}
            />
          ) : (
            <div className="member-avatar" aria-hidden="true" style={{ width: 76, height: 76, fontSize: 28 }}>
              {displayName.trim().charAt(0) || "ส"}
            </div>
          )}
          <div style={{ flex: 1, minWidth: 220 }}>
            <h2 style={{ margin: 0 }}>{displayName}</h2>
            {needsPasswordReset ? (
              <p className="member-account-notice">
                กรุณาเปลี่ยนรหัสผ่านเริ่มต้นเพื่อความปลอดภัย
              </p>
            ) : null}
            <p className="muted" style={{ margin: "0.25rem 0" }}>ชื่อผู้ใช้: {profile.username}</p>
            <span className="context-pill">
              {profile.role === "super_admin" ? "ผู้ดูแลระบบสูงสุด" : "สมาชิกทั่วไป"}
            </span>
          </div>
          <Link href="/profile/edit" className="secondary">แก้ไขข้อมูลส่วนตัว</Link>
        </div>
        {profile.bio ? <p style={{ margin: 0 }}>{profile.bio}</p> : null}
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          สมัครเมื่อ {formatDate(profile.created_at)} · เข้าใช้ล่าสุด {formatDate(profile.last_login_at)}
        </p>
      </section>

      <MemberStats summary={summary} />

      <section className="member-section">
        <div className="member-section-head">
          <h2><span className="glyph" aria-hidden="true">◷</span> ดูล่าสุด</h2>
          <Link href="/profile/recent" className="head-action">ดูทั้งหมด →</Link>
        </div>
        {recentViews.items.length ? (
          <div className="pill-row">
            {recentViews.items.map((entry) => (
              <Link key={entry.item_id} href={`/items/${entry.item_id}`} className="context-pill">
                {entry.item_name} · {formatDate(entry.viewed_at)}
              </Link>
            ))}
          </div>
        ) : <p className="muted">ยังไม่มีรายการที่เปิดดูในช่วง 30 วันที่ผ่านมา</p>}
      </section>

      <section className="member-section" aria-label="กิจกรรมล่าสุด">
        <div className="member-section-head">
          <h2><span className="glyph" aria-hidden="true">⌚</span> กิจกรรมล่าสุด</h2>
          <Link href="/profile/activity" className="head-action">ดูกิจกรรมทั้งหมด →</Link>
        </div>
        <MemberHistoryTable entries={activity.items} hasMore={activity.total > activity.items.length} />
      </section>

      <section className="member-section">
        <div className="member-section-head">
          <h2><span className="glyph" aria-hidden="true">✦</span> คำแนะนำเฉพาะคุณ</h2>
          <Link href="/recommend" className="head-action">ดูและปรับคำแนะนำ →</Link>
        </div>
        {recommendations?.results.length ? (
          <div className="member-grid">
            {recommendations.results.map((result) => (
              <CatalogItemCard key={result.item.id} item={result.item} userKey={userKey} rank={result.rank} />
            ))}
          </div>
        ) : <p className="muted">เริ่มกดถูกใจ บันทึก หรือให้คะแนน เพื่อให้ระบบเรียนรู้ความสนใจของคุณ</p>}
      </section>
    </div>
  );
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  try {
    return new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  } catch {
    return value;
  }
}
