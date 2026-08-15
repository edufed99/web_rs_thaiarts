"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import React, { useEffect, useState } from "react";

import {
  AUTH_CHANGED_EVENT,
  STORAGE_KEY,
  getCurrentUser,
  getReadableUserName,
  logout,
} from "@/lib/auth";
import type { UserOut } from "@/lib/types";

export function FrontendNav() {
  const router = useRouter();
  const [user, setUser] = useState<UserOut | null | undefined>(undefined);

  useEffect(() => {
    function refreshUser() {
      setUser(getCurrentUser());
    }

    refreshUser();
    // Cross-tab logout sync.
    function onStorage(e: StorageEvent) {
      if (e.key === STORAGE_KEY) {
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

  const readableUserName = user ? getReadableUserName(user) : "";

  return (
    <div className="topbar-nav" aria-label="เมนูบัญชีผู้ใช้ด้านบน">
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
              router.replace("/login");
              router.refresh();
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
