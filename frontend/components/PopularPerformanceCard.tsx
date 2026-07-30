"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";

import { getItemLegacyStats } from "@/lib/api";
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

  // Decide how to render the rating row.
  // - Loading (stats === null && !failed) → shimmer placeholder.
  // - Loaded but count == 0 → "ยังไม่มีรีวิว" (neutral, truthful).
  // - Loaded with count > 0 → real stars + real number.
  // - Failed → "ไม่สามารถโหลดสถิติ" warning.
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
    const rating = stats.avg_rating.toFixed(1);
    return (
      <div>
        <span className="popular-stars" aria-hidden="true">★★★★★</span>{" "}
        <strong>{rating}</strong>{" "}
        <span className="muted">({stats.count} รีวิว)</span>
      </div>
    );
  };

  return (
    <article className="popular-card">
      <div
        className="popular-card-media"
        style={
          item.image_url
            ? {
                backgroundImage: `linear-gradient(135deg, rgba(6, 27, 60, 0.08), rgba(197, 145, 59, 0.12)), url("${item.image_url}")`,
              }
            : undefined
        }
      />
      <div className="popular-card-body">
        <span className="popular-badge">{badge}</span>
        <h3 style={{ margin: 0, color: "#102044", fontSize: "1.35rem", lineHeight: 1.35 }}>
          {item.name}
        </h3>
        {renderRating()}
        {description ? (
          <p className="description" style={{ margin: 0 }}>
            {description}
          </p>
        ) : null}
        <Link className="secondary" href={`/items/${item.id}`} style={{ justifySelf: "start" }}>
          รายละเอียด
        </Link>
      </div>
    </article>
  );
}