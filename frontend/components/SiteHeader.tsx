"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import React, { useEffect, useState } from "react";

import {
  AUTH_CHANGED_EVENT,
  STORAGE_KEY,
  getCurrentUser,
  getReadableUserName,
  isAdmin,
  logout,
} from "@/lib/auth";
import type { UserOut } from "@/lib/types";

interface NavItem {
  href: string;
  label: string;
  /** If set, item is only shown to admins. */
  adminOnly?: boolean;
  /** If set, item is only shown after login. */
  authOnly?: boolean;
  /** If set, item is hidden from administrators. */
  memberOnly?: boolean;
}

const PRIMARY_NAV: NavItem[] = [
  { href: "/", label: "หน้าแรก" },
  { href: "/items", label: "ค้นหาชุดการแสดง" },
  { href: "/categories", label: "หมวดหมู่" },
  { href: "/about", label: "เกี่ยวกับเรา" },
  { href: "/profile", label: "ข้อมูลผู้ใช้", authOnly: true, memberOnly: true },
];

/**
 * Top navigation used by every public page.
 *
 * Mirrors the mockup homepage header: brand on the left, primary nav in
 * the centre, login/signup on the right (or user chip when authenticated).
 * The hamburger button on mobile collapses the same items into a drawer.
 */
export function SiteHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<UserOut | null | undefined>(undefined);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    function refresh() {
      setUser(getCurrentUser());
    }
    refresh();
    function onStorage(e: StorageEvent) {
      if (e.key === STORAGE_KEY) refresh();
    }
    window.addEventListener(AUTH_CHANGED_EVENT, refresh);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(AUTH_CHANGED_EVENT, refresh);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  // Close the drawer whenever the route changes — otherwise users on mobile
  // get a drawer that sticks open after tapping a link.
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  const admin = Boolean(user?.is_admin) || isAdmin();
  const readable = user ? getReadableUserName(user) : "";
  const homeHref = admin ? "/admin" : "/";

  return (
    <header className="site-header" role="banner">
      <div className="site-header-inner">
        <Link href={homeHref} className="site-brand" aria-label="หน้าแรก Thai Performing Arts Recommendation System">
          <span className="site-brand-logo-frame" aria-hidden="true">
            <span className="site-brand-logo-copy">
              Thai Performing Arts
              <span>Recommendation System</span>
            </span>
          </span>
        </Link>

        <nav className="site-nav" aria-label="เมนูหลัก">
          {PRIMARY_NAV.map((item) => {
            const visible =
              (!item.adminOnly || admin) &&
              (!item.authOnly || Boolean(user)) &&
              (!item.memberOnly || !admin);
            if (!visible) return null;
            const effectiveHref = item.href === "/" ? homeHref : item.href;
            const active =
              item.href === "/"
                ? pathname === effectiveHref
                : pathname.startsWith(item.href.split("?")[0]);
            return (
              <Link
                key={item.href}
                href={effectiveHref}
                className={active ? "site-nav-link active" : "site-nav-link"}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="site-actions">
          {user === undefined ? null : user ? (
            <>
              <Link
                href={admin ? "/admin" : "/profile"}
                className="site-user-chip site-user-chip-link"
                title={user.is_admin ? "ไปยังข้อมูลผู้ดูแลระบบ" : "ไปยังข้อมูลผู้ใช้"}
                aria-label={`เปิดข้อมูลผู้ใช้ ${readable}`}
              >
                {user.is_admin ? "Admin · " : ""}
                {readable}
              </Link>
              <button
                type="button"
                className="site-button ghost"
                onClick={() => {
                  logout();
                  setUser(null);
                  router.replace("/login");
                  router.refresh();
                }}
              >
                ออกจากระบบ
              </button>
            </>
          ) : (
            <>
              <Link href="/login" className="site-button ghost">เข้าสู่ระบบ</Link>
              <Link href="/signup" className="site-button primary">สมัครสมาชิก</Link>
            </>
          )}
          <button
            type="button"
            className="site-hamburger"
            aria-expanded={drawerOpen}
            aria-label="เปิดเมนู"
            onClick={() => setDrawerOpen((v) => !v)}
          >
            <span aria-hidden="true">{drawerOpen ? "×" : "≡"}</span>
          </button>
        </div>
      </div>

      {drawerOpen ? (
        <div className="site-drawer" role="dialog" aria-label="เมนูมือถือ">
          {PRIMARY_NAV.map((item) => {
            const visible =
              (!item.adminOnly || admin) &&
              (!item.authOnly || Boolean(user)) &&
              (!item.memberOnly || !admin);
            if (!visible) return null;
            const effectiveHref = item.href === "/" ? homeHref : item.href;
            return (
              <Link key={item.href} href={effectiveHref} className="site-drawer-link">
                {item.label}
              </Link>
            );
          })}
          {!user ? (
            <div className="site-drawer-actions">
              <Link href="/login" className="site-button ghost block">เข้าสู่ระบบ</Link>
              <Link href="/signup" className="site-button primary block">สมัครสมาชิก</Link>
            </div>
          ) : null}
        </div>
      ) : null}
    </header>
  );
}
