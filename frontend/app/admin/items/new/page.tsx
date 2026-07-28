"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { AdminItemForm } from "@/components/AdminItemForm";
import { getCurrentUser, isAdmin } from "@/lib/auth";

export default function NewItemPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const u = getCurrentUser();
    if (!u) {
      router.replace("/login?next=/admin/items/new");
      return;
    }
    if (!isAdmin()) {
      router.replace("/?denied=admin_only");
      return;
    }
    setReady(true);
  }, [router]);

  if (!ready) {
    return <div>กำลังตรวจสอบสิทธิ์...</div>;
  }

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>เพิ่มการแสดงใหม่</h1>
      <p style={{ color: "#555", marginTop: 0 }}>
        กรอกข้อมูลการแสดงและให้ระบบช่วยเลือกคำสำคัญที่เหมาะสม
      </p>
      <AdminItemForm />
    </div>
  );
}