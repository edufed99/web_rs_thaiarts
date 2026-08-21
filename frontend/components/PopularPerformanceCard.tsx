"use client";

import Link from "next/link";
import React, { useEffect, useState } from "react";

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

  const priceText =
    item.price_text && /บาท/.test(item.price_text)
      ? item.price_text
      : item.price_text
        ? `${item.price_text} บาท`
        : "";

  const score = engagement?.engagement_score ?? 0;
  const max = engagementMax && engagementMax > 0 ? engagementMax : Math.max(score, 1);
  const percent = Math.min(100, Math.max(1, Math.round((score / max) * 100)));
  const parts: string[] = [];
  if (engagement) {
    if (engagement.like_count > 0) parts.push(`ถูกใจ ${engagement.like_count}`);
    if (engagement.save_count > 0) parts.push(`บันทึก ${engagement.save_count}`);
    if (engagement.rating_count > 0) parts.push(`รีวิวบวก ${engagement.rating_count}`);
  }
  const detailText = parts.length > 0 ? parts.join(" • ") : "มีการตอบรับจากผู้ใช้";

  const renderBadge = () => {
    const badgeText =
      variant === "seasonal"
        ? (topContexts[0] ?? "ช่วงเวลาแนะนำ")
        : "คะแนนสูง";
    return <span className="popular-badge">{badgeText}</span>;
  };

  const renderRating = () => {
    if (statsFailed) {
      return <span className="muted">ไม่สามารถโหลดสถิติ</span>;
    }
    if (stats === null) {
      return <span className="muted">กำลังโหลดสถิติ...</span>;
    }
    if (stats.count === 0) {
      return <span className="muted">ยังไม่มีรีวิว</span>;
    }
    const rating = stats.avg_rating;
    const clamped = Math.max(0, Math.min(5, rating));
    const fillPct = (clamped / 5) * 100;
    return (
      <div className="popular-rating">
        <span
          className="popular-stars"
          aria-label={`คะแนน ${rating.toFixed(1)} จาก 5`}
        >
          <span className="popular-stars-bg" aria-hidden="true">★★★★★</span>
          <span
            className="popular-stars-fg"
            aria-hidden="true"
            style={{ width: `${fillPct}%` }}
          >★★★★★</span>
        </span>
        <strong>{rating.toFixed(1)}</strong>
        <span className="muted">({stats.count} รีวิว)</span>
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
              <span aria-hidden="true">🔥</span> ความนิยม <strong>{percent}%</strong>
            </span>
          </div>
        ) : (
          renderRating()
        )}
        {description ? <p className="popular-card-desc">{description}</p> : null}
        <div className="popular-card-meta">
          {item.performers_count ? (
            <span className="popular-meta-row" title="จำนวนผู้แสดง">
              <span className="popular-meta-icon" aria-hidden="true">👥</span>
              <span className="popular-meta-label">ผู้แสดง :</span>
              <span className="popular-meta-value">{item.performers_count} คน</span>
            </span>
          ) : null}
          {item.duration_minutes ? (
            <span className="popular-meta-row" title="ระยะเวลาการแสดง">
              <span className="popular-meta-icon" aria-hidden="true">⏱</span>
              <span className="popular-meta-label">ระยะการแสดง :</span>
              <span className="popular-meta-value">{item.duration_minutes} นาที</span>
            </span>
          ) : null}
          {priceText ? (
            <span className="popular-meta-row" title="ราคา">
              <span className="popular-meta-icon" aria-hidden="true">💰</span>
              <span className="popular-meta-label">ราคา :</span>
              <span className="popular-meta-value">{priceText}</span>
            </span>
          ) : null}
        </div>
      </div>
    </article>
  );
}
