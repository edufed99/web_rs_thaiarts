"use client";

import React, { useEffect, useState } from "react";

import { getItemLegacyStats } from "@/lib/api";
import { resolvedImageUrl, PerformanceCardMedia } from "@/components/PerformanceCardMedia";
import type { ItemOut, LegacyStatsOut } from "@/lib/types";

interface Props {
  item: ItemOut;
  /** Visual variant: "popular" shows popularity badge, "seasonal" shows context badge. */
  variant: "popular" | "seasonal";
  /** Top contexts of the item (used by the seasonal variant). */
  topContexts?: string[];
}

/**
 * Renders a thumbnail card with REAL legacy rating + review count pulled from
 * ``GET /items/{id}/legacy-stats``. While loading or when the DB is disabled
 * we render a neutral "รอข้อมูล" placeholder rather than fake stars, so the
 * UI never lies about how many people rated the item.
 */
export default function PopularPerformanceCard({
  item,
  variant,
  topContexts = [],
}: Props) {
  const [stats, setStats] = useState<LegacyStatsOut | null>(null);
  const [statsFailed, setStatsFailed] = useState(false);

  useEffect(() => {
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
  }, [item.id]);

  const description =
    item.description && item.description.length > 96
      ? `${item.description.slice(0, 96).trimEnd()}...`
      : item.description;

  const badge = variant === "seasonal"
    ? (topContexts[0] ?? "ช่วงเวลาแนะนำ")
    : "ยอดนิยมในระบบ";
  const priceText =
    item.price_text && /บาท/.test(item.price_text)
      ? item.price_text
      : item.price_text
        ? `${item.price_text} บาท`
        : "";

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
        <span className="popular-badge">{badge}</span>
        <h3 className="popular-card-title">{item.name}</h3>
        {renderRating()}
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
