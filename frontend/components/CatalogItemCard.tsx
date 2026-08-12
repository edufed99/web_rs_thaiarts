"use client";

import React from "react";
import Link from "next/link";

import { ItemActionBar } from "@/components/ItemActionBar";
import { PerformanceCardMedia, resolvedImageUrl } from "@/components/PerformanceCardMedia";
import type { ItemOut, UserState as UserStateType } from "@/lib/types";

export interface CatalogItemCardProps {
  item: ItemOut;
  userKey: string;
  contextId?: number | null;
  /** Optional 1-based rank to display when in ranked mode. */
  rank?: number;
  /** Compact description length (legacy uses 180 chars on list, 150 on ranked). */
  descriptionLimit?: number;
  /** Compact horizontal presentation for member activity pages. */
  variant?: "standard" | "compact";
  /** Called after the user toggles like/save/rating. */
  onUserStateChange?: (itemId: number, next: UserStateType) => void;
}

export function CatalogItemCard({
  item,
  userKey,
  contextId,
  rank,
  descriptionLimit,
  variant = "standard",
  onUserStateChange,
}: CatalogItemCardProps) {
  const compact = variant === "compact";
  const effectiveDescriptionLimit = descriptionLimit ?? (compact ? 110 : 180);
  const description =
    item.description && item.description.length > effectiveDescriptionLimit
      ? `${item.description.slice(0, effectiveDescriptionLimit).trimEnd()}…`
      : item.description;
  const visibleContexts =
    contextId != null
      ? item.contexts.filter((context) => context.id === contextId)
      : item.contexts.slice(0, compact ? 2 : 3);

  function handleStateChange(next: UserStateType) {
    if (onUserStateChange) onUserStateChange(item.id, next);
  }

  return (
    <article
      className={compact ? "item-card item-card--compact" : "item-card"}
      style={compact ? undefined : { display: "flex", flexDirection: "column" }}
    >
      <PerformanceCardMedia
        className="item-card-media"
        imageUrl={resolvedImageUrl(item.image_url)}
        categoryGroup={item.category_group}
        title={item.name}
        variant="card"
      />
      <div className="item-card-body" style={{ display: "grid", gap: "0.55rem", flex: 1 }}>
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: "0.5rem",
        }}
      >
        <h3 style={{ fontSize: "1.05rem" }}>
          {rank ? `#${rank} ` : null}
          <Link href={`/items/${item.id}`}>{item.name}</Link>
        </h3>
      </header>

      {item.category_group || item.performance_type ? (
        <p className="meta-line" style={{ margin: 0 }}>
          {[item.category_group, item.performance_type].filter(Boolean).join(" · ")}
        </p>
      ) : null}

      {description ? (
        <p className="description" style={{ margin: 0 }}>{description}</p>
      ) : null}

      {visibleContexts.length > 0 ? (
        <div className="pill-row">
          {visibleContexts.map((c) => (
            <span key={c.id} className="context-pill">
              {c.name}
            </span>
          ))}
        </div>
      ) : null}

      <ItemActionBar
        itemId={item.id}
        userKey={userKey}
        userState={item.user_state}
        onChange={handleStateChange}
        contextId={contextId ?? null}
      />
      </div>
    </article>
  );
}
