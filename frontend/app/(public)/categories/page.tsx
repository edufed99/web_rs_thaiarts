"use client";

import Link from "next/link";
import React, { useEffect, useMemo, useState } from "react";

import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { LoadingState } from "@/components/LoadingState";
import { ApiClientError, getItems } from "@/lib/api";
import type { ItemOut } from "@/lib/types";

const FETCH_LIMIT = 200;
const CATEGORY_IMAGES = [
  "/img/home/category-1.png",
  "/img/home/category-2.png",
  "/img/home/category-3.png",
  "/img/home/category-4.png",
  "/img/home/category-5.png",
  "/img/home/category-6.png",
] as const;
const CATEGORY_IMAGE_BY_NAME: Record<string, string> = {
  "นาฏศิลป์อนุรักษ์": "/img/home/category-conservation.gif",
  "การแสดงนาฏศิลป์สร้างสรรค์": "/img/home/category-creative.jpg",
  "นาฏศิลป์พื้นบ้านภาคเหนือ": "/img/home/category-north.jpg",
  "นาฏศิลป์พื้นบ้านภาคอีสาน": "/img/home/category-isan.jpg",
  "นาฏศิลป์พื้นบ้านภาคกลาง": "/img/home/category-central.jpg",
  "นาฏศิลป์พื้นบ้านภาคใต้": "/img/home/category-south.jpg",
  "รำฉุยฉาย": "/img/home/category-chui-chai.jpg",
  "ระบำโบราณคดี": "/img/home/category-archaeology.jpg",
};

interface CategorySummary {
  name: string;
  count: number;
  sampleType: string;
}

export default function CategoriesPage() {
  const [items, setItems] = useState<ItemOut[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | undefined>(undefined);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setItems(null);
    setError(null);
    setErrorCode(undefined);

    getItems({ limit: FETCH_LIMIT, offset: 0 })
      .then((resp) => {
        if (!cancelled) setItems(resp.items);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        if (e instanceof ApiClientError) {
          setError(e.message);
          setErrorCode(e.code);
        } else {
          setError(e instanceof Error ? e.message : "Unknown error");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const categories = useMemo(() => buildCategorySummaries(items ?? []), [items]);
  const totalItems = useMemo(
    () => categories.reduce((sum, category) => sum + category.count, 0),
    [categories],
  );

  if (error) {
    return <ErrorState message={error} code={errorCode} onRetry={() => setReloadKey((k) => k + 1)} />;
  }

  return (
    <section className="categories-page section-stack" aria-label="หมวดหมู่ทั้งหมด">
      <div className="catalog-search-panel categories-head-panel">
        <div className="catalog-title-block">
          <div className="catalog-title-row">
            <span className="catalog-title-icon" aria-hidden="true">◇</span>
            <h1>หมวดหมู่ทั้งหมด</h1>
          </div>
          <p className="catalog-result-count">
            {items
              ? <>พบ <span>{formatCount(categories.length)}</span> หมวดหมู่ จาก <span>{formatCount(totalItems)}</span> รายการ</>
              : "กำลังรวบรวมหมวดหมู่จากฐานข้อมูล"}
          </p>
        </div>
      </div>

      {!items ? (
        <LoadingState message="กำลังโหลดหมวดหมู่..." />
      ) : categories.length === 0 ? (
        <EmptyState
          title="ยังไม่มีหมวดหมู่ในระบบ"
          message="เมื่อมีรายการชุดการแสดง หมวดหมู่จะแสดงที่หน้านี้"
        />
      ) : (
        <div className="categories-grid" aria-label="รายการหมวดหมู่ทั้งหมด">
          {categories.map((category, idx) => (
            <Link
              key={category.name}
              href={`/items?category=${encodeURIComponent(category.name)}`}
              className="category-card"
            >
              <img
                src={categoryImageFor(category.name, idx)}
                alt=""
                aria-hidden="true"
              />
              <span className="category-card-body">
                <strong>{category.name}</strong>
                <small>{formatCount(category.count)} รายการในหมวดนี้</small>
                {category.sampleType ? <em>{category.sampleType}</em> : null}
              </span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

function buildCategorySummaries(items: ItemOut[]): CategorySummary[] {
  const buckets = new Map<string, { count: number; sampleType: string }>();
  for (const item of items) {
    const name = (item.category_group || "").trim() || "อื่นๆ";
    const existing = buckets.get(name);
    if (existing) {
      existing.count += 1;
      if (!existing.sampleType && item.performance_type) {
        existing.sampleType = item.performance_type;
      }
    } else {
      buckets.set(name, {
        count: 1,
        sampleType: item.performance_type || "",
      });
    }
  }

  return Array.from(buckets.entries())
    .map(([name, info]) => ({ name, count: info.count, sampleType: info.sampleType }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "th"));
}

function formatCount(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  return new Intl.NumberFormat("th-TH").format(n);
}

function categoryImageFor(name: string, idx: number): string {
  return CATEGORY_IMAGE_BY_NAME[name] ?? CATEGORY_IMAGES[idx % CATEGORY_IMAGES.length];
}
