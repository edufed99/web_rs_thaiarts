"use client";

import React, { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";

import { CatalogItemCard } from "@/components/CatalogItemCard";
import { ErrorState } from "@/components/ErrorState";
import { ItemActionBar } from "@/components/ItemActionBar";
import { LoadingState } from "@/components/LoadingState";
import { MemberRatingSummary } from "@/components/MemberStats";
import {
  PerformanceCardMedia,
  resolvedImageUrl,
} from "@/components/PerformanceCardMedia";
import { useTranslation } from "@/contexts/LanguageContext";

import {
  ApiClientError,
  getItem,
  getItemLegacyStats,
  getMeRatingSummary,
  getSimilarItems,
  postView,
} from "@/lib/api";
import type { ItemOut, LegacyStatsOut, RatingSummaryOut, UserState } from "@/lib/types";
import { useAuthHeaders } from "@/lib/useAuthHeaders";
import { getUserKey } from "@/lib/user";

function ItemDetailContent() {
  const { t } = useTranslation();
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const itemId = Number(params?.id);
  const validId = Number.isFinite(itemId) && itemId > 0;
  // Set by RecommendationCard so the view can be attributed to the
  // recommendation that surfaced this item (ADR-002 §3.2).
  const fromRequest = searchParams?.get("from_request") ?? null;

  const [item, setItem] = useState<ItemOut | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | undefined>(undefined);
  const [userKey, setUserKey] = useState<string>("");
  const [reloadKey, setReloadKey] = useState(0);
  const [legacyStats, setLegacyStats] = useState<LegacyStatsOut | null>(null);
  const [similar, setSimilar] = useState<ItemOut[]>([]);
  const [ratingSummary, setRatingSummary] = useState<RatingSummaryOut | null>(null);
  const authHeaders = useAuthHeaders();

  useEffect(() => {
    setUserKey(getUserKey());
  }, []);

  useEffect(() => {
    if (!validId) return;
    let cancelled = false;
    setError(null);
    setItem(null);
    getItem(itemId, { userKey: userKey || undefined, extraHeaders: authHeaders })
      .then((resp) => {
        if (!cancelled) setItem(resp);
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
  }, [itemId, userKey, reloadKey, validId, authHeaders]);

  // Log the view (ADR-002 §3.1). Deliberately NOT keyed on `reloadKey`:
  // liking or rating re-renders this page, and a re-log would be a second
  // view of the same visit. The backend dedupes per 30-minute window too,
  // so this is belt-and-braces. Failures are swallowed inside `postView` —
  // telemetry must never break the page it measures.
  useEffect(() => {
    if (!validId || !userKey) return;
    void postView(
      { user_key: userKey, item_id: itemId, request_id: fromRequest },
      authHeaders,
    );
  }, [itemId, userKey, validId, fromRequest, authHeaders]);

  // Live legacy rating from the real Postgres corpus. Used by the
  // star count + "X ครั้ง" label on the hero. Failure is non-fatal —
  // we just hide the block.
  useEffect(() => {
    if (!validId) return;
    let cancelled = false;
    getItemLegacyStats(itemId)
      .then((s) => {
        if (!cancelled) setLegacyStats(s);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [itemId, validId]);

  useEffect(() => {
    if (!validId) return;
    let cancelled = false;
    getSimilarItems(itemId, { limit: 4, userKey, extraHeaders: authHeaders })
      .then((resp) => {
        if (cancelled) return;
        setSimilar(resp.items);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [itemId, userKey, validId, authHeaders]);

  useEffect(() => {
    if (!userKey) return;
    let cancelled = false;
    getMeRatingSummary(userKey, authHeaders)
      .then((data) => { if (!cancelled) setRatingSummary(data); })
      .catch(() => { if (!cancelled) setRatingSummary(null); });
    return () => { cancelled = true; };
  }, [userKey, authHeaders, reloadKey]);

  const handleUserStateChange = useCallback((next: UserState) => {
    setItem((prev) => (prev ? { ...prev, user_state: next } : prev));
  }, []);

  if (!validId) {
    return <ErrorState message={t("itemDetail.invalidId")} code="invalid_item_id" />;
  }
  if (error) {
    return (
      <ErrorState
        message={error}
        code={errorCode}
        onRetry={() => setReloadKey((k) => k + 1)}
      />
    );
  }
  if (!item) {
    return <LoadingState message={t("itemDetail.loading")} />;
  }

  const legacyCount = legacyStats?.count ?? 0;
  const legacyAvg = legacyStats?.avg_rating ?? 0;
  const hasLegacy = legacyStats?.source === "postgres" && legacyCount > 0;
  const activeStars = hasLegacy ? Math.round(legacyAvg) : 0;

  return (
    <div className="container" style={{ padding: "var(--space-6) 0" }}>
      <p style={{ margin: "0 0 var(--space-4) 0" }}>
        <Link href="/items" className="secondary" style={{ minHeight: "34px", fontSize: "0.9rem" }}>
          ← {t("itemDetail.backToCatalog")}
        </Link>
      </p>

      <article className="item-detail" aria-label={`${t("itemDetail.eyebrow")} ${item.name}`}>
        <section className="item-detail-hero">
          <div className="hero-media">
            <PerformanceCardMedia
              className="perf-media-hero"
              imageUrl={resolvedImageUrl(item.image_url)}
              categoryGroup={item.category_group}
              title={item.name}
              variant="hero"
            />
          </div>
          <div className="hero-body">
            <p className="eyebrow" style={{ margin: 0 }}>{t("itemDetail.eyebrow")}</p>
            <h1>{item.name}</h1>
            {item.category_group || item.performance_type ? (
              <p className="meta-line" style={{ margin: 0 }}>
                {[item.category_group, item.performance_type].filter(Boolean).join(" · ")}
              </p>
            ) : null}

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--space-3)",
                flexWrap: "wrap",
              }}
            >
              <span
                style={{
                  fontSize: "0.85rem",
                  padding: "0.2rem 0.6rem",
                  borderRadius: "var(--radius-full)",
                  border: "1px solid var(--gold-300)",
                  background: "var(--gold-50)",
                  color: "var(--gold-700)",
                  fontWeight: 700,
                }}
                title="Display-only match percent"
              >
                {item.suitability_label ?? t("itemDetail.matchLabelDefault")} · {item.match_percent ?? 90}%
              </span>
              {hasLegacy ? (
                <span style={{ fontSize: 13, color: "var(--muted)" }}>
                  <span style={{ color: "var(--gold-500)", letterSpacing: 1 }}>
                    {Array.from({ length: 5 }, (_, i) => (
                      <span key={i}>{i < activeStars ? "★" : "☆"}</span>
                    ))}
                  </span>{" "}
                  {legacyAvg.toFixed(1)}/5 · {legacyCount} {t("itemDetail.timesUnit")}
                </span>
              ) : null}
            </div>

            <p className="item-detail-description">{item.description}</p>

            <div className="item-detail-meta">
              {item.performers_count != null ? (
                <span>👥 {t("itemDetail.performers")} {item.performers_count} {t("items.people")}</span>
              ) : null}
              {item.duration_minutes != null ? (
                <span>⏱ {t("itemDetail.duration")} {item.duration_minutes} {t("items.minutes")}</span>
              ) : null}
              {item.price_text ? <span>฿ {t("itemDetail.cost")} {item.price_text}</span> : null}
            </div>

            {item.contexts.length > 0 ? (
              <div className="item-detail-keywords">
                {item.contexts.slice(0, 6).map((c) => (
                  <Link
                    key={c.id}
                    href={`/items?context=${c.id}`}
                    style={{ textDecoration: "none" }}
                  >
                    {c.name}
                  </Link>
                ))}
              </div>
            ) : null}

            <div className="item-detail-actions">
              <ItemActionBar
                itemId={item.id}
                userKey={userKey}
                userState={item.user_state}
                onChange={handleUserStateChange}
              />
            </div>
          </div>
        </section>

        <div className="item-detail-grid">
          <div className="left">
            {item.keywords.length > 0 ? (
              <section className="item-detail-sidecard">
                <h3>{t("itemDetail.itemKeywordsTitle")}</h3>
                <div className="item-detail-keywords">
                  {item.keywords.map((k) => (
                    <span
                      key={k.id}
                      title={k.taxonomy_path || undefined}
                      style={{
                        padding: "4px 10px",
                        borderRadius: "var(--radius-full)",
                        background: "var(--paper-bg-2)",
                        border: "1px solid var(--line-2)",
                        color: "var(--navy-700)",
                        fontSize: 12,
                        fontWeight: 700,
                      }}
                    >
                      {k.name}
                    </span>
                  ))}
                </div>
              </section>
            ) : null}

            {similar.length > 0 ? (
              <section className="member-section">
                <div className="member-section-head">
                  <h2><span className="glyph" aria-hidden="true">↪</span> {t("itemDetail.similarTitle")}</h2>
                  <Link href="/recommend" className="head-action">{t("itemDetail.customizeRec")} ✚</Link>
                </div>
                <div className="similar-strip">
                  {similar.map((it) => (
                    <CatalogItemCard
                      key={it.id}
                      item={it}
                      userKey={userKey}
                      descriptionLimit={120}
                    />
                  ))}
                </div>
              </section>
            ) : null}
          </div>

          <div className="right">
            <section className="item-detail-sidecard">
              <h3>{t("itemDetail.aboutTitle")}</h3>
              <p>
                {t("itemDetail.category")}: <strong>{item.category_group || t("itemDetail.unspecified")}</strong>
              </p>
              <p>
                {t("itemDetail.type")}: <strong>{item.performance_type || t("itemDetail.unspecified")}</strong>
              </p>
              {item.performers_count != null ? (
                <p>
                  {t("itemDetail.performers")}: <strong>{item.performers_count} {t("items.people")}</strong>
                </p>
              ) : null}
              {item.duration_minutes != null ? (
                <p>
                  {t("itemDetail.duration")}: <strong>{item.duration_minutes} {t("items.minutes")}</strong>
                </p>
              ) : null}
              {item.price_text ? (
                <p>
                  {t("itemDetail.cost")}: <strong>{item.price_text}</strong>
                </p>
              ) : null}
            </section>

            <MemberRatingSummary ratingSummary={ratingSummary} />

            <section className="item-detail-sidecard">
              <h3>{t("itemDetail.findSuitTitle")}</h3>
              <p>
                {t("itemDetail.findSuitDesc")}
              </p>
              <Link
                href="/recommend"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "10px 14px",
                  borderRadius: "var(--radius-md)",
                  background: "var(--gold-500)",
                  color: "var(--navy-900)",
                  textDecoration: "none",
                  fontWeight: 800,
                  justifySelf: "start",
                }}
              >
                {t("itemDetail.seeYourRec")} →
              </Link>
            </section>
          </div>
        </div>
      </article>
    </div>
  );
}

export default function ItemDetailPage() {
  return (
    <Suspense fallback={<LoadingState message="กำลังเตรียมหน้ารายละเอียด..." />}>
      <ItemDetailContent />
    </Suspense>
  );
}
