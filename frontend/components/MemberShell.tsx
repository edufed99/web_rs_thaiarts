"use client";

import React, { useEffect, useState } from "react";

import { MemberSidebar } from "@/components/MemberSidebar";
import { getMeSummary } from "@/lib/api";
import { AUTH_CHANGED_EVENT, STORAGE_KEY, getCurrentUser } from "@/lib/auth";
import { MEMBER_ACTIVITY_CHANGED_EVENT } from "@/lib/memberEvents";
import type { UserOut, UserSummaryOut } from "@/lib/types";
import { useAuthHeaders } from "@/lib/useAuthHeaders";
import { getUserKey } from "@/lib/user";

interface MemberShellProps {
  children: React.ReactNode;
  showInterestCard?: boolean;
}

/**
 * Two-column layout used by every member_user mockup page. Loads the
 * current user (from localStorage) + the live activity summary once and
 * passes them down to the sidebar. The main column is just a passthrough
 * so each page keeps full control over its own content.
 */
export function MemberShell({ children, showInterestCard = true }: MemberShellProps) {
  const [user, setUser] = useState<UserOut | null>(null);
  const [summary, setSummary] = useState<UserSummaryOut | null>(null);
  const [userKey, setUserKey] = useState<string>("");
  const [activityVersion, setActivityVersion] = useState(0);
  const authHeaders = useAuthHeaders();

  useEffect(() => {
    function refreshActivity() {
      setActivityVersion((value) => value + 1);
    }
    function refreshMember() {
      setUser(getCurrentUser());
      setUserKey(getUserKey());
    }
    function onStorage(event: StorageEvent) {
      if (event.key === STORAGE_KEY) refreshMember();
    }
    refreshMember();
    window.addEventListener(AUTH_CHANGED_EVENT, refreshMember);
    window.addEventListener(MEMBER_ACTIVITY_CHANGED_EVENT, refreshActivity);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(AUTH_CHANGED_EVENT, refreshMember);
      window.removeEventListener(MEMBER_ACTIVITY_CHANGED_EVENT, refreshActivity);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  useEffect(() => {
    if (!userKey) {
      setSummary(null);
      return;
    }
    let cancelled = false;
    setSummary(null);
    getMeSummary(userKey, authHeaders)
      .then((s) => {
        if (!cancelled) setSummary(s);
      })
      .catch(() => {
        if (!cancelled) setSummary(null);
      });
    return () => {
      cancelled = true;
    };
  }, [userKey, authHeaders, activityVersion]);

  return (
    <div className="member-shell">
      <MemberSidebar
        user={user}
        summary={summary}
        showInterestCard={showInterestCard}
      />
      <main className="member-main">{children}</main>
    </div>
  );
}
