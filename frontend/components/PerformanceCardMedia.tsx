"use client";

import React from "react";

import { resolveImageUrl } from "@/lib/api";

type Variant = "card" | "hero";

interface Props {
  /** Already-resolved absolute URL from ``resolveImageUrl``. Falsy -> placeholder. */
  imageUrl: string | null;
  /** Used to pick a colour ramp when rendering the placeholder. */
  categoryGroup?: string | null;
  /** Display name — embedded in the placeholder so each card is distinguishable. */
  title: string;
  /** ``card`` is square-ish for grids; ``hero`` is wide. */
  variant?: Variant;
  /** Optional className passthrough for layout sizing. */
  className?: string;
}

/**
 * Renders a card's image area. When a real image is present we show it with
 * a tasteful gradient overlay; when it isn't (still the common case — only
 * 2 of 116 items have a cover today) we render a category-aware gradient
 * placeholder so the grid never looks broken.
 *
 * Centralising this here means the "real image or pretty fallback" decision
 * lives in exactly one place — every card (Catalog / Popular / Recommendation /
 * Detail) calls into it instead of repeating the logic.
 */
export function PerformanceCardMedia({
  imageUrl,
  categoryGroup,
  title,
  variant = "card",
  className,
}: Props) {
  const aspect = variant === "hero" ? "16 / 9" : "4 / 3";
  const palette = paletteFor(categoryGroup);

  if (imageUrl) {
    return (
      <div
        className={className ?? "perf-media perf-media-image"}
        style={{
          aspectRatio: aspect,
          backgroundImage: `linear-gradient(135deg, rgba(6, 27, 60, 0.12), rgba(197, 145, 59, 0.18)), url("${imageUrl}")`,
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
        role="img"
        aria-label={title}
      />
    );
  }

  return (
    <div
      className={className ?? "perf-media perf-media-placeholder"}
      style={{
        aspectRatio: aspect,
        background: palette.gradient,
        color: palette.ink,
        position: "relative",
        overflow: "hidden",
      }}
      role="img"
      aria-label={`placeholder สำหรับ ${title}`}
    >
      {/* Thai-inspired motif: two stacked diamond glyphs + a subtle grid.
          Pure CSS so we don't ship a single bitmap asset. */}
      <svg
        viewBox="0 0 200 150"
        preserveAspectRatio="xMidYMid slice"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0.18 }}
        aria-hidden="true"
      >
        <defs>
          <pattern id="perf-grid" width="20" height="20" patternUnits="userSpaceOnUse">
            <path d="M10 0 L20 10 L10 20 L0 10 Z" fill="none" stroke={palette.ink} strokeWidth="0.6" />
          </pattern>
        </defs>
        <rect width="200" height="150" fill="url(#perf-grid)" />
        <text
          x="50%"
          y="48%"
          textAnchor="middle"
          fontSize="48"
          fontWeight="800"
          fill={palette.ink}
          opacity="0.55"
        >✦</text>
      </svg>
      <span
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          padding: "10px 14px",
          fontSize: 13,
          fontWeight: 700,
          letterSpacing: "0.02em",
          color: palette.ink,
          textShadow: "0 1px 2px rgba(0,0,0,0.18)",
        }}
      >
        {categoryGroup || title}
      </span>
    </div>
  );
}

interface Palette {
  gradient: string;
  ink: string;
}

/**
 * Map the eight category groups we ship with to a colour ramp. Each ramp
 * uses two stops so the gradient is visible even on the smallest card.
 * Unknown categories fall back to a neutral navy.
 */
function paletteFor(categoryGroup?: string | null): Palette {
  const norm = (categoryGroup ?? "").trim();
  if (norm.includes("โขน") || norm.includes("ละคร")) {
    return {
      gradient: "linear-gradient(135deg, #0b2a55 0%, #31489f 100%)",
      ink: "#f7ebcf",
    };
  }
  if (norm.includes("ระบำ") || norm.includes("รำ") || norm.includes("ฟ้อน")) {
    return {
      gradient: "linear-gradient(135deg, #c5913b 0%, #e7c36a 100%)",
      ink: "#2a1d05",
    };
  }
  if (norm.includes("ภาคกลาง")) {
    return {
      gradient: "linear-gradient(135deg, #1f7a4d 0%, #315c59 100%)",
      ink: "#f7f1e6",
    };
  }
  if (norm.includes("ภาคเหนือ")) {
    return {
      gradient: "linear-gradient(135deg, #5b35d5 0%, #23386b 100%)",
      ink: "#f0d896",
    };
  }
  if (norm.includes("ภาคอีสาน") || norm.includes("อีสาน")) {
    return {
      gradient: "linear-gradient(135deg, #7b2530 0%, #c5913b 100%)",
      ink: "#f7ebcf",
    };
  }
  if (norm.includes("ภาคใต้")) {
    return {
      gradient: "linear-gradient(135deg, #c89536 0%, #1f7a4d 100%)",
      ink: "#1f1505",
    };
  }
  if (norm.includes("อนุรักษ์")) {
    return {
      gradient: "linear-gradient(135deg, #061b3c 0%, #152344 100%)",
      ink: "#e7c36a",
    };
  }
  if (norm.includes("โบราณคดี") || norm.includes("ฉุยฉาย")) {
    return {
      gradient: "linear-gradient(135deg, #8a5b17 0%, #0b2a55 100%)",
      ink: "#f0d896",
    };
  }
  // Unknown / missing — neutral navy that still matches the brand.
  return {
    gradient: "linear-gradient(135deg, #0b2a55 0%, #061b3c 100%)",
    ink: "#e7c36a",
  };
}

/** Convenience helper so callers can do one import. */
export function resolvedImageUrl(path: string | null | undefined): string | null {
  return resolveImageUrl(path);
}