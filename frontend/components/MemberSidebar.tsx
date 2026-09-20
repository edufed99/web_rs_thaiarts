"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import React, { useEffect, useState } from "react";

import type { UserOut, UserSummaryOut } from "@/lib/types";
import { getReadableUserName } from "@/lib/auth";
import { useTranslation } from "@/contexts/LanguageContext";

interface SidebarLink {
  href: string;
  label: string;
  glyph: string;
}

/**
 * Left sidebar for the member_user mockup pages (catalog, profile).
 *
 * Renders the profile card, the activity nav, and the live "ความสนใจของฉัน"
 * interest bar block pulled from ``GET /me/summary``. Falls back to a
 * neutral placeholders when DB is disabled or the user has no activity.
 */
export function MemberSidebar({
  user,
  summary,
  showInterestCard = true,
}: {
  user: UserOut | null;
  summary: UserSummaryOut | null;
  showInterestCard?: boolean;
}) {
  const { locale, t } = useTranslation();
  const pathname = usePathname();
  const [currentHash, setCurrentHash] = useState("");
  const name = user ? getReadableUserName(user, locale) : (locale === "en" ? "Member" : "สมาชิก");
  const initial = (name || (locale === "en" ? "M" : "น")).trim().charAt(0);
  const isAuthed = Boolean(user);

  const links: SidebarLink[] = [
    { href: "/profile", label: t("memberSidebar.userProfile"), glyph: "⌂" },
    { href: "/profile/favorites", label: t("memberSidebar.favorites"), glyph: "♥" },
    { href: "/profile/ratings", label: t("memberSidebar.ratings"), glyph: "★" },
    { href: "/profile/recent", label: t("memberSidebar.recent"), glyph: "◷" },
    { href: "/recommend#recommend-from-history", label: t("memberSidebar.recommendedFromHistory"), glyph: "✦" },
    { href: "/recommend#discover-new-performances", label: t("memberSidebar.discoverNew"), glyph: "⌕" },
  ];

  useEffect(() => {
    const syncHash = () => setCurrentHash(window.location.hash);
    syncHash();
    window.addEventListener("hashchange", syncHash);
    return () => window.removeEventListener("hashchange", syncHash);
  }, [pathname]);

  return (
    <aside className="member-sidebar" aria-label={t("nav.profile")}>
      <section className="member-profile-card">
        <div className="member-profile-head">
          <div className="member-avatar" aria-hidden="true">{initial}</div>
          <div>
            <p className="member-profile-name">{name}</p>
            <p className="member-profile-meta">
              {isAuthed
                ? user?.is_admin
                  ? t("memberSidebar.adminMember")
                  : t("memberSidebar.registeredMember")
                : t("memberSidebar.guestMember")}
            </p>
          </div>
        </div>
        {user?.is_admin ? (
          <div style={{ marginTop: "var(--space-2, 0.5rem)", paddingTop: "var(--space-2, 0.5rem)", borderTop: "1px solid var(--line-1, rgba(0,0,0,0.08))" }}>
            <Link
              href="/admin"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "6px",
                padding: "6px 12px",
                background: "var(--navy-900, #102044)",
                color: "#fff",
                borderRadius: "var(--radius-md, 6px)",
                fontSize: "13px",
                fontWeight: 600,
                textDecoration: "none",
                textAlign: "center",
              }}
            >
              {t("memberSidebar.backToAdmin")}
            </Link>
          </div>
        ) : null}
      </section>

      <nav className="member-side-nav" aria-label={t("nav.menu")}>
        {links.map((link) => {
          const [linkPath, linkHash] = link.href.split("#");
          const isDefaultRecommendLink = linkHash === "recommend-from-history" && !currentHash;
          const isActive = linkHash
            ? linkPath === pathname && (currentHash === `#${linkHash}` || isDefaultRecommendLink)
            : link.href === pathname ||
              (link.href === "/profile" && pathname === "/profile/edit");
          return (
            <Link
              key={link.href}
              href={link.href}
              className={isActive ? "active" : undefined}
              onClick={(event) => {
                if (!linkHash || linkPath !== pathname) return;
                event.preventDefault();
                window.location.hash = linkHash;
                window.dispatchEvent(new HashChangeEvent("hashchange"));
              }}
            >
              <span className="glyph" aria-hidden="true">{link.glyph}</span>
              {link.label}
            </Link>
          );
        })}
      </nav>

      {showInterestCard ? (
        <>
          <div className="member-side-divider" />

          <section className="member-interest" aria-label={t("memberSidebar.myInterests")}>
            <h3>{t("memberSidebar.myInterests")}</h3>
            {summary && summary.interests.length > 0 ? (
              <div>
                {summary.interests.map((bucket) => (
                  <div
                    key={bucket.name}
                    className={bucket.is_top ? "member-interest-row is-top" : "member-interest-row"}
                  >
                    <strong>{bucket.name}</strong>
                    <span className="member-interest-pct">{bucket.percent}%</span>
                    <div className="member-interest-bar" aria-hidden="true">
                      <span style={{ width: `${bucket.percent}%` }} />
                    </div>
                  </div>
                ))}
                <p
                  className="member-profile-meta"
                  style={{ marginTop: "var(--space-2)", textAlign: "right" }}
                >
                  {t("memberSidebar.viewCount").replace("{count}", String(summary.recent_view_count))}
                </p>
              </div>
            ) : (
              <p className="member-interest-empty">
                {t("memberSidebar.noInterests")}
              </p>
            )}
            <p className="member-side-divider" />
            <Link
              href="/recommend"
              className="member-side-cta"
              style={{ textDecoration: "none" }}
            >
              <strong>{t("memberSidebar.viewPersonalizedRec")}</strong>
              <span>{t("memberSidebar.personalizedRecSub")}</span>
            </Link>
          </section>
        </>
      ) : null}
    </aside>
  );
}
