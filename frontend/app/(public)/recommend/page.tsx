"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { CardPagination } from "@/components/CardPagination";
import { ContextPicker } from "@/components/ContextPicker";
import { EmptyState } from "@/components/EmptyState";
import { KeywordPicker } from "@/components/KeywordPicker";
import { LoadingState } from "@/components/LoadingState";
import { MemberHero } from "@/components/MemberHero";
import { MemberShell } from "@/components/MemberShell";
import { ProfileRecommendationCard } from "@/components/ProfileRecommendationCard";
import { useTranslation } from "@/contexts/LanguageContext";
import { ApiClientError, getProfileRecommendations } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";
import type {
  ProfileRecommendationResponseOut,
  UserState,
} from "@/lib/types";
import { useAuthHeaders } from "@/lib/useAuthHeaders";
import { getUserKey } from "@/lib/user";
import { useCardPagination } from "@/lib/useCardPagination";

type RecommendView = "history" | "discover";

export default function RecommendPage() {
  const router = useRouter();
  const { t } = useTranslation();
  const [ready, setReady] = useState(false);
  const [activeView, setActiveView] = useState<RecommendView>("history");
  const [profileData, setProfileData] = useState<ProfileRecommendationResponseOut | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [userKey, setUserKey] = useState("");
  const [contextId, setContextId] = useState<number | null>(null);
  const [keywordIds, setKeywordIds] = useState<number[]>([]);
  const [topK, setTopK] = useState(10);
  const [submitting, setSubmitting] = useState(false);
  const authHeaders = useAuthHeaders();

  useEffect(() => {
    const syncViewFromHash = () => {
      setActiveView(
        window.location.hash === "#discover-new-performances" ? "discover" : "history",
      );
    };
    syncViewFromHash();
    window.addEventListener("hashchange", syncViewFromHash);
    return () => window.removeEventListener("hashchange", syncViewFromHash);
  }, []);

  useEffect(() => {
    const u = getCurrentUser();
    if (!u) {
      router.replace("/login?next=/recommend");
      return;
    }
    setUserKey(getUserKey());
    setReady(true);
  }, [router]);

  useEffect(() => {
    if (!ready || activeView !== "history") return;
    let cancelled = false;
    setProfileLoading(true);
    setProfileError(null);
    getProfileRecommendations({ topK: 10, extraHeaders: authHeaders })
      .then((data) => {
        if (!cancelled) setProfileData(data);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setProfileError(e instanceof ApiClientError ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setProfileLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [ready, activeView, authHeaders]);

  function handleProfileStateChange(itemId: number, next: UserState) {
    setProfileData((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        results: prev.results.map((r) =>
          r.item.id === itemId ? { ...r, item: { ...r.item, user_state: next } } : r,
        ),
      };
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (contextId === null) return;
    setSubmitting(true);
    const params = new URLSearchParams();
    params.set("context_id", String(contextId));
    params.set("top_k", String(topK));
    if (keywordIds.length > 0) {
      params.set("keyword_ids", keywordIds.join(","));
    }
    router.push(`/results?${params.toString()}`);
  }

  const canSubmit = contextId !== null && !submitting;

  function handleContextChange(nextContextId: number | null) {
    setContextId(nextContextId);
    setKeywordIds([]);
  }

  const profileResults = useMemo(() => profileData?.results ?? [], [profileData]);
  const {
    page: profilePage,
    setPage: setProfilePage,
    pageItems: visibleProfileResults,
  } = useCardPagination(profileResults, profileData?.request_id ?? "");

  if (!ready) {
    return <LoadingState message={t("recommend.checkingProfile")} />;
  }

  return (
    <MemberShell>
    <form onSubmit={handleSubmit} className="section-stack recommend-page">
      <MemberHero
        title={activeView === "history" ? t("recommend.heroHistoryTitle") : t("recommend.heroDiscoverTitle")}
        subtitle={activeView === "history"
          ? t("recommend.heroHistorySubtitle")
          : t("recommend.heroDiscoverSubtitle")}
      />

      {activeView === "history" ? <section
        id="recommend-from-history"
        className="profile-recommendation-section"
        aria-labelledby="profile-recommendation-title"
      >
        <div className="home-section-head recommend-profile-head">
          <div>
            <h2 id="profile-recommendation-title">{t("recommend.profileRecTitle")}</h2>
            <p>
              {t("recommend.profileRecSubtitle")}
            </p>
          </div>
          <div className="recommend-profile-actions">
            <span className="context-pill">
              {t("recommend.profileRecItemsCount").replace(
                "{count}",
                String(profileData?.results.length ?? topK),
              )}
            </span>
          </div>
        </div>

        {profileLoading ? (
          <LoadingState message={t("recommend.profileRecCalculating")} />
        ) : profileError ? (
          <EmptyState title={t("recommend.profileRecErrorTitle")} message={profileError} />
        ) : profileData && profileData.results.length > 0 ? (
          <>
          <div id="profile-recommendation-results" className="profile-recommendation-grid" aria-label={t("recommend.profileRecTitle")}>
            {visibleProfileResults.map((result) => (
              <ProfileRecommendationCard
                key={result.item.id}
                result={result}
                userKey={userKey}
                requestId={profileData.request_id}
                onUserStateChange={handleProfileStateChange}
              />
            ))}
          </div>
          <CardPagination
            currentPage={profilePage}
            totalItems={profileResults.length}
            onPageChange={setProfilePage}
            scrollTargetId="profile-recommendation-results"
          />
          </>
        ) : (
          <EmptyState
            title={t("recommend.profileRecEmptyTitle")}
            message={t("recommend.profileRecEmptyMessage")}
          />
        )}
      </section> : null}

      {activeView === "discover" ? <section
        id="discover-new-performances"
        className="form-panel recommend-config-panel"
        aria-labelledby="recommend-config-title"
      >
        <div className="recommend-config-heading">
          <div>
            <p className="eyebrow">{t("recommend.configEyebrow")}</p>
            <h2 id="recommend-config-title">{t("recommend.configTitle")}</h2>
            <p>
              {t("recommend.configSubtitle")}
            </p>
          </div>
        </div>
        <div className="recommend-config-form">
          <div className="recommend-primary-grid">
            <div className="recommend-context-field">
              <ContextPicker value={contextId} onChange={handleContextChange} />
            </div>
            <div className="recommend-topk-field-wrap">
              <label className="field recommend-topk-field">
                <span>{t("recommend.topKLabel")}</span>
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={topK}
                  onChange={(e) => {
                    const n = parseInt(e.target.value, 10);
                    if (!isNaN(n) && n >= 1 && n <= 50) setTopK(n);
                  }}
                />
              </label>
            </div>
          </div>

          <div className="recommend-keyword-section">
            <KeywordPicker
              selectedIds={keywordIds}
              onChange={setKeywordIds}
              contextId={contextId}
            />
          </div>

          <div className="recommend-actions-bar">
            <button
              type="submit"
              disabled={!canSubmit}
              className="recommend-submit-button"
            >
              {submitting ? t("recommend.calculatingButton") : t("recommend.calculateButton")}
            </button>
          </div>
        </div>
      </section> : null}
    </form>
    </MemberShell>
  );
}
