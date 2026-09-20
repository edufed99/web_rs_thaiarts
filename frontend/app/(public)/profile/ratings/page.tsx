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
import { getMeRated } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";
import { loadMemberItems } from "@/lib/memberItems";
import type { ItemOut, RatedItemOut, UserState } from "@/lib/types";
import { useAuthHeaders } from "@/lib/useAuthHeaders";
import { getUserKey } from "@/lib/user";
import { useCardPagination } from "@/lib/useCardPagination";

export default function RatingsPage() {
  const router = useRouter();
  const { t, locale } = useTranslation();
  const authHeaders = useAuthHeaders();
  const [userKey, setUserKey] = useState("");
  const [ratings, setRatings] = useState<RatedItemOut[] | null>(null);
  const [items, setItems] = useState<ItemOut[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!getCurrentUser()) {
      router.replace("/login?next=/profile/ratings");
      return;
    }
    const key = getUserKey();
    setUserKey(key);
    let cancelled = false;
    getMeRated(key, authHeaders)
      .then(async (data) => {
        const loaded = await loadMemberItems(data.items.map((entry) => entry.item_id), key, authHeaders);
        if (!cancelled) {
          setRatings(data.items);
          setItems(loaded);
        }
      })
      .catch((reason: unknown) => !cancelled && setError(reason instanceof Error ? reason.message : String(reason)));
    return () => { cancelled = true; };
  }, [router, authHeaders]);

  const ratingByItem = useMemo(() => new Map((ratings ?? []).map((entry) => [entry.item_id, entry])), [ratings]);
  const ratedItems = useMemo(() => items ?? [], [items]);
  const { page, setPage, pageItems } = useCardPagination(ratedItems);
  function onStateChange(itemId: number, next: UserState) {
    setItems((current) => current?.map((item) => item.id === itemId ? { ...item, user_state: next } : item) ?? current);
    setRatings((current) => current?.map((entry) => entry.item_id === itemId
      ? { ...entry, rating: next.rating, updated_at: new Date().toISOString() }
      : entry) ?? current);
  }

  if (error) return <ErrorState message={error} onRetry={() => window.location.reload()} />;
  if (!items || !ratings) return <LoadingState message={t("ratings.loading")} />;
  return (
    <div className="section-stack">
      <MemberHero title={t("ratings.title")} subtitle={t("ratings.subtitle")} />
      {!items.length ? (
        <EmptyState title={t("ratings.emptyTitle")} message={t("ratings.emptyMessage")} />
      ) : (
        <>
          <div id="rated-card-results" className="profile-compact-grid">
            {pageItems.map((item) => {
              const entry = ratingByItem.get(item.id);
              const ratingValue = entry?.rating ?? item.user_state.rating;
              return (
                <div key={item.id} className="profile-compact-entry">
                  <p className="profile-card-status">
                    {t("ratings.currentRating").replace("{rating}", String(ratingValue))} · {t("ratings.lastEdited").replace("{date}", formatDate(entry?.updated_at, locale))}
                  </p>
                  <CatalogItemCard
                    item={item}
                    userKey={userKey}
                    variant="compact"
                    onUserStateChange={onStateChange}
                  />
                </div>
              );
            })}
          </div>
          <CardPagination
            currentPage={page}
            totalItems={ratedItems.length}
            onPageChange={setPage}
            scrollTargetId="rated-card-results"
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
