"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import React, { useEffect, useMemo, useState } from "react";

import {
  AUTH_CHANGED_EVENT,
  getCurrentUser,
  isAdmin,
  logout,
  STORAGE_KEY,
} from "@/lib/auth";
import { getBaseUrl, getContexts, getKeywords } from "@/lib/api";
import type { ContextOut, KeywordOut, UserOut } from "@/lib/types";

export function SideMenu() {
  const pathname = usePathname();
  const [hash, setHash] = useState("");
  const [user, setUser] = useState<UserOut | null>(null);
  const [admin, setAdmin] = useState(false);
  const [contexts, setContexts] = useState<ContextOut[]>([]);
  const [keywords, setKeywords] = useState<KeywordOut[]>([]);
  // Controlled filter state — selecting an option now actually feeds the
  // "ใช้เงื่อนไขนี้" link below.
  const [selectedContextId, setSelectedContextId] = useState<string>("");
  const [selectedKeywordId, setSelectedKeywordId] = useState<string>("");
  const [topK, setTopK] = useState<number>(10);

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

  useEffect(() => {
    function syncHash() {
      setHash(window.location.hash);
    }

    syncHash();
    window.addEventListener("hashchange", syncHash);
    return () => window.removeEventListener("hashchange", syncHash);
  }, []);

  // Fetch contexts + a small slice of keywords once on mount so the side
  // filter dropdowns show real data instead of hardcoded Thai strings.
  // Failures fall back to empty lists — the panel stays visible but the
  // CTA is disabled until the user has a real option to pick.
  useEffect(() => {
    let cancelled = false;
    Promise.all([getContexts(), getKeywords(undefined, 200)])
      .then(([contextList, keywordList]) => {
        if (cancelled) return;
        setContexts(contextList.contexts);
        setKeywords(keywordList.keywords);
        if (contextList.contexts.length > 0) {
          setSelectedContextId(String(contextList.contexts[0].id));
        }
        if (keywordList.keywords.length > 0) {
          setSelectedKeywordId(String(keywordList.keywords[0].id));
        }
      })
      .catch(() => {
        // Silently leave the lists empty; the CTA will reflect that.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const recommendHref = user ? "/recommend" : "/login?next=/recommend";
  const profileHref = user ? "/profile" : "/login?next=/profile";
  const settingsHref = user ? "/profile#settings" : "/login?next=/profile";
  const apiDocsHref = `${getBaseUrl()}/docs`;

  // Build a real /recommend URL from the selected filter values. Empty
  // selections are simply omitted from the query string.
  const filterHref = useMemo(() => {
    const params = new URLSearchParams();
    if (selectedContextId) params.set("context_id", selectedContextId);
    if (selectedKeywordId) params.set("keyword_ids", selectedKeywordId);
    if (topK && topK !== 10) params.set("top_k", String(topK));
    const query = params.toString();
    return user
      ? `/recommend${query ? `?${query}` : ""}`
      : `/login?next=/recommend${query ? `&${query}` : ""}`;
  }, [selectedContextId, selectedKeywordId, topK, user]);
  const filterDisabled = !selectedContextId || !user;

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
        <SideNavLink
          href={profileHref}
          icon="♙"
          label="ข้อมูลผู้ใช้"
          active={pathname === "/profile" && !hash}
        />
        <SideNavLink href={settingsHref} icon="⚙" label="ตั้งค่าระบบ" active={pathname === "/profile" && hash === "#settings"} />
      </nav>

      {admin ? (
        <>
          <div className="side-menu-title">Research tools</div>
          <Link href="/dashboard"><span>05</span><b>Dashboard / สถิติ</b></Link>
          <Link href="/admin/items"><span>DB</span><b>บริหารฐานข้อมูล</b></Link>
          <Link href={apiDocsHref}><span>API</span><b>Swagger docs</b></Link>
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
          <select
            value={selectedContextId}
            onChange={(e) => setSelectedContextId(e.target.value)}
          >
            {contexts.length === 0 ? (
              <option value="">กำลังโหลดบริบท...</option>
            ) : (
              <>
                <option value="">— เลือกบริบท —</option>
                {contexts.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </>
            )}
          </select>
        </label>
        <label>
          <span>คำสำคัญ (ไม่บังคับ)</span>
          <select
            value={selectedKeywordId}
            onChange={(e) => setSelectedKeywordId(e.target.value)}
          >
            {keywords.length === 0 ? (
              <option value="">กำลังโหลดคำสำคัญ...</option>
            ) : (
              <>
                <option value="">— ไม่ระบุ —</option>
                {keywords.slice(0, 50).map((k) => (
                  <option key={k.id} value={k.id}>{k.name}</option>
                ))}
              </>
            )}
          </select>
        </label>
        <label>
          <span>จำนวนรายการ</span>
          <select
            value={topK}
            onChange={(e) => setTopK(Number(e.target.value))}
          >
            <option value={5}>5</option>
            <option value={10}>10</option>
            <option value={20}>20</option>
            <option value={30}>30</option>
          </select>
        </label>
        <Link
          className="side-filter-button"
          href={filterHref}
          aria-disabled={filterDisabled || undefined}
          style={filterDisabled ? { pointerEvents: "none", opacity: 0.5 } : undefined}
        >
          {filterDisabled ? "เลือกบริบทก่อน" : "ใช้เงื่อนไขนี้"}
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
