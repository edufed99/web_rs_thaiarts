"use client";

import Link from "next/link";
import React, { useEffect, useState } from "react";

import { AUTH_CHANGED_EVENT, getCurrentUser, isAdmin, STORAGE_KEY } from "@/lib/auth";
import type { UserOut } from "@/lib/types";

export function SideMenu() {
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

  return (
    <aside className="side-menu" aria-label="เมนูหลักของระบบ">
      <Link href="/"><span>01</span><b>หน้าหลัก</b></Link>
      <Link href="/items"><span>02</span><b>คลังชุดการแสดง</b></Link>
      <Link href={recommendHref}><span>03</span><b>คำแนะนำเฉพาะคุณ</b></Link>
      {user ? <Link href="/profile"><span>04</span><b>ข้อมูลผู้ใช้</b></Link> : null}
      {admin ? (
        <>
          <div className="side-menu-title">Research tools</div>
          <Link href="/admin/items"><span>05</span><b>Dashboard ผู้วิจัย</b></Link>
          <Link href="http://127.0.0.1:8080/docs"><span>API</span><b>Swagger docs</b></Link>
        </>
      ) : null}
    </aside>
  );
}
