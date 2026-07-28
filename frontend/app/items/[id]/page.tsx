"use client";

import React, { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

import { ItemActionBar } from "@/components/ItemActionBar";
import { ErrorState } from "@/components/ErrorState";
import { LoadingState } from "@/components/LoadingState";

import { ApiClientError, getItem } from "@/lib/api";
import type { ItemOut, UserState } from "@/lib/types";
import { useAuthHeaders } from "@/lib/useAuthHeaders";
import { getUserKey } from "@/lib/user";

function ItemDetailContent() {
  const params = useParams<{ id: string }>();
  const itemId = Number(params?.id);
  const validId = Number.isFinite(itemId) && itemId > 0;

  const [item, setItem] = useState<ItemOut | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | undefined>(undefined);
  const [userKey, setUserKey] = useState<string>("");
  const [reloadKey, setReloadKey] = useState(0);
  const authHeaders = useAuthHeaders();

  useEffect(() => {
    setUserKey(getUserKey());
  }, []);

  useEffect(() => {
    if (!validId) return;
    let cancelled = false;
    setError(null);
    setItem(null);
    getItem(itemId, { userKey: userKey || undefined, extraHeaders: authHeaders })
      .then((resp) => {
        if (!cancelled) setItem(resp);
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
  }, [itemId, userKey, reloadKey, validId, authHeaders]);

  const handleUserStateChange = useCallback((next: UserState) => {
    setItem((prev) => (prev ? { ...prev, user_state: next } : prev));
  }, []);

  if (!validId) {
    return <ErrorState message="Item id ไม่ถูกต้อง" code="invalid_item_id" />;
  }
  if (error) {
    return (
      <ErrorState
        message={error}
        code={errorCode}
        onRetry={() => setReloadKey((k) => k + 1)}
      />
    );
  }
  if (!item) {
    return <LoadingState message="กำลังโหลดรายละเอียด..." />;
  }

  return (
    <article style={{ display: "grid", gap: "1rem" }}>
      <p style={{ margin: 0 }}>
        <Link
          href="/items"
          style={{ color: "#1e6fd9", textDecoration: "none", fontSize: "0.9rem" }}
        >
          ← กลับไปแคตตาล็อก
        </Link>
      </p>

      <header
        style={{
          padding: "1.25rem",
          border: "1px solid #e0e0e0",
          borderRadius: "10px",
          backgroundColor: "#fff",
        }}
      >
        <h1 style={{ margin: "0 0 0.25rem 0", fontSize: "1.4rem" }}>{item.name}</h1>
        {item.category_group || item.performance_type ? (
          <p style={{ margin: 0, color: "#666" }}>
            {[item.category_group, item.performance_type].filter(Boolean).join(" · ")}
          </p>
        ) : null}
        {item.match_percent != null && item.suitability_label ? (
          <p style={{ margin: "0.5rem 0 0 0" }}>
            <span
              style={{
                fontSize: "0.85rem",
                padding: "0.2rem 0.6rem",
                borderRadius: "999px",
                border: "1px solid #1e88e5",
                backgroundColor: "#e3f2fd",
                color: "#1e88e5",
                fontWeight: 600,
              }}
              title="Display-only match percent"
            >
              {item.suitability_label} · {item.match_percent}%
            </span>
          </p>
        ) : null}
      </header>

      {item.description ? (
        <section
          style={{
            padding: "1rem 1.25rem",
            border: "1px solid #e0e0e0",
            borderRadius: "10px",
            backgroundColor: "#fff",
          }}
        >
          <p style={{ margin: 0, lineHeight: 1.6 }}>{item.description}</p>
        </section>
      ) : null}

      <section
        style={{
          padding: "1rem 1.25rem",
          border: "1px solid #e0e0e0",
          borderRadius: "10px",
          backgroundColor: "#fff",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: "0.5rem 1rem",
        }}
      >
        {item.performers_count != null ? (
          <p style={{ margin: 0 }}>
            <strong>ผู้แสดง:</strong> {item.performers_count} คน
          </p>
        ) : null}
        {item.duration_minutes != null ? (
          <p style={{ margin: 0 }}>
            <strong>ระยะเวลา:</strong> {item.duration_minutes} นาที
          </p>
        ) : null}
        {item.price_text ? (
          <p style={{ margin: 0 }}>
            <strong>ค่าตัว:</strong> {item.price_text}
          </p>
        ) : null}
      </section>

      {item.contexts.length > 0 ? (
        <section
          style={{
            padding: "1rem 1.25rem",
            border: "1px solid #e0e0e0",
            borderRadius: "10px",
            backgroundColor: "#fff",
          }}
        >
          <h2 style={{ margin: "0 0 0.5rem 0", fontSize: "1.05rem" }}>บริบทที่เหมาะสม</h2>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
            {item.contexts.map((c) => (
              <Link
                key={c.id}
                href={`/items?context=${c.id}`}
                style={{
                  fontSize: "0.85rem",
                  color: "#1e6fd9",
                  textDecoration: "none",
                  padding: "0.2rem 0.6rem",
                  backgroundColor: "#f0f4ff",
                  borderRadius: "4px",
                }}
              >
                {c.name}
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {item.keywords.length > 0 ? (
        <section
          style={{
            padding: "1rem 1.25rem",
            border: "1px solid #e0e0e0",
            borderRadius: "10px",
            backgroundColor: "#fff",
          }}
        >
          <h2 style={{ margin: "0 0 0.5rem 0", fontSize: "1.05rem" }}>คำสำคัญ</h2>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
            {item.keywords.map((k) => (
              <span
                key={k.id}
                title={k.taxonomy_path || undefined}
                style={{
                  fontSize: "0.85rem",
                  color: "#555",
                  padding: "0.15rem 0.5rem",
                  backgroundColor: "#fff8e1",
                  border: "1px solid #ffe082",
                  borderRadius: "4px",
                }}
              >
                {k.name}
              </span>
            ))}
          </div>
        </section>
      ) : null}

      {userKey ? (
        <section
          style={{
            padding: "1rem 1.25rem",
            border: "1px solid #e0e0e0",
            borderRadius: "10px",
            backgroundColor: "#fff",
          }}
        >
          <ItemActionBar
            itemId={item.id}
            userKey={userKey}
            userState={item.user_state}
            onChange={handleUserStateChange}
          />
        </section>
      ) : null}
    </article>
  );
}

export default function ItemDetailPage() {
  return (
    <Suspense fallback={<LoadingState message="กำลังเตรียมหน้ารายละเอียด..." />}>
      <ItemDetailContent />
    </Suspense>
  );
}