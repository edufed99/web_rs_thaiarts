"use client";

import React from "react";
import Link from "next/link";

import { ItemActionBar } from "@/components/ItemActionBar";
import {
  PerformanceCardMedia,
  resolvedImageUrl,
} from "@/components/PerformanceCardMedia";
import type {
  RecommendationResultOut,
  UserState as UserStateType,
} from "@/lib/types";

// Suitability-pill background by Thai label. Centralised here so the
// catalog card can reuse the same colour scheme.
function suitabilityColor(label: string): string {
  if (label === "เหมาะมาก") return "#e8f5e9"; // green-50
  if (label === "เหมาะสม") return "#e3f2fd"; // blue-50
  return "#f5f5f5"; // grey-100 (เหมาะใช้ได้)
}

function suitabilityBorder(label: string): string {
  if (label === "เหมาะมาก") return "#43a047"; // green-600
  if (label === "เหมาะสม") return "#1e88e5"; // blue-600
  return "#9e9e9e"; // grey-500
}

export interface RecommendationCardProps {
  result: RecommendationResultOut;
  userKey: string;
  contextId?: number | null;
  contextName?: string;
  requestId?: string | null;
  /** Called when the user toggles like/save/rating on this card. */
  onUserStateChange?: (itemId: number, next: UserStateType) => void;
}

export function RecommendationCard({
  result,
  userKey,
  contextId,
  requestId,
  onUserStateChange,
}: RecommendationCardProps) {
  const { rank, item, scores, matched_keywords } = result;
  const explanation = result.explanation;

  function handleStateChange(next: UserStateType) {
    if (onUserStateChange) onUserStateChange(item.id, next);
  }

  // Carry the recommendation id into the detail page so the view it logs can
  // be attributed to this recommendation (ADR-002 §3.2). Without it the
  // click-through rate is uncomputable.
  const detailHref = requestId
    ? `/items/${item.id}?from_request=${encodeURIComponent(requestId)}`
    : `/items/${item.id}`;

  return (
    <article className="recommendation-card">
      <div className="recommendation-card-layout">
        <Link
          href={detailHref}
          className="recommendation-card-media"
          aria-label={`ดูรายละเอียด ${item.name}`}
          style={{ display: "block", textDecoration: "none" }}
        >
          <PerformanceCardMedia
            imageUrl={resolvedImageUrl(item.image_url)}
            categoryGroup={item.category_group}
            title={item.name}
            variant="card"
          />
        </Link>

        <div className="recommendation-card-content">
          <header style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "0.5rem", gap: "0.5rem" }}>
            <h3 style={{ fontSize: "1.1rem" }}>
              #{rank}{" "}
              <Link href={detailHref}>{item.name}</Link>
            </h3>
            <div style={{ display: "flex", gap: "0.4rem", flexShrink: 0 }}>
              <span
                style={{
                  fontSize: "0.78rem",
                  color: suitabilityBorder(result.suitability_label),
                  padding: "0.2rem 0.55rem",
                  backgroundColor: suitabilityColor(result.suitability_label),
                  borderRadius: "999px",
                  border: `1px solid ${suitabilityBorder(result.suitability_label)}`,
                  fontWeight: 600,
                }}
                title="Display-only match percent — does not affect ranking."
              >
                {result.suitability_label} · {result.match_percent}%
              </span>
              <span
                style={{
                  fontSize: "0.8rem",
                  color: "#555",
                  padding: "0.2rem 0.5rem",
                  backgroundColor: "#f0f4ff",
                  borderRadius: "999px",
                }}
              >
                hybrid {scores.hybrid.toFixed(3)}
              </span>
            </div>
          </header>

          {item.category_group || item.performance_type ? (
            <p className="meta-line" style={{ margin: "0.25rem 0" }}>
              {[item.category_group, item.performance_type].filter(Boolean).join(" · ")}
            </p>
          ) : null}

          {item.description ? (
            <p className="description" style={{ margin: "0.5rem 0" }}>{item.description}</p>
          ) : null}

          <div
            style={{
              display: "flex",
              gap: "1rem",
              fontSize: "0.85rem",
              color: "#555",
              margin: "0.5rem 0",
            }}
          >
            <span>CBF: <strong>{scores.cbf.toFixed(3)}</strong></span>
            <span>CF: <strong>{scores.cf.toFixed(3)}</strong></span>
          </div>

          {matched_keywords.length > 0 ? (
            <div style={{ margin: "0.5rem 0" }}>
              <span className="meta-line">คำสำคัญที่ตรง: </span>
              <span className="pill-row" style={{ display: "inline-flex" }}>
                {matched_keywords.map((kw, i) => (
                  <span key={i} className="keyword-pill">{kw}</span>
                ))}
              </span>
            </div>
          ) : null}

          {explanation ? (
            <p
              style={{
                margin: "0.75rem 0 0 0",
                padding: "0.75rem",
                backgroundColor: "#fff7e5",
                borderLeft: "3px solid #c5913b",
                borderRadius: "4px",
                fontSize: "0.9rem",
                color: "#222",
              }}
            >
              {explanation}
            </p>
          ) : null}

          {userKey ? (
            <ItemActionBar
              itemId={item.id}
              userKey={userKey}
              userState={item.user_state}
              onChange={handleStateChange}
              contextId={contextId}
              requestId={requestId}
            />
          ) : null}
        </div>
      </div>
    </article>
  );
}
