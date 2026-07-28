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
  { href: "/", label: "Home" },
  { href: "/items", label: "แคตตาล็อก" },
  { href: "/recommend", label: "คำแนะนำ" },
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
    links.push({ href: "/admin/items", label: "ผู้ดูแล" });
  }

  return (
    <nav style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
      {links.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          style={{
            color: "#fff",
            textDecoration: "none",
            padding: "0.35rem 0.75rem",
            borderRadius: "6px",
            backgroundColor: "rgba(255,255,255,0.12)",
            fontSize: "0.9rem",
          }}
        >
          {l.label}
        </Link>
      ))}
      {user === undefined ? null : user ? (
        <div style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem" }}>
          <span
            title={user.is_admin ? "ผู้ดูแลระบบ" : user.username}
            style={{
              color: "#fff",
              fontSize: "0.85rem",
              opacity: 0.9,
              padding: "0.25rem 0.5rem",
              backgroundColor: "rgba(255,255,255,0.18)",
              borderRadius: "4px",
            }}
          >
            {user.is_admin ? "🛡 " : ""}
            {user.display_name || user.username}
          </span>
          <button
            type="button"
            onClick={() => {
              logout();
              setUser(null);
            }}
            style={{
              padding: "0.35rem 0.75rem",
              backgroundColor: "transparent",
              color: "#fff",
              border: "1px solid rgba(255,255,255,0.6)",
              borderRadius: "6px",
              fontSize: "0.85rem",
              cursor: "pointer",
            }}
          >
            ออกจากระบบ
          </button>
        </div>
      ) : (
        <div style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}>
          <Link
            href="/login"
            style={{
              color: "#fff",
              textDecoration: "none",
              padding: "0.35rem 0.75rem",
              borderRadius: "6px",
              backgroundColor: "rgba(255,255,255,0.18)",
              fontSize: "0.9rem",
            }}
          >
            เข้าสู่ระบบ
          </Link>
          <Link
            href="/signup"
            style={{
              color: "#1e6fd9",
              textDecoration: "none",
              padding: "0.35rem 0.75rem",
              borderRadius: "6px",
              backgroundColor: "#fff",
              fontSize: "0.9rem",
              fontWeight: 600,
            }}
          >
            สมัครสมาชิก
          </Link>
        </div>
      )}
    </nav>
  );
}