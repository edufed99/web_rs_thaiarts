"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import React, { useEffect, useMemo, useState } from "react";

import PopularPerformanceCard from "@/components/PopularPerformanceCard";
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

// ---------------------------------------------------------------------------
// Static marketing copy — kept verbatim because the user wants images and
// these "framing" strings to remain frozen until manually updated.
// ---------------------------------------------------------------------------

// 3-step "how it works" — pure marketing copy.
const HOW_STEPS = [
  {
    n: "1",
    icon: "♡",
    title: "เลือกบริบทและความสนใจ",
    desc: "ระบุโอกาส งบประมาณ จำนวนผู้แสดง และรูปแบบที่ต้องการ",
  },
  {
    n: "2",
    icon: "AI",
    title: "AI วิเคราะห์ข้อมูล",
    desc: "ระบบวิเคราะห์ความเหมาะสมจากฐานข้อมูลชุดการแสดงและบริบทงาน",
  },
  {
    n: "3",
    icon: "♧",
    title: "ค้นพบชุดการแสดงที่เหมาะสม",
    desc: "รับคำแนะนำที่ตรงกับความต้องการ พร้อมรายละเอียดครบถ้วน",
  },
] as const;

// Hardcoded image paths. The user has not yet replaced /img/home/* with
// real uploads, so we keep using the marketing assets paired by index.
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
  const [user, setUser] = useState<UserOut | null>(null);
  const [live, setLive] = useState<LiveData>(EMPTY_LIVE);
  const [liveReady, setLiveReady] = useState(false);
  const [heroSearch, setHeroSearch] = useState("");

  // Client-side search submit — avoids a full HTML form post so the home
  // → /items navigation reuses Next.js's preloaded chunks (catalogue grid
  // / skeletons / Suspense boundary) instead of tearing the document down
  // and re-running the boot pipeline from scratch. Anonymous callers get
  // the same fast path; getItems() will skip the user_key param when no
  // member is logged in (see lib/api.ts).
  const onHeroSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = heroSearch.trim();
    router.push(q ? `/items?q=${encodeURIComponent(q)}` : "/items");
  };

  // Auth state — ref counts on login/logout so the CTA banner can hide for
  // returning users. Mirrors the pattern from member pages.
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

  // Live data — three endpoints fired in parallel, then a 4th call for the
  // batch legacy stats (so the popular card can show real ratings) and a
  // 5th call for live engagement (likes + saves + positive ratings). The
  // page stays usable even if any one of them fails — we render graceful
  // placeholders rather than blowing the page up.
  useEffect(() => {
    let cancelled = false;
    setLiveReady(false);

    Promise.allSettled([
      // Send the anon user_key so the catalog endpoint can apply live
      // personalization. We ask for 200 items so the category bucket
      // counts are accurate — the homepage renders the top 6 categories
      // by item count, which would be wrong if we capped at 50.
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

      // Stage 2 — fetch all-time engagement (popular ranking), monthly
      // engagement (top-rated ranking, so it matches /top-rated), and legacy
      // stats (rating summary shown on cards). All three are batch endpoints
      // and are kicked off in parallel.
      const ids = items.map((item) => item.id);
      const engagementP = getItemEngagementBatch(ids).catch((e: unknown) => {
        if (cancelled) return { engagements: [], source: "disabled" as const };
        return { engagements: [], source: "disabled" as const };
      });
      const engagementMonthP = getItemEngagementBatch(ids, { range: "30d" }).catch((e: unknown) => {
        if (cancelled) return { engagements: [], source: "disabled" as const };
        return { engagements: [], source: "disabled" as const };
      });
      const legacyP = getItemLegacyStatsBatch(ids).catch((e: unknown) => new Map());

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

  // -------------------------- Derived data -----------------------------

  // Popular cards: top 4 by live engagement_score desc.
  //
  // "Engagement" = likes + saves + positive (rating ≥ 4) ratings. Only
  // items with engagement > 0 qualify; tie-breakers are avg_rating desc,
  // total review count desc, match_percent desc, then id desc.
  const popularTop4 = useMemo(() => {
    return rankPopularItems(live.items, live.engagement, live.legacy, 4);
  }, [live.items, live.engagement, live.legacy]);

  // Top Rated cards: top 4 by avg_rating desc among items that received a
  // rating in the last 30 days, so the homepage preview matches the first 4
  // rows of the monthly section on /top-rated.
  const topRatedTop4 = useMemo(() => {
    return rankTopRatedItems(live.items, live.legacy, 4, live.engagementMonth);
  }, [live.items, live.legacy, live.engagementMonth]);

  // Category tiles: top 6 distinct `category_group` values by item count.
  // Item.category_group is the live field; the static homepage currently
  // hardcodes region-themed labels that don't map 1:1, so we render whatever
  // the corpus actually contains.
  const categoryTop6 = useMemo(() => {
    const buckets = new Map<string, { count: number; sample_id: number }>();
    for (const item of live.items) {
      const key = (item.category_group || "").trim() || "อื่นๆ";
      const cur = buckets.get(key);
      if (cur) cur.count += 1;
      else buckets.set(key, { count: 1, sample_id: item.id });
    }
    return Array.from(buckets.entries())
      .map(([name, info]) => ({ name, count: info.count, sample_id: info.sample_id }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "th"))
      .slice(0, 6);
  }, [live.items]);

  // Preview the same ordered sub-contexts shown on /occasions.
  const occasionPreview = useMemo(
    () => buildOccasionSummaries(live.contexts).slice(0, 5),
    [live.contexts],
  );

  const itemCount = live.metrics?.item_count ?? live.items.length;
  const totalItemsLabel = itemCount > 0 ? new Intl.NumberFormat("th-TH").format(itemCount) : "—";

  return (
    <div className="home home-mockup">
      <section className="home-hero">
        <div className="home-hero-text">
          <h1>
            ค้นหาชุดการแสดงที่ใช่
            <br />
            สำหรับทุกโอกาส
          </h1>
          <p className="home-hero-sub">
            สำรวจนาฏศิลป์ไทยกว่า {totalItemsLabel !== "—" ? `${totalItemsLabel} ชุด` : "100 ชุด"}
            พร้อมข้อมูลผู้แสดง ระยะเวลา และราคา
          </p>
          <form className="home-search" role="search" onSubmit={onHeroSearchSubmit}>
            <span className="home-search-icon" aria-hidden="true">⌕</span>
            <input
              type="search"
              name="q"
              value={heroSearch}
              onChange={(e) => setHeroSearch(e.target.value)}
              placeholder="ค้นหาชื่อชุดการแสดง หรือโอกาสที่ต้องการ..."
              aria-label="ค้นหาชุดการแสดง"
            />
            <button type="submit" aria-label="ค้นหา">⌕</button>
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
            <h2>รับคำแนะนำที่ตรงกับความต้องการของคุณ</h2>
            <p>สมัครสมาชิกฟรี เพื่อรับคำแนะนำเฉพาะคุณ และเข้าถึงชุดการแสดงพิเศษก่อนใคร</p>
            <Link href="/signup" className="site-button primary">สมัครสมาชิกฟรี</Link>
            <small>ไม่มีค่าใช้จ่าย • ยกเลิกได้ทุกเมื่อ</small>
          </div>
        </section>
      )}

      <section className="home-section">
        <SectionHead title="ชุดการแสดงยอดนิยม" href="/popular" />
        {!liveReady ? (
          <SkeletonGrid count={4} />
        ) : popularTop4.length === 0 ? (
          <EmptyState text={live.error ? "ไม่สามารถโหลดข้อมูลจากเซิร์ฟเวอร์" : "ยังไม่มีชุดการแสดงในระบบ"} />
        ) : (
          <div className="home-card-grid" style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))" }}>
            {popularTop4.map((item, idx) => (
              <div key={item.id} className="popular-slot">
                <PopularPerformanceCard item={item} variant="popular" />
                {/* Images are hardcoded — overlay the marketing thumbnail on
                    top of the component's media area so the live name/price
                    show while the photo stays put. */}
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
        <SectionHead title="ชุดการแสดงที่ได้รับคะแนนสูง" href="/top-rated" />
        {!liveReady ? (
          <SkeletonGrid count={4} />
        ) : topRatedTop4.length === 0 ? (
          <EmptyState text={live.error ? "ไม่สามารถโหลดข้อมูลจากเซิร์ฟเวอร์" : "ยังไม่มีชุดการแสดงที่ได้รับคะแนน"} />
        ) : (
          <div className="home-card-grid" style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))" }}>
            {topRatedTop4.map((item) => (
              <PopularPerformanceCard key={item.id} item={item} variant="top-rated" />
            ))}
          </div>
        )}
      </section>

      <section className="home-section">
        <SectionHead title="สำรวจตามหมวดหมู่" href="/categories" />
        {!liveReady ? (
          <SkeletonGrid count={6} variant="square" />
        ) : categoryTop6.length === 0 ? (
          <EmptyState text="ยังไม่มีข้อมูลหมวดหมู่" />
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
                <strong>{cat.name}</strong>
                <small>{formatCount(cat.count)} รายการในหมวดนี้</small>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="home-section">
        <SectionHead title="เลือกตามโอกาสสำคัญ" href="/occasions" />
        {!liveReady ? (
          <SkeletonGrid count={5} variant="square" />
        ) : occasionPreview.length === 0 ? (
          <EmptyState text="ยังไม่มีข้อมูลโอกาส" />
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
                <h3>{occ.context.name}</h3>
                <p>{formatCount(occ.context.active_item_count)} ชุดการแสดงตามโอกาสนี้</p>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="home-section">
        <SectionHead title="ระบบแนะนำทำงานอย่างไร" />
        <ol className="home-how">
          {HOW_STEPS.map((step) => (
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

function SectionHead({ title, href }: { title: string; href?: string }) {
  return (
    <div className="home-section-head">
      <h2><span aria-hidden="true">❖</span>{title}</h2>
      {href ? <Link href={href}>ดูทั้งหมด ›</Link> : null}
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

// Tiny intl formatter — th-TH locale adds thousands separators.
function formatCount(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  return new Intl.NumberFormat("th-TH").format(n);
}

function categoryImageFor(name: string, idx: number): string {
  return CATEGORY_IMAGE_BY_NAME[name] ?? CATEGORY_IMAGES[idx % CATEGORY_IMAGES.length];
}

// Same icon mapping the original page used — keeps the visual rhythm of
// the chip badges consistent with the rest of the public pages.
function chipIcon(label: string): string {
  if (label.includes("เทศกาล")) return "✣";
  if (label.includes("เผยแพร่")) return "❋";
  if (label.includes("ราชพิธี")) return "♜";
  if (label.includes("อวมงคล")) return "♢";
  if (label.includes("มงคล")) return "✦";
  return "♧";
}
