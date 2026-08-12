"use client";

import { useRouter } from "next/navigation";
import React, { useEffect, useState } from "react";

import { ErrorState } from "@/components/ErrorState";
import { LoadingState } from "@/components/LoadingState";
import { MemberHero } from "@/components/MemberHero";
import { MemberHistoryTable } from "@/components/MemberHistoryTable";
import { getMeHistory } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";
import type { HistoryListOut } from "@/lib/types";
import { useAuthHeaders } from "@/lib/useAuthHeaders";
import { getUserKey } from "@/lib/user";

export default function MemberActivityPage() {
  const router = useRouter();
  const authHeaders = useAuthHeaders();
  const [activity, setActivity] = useState<HistoryListOut | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!getCurrentUser()) {
      router.replace("/login?next=/profile/activity");
      return;
    }

    let cancelled = false;
    setError(null);
    getMeHistory(getUserKey(), 200, authHeaders)
      .then((data) => {
        if (!cancelled) setActivity(data);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      });

    return () => {
      cancelled = true;
    };
  }, [router, authHeaders, reloadKey]);

  if (error) {
    return <ErrorState message={error} onRetry={() => setReloadKey((value) => value + 1)} />;
  }
  if (!activity) return <LoadingState message="กำลังโหลดกิจกรรมทั้งหมด..." />;

  return (
    <div className="section-stack">
      <MemberHero
        title="กิจกรรมทั้งหมด"
        subtitle="ประวัติการถูกใจ บันทึก และให้คะแนนชุดการแสดงของคุณ เรียงจากล่าสุด"
      />
      <section className="member-section" aria-label="กิจกรรมทั้งหมด">
        <MemberHistoryTable entries={activity.items} />
      </section>
    </div>
  );
}
