"use client";

import React from "react";
import Link from "next/link";

import { ItemActionBar } from "@/components/ItemActionBar";
import {
  PerformanceCardMedia,
  resolvedImageUrl,
} from "@/components/PerformanceCardMedia";
import { useTranslation } from "@/contexts/LanguageContext";
import { getLocalizedItem } from "@/lib/localization";
import type {
  RecommendationResultOut,
  UserState,
} from "@/lib/types";

export interface ProfileRecommendationCardProps {
  result: RecommendationResultOut;
  userKey: string;
  requestId: string;
  onUserStateChange: (itemId: number, next: UserState) => void;
}

export function ProfileRecommendationCard({
  result,
  userKey,
  requestId,
  onUserStateChange,
}: ProfileRecommendationCardProps) {
  const { locale, t } = useTranslation();
  const localizedItem = getLocalizedItem(result.item, locale);
  const detailHref = requestId
    ? `/items/${result.item.id}?from_request=${encodeURIComponent(requestId)}`
    : `/items/${result.item.id}`;

  return (
    <article className="popular-card profile-recommendation-card">
      <Link
        href={detailHref}
        className="popular-card-media-link"
        aria-label={`${t("recommend.details")} ${localizedItem.displayName}`}
        style={{ display: "block", textDecoration: "none" }}
      >
        <PerformanceCardMedia
          className="popular-card-media"
          imageUrl={resolvedImageUrl(localizedItem.image_url)}
          categoryGroup={localizedItem.displayCategoryGroup}
          title={localizedItem.displayName}
          variant="card"
        />
      </Link>
      <div className="popular-card-body">
        <span className="popular-badge">
          {t("recommend.rankBadge").replace("{rank}", String(result.rank))}
        </span>
        <h3 className="profile-recommendation-title">
          <Link href={detailHref} style={{ color: "inherit", textDecoration: "none" }}>
            {localizedItem.displayName}
          </Link>
        </h3>
        <p className="muted profile-recommendation-reason">
          {result.explanation}
        </p>
        <div className="profile-card-footer">
          <ItemActionBar
            itemId={result.item.id}
            userKey={userKey}
            userState={result.item.user_state}
            onChange={(next) => onUserStateChange(result.item.id, next)}
            requestId={requestId}
          />
          <Link className="secondary profile-detail-link" href={detailHref}>
            {t("recommend.details")}
          </Link>
        </div>
      </div>
    </article>
  );
}
