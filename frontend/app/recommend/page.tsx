"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { ContextPicker } from "@/components/ContextPicker";
import { EmptyState } from "@/components/EmptyState";
import { ItemActionBar } from "@/components/ItemActionBar";
import { KeywordPicker } from "@/components/KeywordPicker";
import { LoadingState } from "@/components/LoadingState";
import { ApiClientError, getProfileRecommendations } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";
import type {
  ProfileRecommendationResponseOut,
  RecommendationResultOut,
  UserState,
} from "@/lib/types";
import { useAuthHeaders } from "@/lib/useAuthHeaders";
import { getUserKey } from "@/lib/user";

export default function RecommendPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
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
    const u = getCurrentUser();
    if (!u) {
      router.replace("/login?next=/recommend");
      return;
    }
    setUserKey(getUserKey());
    setReady(true);
  }, [router]);

  useEffect(() => {
    if (!ready) return;
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
  }, [ready, authHeaders]);

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

  if (!ready) {
    return <LoadingState message="กำลังตรวจสอบโปรไฟล์ผู้ใช้..." />;
  }

  return (
    <form onSubmit={handleSubmit} className="section-stack">
      <section className="page-hero">
        <div>
          <p className="eyebrow">Personalized recommendation</p>
          <h1>คำแนะนำเฉพาะคุณ</h1>
          <p className="muted">
            เลือกโอกาสที่ใช้แสดงและคุณลักษณะที่สนใจ ระบบจะใช้ข้อมูลบริบท คำสำคัญ
            และพฤติกรรมผู้ใช้เพื่อจัดอันดับชุดการแสดงที่เหมาะกับคุณ
          </p>
        </div>
      </section>

      <section className="profile-recommendation-section">
        <div className="home-section-head" style={{ marginBottom: 0 }}>
          <div>
            <p className="eyebrow">ส่วนที่ 1</p>
            <h2>การแสดงที่คาดว่าคุณจะชอบจากพฤติกรรมในอดีต</h2>
            <p>
              ระบบคำนวณจากรายการที่คุณเคยชอบ กดบันทึก กดถูกใจ กดให้คะแนน
              แล้วนำเสนอรายการที่มีรูปแบบผู้ใช้ใกล้เคียงกัน
            </p>
          </div>
          <span className="context-pill">{profileData?.results.length ?? topK} รายการ</span>
        </div>

        {profileLoading ? (
          <LoadingState message="กำลังคำนวณจากโปรไฟล์ผู้ใช้..." />
        ) : profileError ? (
          <EmptyState title="โหลดคำแนะนำจากโปรไฟล์ไม่ได้" message={profileError} />
        ) : profileData && profileData.results.length > 0 ? (
          <div className="profile-recommendation-grid">
            {profileData.results.map((result) => (
              <ProfileRecommendationCard
                key={result.item.id}
                result={result}
                userKey={userKey}
                requestId={profileData.request_id}
                onUserStateChange={handleProfileStateChange}
              />
            ))}
          </div>
        ) : (
          <EmptyState
            title="ยังไม่มีประวัติพอสำหรับคำแนะนำจากโปรไฟล์"
            message="ลองถูกใจ บันทึก หรือให้คะแนนชุดการแสดงก่อน ระบบจะใช้ข้อมูลนั้นเพื่อแนะนำรายการที่ใกล้เคียงกับความสนใจของคุณ"
          />
        )}
      </section>

      <section className="form-panel">
        <div>
          <p className="eyebrow">ส่วนที่ 2</p>
          <h2 style={{ margin: 0, color: "#102044" }}>ปรับคำแนะนำด้วยโอกาสและคุณลักษณะ</h2>
        </div>
        <ContextPicker value={contextId} onChange={setContextId} />
        <KeywordPicker selectedIds={keywordIds} onChange={setKeywordIds} />
        <label className="field" style={{ maxWidth: "180px" }}>
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

        <button
          type="submit"
          disabled={!canSubmit}
          style={{ justifySelf: "start", minWidth: "180px" }}
        >
          {submitting ? "กำลังคำนวณ..." : "คำนวณคำแนะนำเฉพาะคุณ"}
        </button>
      </section>
    </form>
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
  const description =
    result.item.description && result.item.description.length > 120
      ? `${result.item.description.slice(0, 120).trimEnd()}...`
      : result.item.description;

  return (
    <article className="popular-card">
      <div
        className="popular-card-media"
        style={result.item.image_url ? { backgroundImage: `linear-gradient(135deg, rgba(6, 27, 60, 0.08), rgba(197, 145, 59, 0.12)), url("${result.item.image_url}")` } : undefined}
      />
      <div className="popular-card-body">
        <span className="popular-badge">อันดับที่ {result.rank}</span>
        <h3 style={{ margin: 0, color: "#102044", fontSize: "1.25rem", lineHeight: 1.35 }}>
          {result.item.name}
        </h3>
        {description ? <p className="description" style={{ margin: 0 }}>{description}</p> : null}
        <p className="muted" style={{ margin: 0, fontSize: "0.88rem" }}>
          {result.explanation}
        </p>
        <Link className="secondary" href={`/items/${result.item.id}`} style={{ justifySelf: "start" }}>
          รายละเอียด
        </Link>
        <ItemActionBar
          itemId={result.item.id}
          userKey={userKey}
          userState={result.item.user_state}
          onChange={(next) => onUserStateChange(result.item.id, next)}
          requestId={requestId}
        />
      </div>
    </article>
  );
}
