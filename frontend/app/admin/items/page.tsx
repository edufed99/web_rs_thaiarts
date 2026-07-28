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
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "0.5rem",
          flexWrap: "wrap",
        }}
      >
        <h1 style={{ margin: 0 }}>รายการแนะนำสำหรับผู้ดูแล</h1>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button
            type="button"
            onClick={() => setReloadKey((k) => k + 1)}
            style={{
              padding: "0.4rem 0.75rem",
              backgroundColor: "#fff",
              color: "#1e6fd9",
              border: "1px solid #1e6fd9",
              borderRadius: "4px",
              fontSize: "0.85rem",
              cursor: "pointer",
            }}
          >
            รีเฟรช
          </button>
          <Link
            href="/admin/items/new"
            style={{
              padding: "0.4rem 0.75rem",
              backgroundColor: "#1e6fd9",
              color: "#fff",
              border: "none",
              borderRadius: "4px",
              fontSize: "0.85rem",
              textDecoration: "none",
            }}
          >
            + เพิ่มการแสดงใหม่
          </Link>
        </div>
      </div>

      <p style={{ color: "#555" }}>
        รายการด้านล่างคือการแสดงทั้งหมดที่อยู่ในแคตตาล็อก (MVP — ระบบจะแยกรายการที่ผู้ดูแลเพิ่มในเวอร์ชันถัดไป)
      </p>

      {error ? (
        <div
          role="alert"
          style={{
            color: "#7a1f1f",
            backgroundColor: "#fdecec",
            border: "1px solid #f5c2c2",
            borderRadius: "4px",
            padding: "0.5rem 0.75rem",
          }}
        >
          {error}
        </div>
      ) : null}

      {!items ? (
        <div>กำลังโหลด...</div>
      ) : items.length === 0 ? (
        <div>ยังไม่มีการแสดงในระบบ</div>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: "0.5rem" }}>
          {items.map((it) => (
            <li
              key={it.id}
              style={{
                padding: "0.75rem 1rem",
                backgroundColor: "#fff",
                border: "1px solid #e3e3e3",
                borderRadius: "6px",
                display: "flex",
                gap: "0.5rem",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <div>
                <div style={{ fontWeight: 600 }}>{it.name}</div>
                <div style={{ fontSize: "0.85rem", color: "#555" }}>
                  {it.category_group} · {it.performance_type || "—"}
                </div>
              </div>
              <Link
                href={`/items/${it.id}`}
                style={{
                  padding: "0.3rem 0.6rem",
                  backgroundColor: "#1e6fd9",
                  color: "#fff",
                  borderRadius: "4px",
                  fontSize: "0.85rem",
                  textDecoration: "none",
                }}
              >
                ดูรายละเอียด
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}