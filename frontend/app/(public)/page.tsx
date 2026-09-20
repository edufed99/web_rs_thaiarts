"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import React, { useEffect, useMemo, useState } from "react";

import PopularPerformanceCard from "@/components/PopularPerformanceCard";
import { useTranslation } from "@/contexts/LanguageContext";
import {
  AUTH_CHANGED_EVENT,
  getCurrentUser,
  STORAGE_KEY,
} from "@/lib/auth";
import {
  getContexts,
  getItemEngagementBatch,
  getItemLegacyStatsBatch,
  getItems,
  getMetrics,
} from "@/lib/api";
import { buildOccasionSummaries, occasionImageFor } from "@/lib/occasionCatalog";
import { getUserKey } from "@/lib/user";
import { rankPopularItems, rankTopRatedItems } from "@/lib/popularityRanking";
import type { ContextOut, EngagementOut, ItemOut, LegacyStatsOut, UserOut } from "@/lib/types";

// Hardcoded image paths. We keep using the marketing assets paired by index.
const POPULAR_IMAGES = [
  "/img/home/popular-1.png",
  "/img/home/popular-2.png",
  "/img/home/popular-3.png",
  "/img/home/popular-4.png",
] as const;
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

// ---------------------------------------------------------------------------
// Live data shape populated by the page's single useEffect.
// ---------------------------------------------------------------------------

interface LiveData {
  items: ItemOut[];
  contexts: ContextOut[];
  metrics: { item_count: number; context_count: number } | null;
  legacy: Map<number, LegacyStatsOut>;
  engagement: Map<number, EngagementOut>;
  engagementMonth: Map<number, EngagementOut>;
  error: string | null;
}

const EMPTY_LIVE: LiveData = {
  items: [],
  contexts: [],
  metrics: null,
  legacy: new Map(),
  engagement: new Map(),
  engagementMonth: new Map(),
  error: null,
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function HomePage() {
  const router = useRouter();
  const { t, locale } = useTranslation();
  const [user, setUser] = useState<UserOut | null>(null);
  const [live, setLive] = useState<LiveData>(EMPTY_LIVE);
  const [liveReady, setLiveReady] = useState(false);
  const [heroSearch, setHeroSearch] = useState("");

  const onHeroSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = heroSearch.trim();
    router.push(q ? `/items?q=${encodeURIComponent(q)}` : "/items");
  };

  useEffect(() => {
    function syncAuth() {
      const currentUser = getCurrentUser();
      setUser(currentUser);
    }
    syncAuth();
    function onStorage(e: StorageEvent) {
      if (e.key === STORAGE_KEY) syncAuth();
    }
    window.addEventListener(AUTH_CHANGED_EVENT, syncAuth);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(AUTH_CHANGED_EVENT, syncAuth);
      window.removeEventListener("storage", onStorage);
    };
  }, [router]);

  useEffect(() => {
    let cancelled = false;
    setLiveReady(false);

    Promise.allSettled([
      getItems({ limit: 200, userKey: getUserKey() || undefined }),
      getContexts(),
      getMetrics(),
    ]).then(([itemsRes, contextsRes, metricsRes]) => {
      if (cancelled) return;
      const err =
        (itemsRes.status === "rejected" && itemsRes.reason instanceof Error
          ? itemsRes.reason.message
          : null) ??
        (contextsRes.status === "rejected" && contextsRes.reason instanceof Error
          ? contextsRes.reason.message
          : null) ??
        (metricsRes.status === "rejected" && metricsRes.reason instanceof Error
          ? metricsRes.reason.message
          : null);

      const items = itemsRes.status === "fulfilled" ? itemsRes.value.items : [];
      const contexts = contextsRes.status === "fulfilled" ? contextsRes.value.contexts : [];
      const metrics =
        metricsRes.status === "fulfilled"
          ? { item_count: metricsRes.value.item_count, context_count: metricsRes.value.context_count }
          : null;

      const ids = items.map((item) => item.id);
      const engagementP = getItemEngagementBatch(ids).catch(() => ({
        engagements: [],
        source: "disabled" as const,
      }));
      const engagementMonthP = getItemEngagementBatch(ids, { range: "30d" }).catch(() => ({
        engagements: [],
        source: "disabled" as const,
      }));
      const legacyP = getItemLegacyStatsBatch(ids).catch(() => new Map());

      Promise.all([engagementP, engagementMonthP, legacyP]).then(([engRes, engMonthRes, legacyMap]) => {
        if (cancelled) return;
        const toMap = (rows: EngagementOut[]) => {
          const m = new Map<number, EngagementOut>();
          for (const row of rows) m.set(row.item_id, row);
          return m;
        };
        setLive({
          items,
          contexts,
          metrics,
          legacy: legacyMap,
          engagement: toMap(engRes.engagements),
          engagementMonth: toMap(engMonthRes.engagements),
          error: err,
        });
        setLiveReady(true);
      });
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const popularTop4 = useMemo(() => {
    return rankPopularItems(live.items, live.engagement, live.legacy, 4);
  }, [live.items, live.engagement, live.legacy]);

  const maxPopularScore = useMemo(() => {
    let m = 0;
    for (const item of popularTop4) {
      const s = live.engagement.get(item.id)?.engagement_score ?? 0;
      if (s > m) m = s;
    }
    return m > 0 ? m : 1;
  }, [popularTop4, live.engagement]);

  const topRatedTop4 = useMemo(() => {
    return rankTopRatedItems(live.items, live.legacy, 4, live.engagementMonth);
  }, [live.items, live.legacy, live.engagementMonth]);

  const categoryTop6 = useMemo(() => {
    const buckets = new Map<string, { nameEn: string; count: number; sample_id: number }>();
    for (const item of live.items) {
      const key = (item.category_group || "").trim() || "อื่นๆ";
      const keyEn = (item.category_group_en || "").trim() || "Other";
      const cur = buckets.get(key);
      if (cur) cur.count += 1;
      else buckets.set(key, { nameEn: keyEn, count: 1, sample_id: item.id });
    }
    return Array.from(buckets.entries())
      .map(([name, info]) => ({ name, nameEn: info.nameEn, count: info.count, sample_id: info.sample_id }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "th"))
      .slice(0, 6);
  }, [live.items]);

  const occasionPreview = useMemo(
    () => buildOccasionSummaries(live.contexts).slice(0, 5),
    [live.contexts],
  );

  const howSteps = useMemo(
    () => [
      {
        n: "1",
        icon: "♡",
        title: t("home.howStep1Title"),
        desc: t("home.howStep1Desc"),
      },
      {
        n: "2",
        icon: "AI",
        title: t("home.howStep2Title"),
        desc: t("home.howStep2Desc"),
      },
      {
        n: "3",
        icon: "♧",
        title: t("home.howStep3Title"),
        desc: t("home.howStep3Desc"),
      },
    ],
    [t],
  );

  return (
    <div className="home home-mockup">
      <section className="home-hero">
        <div className="home-hero-text">
          <h1>{t("home.heroTitle")}</h1>
          <p className="home-hero-sub">
            {t("home.heroSubtitle")}
          </p>
          <form className="home-search" role="search" onSubmit={onHeroSearchSubmit}>
            <span className="home-search-icon" aria-hidden="true">⌕</span>
            <input
              type="search"
              name="q"
              value={heroSearch}
              onChange={(e) => setHeroSearch(e.target.value)}
              placeholder={t("home.heroSearchPlaceholder")}
              aria-label={t("common.search")}
            />
            <button type="submit" aria-label={t("common.search")}>⌕</button>
          </form>
        </div>
        <div className="home-hero-art" aria-hidden="true">
          <img src="/img/hero-chatgpt-gold-lines.png" alt="" />
        </div>
      </section>

      {user ? null : (
        <section className="home-cta">
          <div className="home-cta-media" aria-hidden="true">
            <img src="/img/home/cta-loy-krathong.png" alt="" />
          </div>
          <div className="home-cta-text">
            <h2>{t("home.ctaTitle")}</h2>
            <p>{t("home.ctaSubtitle")}</p>
            <Link href="/signup" className="site-button primary">{t("home.ctaButton")}</Link>
            <small>{t("home.ctaNote")}</small>
          </div>
        </section>
      )}

      <section className="home-section">
        <SectionHead title={t("home.popularTitle")} href="/popular" viewAllText={t("common.viewAll")} />
        {!liveReady ? (
          <SkeletonGrid count={4} />
        ) : popularTop4.length === 0 ? (
          <EmptyState text={live.error ? t("home.serverError") : t("home.noItems")} />
        ) : (
          <div className="home-card-grid" style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))" }}>
            {popularTop4.map((item, idx) => (
              <div key={item.id} className="popular-slot">
                <PopularPerformanceCard
                  item={item}
                  variant="popular"
                  engagement={live.engagement.get(item.id)}
                  engagementMax={maxPopularScore}
                />
                <img
                  src={POPULAR_IMAGES[idx] ?? POPULAR_IMAGES[0]}
                  alt=""
                  aria-hidden="true"
                  className="popular-slot-thumb"
                />
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="home-section">
        <SectionHead title={t("home.topRatedTitle")} href="/top-rated" viewAllText={t("common.viewAll")} />
        {!liveReady ? (
          <SkeletonGrid count={4} />
        ) : topRatedTop4.length === 0 ? (
          <EmptyState text={live.error ? t("home.serverError") : t("home.noRatedItems")} />
        ) : (
          <div className="home-card-grid" style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))" }}>
            {topRatedTop4.map((item) => (
              <PopularPerformanceCard key={item.id} item={item} variant="top-rated" />
            ))}
          </div>
        )}
      </section>

      <section className="home-section">
        <SectionHead title={t("home.exploreCategories")} href="/categories" viewAllText={t("common.viewAll")} />
        {!liveReady ? (
          <SkeletonGrid count={6} variant="square" />
        ) : categoryTop6.length === 0 ? (
          <EmptyState text={t("home.noCategories")} />
        ) : (
          <div className="home-tile-grid">
            {categoryTop6.map((cat, idx) => (
              <Link
                key={cat.name}
                href={`/items?category=${encodeURIComponent(cat.name)}`}
                className="home-category-tile"
              >
                <img
                  src={categoryImageFor(cat.name, idx)}
                  alt=""
                  aria-hidden="true"
                />
                <strong>{locale === "en" && cat.nameEn ? cat.nameEn : cat.name}</strong>
                <small>{formatCount(cat.count, locale)} {t("home.itemsInCat")}</small>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="home-section">
        <SectionHead title={t("home.occasionsTitle")} href="/occasions" viewAllText={t("common.viewAll")} />
        {!liveReady ? (
          <SkeletonGrid count={5} variant="square" />
        ) : occasionPreview.length === 0 ? (
          <EmptyState text={t("home.noOccasions")} />
        ) : (
          <div className="home-occasion-grid">
            {occasionPreview.map((occ, idx) => (
              <Link
                key={occ.context.id}
                href={`/items?context=${occ.context.id}`}
                className="home-occasion-card"
              >
                <img
                  src={occasionImageFor(occ.context.name, occ.groupLabel, idx)}
                  alt=""
                  aria-hidden="true"
                />
                <span className="home-occasion-icon" aria-hidden="true">{chipIcon(occ.groupLabel)}</span>
                <h3>{locale === "en" && occ.context.name_en ? occ.context.name_en : occ.context.name}</h3>
                <p>{formatCount(occ.context.active_item_count, locale)} {t("home.itemsInOccasion")}</p>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="home-section">
        <SectionHead title={t("home.systemHighlights")} />
        <ol className="home-how">
          {howSteps.map((step) => (
            <HowStep
              key={step.n}
              n={step.n}
              icon={step.icon}
              title={step.title}
              desc={step.desc}
            />
          ))}
        </ol>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Local presentation helpers (kept inline — small + page-specific)
// ---------------------------------------------------------------------------

function SectionHead({ title, href, viewAllText }: { title: string; href?: string; viewAllText?: string }) {
  return (
    <div className="home-section-head">
      <h2><span aria-hidden="true">❖</span>{title}</h2>
      {href ? <Link href={href}>{viewAllText ?? "ดูทั้งหมด"} ›</Link> : null}
    </div>
  );
}

function HowStep({ n, icon, title, desc }: { n: string; icon: string; title: string; desc: string }) {
  return (
    <li className="home-how-step">
      <span className="home-how-number">{n}</span>
      <span className="home-how-icon" aria-hidden="true">{icon}</span>
      <div>
        <h3>{title}</h3>
        <p>{desc}</p>
      </div>
    </li>
  );
}

function SkeletonGrid({ count, variant }: { count: number; variant?: "square" }) {
  return (
    <div className={`home-card-grid ${variant === "square" ? "home-tile-grid" : ""}`} aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="popular-slot">
          <div className="popular-card popular-card--skeleton" />
        </div>
      ))}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="home-empty">
      <p>{text}</p>
    </div>
  );
}

function formatCount(n: number, locale: string = "th"): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  return new Intl.NumberFormat(locale === "en" ? "en-US" : "th-TH").format(n);
}

function categoryImageFor(name: string, idx: number): string {
  return CATEGORY_IMAGE_BY_NAME[name] ?? CATEGORY_IMAGES[idx % CATEGORY_IMAGES.length];
}

function chipIcon(label: string): string {
  if (label.includes("เทศกาล")) return "✣";
  if (label.includes("เผยแพร่")) return "❋";
  if (label.includes("ราชพิธี")) return "♜";
  if (label.includes("อวมงคล")) return "♢";
  if (label.includes("มงคล")) return "✦";
  return "♧";
}
