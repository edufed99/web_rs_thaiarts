"use client";

import { useRouter } from "next/navigation";
import React, { useEffect, useMemo, useState } from "react";

import { CardPagination } from "@/components/CardPagination";
import { CatalogItemCard } from "@/components/CatalogItemCard";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { LoadingState } from "@/components/LoadingState";
import { MemberHero } from "@/components/MemberHero";
import { useTranslation } from "@/contexts/LanguageContext";
import { getMeRecentViews } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";
import { loadMemberItems } from "@/lib/memberItems";
import type { ItemOut, RecentViewOut, UserState } from "@/lib/types";
import { useAuthHeaders } from "@/lib/useAuthHeaders";
import { getUserKey } from "@/lib/user";
import { useCardPagination } from "@/lib/useCardPagination";

export default function RecentViewsPage() {
  const router = useRouter();
  const { t, locale } = useTranslation();
  const authHeaders = useAuthHeaders();
  const [userKey, setUserKey] = useState("");
  const [views, setViews] = useState<RecentViewOut[] | null>(null);
  const [items, setItems] = useState<ItemOut[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!getCurrentUser()) {
      router.replace("/login?next=/profile/recent");
      return;
    }
    const key = getUserKey();
    setUserKey(key);
    let cancelled = false;
    getMeRecentViews(key, 30, 50, authHeaders)
      .then(async (data) => {
        const loaded = await loadMemberItems(data.items.map((entry) => entry.item_id), key, authHeaders);
        if (!cancelled) {
          setViews(data.items);
          setItems(loaded);
        }
      })
      .catch((reason: unknown) => !cancelled && setError(reason instanceof Error ? reason.message : String(reason)));
    return () => { cancelled = true; };
  }, [router, authHeaders]);

  const viewByItem = useMemo(() => new Map((views ?? []).map((entry) => [entry.item_id, entry])), [views]);
  const recentItems = useMemo(() => items ?? [], [items]);
  const { page, setPage, pageItems } = useCardPagination(recentItems);
  function onStateChange(itemId: number, next: UserState) {
    setItems((current) => current?.map((item) => item.id === itemId ? { ...item, user_state: next } : item) ?? current);
  }

  if (error) return <ErrorState message={error} onRetry={() => window.location.reload()} />;
  if (!items || !views) return <LoadingState message={t("recent.loading")} />;
  return (
    <div className="section-stack">
      <MemberHero title={t("recent.title")} subtitle={t("recent.subtitle")} />
      {!items.length ? (
        <EmptyState title={t("recent.emptyTitle")} message={t("recent.emptyMessage")} />
      ) : (
        <>
          <div id="recent-card-results" className="profile-compact-grid">
            {pageItems.map((item) => (
              <div key={item.id} className="profile-compact-entry">
                <p className="profile-card-status">
                  {t("recent.lastViewed").replace("{date}", formatDate(viewByItem.get(item.id)?.viewed_at, locale))}
                </p>
                <CatalogItemCard
                  item={item}
                  userKey={userKey}
                  variant="compact"
                  onUserStateChange={onStateChange}
                />
              </div>
            ))}
          </div>
          <CardPagination
            currentPage={page}
            totalItems={recentItems.length}
            onPageChange={setPage}
            scrollTargetId="recent-card-results"
          />
        </>
      )}
    </div>
  );
}

function formatDate(value?: string, locale: string = "th"): string {
  if (!value) return "—";
  try {
    return new Intl.DateTimeFormat(locale === "en" ? "en-US" : "th-TH", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  } catch {
    return value;
  }
}
