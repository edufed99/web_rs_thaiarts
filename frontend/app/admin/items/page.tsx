"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { ApiClientError, getItems } from "@/lib/api";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import type { ItemOut } from "@/lib/types";

export default function AdminItemsListPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [items, setItems] = useState<ItemOut[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const u = getCurrentUser();
    if (!u) {
      router.replace("/login?next=/admin/items");
      return;
    }
    if (!isAdmin()) {
      router.replace("/?denied=admin_only");
      return;
    }
    setReady(true);

    let cancelled = false;
    getItems({ limit: 50 })
      .then((data) => {
        if (cancelled) return;
        setItems(data.items);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof ApiClientError ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [router, reloadKey]);

  if (!ready) {
    return <div>กำลังตรวจสอบสิทธิ์...</div>;
  }

  return (
    <div className="section-stack">
      <section className="page-hero">
        <div>
          <p className="eyebrow">Researcher / Admin Dashboard</p>
          <h1>ศูนย์บริหารข้อมูลการแสดง</h1>
          <p className="muted">
            ตรวจ catalog, เพิ่มชุดการแสดง และติดตามข้อมูลพื้นฐานที่ใช้กับ recommender
          </p>
        </div>
        <div className="actions" style={{ marginTop: 0 }}>
          <button
            type="button"
            onClick={() => setReloadKey((k) => k + 1)}
            className="secondary"
          >
            รีเฟรช
          </button>
          <Link href="/admin/items/new" className="primary">เพิ่มการแสดงใหม่</Link>
        </div>
      </section>

      <section className="research-kpi-grid" aria-label="ตัวชี้วัด catalog">
        <article className="metric-card">
          <span>Catalog rows</span>
          <strong>{items?.length ?? "..."}</strong>
          <small className="muted">โหลดล่าสุดจาก FastAPI</small>
        </article>
        <article className="metric-card">
          <span>Admin flow</span>
          <strong>Layer A+B</strong>
          <small className="muted">grounding + keyword proposal</small>
        </article>
        <article className="metric-card">
          <span>API contract</span>
          <strong>Swagger</strong>
          <small className="muted">FastAPI docs ที่ /docs</small>
        </article>
        <article className="metric-card">
          <span>Storage</span>
          <strong>Postgres</strong>
          <small className="muted">persist admin ingest และ actions</small>
        </article>
      </section>

      {error ? (
        <div role="alert" className="error-panel">
          {error}
        </div>
      ) : null}

      {!items ? (
        <div className="panel">กำลังโหลด...</div>
      ) : items.length === 0 ? (
        <div className="panel">ยังไม่มีการแสดงในระบบ</div>
      ) : (
        <section className="research-panel">
          <div className="research-section-head" style={{ marginTop: 0 }}>
            <div>
              <p className="eyebrow">Knowledge Base Management</p>
              <h2>ตารางจัดการชุดการแสดง</h2>
            </div>
            <span>{items.length} รายการล่าสุด</span>
          </div>
          <div className="management-table-wrap">
            <table className="management-table">
              <thead>
                <tr>
                  <th>ชุดการแสดง</th>
                  <th>หมวดหมู่</th>
                  <th>ประเภท</th>
                  <th>บริบท</th>
                  <th>สถานะ</th>
                  <th>เปิดดู</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.id}>
                    <td><strong>{it.name}</strong></td>
                    <td>{it.category_group || "-"}</td>
                    <td>{it.performance_type || "-"}</td>
                    <td>{it.contexts.slice(0, 2).map((c) => c.name).join(", ") || "-"}</td>
                    <td><span className="status-pill">{it.suitability_label || "Active"}</span></td>
                    <td><Link className="secondary" href={`/items/${it.id}`}>รายละเอียด</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
