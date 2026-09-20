"use client";

import React from "react";

import { useTranslation } from "@/contexts/LanguageContext";
import type { ContextOut } from "@/lib/types";

interface MemberHeroProps {
  /** Page-level heading shown above the content area. */
  title: string;
  /** One-line subtitle under the heading. */
  subtitle?: string;
  /** Quick context chips — selecting one navigates with ``?context=``. */
  contexts?: ContextOut[];
  /** Currently selected context id (for chip "active" state). */
  activeContextId?: number | null;
}

/**
 * Navy hero strip rendered at the top of member_user pages (catalog,
 * profile). Shows the page title + a subtitle + a row of quick-pick
 * context chips. Selecting a chip pushes a query-param that the page
 * reads on its next render so we don't need to plumb new props.
 */
export function MemberHero({
  title,
  subtitle,
  contexts,
  activeContextId,
}: MemberHeroProps) {
  const { locale } = useTranslation();
  const chips = (contexts ?? []).slice(0, 6);
  return (
    <section className="member-hero" aria-label={title}>
      <div>
        <h1>{title}</h1>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      {chips.length > 0 ? (
        <div className="hero-chips" aria-label={locale === "en" ? "Quick context filters" : "ตัวกรองบริบทด่วน"}>
          {chips.map((ctx) => {
            const active = activeContextId === ctx.id;
            const displayName = locale === "en" && ctx.name_en ? ctx.name_en : ctx.name;
            return (
              <a
                key={ctx.id}
                href={
                  typeof window !== "undefined"
                    ? updateQuery({ context: active ? null : ctx.id })
                    : `?context=${ctx.id}`
                }
                className={active ? "hero-chip active" : "hero-chip"}
              >
                <span aria-hidden="true">●</span>
                {displayName}
              </a>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

function updateQuery(patch: Record<string, string | number | null>) {
  if (typeof window === "undefined") return "";
  const url = new URL(window.location.href);
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === "") {
      url.searchParams.delete(k);
    } else {
      url.searchParams.set(k, String(v));
    }
  }
  return url.pathname + (url.search ? url.search : "");
}