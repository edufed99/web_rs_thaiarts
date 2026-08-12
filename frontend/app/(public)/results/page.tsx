"use client";

import React, { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { EmptyState } from "@/components/EmptyState";
import { CardPagination } from "@/components/CardPagination";
import { ErrorState } from "@/components/ErrorState";
import { LoadingState } from "@/components/LoadingState";
import { MemberHero } from "@/components/MemberHero";
import { MemberShell } from "@/components/MemberShell";
import { MemberStats } from "@/components/MemberStats";
import { RecommendationCard } from "@/components/RecommendationCard";

import {
  ApiClientError,
  getKeywords,
  getMeSummary,
  postRecommendations,
} from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";
import type {
  KeywordOut,
  RecommendationRequestIn,
  RecommendationResponseOut,
  UserState,
  UserSummaryOut,
} from "@/lib/types";
import { useAuthHeaders } from "@/lib/useAuthHeaders";
import { getUserKey } from "@/lib/user";
import { useCardPagination } from "@/lib/useCardPagination";

function ResultsContent() {
  const router = useRouter();
  const params = useSearchParams();

  const contextIdStr = params.get("context_id");
  const topKStr = params.get("top_k") ?? "10";
  const keywordsCsv = params.get("keyword_ids") ?? "";

  const contextId = contextIdStr ? Number(contextIdStr) : NaN;
  const topK = Math.max(1, Math.min(50, parseInt(topKStr, 10) || 10));
  const keywordIds = keywordsCsv
    .split(",")
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !isNaN(n) && n > 0);

  const [data, setData] = useState<RecommendationResponseOut | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | undefined>(undefined);
  const [reloadKey, setReloadKey] = useState(0);
  const [ready, setReady] = useState(false);
  const [keywordLookup, setKeywordLookup] = useState<Map<number, KeywordOut>>(new Map());
  const [userKey, setUserKey] = useState<string>("");
  const [summary, setSummary] = useState<UserSummaryOut | null>(null);
  const authHeaders = useAuthHeaders();

  useEffect(() => {
    const u = getCurrentUser();
    if (!u) {
      const next =
        typeof window !== "undefined"
          ? `${window.location.pathname}${window.location.search}`
          : "/recommend";
      router.replace(`/login?next=${encodeURIComponent(next)}`);
      return;
    }
    setUserKey(getUserKey());
    setReady(true);
  }, [router]);

  useEffect(() => {
    if (!userKey) return;
    let cancelled = false;
    getMeSummary(userKey, authHeaders)
      .then((s) => {
        if (!cancelled) setSummary(s);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [userKey, authHeaders]);

  useEffect(() => {
    if (!ready) return;
    if (!contextId || isNaN(contextId)) {
      setError("ไม่พบ context_id ใน URL — กรุณากลับไปเลือกบริบท");
      setErrorCode("missing_context_id");
      return;
    }
    let cancelled = false;
    setError(null);
    setData(null);
    const body: RecommendationRequestIn = {
      context_id: contextId,
      keyword_ids: keywordIds,
      top_k: topK,
    };
    if (userKey) body.user_key = userKey;
    postRecommendations(body, authHeaders)
      .then((resp) => {
        if (!cancelled) setData(resp);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        if (e instanceof ApiClientError) {
          setError(e.message);
          setErrorCode(e.code);
        } else {
          setError(e instanceof Error ? e.message : "Unknown error");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [ready, contextId, topK, keywordsCsv, reloadKey, userKey, authHeaders]);

  useEffect(() => {
    if (!ready || keywordIds.length === 0) return;
    let cancelled = false;
    getKeywords(undefined, 1000)
      .then((resp) => {
        if (cancelled) return;
        setKeywordLookup(new Map(resp.keywords.map((keyword) => [keyword.id, keyword])));
      })
      .catch(() => {
        if (!cancelled) setKeywordLookup(new Map());
      });
    return () => {
      cancelled = true;
    };
  }, [ready, keywordsCsv]);

  const handleUserStateChange = useCallback((itemId: number, next: UserState) => {
    setData((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        results: prev.results.map((r) =>
          r.item.id === itemId
            ? { ...r, item: { ...r.item, user_state: next } }
            : r,
        ),
      };
    });
  }, []);

  const summaryHeader = useMemo(() => {
    if (!data) return null;
    const requestedKeywordCount = keywordIds.length;
    const resolvedKeywordCount = data.selected_keywords.length;
    const displayKeywords =
      resolvedKeywordCount > 0
        ? data.selected_keywords
        : keywordIds
            .map((id) => keywordLookup.get(id))
            .filter((keyword): keyword is KeywordOut => Boolean(keyword));
    return (
      <section
        className="panel"
        style={{
          padding: "1rem 1.25rem",
        }}
      >
        <p className="muted" style={{ margin: 0 }}>
          บริบท: <strong>{data.selected_context.name}</strong> · คุณลักษณะที่ส่งไป:{" "}
          <strong>{requestedKeywordCount}</strong> · backend รับรู้:{" "}
          <strong>{resolvedKeywordCount}</strong> · candidates:{" "}
          <strong>{data.candidate_count}</strong> · top-K: <strong>{data.top_k}</strong>
          {" "}· embedding: <strong>{data.embedding_backend.toUpperCase()}</strong>
          {" "}({data.embedding_latency_ms.toFixed(1)} ms)
        </p>
        {displayKeywords.length > 0 ? (
          <p className="muted" style={{ margin: "0.5rem 0 0 0", fontSize: "0.9rem" }}>
            {displayKeywords.map((k) => k.name).join(" · ")}
          </p>
        ) : null}
      </section>
    );
  }, [data, keywordIds, keywordLookup]);

  const recommendationResults = useMemo(() => data?.results ?? [], [data]);
  const {
    page,
    setPage,
    pageItems: visibleResults,
  } = useCardPagination(recommendationResults, data?.request_id ?? "");

  if (error) {
    return (
      <ErrorState
        message={error}
        code={errorCode}
        onRetry={() => setReloadKey((k) => k + 1)}
      />
    );
  }
  if (!ready) {
    return <LoadingState message="กำลังตรวจสอบโปรไฟล์ผู้ใช้..." />;
  }
  if (!data) {
    return <LoadingState message="กำลังคำนวณคำแนะนำ..." />;
  }

  return (
    <MemberShell>
      <MemberHero
        title="ผลคำแนะนำเฉพาะคุณ"
        subtitle={`เรียงลำดับจากบริบท "${data.selected_context.name}" และสัญญาณความสนใจของผู้ใช้ พร้อมเหตุผลประกอบเป็นภาษาไทย`}
      />

      <MemberStats summary={summary} />

      {summaryHeader}

      {data.results.length === 0 ? (
        <EmptyState
          title="ไม่มีผลลัพธ์"
          message="บริบทนี้ไม่มี candidate ที่ผ่าน eligibility gate"
        />
      ) : (
        <div className="member-section" aria-label="ผลลัพธ์แนะนำ">
          <div className="member-section-head">
            <h2><span className="glyph" aria-hidden="true">✦</span> ผลลัพธ์แนะนำ {data.results.length} รายการ</h2>
            <span style={{ color: "var(--muted)", fontSize: 12 }}>
              วิธี: {data.method} · request: {data.request_id.slice(0, 6)}
            </span>
          </div>
          <div id="recommendation-card-results" className="member-grid recommendation-results-grid">
            {visibleResults.map((r) => (
              <RecommendationCard
                key={r.item.id}
                result={r}
                userKey={userKey}
                contextId={data.selected_context.id}
                contextName={data.selected_context.name}
                requestId={data.request_id}
                onUserStateChange={handleUserStateChange}
              />
            ))}
          </div>
          <CardPagination
            currentPage={page}
            totalItems={data.results.length}
            onPageChange={setPage}
            scrollTargetId="recommendation-card-results"
          />
        </div>
      )}
    </MemberShell>
  );
}

export default function ResultsPage() {
  return (
    <Suspense fallback={<LoadingState message="กำลังเตรียมผลลัพธ์..." />}>
      <ResultsContent />
    </Suspense>
  );
}
