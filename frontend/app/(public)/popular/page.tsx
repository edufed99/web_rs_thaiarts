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
import { rankPopularItems, toEngagementMap } from "@/lib/popularityRanking";

interface PopularData {
  items: ItemOut[];
  legacy: Map<number, LegacyStatsOut>;
  week: Map<number, EngagementOut>;
  month: Map<number, EngagementOut>;
  error: string | null;
}

const EMPTY: PopularData = {
  items: [],
  legacy: new Map(),
  week: new Map(),
  month: new Map(),
  error: null,
};

export default function PopularPage() {
  const { t, locale } = useTranslation();
  const [data, setData] = useState<PopularData>(EMPTY);
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
          error: e instanceof Error ? e.message : (locale === "en" ? "Failed to load popularity rankings" : "ไม่สามารถโหลดข้อมูลยอดนิยม"),
        });
        setReady(true);
      });

    return () => {
      cancelled = true;
    };
  }, [locale]);

  const weeklyTop10 = useMemo(
    () => rankPopularItems(data.items, data.week, data.legacy, 10),
    [data.items, data.week, data.legacy],
  );
  const monthlyTop10 = useMemo(
    () => rankPopularItems(data.items, data.month, data.legacy, 10),
    [data.items, data.month, data.legacy],
  );

  return (
    <main className="popular-page">
      <header className="popular-page-head">
        <div>
          <p>{t("popular.eyebrow")}</p>
          <h1>{t("popular.title")}</h1>
        </div>
        <Link href="/" className="popular-page-back">{t("popular.backHome")}</Link>
      </header>

      {!ready ? (
        <div className="popular-page-loading">{t("popular.loading")}</div>
      ) : data.error ? (
        <div className="home-empty"><p>{data.error}</p></div>
      ) : (
        <div className="popular-page-grid">
          <PopularTopTen
            title={t("popular.weeklyTitle")}
            subtitle={t("popular.weeklySubtitle")}
            items={weeklyTop10}
            engagement={data.week}
            legacy={data.legacy}
            locale={locale}
            t={t}
          />
          <PopularTopTen
            title={t("popular.monthlyTitle")}
            subtitle={t("popular.monthlySubtitle")}
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

function PopularTopTen({
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
  const maxScore = useMemo(() => {
    let m = 0;
    for (const item of items) {
      const s = engagement.get(item.id)?.engagement_score ?? 0;
      if (s > m) m = s;
    }
    return m > 0 ? m : 1;
  }, [items, engagement]);

  return (
    <section className="popular-topten">
      <header>
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </header>
      {items.length === 0 ? (
        <div className="popular-topten-empty">{t("popular.empty")}</div>
      ) : (
        <ol>
          {items.map((item, idx) => (
            <PopularRankRow
              key={item.id}
              rank={idx + 1}
              item={item}
              engagement={engagement.get(item.id)}
              maxScore={maxScore}
              locale={locale}
              t={t}
            />
          ))}
        </ol>
      )}
    </section>
  );
}

function PopularRankRow({
  rank,
  item,
  engagement,
  maxScore,
  locale,
  t,
}: {
  rank: number;
  item: ItemOut;
  engagement?: EngagementOut;
  maxScore: number;
  locale: string;
  t: (key: string) => string;
}) {
  const localized = getLocalizedItem(item, locale as "en" | "th");
  const score = engagement?.engagement_score ?? 0;
  const percent = Math.min(100, Math.max(1, Math.round((score / (maxScore || 1)) * 100)));

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
        <div className="popular-rank-engagement-line">
          <span className="popular-rank-pct-badge">
            <span aria-hidden="true">🔥</span> {t("popular.popularityBadge")} <strong>{percent}%</strong>
          </span>
          <span className="popular-rank-detail-summary">{engagementSummary(engagement, locale, t)}</span>
        </div>
      </div>
    </li>
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
