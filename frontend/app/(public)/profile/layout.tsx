"use client";

import { useRouter } from "next/navigation";
import React, { useEffect, useState } from "react";

import { MemberShell } from "@/components/MemberShell";
import { isAdmin } from "@/lib/auth";

export default function ProfileLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (isAdmin()) {
      router.replace("/admin");
      return;
    }
    setChecked(true);
  }, [router]);

  if (!checked) {
    return (
      <div className="profile-route-guard" role="status">
        กำลังตรวจสอบบัญชี...
      </div>
    );
  }

  return <MemberShell>{children}</MemberShell>;
}
