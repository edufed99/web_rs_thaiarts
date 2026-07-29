"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";

import { ApiClientError, getContexts, getItems } from "@/lib/api";
import type { ContextOut, ItemOut } from "@/lib/types";

import { ErrorState } from "@/components/ErrorState";
import { LoadingState } from "@/components/LoadingState";
import { isAdmin } from "@/lib/auth";
import { groupContexts } from "@/lib/contextGroups";
import { getUserKey } from "@/lib/user";

export default function HomePage() {
  const [contexts, setContexts] = useState<ContextOut[]>([]);
  const [items, setItems] = useState<ItemOut[] | null>(null);
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
    const userKey = getUserKey();
    Promise.all([getContexts(), getItems({ limit: 8, userKey })])
      .then(([c, itemList]) => {
        if (cancelled) return;
        setContexts(c.contexts);
        setItems(itemList.items);
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
  if (!items) {
    return <LoadingState message="กำลังเชื่อมต่อ backend..." />;
  }

  const popularItems = items.slice(0, 4);
  const seasonalItems = items.slice(4, 8).length > 0 ? items.slice(4, 8) : popularItems;
  const contextGroups = groupContexts(contexts);

  return (
    <div className="section-stack">
      <section className="portal-hero">
        <div className="portal-hero-media">
          <div className="portal-hero-copy">
            <p className="eyebrow hero-badge">Research prototype</p>
            <h1>ค้นหาชุดการแสดงไทยที่เหมาะกับงานของคุณ</h1>
            <p>
              เลือกโอกาสที่ใช้แสดงหรือคำสำคัญจาก taxonomy เพื่อให้ระบบ Context Gate,
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
            <span>เลือกโอกาสที่ใช้แสดงหรือพิมพ์คำค้นหา เช่น โขน ตารีบุหงา งานมงคล</span>
          </div>
          <div className="portal-search-fields">
            <label className="field">
              <span>โอกาสที่ใช้แสดง</span>
              <select name="context">
                <option value="">เลือกโอกาสที่ใช้แสดง</option>
                {contextGroups.map((group) => (
                  <optgroup key={group.label} label={group.label}>
                    {group.contexts.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </optgroup>
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

      <section className="personalized-panel">
        <div>
          <p className="eyebrow">Personalized mode</p>
          <h2 style={{ margin: 0, color: "#23386b" }}>เข้าสู่ระบบเพื่อรับคำแนะนำเฉพาะคุณ</h2>
          <p className="muted" style={{ marginBottom: 0 }}>
            เมื่อเข้าสู่ระบบ คุณสามารถบันทึก ถูกใจ ให้คะแนน และใช้ข้อมูลการทดลองเพื่อปรับคำแนะนำให้ตรงขึ้น
          </p>
        </div>
        <div className="actions" style={{ marginTop: 0 }}>
          <Link className="primary" href="/login">เข้าสู่ระบบเพื่อรับคำแนะนำ</Link>
          <Link className="secondary" href="/signup">สมัครสมาชิก</Link>
        </div>
      </section>

      <section className="home-section-head">
        <div>
          <p className="eyebrow">Popular performances</p>
          <h2>ชุดการแสดงยอดนิยม</h2>
          <p>รายการที่ได้รับความสนใจจากผู้ใช้ในระบบ เหมาะสำหรับเริ่มสำรวจโดยยังไม่ใช้ข้อมูลเฉพาะบุคคล</p>
        </div>
        <Link className="secondary" href="/items">ดูทั้งหมด</Link>
      </section>

      <section className="popular-performance-grid">
        {popularItems.map((item, idx) => (
          <PopularPerformanceCard key={item.id} item={item} index={idx} />
        ))}
      </section>

      <section className="seasonal-band">
        <div className="seasonal-head">
          <div>
            <h2>แนะนำชุดการแสดงตามช่วงเวลาสำคัญของปฏิทิน</h2>
            <p className="muted" style={{ margin: "8px 0 0" }}>ช่วงเข้าพรรษาและงานบุญ</p>
          </div>
          <span className="context-pill">วันเข้าพรรษา</span>
        </div>
        <div className="seasonal-grid">
          {seasonalItems.map((item) => (
            <Link
              key={item.id}
              className="seasonal-tile"
              href={`/items/${item.id}`}
              style={item.image_url ? { backgroundImage: `linear-gradient(180deg, rgba(6, 18, 36, 0.08) 0%, rgba(6, 18, 36, 0.86) 100%), url("${item.image_url}")` } : undefined}
            >
              <span>ช่วงเข้าพรรษาและงานบุญ</span>
              <strong>{item.name}</strong>
            </Link>
          ))}
        </div>
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
            <p className="muted">กรอง candidate ด้วยโอกาสที่ใช้แสดงก่อนจัดอันดับ</p>
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

function PopularPerformanceCard({ item, index }: { item: ItemOut; index: number }) {
  const rating = (4.9 - (index % 2) * 0.1).toFixed(1);
  const reviews = 144 - index * 17;
  const matchPercent = item.match_percent ?? 100;
  const description =
    item.description && item.description.length > 96
      ? `${item.description.slice(0, 96).trimEnd()}...`
      : item.description;

  return (
    <article className="popular-card">
      <div
        className="popular-card-media"
        style={item.image_url ? { backgroundImage: `linear-gradient(135deg, rgba(6, 27, 60, 0.08), rgba(197, 145, 59, 0.12)), url("${item.image_url}")` } : undefined}
      />
      <div className="popular-card-body">
        <span className="popular-badge">ยอดนิยมในระบบ</span>
        <span className="popular-match">ระดับความตรงบริบท: {matchPercent}%</span>
        <h3 style={{ margin: 0, color: "#102044", fontSize: "1.35rem", lineHeight: 1.35 }}>
          {item.name}
        </h3>
        <div>
          <span className="popular-stars">★★★★★</span>{" "}
          <strong>{rating}</strong>{" "}
          <span className="muted">({reviews} รีวิว)</span>
        </div>
        {description ? <p className="description" style={{ margin: 0 }}>{description}</p> : null}
        <Link className="secondary" href={`/items/${item.id}`} style={{ justifySelf: "start" }}>
          รายละเอียด
        </Link>
      </div>
    </article>
  );
}
