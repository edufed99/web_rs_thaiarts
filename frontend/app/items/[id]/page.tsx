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
    <article className="section-stack">
      <p style={{ margin: 0 }}>
        <Link
          href="/items"
          className="secondary"
          style={{ minHeight: "34px", fontSize: "0.9rem" }}
        >
          กลับไปแคตตาล็อก
        </Link>
      </p>

      <header className="panel" style={{ padding: 0, overflow: "hidden" }}>
        <div
          className="detail-media"
          style={item.image_url ? { backgroundImage: `linear-gradient(90deg, rgba(6, 27, 60, 0.32), rgba(197, 145, 59, 0.08)), url("${item.image_url}")` } : undefined}
        />
        <div style={{ padding: "22px" }}>
        <p className="eyebrow">Performance detail</p>
        <h1 style={{ margin: "0 0 0.25rem 0", fontSize: "2rem", color: "#102044" }}>{item.name}</h1>
        {item.category_group || item.performance_type ? (
          <p className="meta-line" style={{ margin: 0 }}>
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
        </div>
      </header>

      {item.description ? (
        <section className="panel">
          <p className="description" style={{ margin: 0 }}>{item.description}</p>
        </section>
      ) : null}

      <section
        className="panel"
        style={{
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
        <section className="panel">
          <h2 style={{ margin: "0 0 0.5rem 0", fontSize: "1.05rem" }}>บริบทที่เหมาะสม</h2>
          <div className="pill-row">
            {item.contexts.map((c) => (
              <Link
                key={c.id}
                href={`/items?context=${c.id}`}
                className="context-pill"
                style={{ textDecoration: "none" }}
              >
                {c.name}
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {item.keywords.length > 0 ? (
        <section className="panel">
          <h2 style={{ margin: "0 0 0.5rem 0", fontSize: "1.05rem" }}>คำสำคัญ</h2>
          <div className="pill-row">
            {item.keywords.map((k) => (
              <span
                key={k.id}
                title={k.taxonomy_path || undefined}
                className="keyword-pill"
              >
                {k.name}
              </span>
            ))}
          </div>
        </section>
      ) : null}

      {userKey ? (
        <section className="panel">
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
