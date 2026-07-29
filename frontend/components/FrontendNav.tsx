"use client";

import Link from "next/link";
import React, { useEffect, useState } from "react";

import {
  AUTH_CHANGED_EVENT,
  getCurrentUser,
  getReadableUserName,
  logout,
  isAdmin,
} from "@/lib/auth";
import type { UserOut } from "@/lib/types";

interface NavLink {
  href: string;
  label: string;
}

function baseLinks(isLoggedIn: boolean): NavLink[] {
  return [
    { href: "/", label: "หน้าหลัก" },
    { href: "/items", label: "คลังชุดการแสดง" },
    {
      href: isLoggedIn ? "/recommend" : "/login?next=/recommend",
      label: "คำแนะนำเฉพาะคุณ",
    },
  ];
}

export function FrontendNav() {
  const [user, setUser] = useState<UserOut | null | undefined>(undefined);

  useEffect(() => {
    function refreshUser() {
      setUser(getCurrentUser());
    }

    refreshUser();
    // Cross-tab logout sync.
    function onStorage(e: StorageEvent) {
      if (e.key === "thai_arts_jwt") {
        refreshUser();
      }
    }
    window.addEventListener(AUTH_CHANGED_EVENT, refreshUser);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(AUTH_CHANGED_EVENT, refreshUser);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const isLoggedIn = Boolean(user);
  const links: NavLink[] = baseLinks(isLoggedIn);
  if (isLoggedIn) {
    links.push({ href: "/profile", label: "ข้อมูลผู้ใช้" });
  }
  if (user?.is_admin || isAdmin()) {
    links.push({ href: "/admin/items", label: "Dashboard ผู้วิจัย" });
  }
  const readableUserName = user ? getReadableUserName(user) : "";

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
            {readableUserName}
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
