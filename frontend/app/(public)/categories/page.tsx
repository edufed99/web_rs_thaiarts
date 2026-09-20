"use client";

import Link from "next/link";
import React, { useEffect, useMemo, useState } from "react";

import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { LoadingState } from "@/components/LoadingState";
import { useTranslation } from "@/contexts/LanguageContext";
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
  thaiName: string;
  displayName: string;
  count: number;
  sampleType: string;
}

export default function CategoriesPage() {
  const { locale, t } = useTranslation();
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

  const categories = useMemo(() => buildCategorySummaries(items ?? [], locale), [items, locale]);
  const totalItems = useMemo(
    () => categories.reduce((sum, category) => sum + category.count, 0),
    [categories],
  );

  if (error) {
    return <ErrorState message={error} code={errorCode} onRetry={() => setReloadKey((k) => k + 1)} />;
  }

  return (
    <section className="categories-page section-stack" aria-label={t("categories.title")}>
      <div className="catalog-search-panel categories-head-panel">
        <div className="catalog-title-block">
          <div className="catalog-title-row">
            <span className="catalog-title-icon" aria-hidden="true">◇</span>
            <h1>{t("categories.title")}</h1>
          </div>
          <p className="catalog-result-count">
            {items ? (
              locale === "en" ? (
                <>Found <span>{formatCount(categories.length, "en")}</span> categories across <span>{formatCount(totalItems, "en")}</span> performances</>
              ) : (
                <>พบ <span>{formatCount(categories.length, "th")}</span> หมวดหมู่ จาก <span>{formatCount(totalItems, "th")}</span> รายการ</>
              )
            ) : (
              t("categories.gathering")
            )}
          </p>
        </div>
      </div>

      {!items ? (
        <LoadingState message={t("categories.loading")} />
      ) : categories.length === 0 ? (
        <EmptyState
          title={t("categories.emptyTitle")}
          message={t("categories.emptyMessage")}
        />
      ) : (
        <div className="categories-grid" aria-label={t("categories.gridLabel")}>
          {categories.map((category, idx) => (
            <Link
              key={category.thaiName}
              href={`/items?category=${encodeURIComponent(category.thaiName)}`}
              className="category-card"
            >
              <img
                src={categoryImageFor(category.thaiName, idx)}
                alt=""
                aria-hidden="true"
              />
              <span className="category-card-body">
                <strong>{category.displayName}</strong>
                <small>{formatCount(category.count, locale)} {t("categories.itemsInCat")}</small>
                {category.sampleType ? <em>{category.sampleType}</em> : null}
              </span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

function buildCategorySummaries(items: ItemOut[], locale: "th" | "en"): CategorySummary[] {
  const isEn = locale === "en";
  const buckets = new Map<string, {
    thaiName: string;
    enName: string;
    count: number;
    sampleType: string;
  }>();

  for (const item of items) {
    const thaiName = (item.category_group || "").trim() || "อื่นๆ";
    const enName = (item.category_group_en || "").trim() || "Other";
    const existing = buckets.get(thaiName);
    const sampleType = isEn && item.performance_type_en ? item.performance_type_en : (item.performance_type || "");

    if (existing) {
      existing.count += 1;
      if (!existing.sampleType && sampleType) {
        existing.sampleType = sampleType;
      }
    } else {
      buckets.set(thaiName, {
        thaiName,
        enName,
        count: 1,
        sampleType,
      });
    }
  }

  return Array.from(buckets.values())
    .map((info) => ({
      name: info.thaiName,
      thaiName: info.thaiName,
      displayName: isEn && info.enName ? info.enName : info.thaiName,
      count: info.count,
      sampleType: info.sampleType,
    }))
    .sort((a, b) => b.count - a.count || a.displayName.localeCompare(b.displayName, isEn ? "en" : "th"));
}

function formatCount(n: number, locale: "th" | "en" = "th"): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  return new Intl.NumberFormat(locale === "en" ? "en-US" : "th-TH").format(n);
}

function categoryImageFor(name: string, idx: number): string {
  return CATEGORY_IMAGE_BY_NAME[name] ?? CATEGORY_IMAGES[idx % CATEGORY_IMAGES.length];
}

