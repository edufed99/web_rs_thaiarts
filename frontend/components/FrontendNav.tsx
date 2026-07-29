"use client";

import Link from "next/link";
import React, { useEffect, useState } from "react";

import { getCurrentUser, logout, isAdmin } from "@/lib/auth";
import type { UserOut } from "@/lib/types";

interface NavLink {
  href: string;
  label: string;
}

const BASE_LINKS: NavLink[] = [
  { href: "/", label: "หน้าหลัก" },
  { href: "/items", label: "คลังชุดการแสดง" },
  { href: "/recommend", label: "ค้นหาชุดการแสดง" },
];

export function FrontendNav() {
  const [user, setUser] = useState<UserOut | null | undefined>(undefined);

  useEffect(() => {
    setUser(getCurrentUser());
    // Cross-tab logout sync.
    function onStorage(e: StorageEvent) {
      if (e.key === "thai_arts_jwt") {
        setUser(getCurrentUser());
      }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const links: NavLink[] = [...BASE_LINKS];
  if (isAdmin()) {
    links.push({ href: "/admin/items", label: "Dashboard ผู้วิจัย" });
  }

  return (
    <div className="topbar-nav" aria-label="เมนูหลักด้านบน">
      {links.map((l) => (
        <Link key={l.href} href={l.href}>{l.label}</Link>
      ))}
      {user === undefined ? null : user ? (
        <nav className="utility-nav" aria-label="เมนูบัญชีผู้ใช้">
          <span
            title={user.is_admin ? "ผู้ดูแลระบบ" : user.username}
            className="user-chip"
          >
            {user.is_admin ? "Admin · " : ""}
            {user.display_name || user.username}
          </span>
          <button
            type="button"
            onClick={() => {
              logout();
              setUser(null);
            }}
          >
            ออกจากระบบ
          </button>
        </nav>
      ) : (
        <nav className="utility-nav" aria-label="เข้าสู่ระบบ">
          <Link href="/login">เข้าสู่ระบบ</Link>
          <Link className="button-link" href="/signup">สมัครสมาชิก</Link>
        </nav>
      )}
    </div>
  );
}
