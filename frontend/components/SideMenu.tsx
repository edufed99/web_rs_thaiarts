"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import React, { useEffect, useState } from "react";

import {
  AUTH_CHANGED_EVENT,
  getCurrentUser,
  isAdmin,
  logout,
  STORAGE_KEY,
} from "@/lib/auth";
import type { UserOut } from "@/lib/types";

export function SideMenu() {
  const pathname = usePathname();
  const [user, setUser] = useState<UserOut | null>(null);
  const [admin, setAdmin] = useState(false);

  useEffect(() => {
    const syncAuth = () => {
      const currentUser = getCurrentUser();
      setUser(currentUser);
      setAdmin(Boolean(currentUser?.is_admin) || isAdmin());
    };
    syncAuth();

    function onStorage(e: StorageEvent) {
      if (e.key === STORAGE_KEY) syncAuth();
    }

    window.addEventListener("storage", onStorage);
    window.addEventListener(AUTH_CHANGED_EVENT, syncAuth);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(AUTH_CHANGED_EVENT, syncAuth);
    };
  }, []);

  const recommendHref = user ? "/recommend" : "/login?next=/recommend";
  const savedHref = user ? "/profile#saved" : "/login?next=/profile";
  const historyHref = user ? "/profile#history" : "/login?next=/profile";
  const profileHref = user ? "/profile" : "/login?next=/profile";
  const settingsHref = user ? "/profile#settings" : "/login?next=/profile";

  return (
    <aside className="side-menu" aria-label="เมนูหลักของระบบ">
      <Link className="side-brand" href="/">
        <span className="side-brand-mark">TP</span>
        <b>ระบบแนะนำ<br />ชุดการแสดง</b>
      </Link>

      <nav className="side-menu-links" aria-label="เมนูนำทางหลัก">
        <SideNavLink href="/" icon="⌂" label="หน้าหลัก" active={pathname === "/"} />
        <SideNavLink
          href={recommendHref}
          icon="✦"
          label="แนะนำเฉพาะคุณ"
          active={pathname === "/recommend"}
        />
        <SideNavLink
          href="/items"
          icon="⌕"
          label="ค้นหาชุดการแสดง"
          active={pathname?.startsWith("/items")}
        />
        <SideNavLink href={savedHref} icon="♡" label="รายการที่บันทึกไว้" active={false} />
        <SideNavLink href={historyHref} icon="◷" label="ประวัติความสนใจ" active={false} />
        <SideNavLink
          href={profileHref}
          icon="♙"
          label="ข้อมูลผู้ใช้"
          active={pathname === "/profile"}
        />
        <SideNavLink href={settingsHref} icon="⚙" label="ตั้งค่าระบบ" active={false} />
      </nav>

      {admin ? (
        <>
          <div className="side-menu-title">Research tools</div>
          <Link href="/admin/items"><span>05</span><b>Dashboard ผู้วิจัย</b></Link>
          <Link href="http://127.0.0.1:8080/docs"><span>API</span><b>Swagger docs</b></Link>
        </>
      ) : null}

      <div className="side-menu-divider" />

      {user ? (
        <button
          type="button"
          className="side-logout"
          onClick={logout}
        >
          <span>↪</span>
          <b>ออกจากระบบ</b>
        </button>
      ) : (
        <Link className="side-logout" href="/login">
          <span>↪</span>
          <b>เข้าสู่ระบบ</b>
        </Link>
      )}

      <div className="side-filter-panel" aria-label="ปรับเงื่อนไขคำแนะนำ">
        <strong>ปรับเงื่อนไขคำแนะนำ</strong>
        <label>
          <span>บริบทการแสดง</span>
          <select defaultValue="วันลอยกระทง">
            <option>วันลอยกระทง</option>
            <option>วันสงกรานต์</option>
            <option>งานทำบุญ</option>
          </select>
        </label>
        <label>
          <span>หมวดคำสำคัญ</span>
          <select defaultValue="ภูมิศาสตร์และอาณาบริเวณ">
            <option>ภูมิศาสตร์และอาณาบริเวณ</option>
            <option>นาฏยศิลป์และการแสดง</option>
            <option>ดุริยางคศิลป์และคีตศิลป์</option>
          </select>
        </label>
        <label>
          <span>จำนวนรายการ</span>
          <select defaultValue="10">
            <option>10</option>
            <option>20</option>
            <option>30</option>
          </select>
        </label>
        <Link className="side-filter-button" href={recommendHref}>
          ใช้เงื่อนไขนี้
        </Link>
      </div>
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
    <Link href={href} className={active ? "active" : undefined}>
      <span>{icon}</span>
      <b>{label}</b>
    </Link>
  );
}
