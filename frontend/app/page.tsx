"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";

import { ApiClientError, getContexts, getHealth, getMetrics } from "@/lib/api";
import type { ContextOut, HealthOut, MetricsOut } from "@/lib/types";

import { ErrorState } from "@/components/ErrorState";
import { LoadingState } from "@/components/LoadingState";
import { isAdmin } from "@/lib/auth";

export default function HomePage() {
  const [health, setHealth] = useState<HealthOut | null>(null);
  const [metrics, setMetrics] = useState<MetricsOut | null>(null);
  const [contexts, setContexts] = useState<ContextOut[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | undefined>(undefined);
  const [reloadKey, setReloadKey] = useState(0);
  const [admin, setAdmin] = useState(false);

  useEffect(() => {
    setAdmin(isAdmin());
    function onStorage(e: StorageEvent) {
      if (e.key === "thai_arts_jwt") setAdmin(isAdmin());
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    Promise.all([getHealth(), getMetrics(), getContexts()])
      .then(([h, m, c]) => {
        if (cancelled) return;
        setHealth(h);
        setMetrics(m);
        setContexts(c.contexts);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        if (e instanceof ApiClientError) {
          setError(e.message);
          setErrorCode(e.code);
        } else {
          setError(e instanceof Error ? e.message : "Unknown error");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  if (error) {
    return (
      <ErrorState
        title="เชื่อมต่อ backend ไม่ได้"
        message={error}
        code={errorCode}
        onRetry={() => setReloadKey((k) => k + 1)}
      />
    );
  }
  if (!health || !metrics) {
    return <LoadingState message="กำลังเชื่อมต่อ backend..." />;
  }

  const degraded = health.status !== "ok";

  const quickContexts = contexts.slice(0, 8);

  return (
    <div className="section-stack">
      <section className="portal-hero">
        <div className="portal-hero-media">
          <div className="portal-hero-copy">
            <p className="eyebrow hero-badge">Research prototype</p>
            <h1>ค้นหาชุดการแสดงไทยที่เหมาะกับงานของคุณ</h1>
            <p>
              เลือกบริบทย่อยหรือคำสำคัญจาก taxonomy เพื่อให้ระบบ Context Gate,
              CBF, ItemKNN และ Hybrid Ranking ช่วยคัดรายการที่เหมาะสมที่สุด
            </p>
            <div className="portal-hero-actions">
              <Link className="primary" href="/recommend">เริ่มค้นหาด้วย taxonomy</Link>
              <Link className="secondary" href="/items">สำรวจคลังชุดการแสดง</Link>
            </div>
          </div>
        </div>

        <form className="portal-search-card" action="/items">
          <div className="portal-search-intro">
            <strong>ค้นหาชุดการแสดง</strong>
            <span>เลือกบริบทย่อยหรือพิมพ์คำค้นหา เช่น โขน ตารีบุหงา งานมงคล</span>
          </div>
          <div className="portal-search-fields">
            <label className="field">
              <span>บริบทย่อยของงาน</span>
              <select name="context">
                <option value="">เลือกบริบทย่อย</option>
                {contexts.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>ชื่อการแสดงหรือ keyword</span>
              <input name="q" type="search" placeholder="เช่น โขน งานมงคล วัฒนธรรม" />
            </label>
            <button type="submit">ค้นหา</button>
          </div>
        </form>
      </section>

      <section className="home-section-head">
        <div>
          <p className="eyebrow">System status</p>
          <h2>ระบบพร้อมสำหรับการทดลองใช้งาน</h2>
          <p>
            {degraded
              ? "Backend ยังโหลด artifacts ไม่สำเร็จ กรุณาตรวจ pipeline และรัน backend ใหม่"
              : "Backend, artifacts และ API contract พร้อมใช้งานผ่าน FastAPI"}
          </p>
        </div>
        <Link className="secondary" href="http://127.0.0.1:8080/docs">เปิด Swagger docs</Link>
      </section>

      <section className="research-kpi-grid" aria-label="สถิติระบบ">
        <article className="metric-card">
          <span>ชุดการแสดง</span>
          <strong>{health.item_count}</strong>
          <small className="muted">active catalog items</small>
        </article>
        <article className="metric-card">
          <span>บริบทย่อย</span>
          <strong>{health.context_count}</strong>
          <small className="muted">context gate vocabulary</small>
        </article>
        <article className="metric-card">
          <span>Keyword</span>
          <strong>{metrics.keyword_count}</strong>
          <small className="muted">taxonomy terms</small>
        </article>
        <article className="metric-card">
          <span>Embedding dim</span>
          <strong>{health.embedding_dim}</strong>
          <small className="muted">multilingual E5 vector</small>
        </article>
      </section>

      <section className="home-section-head">
        <div>
          <p className="eyebrow">Popular contexts</p>
          <h2>เริ่มจากบริบทที่ใช้บ่อย</h2>
          <p>ทางลัดเข้าสู่การเรียกดูรายการตามบริบท เหมาะสำหรับตรวจหน้าตาและ flow หลัก</p>
        </div>
        <Link className="secondary" href="/recommend">ค้นหาด้วย keyword taxonomy</Link>
      </section>

      <section className="card-grid">
        {quickContexts.map((context, idx) => (
          <Link
            key={context.id}
            className="item-card"
            href={`/items?context=${context.id}`}
            style={{ textDecoration: "none" }}
          >
            <div className="item-card-media" />
            <div className="item-card-body">
              <p className="eyebrow">Context {String(idx + 1).padStart(2, "0")}</p>
              <h3>{context.name}</h3>
              <p className="description">
                {context.description || `${context.active_item_count} รายการที่เปิดใช้งานในบริบทนี้`}
              </p>
              <span className="context-pill">{context.active_item_count} รายการ</span>
            </div>
          </Link>
        ))}
      </section>

      {admin ? (
        <section data-testid="admin-cta" className="panel">
          <p className="eyebrow">Researcher / Admin</p>
          <h2 style={{ marginTop: 0 }}>ศูนย์บริหารข้อมูลและติดตามระบบ</h2>
          <p className="muted">
            เพิ่มการแสดงใหม่ ตรวจ catalog และใช้ Layer A+B grounding เพื่อช่วยเลือกคำสำคัญ
          </p>
          <div className="actions">
            <Link className="primary" href="/admin/items/new">เพิ่มการแสดงใหม่</Link>
            <Link className="secondary" href="/admin/items">จัดการแคตตาล็อก</Link>
          </div>
        </section>
      ) : null}

      <footer id="system-summary" className="panel">
        <p className="eyebrow">Research system info</p>
        <h2 style={{ marginTop: 0 }}>ข้อมูลระบบสำหรับงานวิจัย</h2>
        <div className="card-grid" style={{ marginTop: "14px" }}>
          <article>
            <strong>Context Gate</strong>
            <p className="muted">กรอง candidate ด้วยบริบทย่อยก่อนจัดอันดับ</p>
          </article>
          <article>
            <strong>Keyword Taxonomy</strong>
            <p className="muted">ช่วยผู้ใช้เลือกคำสำคัญเมื่อยังไม่รู้ชื่อการแสดง</p>
          </article>
          <article>
            <strong>Hybrid Ranking</strong>
            <p className="muted">รวม CBF, ItemKNN และ WeightedSum พร้อมคำอธิบายภาษาไทย</p>
          </article>
        </div>
      </footer>
    </div>
  );
}
