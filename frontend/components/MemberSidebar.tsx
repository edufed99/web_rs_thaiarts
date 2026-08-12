"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import React, { useEffect, useState } from "react";

import type { UserOut, UserSummaryOut } from "@/lib/types";
import { getReadableUserName } from "@/lib/auth";

interface SidebarLink {
  href: string;
  label: string;
  glyph: string;
}

const LINKS: SidebarLink[] = [
  { href: "/profile", label: "ข้อมูลผู้ใช้", glyph: "⌂" },
  { href: "/profile/favorites", label: "รายการโปรด", glyph: "♥" },
  { href: "/profile/ratings", label: "ประวัติการให้คะแนน", glyph: "★" },
  { href: "/profile/recent", label: "ดูล่าสุด", glyph: "◷" },
  { href: "/recommend#recommend-from-history", label: "แนะนำจากสิ่งที่คุณชอบ", glyph: "✦" },
  { href: "/recommend#discover-new-performances", label: "ค้นหาการแสดงใหม่", glyph: "⌕" },
];

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
  const pathname = usePathname();
  const [currentHash, setCurrentHash] = useState("");
  const name = user ? getReadableUserName(user) : "สมาชิก";
  const initial = (name || "น").trim().charAt(0);
  const isAuthed = Boolean(user);

  useEffect(() => {
    const syncHash = () => setCurrentHash(window.location.hash);
    syncHash();
    window.addEventListener("hashchange", syncHash);
    return () => window.removeEventListener("hashchange", syncHash);
  }, [pathname]);

  return (
    <aside className="member-sidebar" aria-label="ข้อมูลสมาชิกและเมนู">
      <section className="member-profile-card">
        <div className="member-profile-head">
          <div className="member-avatar" aria-hidden="true">{initial}</div>
          <div>
            <p className="member-profile-name">{name}</p>
            <p className="member-profile-meta">
              {isAuthed ? "สมาชิกที่ลงทะเบียน" : "ผู้เยี่ยมชม (ยังไม่ได้เข้าสู่ระบบ)"}
            </p>
          </div>
        </div>
      </section>

      <nav className="member-side-nav" aria-label="เมนูกิจกรรม">
        {LINKS.map((link) => {
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

          <section className="member-interest" aria-label="ความสนใจของฉัน">
            <h3>ความสนใจของฉัน</h3>
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
                  เปิดดู {summary.recent_view_count} รายการในช่วง 30 วันที่ผ่านมา
                </p>
              </div>
            ) : (
              <p className="member-interest-empty">
                ยังไม่มีข้อมูลความสนใจ เริ่มกดถูกใจ/บันทึก/ให้คะแนนรายการที่ชอบ
                เพื่อให้ระบบเรียนรู้รสนิยมของคุณ
              </p>
            )}
            <p className="member-side-divider" />
            <Link
              href="/recommend"
              className="member-side-cta"
              style={{ textDecoration: "none" }}
            >
              <strong>ดูแนะนำเฉพาะคุณ →</strong>
              <span>ระบบจะจัดอันดับจากประวัติและความสนใจของคุณ</span>
            </Link>
          </section>
        </>
      ) : null}
    </aside>
  );
}
