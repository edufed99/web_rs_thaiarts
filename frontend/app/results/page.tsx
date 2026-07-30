"use client";

import React, { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { LoadingState } from "@/components/LoadingState";
import { RecommendationCard } from "@/components/RecommendationCard";

import { ApiClientError, getKeywords, postRecommendations } from "@/lib/api";
import type {
  KeywordOut,
  RecommendationRequestIn,
  RecommendationResponseOut,
  UserState,
} from "@/lib/types";
import { getCurrentUser } from "@/lib/auth";
import { useAuthHeaders } from "@/lib/useAuthHeaders";
import { getUserKey } from "@/lib/user";

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
  // SSR-safe user key. Initialized to "" on the server, replaced on mount.
  const [userKey, setUserKey] = useState<string>("");
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

  const headerLabel = useMemo(() => {
    if (!data) return null;
    const requestedKeywordCount = keywordIds.length;
    const resolvedKeywordCount = data.selected_keywords.length;
    const displayKeywords =
      resolvedKeywordCount > 0
        ? data.selected_keywords
        : keywordIds
            .map((id) => keywordLookup.get(id))
            .filter((keyword): keyword is KeywordOut => Boolean(keyword));
    const unresolvedKeywordIds =
      requestedKeywordCount > resolvedKeywordCount
        ? keywordIds.filter((id) => !data.selected_keywords.some((keyword) => keyword.id === id))
        : [];
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
        </p>
        {displayKeywords.length > 0 ? (
          <p className="muted" style={{ margin: "0.5rem 0 0 0", fontSize: "0.9rem" }}>
            {displayKeywords.map((k) => k.name).join(" · ")}
          </p>
        ) : null}
        {requestedKeywordCount > 0 && resolvedKeywordCount === 0 ? (
          <p className="muted" style={{ margin: "0.5rem 0 0 0", fontSize: "0.9rem" }}>
            ระบบได้รับ keyword id จากหน้าเว็บแล้ว แต่ backend ยังไม่คืนชื่อคุณลักษณะกลับมา
            จึงยังใช้ keyword นั้นในการให้เหตุผลไม่ได้ ไม่ได้แปลว่าไม่มีชุดการแสดงตรงกับบริบทเสมอไป
            {unresolvedKeywordIds.length > 0 ? ` (ids: ${unresolvedKeywordIds.join(", ")})` : ""}
          </p>
        ) : null}
      </section>
    );
  }, [data, keywordIds, keywordLookup]);

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
    <div className="section-stack">
      <section className="page-hero">
        <div>
          <p className="eyebrow">Personalized recommendation results</p>
          <h1>ผลคำแนะนำเฉพาะคุณ</h1>
          <p className="muted">
            ระบบเรียงลำดับจากบริบท คำสำคัญ และสัญญาณความสนใจของผู้ใช้
            พร้อมเหตุผลประกอบเป็นภาษาไทย
          </p>
        </div>
      </section>
      {headerLabel}
      {data.results.length === 0 ? (
        <EmptyState
          title="ไม่มีผลลัพธ์"
          message="บริบทนี้ไม่มี candidate ที่ผ่าน eligibility gate"
        />
      ) : (
        <div className="section-stack">
          {data.results.map((r) => (
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
      )}
    </div>
  );
}

export default function ResultsPage() {
  return (
    <Suspense fallback={<LoadingState message="กำลังเตรียมผลลัพธ์..." />}>
      <ResultsContent />
    </Suspense>
  );
}
