"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import React from "react";

import { useTranslation } from "@/contexts/LanguageContext";
import { logout } from "@/lib/auth";

/** Navigation reserved for administrators and research operations only. */
export function SideMenu() {
  const { t } = useTranslation();
  const pathname = usePathname();
  const router = useRouter();

  const adminNav = [
    { href: "/admin", icon: "⌂", label: t("admin.dashboard") },
    { href: "/admin/analytics", icon: "AI", label: t("admin.analytics") },
    { href: "/admin/items", icon: "DB", label: t("admin.itemManagement") },
    { href: "/admin/email-settings", icon: "✉", label: t("admin.emailSettings") },
  ];

  return (
    <aside className="side-menu admin-side-menu" aria-label={t("admin.title")}>
      <Link className="side-brand" href="/admin" aria-label={t("admin.title")}>
        <span className="side-brand-mark">TP</span>
        <span className="side-brand-copy">
          <b>{t("nav.brandSideMenu")}</b>
          <small>ADMIN CONSOLE</small>
        </span>
      </Link>

      <div className="side-menu-title">
        <span>{t("admin.researchTools")}</span>
        <i aria-hidden="true" />
      </div>
      <nav className="side-menu-links admin-research-links" aria-label={t("admin.researchTools")}>
        {adminNav.map((item) => (
          <SideNavLink
            key={item.href}
            href={item.href}
            icon={item.icon}
            label={item.label}
            active={
              item.href === "/admin"
                ? pathname === "/admin" || pathname === "/dashboard"
                : pathname.startsWith(item.href)
            }
          />
        ))}
      </nav>

      <div className="side-menu-title" style={{ marginTop: "0.5rem" }}>
        <span>{t("admin.publicPages")}</span>
        <i aria-hidden="true" />
      </div>
      <nav className="side-menu-links admin-research-links" aria-label={t("admin.publicPages")}>
        <SideNavLink
          href="/"
          icon="🌐"
          label={t("admin.publicPages")}
          active={false}
        />
        <SideNavLink
          href="/profile"
          icon="👤"
          label={t("admin.myProfile")}
          active={pathname.startsWith("/profile")}
        />
      </nav>

      <div className="admin-side-status" aria-label={t("admin.systemReady")}>
        <span aria-hidden="true" />
        <div>
          <strong>{t("admin.systemReady")}</strong>
          <small>Admin workspace</small>
        </div>
      </div>

      <div className="side-menu-divider" />
      <button
        type="button"
        className="side-logout"
        onClick={() => {
          logout();
          router.replace("/login");
          router.refresh();
        }}
      >
        <span>↪</span>
        <b>{t("nav.logout")}</b>
      </button>
    </aside>
  );
}

function SideNavLink({
  href,
  icon,
  label,
  active,
}: {
  href: string;
  icon: string;
  label: string;
  active: boolean;
}) {
  return (
    <Link href={href} className={active ? "active" : undefined} aria-current={active ? "page" : undefined}>
      <span>{icon}</span>
      <b>{label}</b>
      <em aria-hidden="true">›</em>
    </Link>
  );
}
