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
import { useTranslation } from "@/contexts/LanguageContext";
import { getMemberDashboard, getProfileRecommendations, resolveImageUrl } from "@/lib/api";
import { getCurrentUser, getReadableUserName, userNeedsPasswordReset } from "@/lib/auth";
import { MEMBER_ACTIVITY_CHANGED_EVENT } from "@/lib/memberEvents";
import type { MemberDashboardOut, ProfileRecommendationResponseOut, UserState } from "@/lib/types";
import { useAuthHeaders } from "@/lib/useAuthHeaders";
import { getUserKey } from "@/lib/user";

export default function MemberDashboardPage() {
  const router = useRouter();
  const { t, locale } = useTranslation();
  const authHeaders = useAuthHeaders();
  const [dashboard, setDashboard] = useState<MemberDashboardOut | null>(null);
  const [recommendations, setRecommendations] = useState<ProfileRecommendationResponseOut | null>(null);
  const [userKey, setUserKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [avatarError, setAvatarError] = useState(false);

  useEffect(() => {
    const reload = () => {
      // Reload dashboard stats/activity on user action without wiping the active recommendations
      getMemberDashboard()
        .then((memberData) => setDashboard(memberData))
        .catch(() => {});
    };
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

  function handleRecommendationStateChange(itemId: number, next: UserState) {
    setRecommendations((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        results: prev.results.map((r) =>
          r.item.id === itemId ? { ...r, item: { ...r.item, user_state: next } } : r,
        ),
      };
    });
  }

  if (error) {
    return <ErrorState message={error} onRetry={() => setReloadKey((value) => value + 1)} />;
  }
  if (!dashboard) return <LoadingState message={t("profile.loadingDashboard")} />;

  const { profile, summary, recent_activity: activity, recent_views: recentViews } = dashboard;
  const displayName = getReadableUserName(profile, locale);
  const needsPasswordReset = userNeedsPasswordReset(profile);

  return (
    <div className="section-stack">
      <MemberHero
        title={t("profile.greeting").replace("{name}", displayName)}
        subtitle={t("profile.heroSubtitle")}
      />

      <section className="panel" style={{ display: "grid", gap: "1rem" }} aria-label={t("profile.panelAria")}>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
          {profile.avatar_url && !avatarError ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={resolveImageUrl(profile.avatar_url) ?? undefined}
              alt={t("profile.profilePictureOf").replace("{name}", displayName)}
              style={{ width: 76, height: 76, borderRadius: "50%", objectFit: "cover" }}
              onError={() => setAvatarError(true)}
            />
          ) : (
            <div className="member-avatar" aria-hidden="true" style={{ width: 76, height: 76, fontSize: 28 }}>
              {displayName.trim().charAt(0) || (locale === "en" ? "M" : "ส")}
            </div>
          )}
          <div style={{ flex: 1, minWidth: 220 }}>
            <h2 style={{ margin: 0 }}>{displayName}</h2>
            {needsPasswordReset ? (
              <p className="member-account-notice">
                {t("profile.resetPasswordNotice")}
              </p>
            ) : null}
            <p className="muted" style={{ margin: "0.25rem 0" }}>
              {t("profile.usernameLabel")}: {profile.username}
            </p>
            <span className="context-pill">
              {profile.role === "super_admin" ? t("profile.roleSuperAdmin") : t("profile.roleGeneral")}
            </span>
          </div>
          <Link href="/profile/edit" className="secondary">{t("profile.editProfile")}</Link>
        </div>
        {profile.bio ? <p style={{ margin: 0 }}>{profile.bio}</p> : null}
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          {t("profile.joinedAt").replace("{date}", formatDate(profile.created_at, locale))} · {t("profile.lastLogin").replace("{date}", formatDate(profile.last_login_at, locale))}
        </p>
      </section>

      <MemberStats summary={summary} />

      <section className="member-section">
        <div className="member-section-head">
          <h2><span className="glyph" aria-hidden="true">◷</span> {t("profile.recentlyViewedTitle")}</h2>
          <Link href="/profile/recent" className="head-action">{t("profile.viewAllLink")}</Link>
        </div>
        {recentViews.items.length ? (
          <div className="pill-row">
            {recentViews.items.map((entry) => {
              const recentItemName = (locale === "en" && entry.item_name_en) ? entry.item_name_en : entry.item_name;
              return (
                <Link key={entry.item_id} href={`/items/${entry.item_id}`} className="context-pill">
                  {recentItemName} · {formatDate(entry.viewed_at, locale)}
                </Link>
              );
            })}
          </div>
        ) : <p className="muted">{t("profile.noRecentViews")}</p>}
      </section>

      <section className="member-section" aria-label={t("profile.recentActivityTitle")}>
        <div className="member-section-head">
          <h2><span className="glyph" aria-hidden="true">⌚</span> {t("profile.recentActivityTitle")}</h2>
          <Link href="/profile/activity" className="head-action">{t("profile.allActivityLink")}</Link>
        </div>
        <MemberHistoryTable entries={activity.items} hasMore={activity.total > activity.items.length} />
      </section>

      <section className="member-section">
        <div className="member-section-head">
          <h2><span className="glyph" aria-hidden="true">✦</span> {t("profile.personalizedRecTitle")}</h2>
          <Link href="/recommend" className="head-action">{t("profile.tuneRecLink")}</Link>
        </div>
        {recommendations?.results.length ? (
          <div className="member-grid">
            {recommendations.results.map((result) => (
              <CatalogItemCard
                key={result.item.id}
                item={result.item}
                userKey={userKey}
                rank={result.rank}
                onUserStateChange={handleRecommendationStateChange}
              />
            ))}
          </div>
        ) : <p className="muted">{t("profile.startEngagingHint")}</p>}
      </section>
    </div>
  );
}

function formatDate(value: string | null, locale: string): string {
  if (!value) return "—";
  try {
    return new Intl.DateTimeFormat(locale === "en" ? "en-US" : "th-TH", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  } catch {
    return value;
  }
}
