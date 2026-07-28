"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";

import { ApiClientError, getHealth, getMetrics } from "@/lib/api";
import type { HealthOut, MetricsOut } from "@/lib/types";

import { ErrorState } from "@/components/ErrorState";
import { LoadingState } from "@/components/LoadingState";

export default function HomePage() {
  const [health, setHealth] = useState<HealthOut | null>(null);
  const [metrics, setMetrics] = useState<MetricsOut | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | undefined>(undefined);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    Promise.all([getHealth(), getMetrics()])
      .then(([h, m]) => {
        if (cancelled) return;
        setHealth(h);
        setMetrics(m);
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
  }, [reloadKey]);

  if (error) {
    return (
      <ErrorState
        title="เชื่อมต่อ backend ไม่ได้"
        message={error}
        code={errorCode}
        onRetry={() => setReloadKey((k) => k + 1)}
      />
    );
  }
  if (!health || !metrics) {
    return <LoadingState message="กำลังเชื่อมต่อ backend..." />;
  }

  const degraded = health.status !== "ok";

  return (
    <div style={{ display: "grid", gap: "1rem" }}>
      <section
        style={{
          padding: "1.25rem",
          border: "1px solid #e0e0e0",
          borderRadius: "8px",
          backgroundColor: "#fff",
        }}
      >
        <h2 style={{ marginTop: 0 }}>สถานะระบบ</h2>
        {degraded ? (
          <p style={{ color: "#7a1f1f" }}>
            Backend โหลด artifacts ไม่สำเร็จ — ตรวจสอบ pipeline และรัน backend ใหม่
          </p>
        ) : (
          <p style={{ color: "#0a6b1f" }}>Backend พร้อมใช้งาน ✓</p>
        )}
        <ul style={{ marginTop: "0.5rem", color: "#555" }}>
          <li>version: <code>{health.version}</code></li>
          <li>items: <strong>{health.item_count}</strong></li>
          <li>contexts: <strong>{health.context_count}</strong></li>
          <li>embedding dim: <strong>{health.embedding_dim}</strong></li>
          <li>
            loaded at:{" "}
            <code>{health.artifacts_loaded_at ?? "—"}</code>
          </li>
        </ul>
      </section>

      <section
        style={{
          padding: "1.25rem",
          border: "1px solid #e0e0e0",
          borderRadius: "8px",
          backgroundColor: "#fff",
        }}
      >
        <h2 style={{ marginTop: 0 }}>ข้อมูลคลัง</h2>
        <ul style={{ marginTop: "0.5rem", color: "#555" }}>
          <li>keywords: <strong>{metrics.keyword_count}</strong></li>
          <li>positive users (CF index): <strong>{metrics.positive_user_count}</strong></li>
          <li>unique item-user edges: <strong>{metrics.unique_item_user_edges}</strong></li>
          <li>config hash: <code>{metrics.config_hash}</code></li>
        </ul>
      </section>

      <section
        style={{
          padding: "1.25rem",
          border: "1px solid #e0e0e0",
          borderRadius: "8px",
          backgroundColor: "#fff",
        }}
      >
        <h2 style={{ marginTop: 0 }}>เริ่มใช้งาน</h2>
        <p style={{ marginTop: 0 }}>ไปที่หน้าขอคำแนะนำเพื่อเลือกบริบทและคำสำคัญ</p>
        <Link
          href="/recommend"
          style={{
            display: "inline-block",
            padding: "0.6rem 1.2rem",
            backgroundColor: "#1e6fd9",
            color: "#fff",
            borderRadius: "4px",
            textDecoration: "none",
            fontWeight: 600,
          }}
        >
          ขอคำแนะนำ →
        </Link>
      </section>
    </div>
  );
}