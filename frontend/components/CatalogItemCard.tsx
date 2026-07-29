"use client";

import React from "react";
import Link from "next/link";

import { ItemActionBar } from "@/components/ItemActionBar";
import type { ItemOut, UserState as UserStateType } from "@/lib/types";

function suitabilityColor(label: string | null | undefined): string {
  if (label === "เหมาะมาก") return "#e8f5e9";
  if (label === "เหมาะสม") return "#e3f2fd";
  return "#f5f5f5";
}

function suitabilityBorder(label: string | null | undefined): string {
  if (label === "เหมาะมาก") return "#43a047";
  if (label === "เหมาะสม") return "#1e88e5";
  return "#9e9e9e";
}

export interface CatalogItemCardProps {
  item: ItemOut;
  userKey: string;
  contextId?: number | null;
  /** Optional 1-based rank to display when in ranked mode. */
  rank?: number;
  /** Compact description length (legacy uses 180 chars on list, 150 on ranked). */
  descriptionLimit?: number;
  /** Called after the user toggles like/save/rating. */
  onUserStateChange?: (itemId: number, next: UserStateType) => void;
}

export function CatalogItemCard({
  item,
  userKey,
  contextId,
  rank,
  descriptionLimit = 180,
  onUserStateChange,
}: CatalogItemCardProps) {
  const description =
    item.description && item.description.length > descriptionLimit
      ? `${item.description.slice(0, descriptionLimit).trimEnd()}…`
      : item.description;

  function handleStateChange(next: UserStateType) {
    if (onUserStateChange) onUserStateChange(item.id, next);
  }

  return (
    <article className="item-card" style={{ display: "flex", flexDirection: "column" }}>
      <div
        className="item-card-media"
        style={item.image_url ? { backgroundImage: `linear-gradient(135deg, rgba(6, 27, 60, 0.12), rgba(197, 145, 59, 0.18)), url("${item.image_url}")` } : undefined}
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
        {item.match_percent != null && item.suitability_label ? (
          <span
            style={{
              fontSize: "0.78rem",
              color: suitabilityBorder(item.suitability_label),
              padding: "0.2rem 0.55rem",
              backgroundColor: suitabilityColor(item.suitability_label),
              borderRadius: "999px",
              border: `1px solid ${suitabilityBorder(item.suitability_label)}`,
              fontWeight: 600,
              flexShrink: 0,
            }}
            title="Display-only match percent — does not affect ranking."
          >
            {item.suitability_label} · {item.match_percent}%
          </span>
        ) : null}
      </header>

      {item.category_group || item.performance_type ? (
        <p className="meta-line" style={{ margin: 0 }}>
          {[item.category_group, item.performance_type].filter(Boolean).join(" · ")}
        </p>
      ) : null}

      {description ? (
        <p className="description" style={{ margin: 0 }}>{description}</p>
      ) : null}

      {item.contexts.length > 0 ? (
        <div className="pill-row">
          {item.contexts.slice(0, 3).map((c) => (
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
