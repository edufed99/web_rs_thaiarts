"use client";

import Link from "next/link";
import React, { useEffect, useState } from "react";

import { useTranslation } from "@/contexts/LanguageContext";
import { getItemLegacyStats } from "@/lib/api";
import { resolvedImageUrl, PerformanceCardMedia } from "@/components/PerformanceCardMedia";
import type { EngagementOut, ItemOut, LegacyStatsOut } from "@/lib/types";

interface Props {
  item: ItemOut;
  /** Visual variant: "popular" shows popularity badge & engagement %, "top-rated" shows rating badge & stars, "seasonal" shows context badge. */
  variant: "popular" | "top-rated" | "seasonal";
  /** Top contexts of the item (used by the seasonal variant). */
  topContexts?: string[];
  /** Live engagement data for popular variant. */
  engagement?: EngagementOut;
  /** Max engagement score across the set for 100% scaling. */
  engagementMax?: number;
}

/**
 * Renders a thumbnail card. For "popular" cards, displays a normalized
 * Engagement Score percentage (100% scale) reflecting live likes/saves/reviews.
 * For "top-rated" cards, displays legacy star ratings.
 */
export default function PopularPerformanceCard({
  item,
  variant,
  topContexts = [],
  engagement,
  engagementMax,
}: Props) {
  const { t, locale } = useTranslation();
  const [stats, setStats] = useState<LegacyStatsOut | null>(null);
  const [statsFailed, setStatsFailed] = useState(false);

  useEffect(() => {
    if (variant === "popular") return;
    let cancelled = false;
    setStatsFailed(false);
    getItemLegacyStats(item.id)
      .then((result) => {
        if (!cancelled) setStats(result);
      })
      .catch(() => {
        if (!cancelled) setStatsFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [item.id, variant]);

  const description =
    item.description && item.description.length > 96
      ? `${item.description.slice(0, 96).trimEnd()}...`
      : item.description;

  const rawPrice = item.price_text ? item.price_text.replace(/\s*บาท\s*$/i, "").trim() : "";
  const priceText = rawPrice
    ? `${rawPrice} ${t("items.cardBaht")}`
    : "";

  const score = engagement?.engagement_score ?? 0;
  const max = engagementMax && engagementMax > 0 ? engagementMax : Math.max(score, 1);
  const percent = Math.min(100, Math.max(1, Math.round((score / max) * 100)));
  const parts: string[] = [];
  if (engagement) {
    if (engagement.like_count > 0) parts.push(`${t("items.cardLikes")} ${engagement.like_count}`);
    if (engagement.save_count > 0) parts.push(`${t("items.cardSaves")} ${engagement.save_count}`);
    if (engagement.rating_count > 0) parts.push(`${t("items.cardPositiveReviews")} ${engagement.rating_count}`);
  }

  const renderBadge = () => {
    const badgeText =
      variant === "seasonal"
        ? (topContexts[0] ?? t("items.cardSeasonalDefault"))
        : t("items.cardHighRating");
    return <span className="popular-badge">{badgeText}</span>;
  };

  const renderRating = () => {
    if (statsFailed) {
      return <span className="muted">{t("items.cardStatsFailed")}</span>;
    }
    if (stats === null) {
      return <span className="muted">{t("items.cardLoadingStats")}</span>;
    }
    if (stats.count === 0) {
      return <span className="muted">{t("items.cardNoReviews")}</span>;
    }
    const rating = stats.avg_rating;
    const clamped = Math.max(0, Math.min(5, rating));
    const fillPct = (clamped / 5) * 100;
    return (
      <div className="popular-rating">
        <span
          className="popular-stars"
          aria-label={`${t("items.cardRatingUnit")} ${rating.toFixed(1)} ${t("items.cardFrom5")}`}
        >
          <span className="popular-stars-bg" aria-hidden="true">★★★★★</span>
          <span
            className="popular-stars-fg"
            aria-hidden="true"
            style={{ width: `${fillPct}%` }}
          >★★★★★</span>
        </span>
        <strong>{rating.toFixed(1)}</strong>
        <span className="muted">({stats.count} {t("items.cardReviews")})</span>
      </div>
    );
  };

  return (
    <article className="popular-card">
      <PerformanceCardMedia
        imageUrl={resolvedImageUrl(item.image_url)}
        categoryGroup={item.category_group}
        title={item.name}
        variant="card"
      />
      <div className="popular-card-body">
        {variant === "popular" ? null : renderBadge()}
        <h3 className="popular-card-title">
          <Link href={`/items/${item.id}`} className="popular-title-link">{item.name}</Link>
        </h3>
        {variant === "popular" ? (
          <div className="popular-rating">
            <span className="popular-badge popular-badge--engagement">
              <span aria-hidden="true">🔥</span> {t("items.cardPopularity")}{" "}
              <strong>{percent}%</strong>
            </span>
          </div>
        ) : (
          renderRating()
        )}
        {description ? <p className="popular-card-desc">{description}</p> : null}
        <div className="popular-card-meta">
          {item.performers_count ? (
            <span className="popular-meta-row" title={t("items.filterPerformers")}>
              <span className="popular-meta-icon" aria-hidden="true">👥</span>
              <span className="popular-meta-label">{t("items.cardPerformers")}</span>
              <span className="popular-meta-value">{item.performers_count} {t("items.people")}</span>
            </span>
          ) : null}
          {item.duration_minutes ? (
            <span className="popular-meta-row" title={t("items.filterDuration")}>
              <span className="popular-meta-icon" aria-hidden="true">⏱</span>
              <span className="popular-meta-label">{t("items.cardDuration")}</span>
              <span className="popular-meta-value">{item.duration_minutes} {t("items.minutes")}</span>
            </span>
          ) : null}
          {priceText ? (
            <span className="popular-meta-row" title={t("items.cardPrice")}>
              <span className="popular-meta-icon" aria-hidden="true">💰</span>
              <span className="popular-meta-label">{t("items.cardPrice")}</span>
              <span className="popular-meta-value">{priceText}</span>
            </span>
          ) : null}
        </div>
      </div>
    </article>
  );
}
