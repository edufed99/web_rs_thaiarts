"use client";

import { useRouter } from "next/navigation";
import React, { useEffect, useState } from "react";

import { getBaseUrl } from "@/lib/api";
import { getCurrentUser, isAdmin } from "@/lib/auth";

export default function AdminSwaggerDocsPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const user = getCurrentUser();
    if (!user) {
      router.replace("/login?next=/admin/docs");
      return;
    }
    if (!isAdmin()) {
      router.replace("/?denied=admin_only");
      return;
    }
    setReady(true);
  }, [router]);

  if (!ready) return <div className="panel">กำลังตรวจสอบสิทธิ์...</div>;

  return (
    <div className="swagger-docs-page">
      <header className="swagger-docs-head">
        <div>
          <p className="eyebrow">API Reference</p>
          <h1>Swagger API Documentation</h1>
          <p>ตรวจสอบ Endpoint, Schema และทดลองเรียก API ภายในหน้า Admin เดียวกัน</p>
        </div>
        <span className={`status-pill ${loaded ? "active" : "muted"}`}>
          {loaded ? "Docs พร้อมใช้งาน" : "กำลังโหลด Docs..."}
        </span>
      </header>

      <section className="swagger-docs-frame-wrap">
        {!loaded ? <div className="swagger-docs-loading">กำลังโหลด Swagger UI...</div> : null}
        <iframe
          className="swagger-docs-frame"
          src={`${getBaseUrl()}/docs`}
          title="Swagger API Documentation"
          onLoad={() => setLoaded(true)}
        />
      </section>
    </div>
  );
}
