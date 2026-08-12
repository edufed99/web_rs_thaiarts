"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { CardPagination } from "@/components/CardPagination";
import { ContextPicker } from "@/components/ContextPicker";
import { EmptyState } from "@/components/EmptyState";
import { ItemActionBar } from "@/components/ItemActionBar";
import { KeywordPicker } from "@/components/KeywordPicker";
import { LoadingState } from "@/components/LoadingState";
import { MemberHero } from "@/components/MemberHero";
import { MemberShell } from "@/components/MemberShell";
import {
  PerformanceCardMedia,
  resolvedImageUrl,
} from "@/components/PerformanceCardMedia";
import { ApiClientError, getProfileRecommendations } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";
import { MEMBER_ACTIVITY_CHANGED_EVENT } from "@/lib/memberEvents";
import type {
  ProfileRecommendationResponseOut,
  RecommendationResultOut,
  UserState,
} from "@/lib/types";
import { useAuthHeaders } from "@/lib/useAuthHeaders";
import { getUserKey } from "@/lib/user";
import { useCardPagination } from "@/lib/useCardPagination";

type RecommendView = "history" | "discover";

export default function RecommendPage() {
  const router = useRouter();
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
  const [activityVersion, setActivityVersion] = useState(0);
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
    const refresh = () => setActivityVersion((value) => value + 1);
    window.addEventListener(MEMBER_ACTIVITY_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(MEMBER_ACTIVITY_CHANGED_EVENT, refresh);
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
  }, [ready, activeView, authHeaders, activityVersion]);

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
    return <LoadingState message="กำลังตรวจสอบโปรไฟล์ผู้ใช้..." />;
  }

  return (
    <MemberShell>
    <form onSubmit={handleSubmit} className="section-stack recommend-page">
      <MemberHero
        title={activeView === "history" ? "แนะนำจากสิ่งที่คุณชอบ" : "ค้นหาการแสดงใหม่"}
        subtitle={activeView === "history"
          ? "รายการแสดงที่ระบบคัดเลือกจากประวัติการถูกใจ บันทึก และให้คะแนนของคุณ"
          : "เลือกโอกาสที่ใช้แสดงและคุณลักษณะที่สนใจ เพื่อค้นหาชุดการแสดงที่ตรงกับความต้องการ"}
      />

      {activeView === "history" ? <section
        id="recommend-from-history"
        className="profile-recommendation-section"
        aria-labelledby="profile-recommendation-title"
      >
        <div className="home-section-head recommend-profile-head">
          <div>
            <h2 id="profile-recommendation-title">การแสดงที่คาดว่าคุณจะชอบจากพฤติกรรมในอดีต</h2>
            <p>
              ดูรายการแนะนำแบบย่อจากประวัติการถูกใจ บันทึก และให้คะแนนของคุณ
            </p>
          </div>
          <div className="recommend-profile-actions">
            <span className="context-pill">{profileData?.results.length ?? topK} รายการ</span>
          </div>
        </div>

        {profileLoading ? (
          <LoadingState message="กำลังคำนวณจากโปรไฟล์ผู้ใช้..." />
        ) : profileError ? (
          <EmptyState title="โหลดคำแนะนำจากโปรไฟล์ไม่ได้" message={profileError} />
        ) : profileData && profileData.results.length > 0 ? (
          <>
          <div id="profile-recommendation-results" className="profile-recommendation-grid" aria-label="รายการแนะนำจากพฤติกรรมในอดีต">
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
            title="ยังไม่มีประวัติพอสำหรับคำแนะนำจากโปรไฟล์"
            message="ลองถูกใจ บันทึก หรือให้คะแนนชุดการแสดงก่อน ระบบจะใช้ข้อมูลนั้นเพื่อแนะนำรายการที่ใกล้เคียงกับความสนใจของคุณ"
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
            <p className="eyebrow">กำหนดคำแนะนำของคุณ</p>
            <h2 id="recommend-config-title">ปรับคำแนะนำด้วยโอกาสและคุณลักษณะ</h2>
            <p>
              เลือกโอกาสที่ต้องการนำการแสดงไปใช้ แล้วระบุคุณลักษณะที่สนใจเพื่อให้ผลลัพธ์ตรงความต้องการมากขึ้น
            </p>
          </div>
        </div>
        <div className="recommend-config-grid">
          <ContextPicker value={contextId} onChange={handleContextChange} />
          <div className="recommend-keyword-field">
            <KeywordPicker
              selectedIds={keywordIds}
              onChange={setKeywordIds}
              contextId={contextId}
            />
          </div>
          <label className="field recommend-topk-field">
            <span>จำนวนผลลัพธ์ (top-K)</span>
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

        <button
          type="submit"
          disabled={!canSubmit}
          className="recommend-submit-button"
        >
          {submitting ? "กำลังคำนวณ..." : "คำนวณคำแนะนำเฉพาะคุณ"}
        </button>
      </section> : null}
    </form>
    </MemberShell>
  );
}

function ProfileRecommendationCard({
  result,
  userKey,
  requestId,
  onUserStateChange,
}: {
  result: RecommendationResultOut;
  userKey: string;
  requestId: string;
  onUserStateChange: (itemId: number, next: UserState) => void;
}) {
  return (
    <article className="popular-card profile-recommendation-card">
      <PerformanceCardMedia
        className="popular-card-media"
        imageUrl={resolvedImageUrl(result.item.image_url)}
        categoryGroup={result.item.category_group}
        title={result.item.name}
        variant="card"
      />
      <div className="popular-card-body">
        <span className="popular-badge">อันดับที่ {result.rank}</span>
        <h3 className="profile-recommendation-title">
          {result.item.name}
        </h3>
        <p className="muted profile-recommendation-reason">
          {result.explanation}
        </p>
        <div className="profile-card-footer">
          <ItemActionBar
            itemId={result.item.id}
            userKey={userKey}
            userState={result.item.user_state}
            onChange={(next) => onUserStateChange(result.item.id, next)}
            requestId={requestId}
          />
          <Link className="secondary profile-detail-link" href={`/items/${result.item.id}`}>
            รายละเอียด
          </Link>
        </div>
      </div>
    </article>
  );
}
