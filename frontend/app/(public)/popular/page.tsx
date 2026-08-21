"use client";

import Link from "next/link";
import React, { useEffect, useMemo, useState } from "react";

import { PerformanceCardMedia, resolvedImageUrl } from "@/components/PerformanceCardMedia";
import {
  getItemEngagementBatch,
  getItemLegacyStatsBatch,
  getItems,
} from "@/lib/api";
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
          error: e instanceof Error ? e.message : "ไม่สามารถโหลดข้อมูลยอดนิยม",
        });
        setReady(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

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
          <p>อันดับยอดนิยม</p>
          <h1>ชุดการแสดงยอดนิยม</h1>
        </div>
        <Link href="/" className="popular-page-back">กลับหน้าแรก</Link>
      </header>

      {!ready ? (
        <div className="popular-page-loading">กำลังโหลดอันดับยอดนิยม...</div>
      ) : data.error ? (
        <div className="home-empty"><p>{data.error}</p></div>
      ) : (
        <div className="popular-page-grid">
          <PopularTopTen
            title="ชุดการแสดงยอดนิยมประจำสัปดาห์"
            subtitle="จัดอันดับจากการตอบรับของผู้ใช้ใน 7 วันที่ผ่านมา"
            items={weeklyTop10}
            engagement={data.week}
            legacy={data.legacy}
          />
          <PopularTopTen
            title="ชุดการแสดงยอดนิยมประจำเดือน"
            subtitle="จัดอันดับจากการตอบรับของผู้ใช้ใน 30 วันที่ผ่านมา"
            items={monthlyTop10}
            engagement={data.month}
            legacy={data.legacy}
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
}: {
  title: string;
  subtitle: string;
  items: ItemOut[];
  engagement: Map<number, EngagementOut>;
  legacy: Map<number, LegacyStatsOut>;
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
        <div className="popular-topten-empty">ยังไม่มีข้อมูลความนิยมในช่วงนี้</div>
      ) : (
        <ol>
          {items.map((item, idx) => (
            <PopularRankRow
              key={item.id}
              rank={idx + 1}
              item={item}
              engagement={engagement.get(item.id)}
              maxScore={maxScore}
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
}: {
  rank: number;
  item: ItemOut;
  engagement?: EngagementOut;
  maxScore: number;
}) {
  const score = engagement?.engagement_score ?? 0;
  const percent = Math.min(100, Math.max(1, Math.round((score / (maxScore || 1)) * 100)));

  return (
    <li className="popular-rank-row">
      <span className="popular-rank-badge">{rank}</span>
      <div className="popular-rank-thumb" aria-hidden="true">
        <PerformanceCardMedia
          imageUrl={resolvedImageUrl(item.image_url)}
          categoryGroup={item.category_group}
          title={item.name}
          variant="card"
        />
      </div>
      <div className="popular-rank-info">
        <strong className="popular-rank-name">
          <Link href={`/items/${item.id}`}>{item.name}</Link>
        </strong>
        <span>{compactItemMeta(item)}</span>
        <div className="popular-rank-engagement-line">
          <span className="popular-rank-pct-badge">
            <span aria-hidden="true">🔥</span> ความนิยม <strong>{percent}%</strong>
          </span>
          <span className="popular-rank-detail-summary">{engagementSummary(engagement)}</span>
        </div>
      </div>
    </li>
  );
}

function compactItemMeta(item: ItemOut): string {
  const parts: string[] = [];
  if (item.performers_count) parts.push(`ผู้แสดง ${item.performers_count} คน`);
  if (item.duration_minutes) parts.push(`${item.duration_minutes} นาที`);
  if (item.price_text) {
    parts.push(/บาท/.test(item.price_text) ? item.price_text : `${item.price_text} บาท`);
  }
  return parts.join(" • ");
}

function engagementSummary(row?: EngagementOut): string {
  if (!row || row.engagement_score <= 0) return "ยังไม่มีการตอบรับในช่วงนี้";
  const parts: string[] = [];
  if (row.like_count > 0) parts.push(`ถูกใจ ${formatCount(row.like_count)}`);
  if (row.save_count > 0) parts.push(`บันทึก ${formatCount(row.save_count)}`);
  if (row.rating_count > 0) parts.push(`รีวิวเชิงบวก ${formatCount(row.rating_count)}`);
  return parts.length > 0 ? parts.join(" • ") : "มีการตอบรับจากผู้ใช้";
}

function formatCount(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  return new Intl.NumberFormat("th-TH").format(n);
}
