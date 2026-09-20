"use client";

import React from "react";
import Link from "next/link";

import { ItemActionBar } from "@/components/ItemActionBar";
import {
  PerformanceCardMedia,
  resolvedImageUrl,
} from "@/components/PerformanceCardMedia";
import { useTranslation } from "@/contexts/LanguageContext";
import { getLocalizedItem } from "@/lib/localization";
import type {
  RecommendationResultOut,
  UserState as UserStateType,
} from "@/lib/types";
import { recommendationScoreOutOf100 } from "@/lib/recommendationScore";

// Suitability-pill background by label. Centralised here so the
// catalog card can reuse the same colour scheme.
function suitabilityColor(label: string): string {
  if (label === "เหมาะมาก" || label === "Highly Recommended") return "#e8f5e9"; // green-50
  if (label === "เหมาะสม" || label === "Recommended") return "#e3f2fd"; // blue-50
  return "#f5f5f5"; // grey-100 (เหมาะใช้ได้ / Acceptable)
}

function suitabilityBorder(label: string): string {
  if (label === "เหมาะมาก" || label === "Highly Recommended") return "#43a047"; // green-600
  if (label === "เหมาะสม" || label === "Recommended") return "#1e88e5"; // blue-600
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
  const { locale, t } = useTranslation();
  const { rank, item, scores, matched_keywords } = result;
  const localizedItem = getLocalizedItem(item, locale);
  const explanation = result.explanation;
  const recommendationScore = recommendationScoreOutOf100(scores.hybrid);

  const suitability =
    locale === "en" ? (result.suitability_label_en ?? "Recommended") : result.suitability_label;

  function handleStateChange(next: UserStateType) {
    if (onUserStateChange) onUserStateChange(item.id, next);
  }

  // Carry the recommendation id into the detail page so the view it logs can
  // be attributed to this recommendation (ADR-002 §3.2). Without it the
  // click-through rate is uncomputable.
  const detailHref = requestId
    ? `/items/${item.id}?from_request=${encodeURIComponent(requestId)}`
    : `/items/${item.id}`;

  const categoryAndType = [localizedItem.displayCategoryGroup, localizedItem.displayPerformanceType]
    .filter(Boolean)
    .join(" · ");

  return (
    <article className="recommendation-card">
      <div className="recommendation-card-layout">
        <Link
          href={detailHref}
          className="recommendation-card-media"
          aria-label={`${locale === "en" ? "View details" : "ดูรายละเอียด"} ${localizedItem.displayName}`}
          style={{ display: "block", textDecoration: "none" }}
        >
          <PerformanceCardMedia
            imageUrl={resolvedImageUrl(localizedItem.image_url)}
            categoryGroup={localizedItem.displayCategoryGroup}
            title={localizedItem.displayName}
            variant="card"
          />
        </Link>

        <div className="recommendation-card-content">
          <header style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "0.5rem", gap: "0.5rem" }}>
            <h3 style={{ fontSize: "1.1rem" }}>
              #{rank}{" "}
              <Link href={detailHref}>{localizedItem.displayName}</Link>
            </h3>
            <div style={{ display: "flex", gap: "0.4rem", flexShrink: 0 }}>
              <span
                style={{
                  fontSize: "0.78rem",
                  color: suitabilityBorder(suitability),
                  padding: "0.2rem 0.55rem",
                  backgroundColor: suitabilityColor(suitability),
                  borderRadius: "999px",
                  border: `1px solid ${suitabilityBorder(suitability)}`,
                  fontWeight: 600,
                }}
                title={t("results.cardSuitabilityTooltip")}
              >
                {suitability}
              </span>
              <span
                style={{
                  fontSize: "0.8rem",
                  color: "#17386d",
                  padding: "0.2rem 0.5rem",
                  backgroundColor: "#f0f4ff",
                  borderRadius: "999px",
                  fontWeight: 600,
                }}
                title={t("results.cardScoreTooltip")}
              >
                {t("results.cardScorePrefix")} {recommendationScore}%
              </span>
            </div>
          </header>

          {categoryAndType ? (
            <p className="meta-line" style={{ margin: "0.25rem 0" }}>
              {categoryAndType}
            </p>
          ) : null}

          {localizedItem.displayDescription ? (
            <p className="description" style={{ margin: "0.5rem 0" }}>{localizedItem.displayDescription}</p>
          ) : null}

          {matched_keywords.length > 0 ? (
            <div style={{ margin: "0.5rem 0" }}>
              <span className="meta-line">{t("results.cardMatchedKeywords")} </span>
              <span className="pill-row" style={{ display: "inline-flex" }}>
                {matched_keywords.map((kw, i) => {
                  const kwObj = item.keywords?.find((k) => k.name === kw);
                  const kwDisplay = locale === "en" && kwObj?.name_en ? kwObj.name_en : kw;
                  return (
                    <span key={i} className="keyword-pill">{kwDisplay}</span>
                  );
                })}
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
