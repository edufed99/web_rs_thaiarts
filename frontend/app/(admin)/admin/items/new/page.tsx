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
    <div className="section-stack">
      <section className="page-hero">
        <div>
          <p className="eyebrow">AI / V&V Control</p>
          <h1>เพิ่มการแสดงใหม่</h1>
          <p className="muted">
            กรอกข้อมูลการแสดง แล้วให้ระบบช่วยเสนอ keyword จากกฎและ LLM ก่อนบันทึกลงฐานข้อมูล
          </p>
        </div>
      </section>
      <AdminItemForm />
    </div>
  );
}
