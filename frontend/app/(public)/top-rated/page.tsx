"use client";

import Link from "next/link";
import React, { useEffect, useMemo, useState } from "react";

import { PerformanceCardMedia, resolvedImageUrl } from "@/components/PerformanceCardMedia";
import { useTranslation } from "@/contexts/LanguageContext";
import {
  getItemEngagementBatch,
  getItemLegacyStatsBatch,
  getItems,
} from "@/lib/api";
import { getLocalizedItem } from "@/lib/localization";
import type { EngagementOut, ItemOut, LegacyStatsOut } from "@/lib/types";
import { getUserKey } from "@/lib/user";
import { rankTopRatedItems, toEngagementMap } from "@/lib/popularityRanking";

interface TopRatedData {
  items: ItemOut[];
  legacy: Map<number, LegacyStatsOut>;
  week: Map<number, EngagementOut>;
  month: Map<number, EngagementOut>;
  error: string | null;
}

const EMPTY: TopRatedData = {
  items: [],
  legacy: new Map(),
  week: new Map(),
  month: new Map(),
  error: null,
};

export default function TopRatedPage() {
  const { t, locale } = useTranslation();
  const [data, setData] = useState<TopRatedData>(EMPTY);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setReady(false);

    getItems({ limit: 200, userKey: getUserKey() || undefined })
      .then((itemsRes) => {
        if (cancelled) return;
        const items = itemsRes.items;
        const ids = items.map((item) => item.id);
        return Promise.all([
          getItemEngagementBatch(ids, { range: "7d" }),
          getItemEngagementBatch(ids, { range: "30d" }),
          getItemLegacyStatsBatch(ids),
        ]).then(([weekRes, monthRes, legacy]) => {
          if (cancelled) return;
          setData({
            items,
            legacy,
            week: toEngagementMap(weekRes.engagements),
            month: toEngagementMap(monthRes.engagements),
            error: null,
          });
          setReady(true);
        });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setData({
          ...EMPTY,
          error: e instanceof Error ? e.message : (locale === "en" ? "Failed to load top rated rankings" : "ไม่สามารถโหลดข้อมูลคะแนนสูง"),
        });
        setReady(true);
      });

    return () => {
      cancelled = true;
    };
  }, [locale]);

  const weeklyTop10 = useMemo(
    () => rankTopRatedItems(data.items, data.legacy, 10, data.week),
    [data.items, data.legacy, data.week],
  );
  const monthlyTop10 = useMemo(
    () => rankTopRatedItems(data.items, data.legacy, 10, data.month),
    [data.items, data.legacy, data.month],
  );

  return (
    <main className="popular-page">
      <header className="popular-page-head">
        <div>
          <p>{t("topRated.eyebrow")}</p>
          <h1>{t("topRated.title")}</h1>
        </div>
        <Link href="/" className="popular-page-back">{t("popular.backHome")}</Link>
      </header>

      {!ready ? (
        <div className="popular-page-loading">{t("topRated.loading")}</div>
      ) : data.error ? (
        <div className="home-empty"><p>{data.error}</p></div>
      ) : (
        <div className="popular-page-grid">
          <TopRatedTopTen
            title={t("topRated.weeklyTitle")}
            subtitle={t("topRated.weeklySubtitle")}
            items={weeklyTop10}
            engagement={data.week}
            legacy={data.legacy}
            locale={locale}
            t={t}
          />
          <TopRatedTopTen
            title={t("topRated.monthlyTitle")}
            subtitle={t("topRated.monthlySubtitle")}
            items={monthlyTop10}
            engagement={data.month}
            legacy={data.legacy}
            locale={locale}
            t={t}
          />
        </div>
      )}
    </main>
  );
}

function TopRatedTopTen({
  title,
  subtitle,
  items,
  engagement,
  legacy,
  locale,
  t,
}: {
  title: string;
  subtitle: string;
  items: ItemOut[];
  engagement: Map<number, EngagementOut>;
  legacy: Map<number, LegacyStatsOut>;
  locale: string;
  t: (key: string) => string;
}) {
  return (
    <section className="popular-topten">
      <header>
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </header>
      {items.length === 0 ? (
        <div className="popular-topten-empty">{t("topRated.empty")}</div>
      ) : (
        <ol>
          {items.map((item, idx) => (
            <TopRatedRankRow
              key={item.id}
              rank={idx + 1}
              item={item}
              engagement={engagement.get(item.id)}
              stats={legacy.get(item.id)}
              locale={locale}
              t={t}
            />
          ))}
        </ol>
      )}
    </section>
  );
}

function TopRatedRankRow({
  rank,
  item,
  engagement,
  stats,
  locale,
  t,
}: {
  rank: number;
  item: ItemOut;
  engagement?: EngagementOut;
  stats?: LegacyStatsOut;
  locale: string;
  t: (key: string) => string;
}) {
  const localized = getLocalizedItem(item, locale as "en" | "th");

  return (
    <li className="popular-rank-row">
      <span className="popular-rank-badge">{rank}</span>
      <div className="popular-rank-thumb" aria-hidden="true">
        <PerformanceCardMedia
          imageUrl={resolvedImageUrl(item.image_url)}
          categoryGroup={localized.displayCategoryGroup}
          title={localized.displayName}
          variant="card"
        />
      </div>
      <div className="popular-rank-info">
        <strong className="popular-rank-name">
          <Link href={`/items/${item.id}`}>{localized.displayName}</Link>
        </strong>
        <span>{compactItemMeta(item, locale)}</span>
        <RatingLine stats={stats} locale={locale} t={t} />
        <small>{engagementSummary(engagement, locale, t)}</small>
      </div>
    </li>
  );
}

function RatingLine({ stats, locale, t }: { stats?: LegacyStatsOut; locale: string; t: (key: string) => string }) {
  if (!stats || stats.count <= 0) {
    return <span className="popular-rank-rating muted">{t("topRated.noReviews")}</span>;
  }
  return (
    <span className="popular-rank-rating">
      <span aria-hidden="true">★</span>
      {stats.avg_rating.toFixed(1)} ({t("topRated.reviewsCount").replace("{count}", formatCount(stats.count, locale))})
    </span>
  );
}

function compactItemMeta(item: ItemOut, locale: string): string {
  const parts: string[] = [];
  if (item.performers_count) {
    parts.push(locale === "en" ? `${item.performers_count} performers` : `ผู้แสดง ${item.performers_count} คน`);
  }
  if (item.duration_minutes) {
    parts.push(locale === "en" ? `${item.duration_minutes} mins` : `${item.duration_minutes} นาที`);
  }
  if (item.price_text) {
    parts.push(/บาท/.test(item.price_text) ? item.price_text : `${item.price_text} บาท`);
  }
  return parts.join(" • ");
}

function engagementSummary(row: EngagementOut | undefined, locale: string, t: (key: string) => string): string {
  if (!row || row.engagement_score <= 0) return t("popular.noEngagement");
  const parts: string[] = [];
  if (row.like_count > 0) {
    parts.push(locale === "en" ? `Likes ${formatCount(row.like_count, locale)}` : `ถูกใจ ${formatCount(row.like_count, locale)}`);
  }
  if (row.save_count > 0) {
    parts.push(locale === "en" ? `Saved ${formatCount(row.save_count, locale)}` : `บันทึก ${formatCount(row.save_count, locale)}`);
  }
  if (row.rating_count > 0) {
    parts.push(locale === "en" ? `Positive reviews ${formatCount(row.rating_count, locale)}` : `รีวิวเชิงบวก ${formatCount(row.rating_count, locale)}`);
  }
  return parts.length > 0 ? parts.join(" • ") : t("popular.hasEngagement");
}

function formatCount(n: number, locale: string = "th"): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  return new Intl.NumberFormat(locale === "en" ? "en-US" : "th-TH").format(n);
}
