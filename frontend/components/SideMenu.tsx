"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import React from "react";

import { logout } from "@/lib/auth";

const ADMIN_NAV = [
  { href: "/admin", icon: "⌂", label: "หน้าหลัก / สถิติ" },
  { href: "/admin/analytics", icon: "AI", label: "วิเคราะห์ข้อมูล" },
  { href: "/admin/items", icon: "DB", label: "บริหารฐานข้อมูล" },
  { href: "/admin/email-settings", icon: "✉", label: "ตั้งค่าอีเมล OAuth" },
  { href: "/admin/docs", icon: "API", label: "Swagger docs" },
] as const;

/** Navigation reserved for administrators and research operations only. */
export function SideMenu() {
  const pathname = usePathname();
  const router = useRouter();
  return (
    <aside className="side-menu admin-side-menu" aria-label="เมนูเครื่องมือวิจัยสำหรับผู้ดูแลระบบ">
      <Link className="side-brand" href="/admin" aria-label="กลับหน้าหลักผู้ดูแลระบบ">
        <span className="side-brand-mark">TP</span>
        <span className="side-brand-copy">
          <b>ระบบแนะนำ<br />ชุดการแสดง</b>
          <small>ADMIN CONSOLE</small>
        </span>
      </Link>

      <div className="side-menu-title">
        <span>Research tools</span>
        <i aria-hidden="true" />
      </div>
      <nav className="side-menu-links admin-research-links" aria-label="Research tools">
        {ADMIN_NAV.map((item) => (
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

      <div className="admin-side-status" aria-label="สถานะระบบ">
        <span aria-hidden="true" />
        <div>
          <strong>ระบบพร้อมใช้งาน</strong>
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
        <b>ออกจากระบบ</b>
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
