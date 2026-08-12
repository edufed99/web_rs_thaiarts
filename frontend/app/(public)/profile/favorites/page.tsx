"use client";

import { useRouter } from "next/navigation";
import React, { useEffect, useMemo, useState } from "react";

import { CardPagination } from "@/components/CardPagination";
import { CatalogItemCard } from "@/components/CatalogItemCard";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { LoadingState } from "@/components/LoadingState";
import { MemberHero } from "@/components/MemberHero";
import { getMeLiked, getMeSaved } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";
import { loadMemberItems } from "@/lib/memberItems";
import type { ItemOut, UserState } from "@/lib/types";
import { useAuthHeaders } from "@/lib/useAuthHeaders";
import { getUserKey } from "@/lib/user";
import { useCardPagination } from "@/lib/useCardPagination";

export default function FavoritesPage() {
  const router = useRouter();
  const authHeaders = useAuthHeaders();
  const [userKey, setUserKey] = useState("");
  const [items, setItems] = useState<ItemOut[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!getCurrentUser()) {
      router.replace("/login?next=/profile/favorites");
      return;
    }
    const key = getUserKey();
    setUserKey(key);
    let cancelled = false;
    Promise.all([getMeLiked(key, authHeaders), getMeSaved(key, authHeaders)])
      .then(([liked, saved]) => loadMemberItems([...liked.items, ...saved.items], key, authHeaders))
      .then((loaded) => {
        if (!cancelled) setItems(loaded.filter((item) => item.user_state.liked || item.user_state.saved));
      })
      .catch((reason: unknown) => !cancelled && setError(reason instanceof Error ? reason.message : String(reason)));
    return () => { cancelled = true; };
  }, [router, authHeaders]);

  function onStateChange(itemId: number, next: UserState) {
    setItems((current) => current
      ? current.flatMap((item) => item.id !== itemId
        ? [item]
        : next.liked || next.saved ? [{ ...item, user_state: next }] : [])
      : current);
  }

  const favoriteItems = useMemo(() => items ?? [], [items]);
  const { page, setPage, pageItems } = useCardPagination(favoriteItems);

  if (error) return <ErrorState message={error} onRetry={() => window.location.reload()} />;
  if (!items) return <LoadingState message="กำลังโหลดรายการโปรด..." />;
  return (
    <div className="section-stack">
      <MemberHero title="รายการโปรด" subtitle="รวมชุดการแสดงที่คุณกดถูกใจหรือบันทึกไว้" />
      {!items.length ? (
        <EmptyState title="ยังไม่มีรายการโปรด" message="กดถูกใจหรือบันทึกชุดการแสดง แล้วรายการจะปรากฏที่นี่" />
      ) : (
        <>
          <div id="favorite-card-results" className="profile-compact-grid">
            {pageItems.map((item) => (
              <div key={item.id} className="profile-compact-entry">
                <div className="profile-card-status" aria-label="สถานะรายการ">
                  {item.user_state.liked ? <span className="context-pill">♥ ถูกใจ</span> : null}
                  {item.user_state.saved ? <span className="context-pill">⚑ บันทึกไว้</span> : null}
                </div>
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
            totalItems={favoriteItems.length}
            onPageChange={setPage}
            scrollTargetId="favorite-card-results"
          />
        </>
      )}
    </div>
  );
}
