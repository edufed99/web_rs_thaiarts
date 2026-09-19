"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import React, { useEffect, useState } from "react";

import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { useTranslation } from "@/contexts/LanguageContext";
import {
  AUTH_CHANGED_EVENT,
  STORAGE_KEY,
  getCurrentUser,
  getReadableUserName,
  logout,
} from "@/lib/auth";
import type { UserOut } from "@/lib/types";

export function FrontendNav() {
  const { t } = useTranslation();
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
    <div className="topbar-nav" aria-label={t("nav.profile")}>
      <LanguageSwitcher variant="admin" />
      {user === undefined ? null : user ? (
        <nav className="utility-nav" aria-label={t("nav.profile")}>
          <span
            title={user.is_admin ? "Admin" : user.username}
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
            {t("nav.logout")}
          </button>
        </nav>
      ) : (
        <nav className="utility-nav" aria-label={t("nav.login")}>
          <Link href="/login">{t("nav.login")}</Link>
          <Link className="button-link" href="/signup">{t("nav.signup")}</Link>
        </nav>
      )}
    </div>
  );
}
