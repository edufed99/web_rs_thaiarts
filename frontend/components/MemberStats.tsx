"use client";

import React from "react";

import { useTranslation } from "@/contexts/LanguageContext";
import type { RatingSummaryOut, UserSummaryOut } from "@/lib/types";

interface MemberStatsProps {
  summary: UserSummaryOut | null;
}

/**
 * Renders the four-tile activity strip used by the member_user mockup
 * ("ถูกใจ / บันทึกไว้ / ให้คะแนนแล้ว / ดูล่าสุด"). When the user has
 * zero activity we render the labels + zeros so the section doesn't
 * visually disappear — the empty-state hint lives in the sidebar.
 */
export function MemberStats({ summary }: MemberStatsProps) {
  const { t } = useTranslation();
  const liked = summary?.liked_count ?? 0;
  const saved = summary?.saved_count ?? 0;
  const rated = summary?.rated_count ?? 0;
  const recent = summary?.recent_view_count ?? 0;
  return (
    <section className="member-stats" aria-label={t("memberStats.ariaLabel")}>
      <div className="member-stat liked">
        <span className="glyph-circle" aria-hidden="true">♥</span>
        <div>
          <strong>{liked}</strong>
          <span>{t("memberStats.liked")}</span>
        </div>
      </div>
      <div className="member-stat saved">
        <span className="glyph-circle" aria-hidden="true">⚑</span>
        <div>
          <strong>{saved}</strong>
          <span>{t("memberStats.saved")}</span>
        </div>
      </div>
      <div className="member-stat rated">
        <span className="glyph-circle" aria-hidden="true">★</span>
        <div>
          <strong>{rated}</strong>
          <span>{t("memberStats.rated")}</span>
        </div>
      </div>
      <div className="member-stat recent">
        <span className="glyph-circle" aria-hidden="true">◷</span>
        <div>
          <strong>{recent}</strong>
          <span>{t("memberStats.recent")}</span>
        </div>
      </div>
    </section>
  );
}

/** Mini distribution chart backed by the member's current rating rows. */
export function MemberRatingSummary({ ratingSummary }: { ratingSummary: RatingSummaryOut | null }) {
  const { t } = useTranslation();
  const buckets = ratingSummary?.distribution ?? [5, 4, 3, 2, 1].map((stars) => ({ stars, count: 0 }));
  const total = ratingSummary?.total ?? 0;
  const headline = ratingSummary?.average ?? 0;
  const totalText = `${total} ${t("itemDetail.timesUnit")}`;
  const activeStars = Math.round(headline);
  return (
    <section className="member-rating-summary" aria-label={t("itemDetail.ratingSummaryTitle")}>
      <h3>{t("itemDetail.ratingSummaryTitle")}</h3>
      <div className="member-rating-headline">
        <strong>{headline.toFixed(1)}</strong>
        <span>/ 5.0</span>
        <span style={{ marginLeft: "auto", color: "var(--gold-500)", fontSize: 18 }}>
          {Array.from({ length: 5 }, (_, i) => (
            <span key={i} className={i < activeStars ? "" : "off"}>
              {i < activeStars ? "★" : "☆"}
            </span>
          ))}
        </span>
      </div>
      <div className="member-rating-bars">
        {buckets.map(({ stars, count }) => {
          const pct = total ? Math.round((count / total) * 100) : 0;
          return (
            <div className="member-rating-bar" key={stars}>
              <span>{stars} {t("itemDetail.starsLabel")}</span>
              <span className="track">
                <span style={{ width: `${pct}%` }} />
              </span>
              <span style={{ textAlign: "right" }}>{count}</span>
            </div>
          );
        })}
      </div>
      <p style={{ margin: 0, fontSize: 12, color: "var(--muted)" }}>
        {t("itemDetail.avgFromRatings")} {totalText}
        {total === 0 ? ` ${t("itemDetail.noRatingsYet")}` : ""}
      </p>
    </section>
  );
}
