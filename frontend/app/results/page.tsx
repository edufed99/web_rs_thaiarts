"use client";

import React, { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { LoadingState } from "@/components/LoadingState";
import { RecommendationCard } from "@/components/RecommendationCard";

import { ApiClientError, postRecommendations } from "@/lib/api";
import type {
  RecommendationRequestIn,
  RecommendationResponseOut,
  UserState,
} from "@/lib/types";
import { useAuthHeaders } from "@/lib/useAuthHeaders";
import { getUserKey } from "@/lib/user";

function ResultsContent() {
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
  // SSR-safe user key. Initialized to "" on the server, replaced on mount.
  const [userKey, setUserKey] = useState<string>("");
  const authHeaders = useAuthHeaders();

  useEffect(() => {
    setUserKey(getUserKey());
  }, []);

  useEffect(() => {
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
  }, [contextId, topK, keywordsCsv, reloadKey, userKey, authHeaders]);

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
    return (
      <section
        style={{
          padding: "1rem 1.25rem",
          border: "1px solid #e0e0e0",
          borderRadius: "8px",
          backgroundColor: "#fff",
        }}
      >
        <p style={{ margin: 0, color: "#555" }}>
          บริบท: <strong>{data.selected_context.name}</strong> · คำสำคัญที่เลือก:{" "}
          <strong>{data.selected_keywords.length}</strong> · candidates:{" "}
          <strong>{data.candidate_count}</strong> · top-K: <strong>{data.top_k}</strong>
        </p>
        {data.selected_keywords.length > 0 ? (
          <p style={{ margin: "0.5rem 0 0 0", color: "#555", fontSize: "0.9rem" }}>
            {data.selected_keywords.map((k) => k.name).join(" · ")}
          </p>
        ) : null}
      </section>
    );
  }, [data]);

  if (error) {
    return (
      <ErrorState
        message={error}
        code={errorCode}
        onRetry={() => setReloadKey((k) => k + 1)}
      />
    );
  }
  if (!data) {
    return <LoadingState message="กำลังคำนวณคำแนะนำ..." />;
  }

  return (
    <div style={{ display: "grid", gap: "1rem" }}>
      {headerLabel}
      {data.results.length === 0 ? (
        <EmptyState
          title="ไม่มีผลลัพธ์"
          message="บริบทนี้ไม่มี candidate ที่ผ่าน eligibility gate"
        />
      ) : (
        <div style={{ display: "grid", gap: "0.75rem" }}>
          {data.results.map((r) => (
            <RecommendationCard
              key={r.item.id}
              result={r}
              userKey={userKey}
              contextId={data.selected_context.id}
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
