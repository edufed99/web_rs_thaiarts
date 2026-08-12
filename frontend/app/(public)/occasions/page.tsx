"use client";

import Link from "next/link";
import React, { useEffect, useMemo, useState } from "react";

import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { LoadingState } from "@/components/LoadingState";
import { ApiClientError, getContexts } from "@/lib/api";
import { groupContexts } from "@/lib/contextGroups";
import type { ContextOut } from "@/lib/types";

const OCCASION_IMAGES = [
  "/img/home/occasion-1.png",
  "/img/home/occasion-2.png",
  "/img/home/occasion-3.png",
  "/img/home/occasion-4.png",
  "/img/home/occasion-5.png",
] as const;

const OCCASION_IMAGE_BY_GROUP: Record<string, string> = {
  "งานมงคล": "/img/home/occasion-1.png",
  "งานเทศกาล": "/img/home/occasion-2.png",
  "งานเผยแพร่วัฒนธรรม": "/img/home/occasion-3.png",
  "งานวันสำคัญทางศาสนา": "/img/home/occasion-4.png",
  "งานอวมงคล": "/img/home/occasion-5.png",
};

const OCCASION_IMAGE_BY_NAME: Record<string, string> = {
  "งานขึ้นบ้านใหม่": "/img/home/occasion-housewarming.jpg",
  "งานแต่งงาน": "/img/home/occasion-wedding.jpg",
  "งานทำบุญ": "/img/home/occasion-merit-making.jpg",
  "งานบวงสรวง": "/img/home/occasion-worship-ceremony.jpg",
  "งานเปิดบริษัท": "/img/home/occasion-company-opening.jpg",
  "งานวันเกิด": "/img/home/occasion-birthday.jpg",
  "งานไหว้ครู": "/img/home/occasion-wai-khru.jpg",
  "งานเฉลิมพระชนมพรรษาพระบรมวงศานุวงศ์": "/img/home/occasion-royal-birthday.jpg",
  "งานเทศมหาชาติ": "/img/home/occasion-maha-chat.jpg",
  "งานประชุมสงฆ์": "/img/home/occasion-monks-conference.jpg",
  "วันเข้าพรรษา": "/img/home/occasion-buddhist-lent.jpg",
  "งานสวดมนต์ข้ามปี": "/img/home/occasion-new-year-prayer.jpg",
  "วันวิสาขบูชา": "/img/home/occasion-visakha-bucha.jpg",
  "วันออกพรรษา": "/img/home/occasion-end-buddhist-lent.jpg",
  "งานสวดอภิธรรม": "/img/home/occasion-funeral-prayer.jpg",
  "งานฌาปนกิจศพ": "/img/home/occasion-cremation.jpg",
  "งานพระราชทานเพลิงศพ": "/img/home/occasion-royal-cremation.jpg",
  "วันขึ้นปีใหม่": "/img/home/occasion-new-year.jpg",
  "วันตรุษจีน": "/img/home/occasion-chinese-new-year.jpg",
  "วันลอยกระทง": "/img/home/occasion-loy-krathong.jpg",
  "วันสงกรานต์": "/img/home/occasion-songkran.jpg",
  "การเผยแพร่วัฒนธรรมต่างประเทศ": "/img/home/occasion-cultural-abroad.jpg",
  "งานเผยแพร่วัฒนธรรมต่างประเทศ": "/img/home/occasion-cultural-abroad.jpg",
  "การเผยแพร่วัฒนธรรมในประเทศ": "/img/home/occasion-cultural-domestic.jpg",
  "งานเผยแพร่วัฒนธรรมในประเทศ": "/img/home/occasion-cultural-domestic.jpg",
  "งานสโมสรสันนิบาต": "/img/home/occasion-state-banquet.jpg",
  "งานต้อนรับอาคันตุกะ": "/img/home/occasion-guest-reception.jpg",
};

interface OccasionSummary {
  context: ContextOut;
  groupLabel: string;
}

export default function OccasionsPage() {
  const [contexts, setContexts] = useState<ContextOut[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | undefined>(undefined);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setContexts(null);
    setError(null);
    setErrorCode(undefined);

    getContexts()
      .then((resp) => {
        if (!cancelled) setContexts(resp.contexts);
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

  const occasions = useMemo(() => buildOccasionSummaries(contexts ?? []), [contexts]);
  const totalItems = useMemo(
    () => occasions.reduce((sum, occ) => sum + (occ.context.active_item_count ?? 0), 0),
    [occasions],
  );

  if (error) {
    return <ErrorState message={error} code={errorCode} onRetry={() => setReloadKey((k) => k + 1)} />;
  }

  return (
    <section className="occasions-page section-stack" aria-label="โอกาสสำคัญทั้งหมด">
      <div className="catalog-search-panel occasions-head-panel">
        <div className="catalog-title-block">
          <div className="catalog-title-row">
            <span className="catalog-title-icon" aria-hidden="true">❖</span>
            <h1>โอกาสสำคัญทั้งหมด</h1>
          </div>
          <p className="catalog-result-count">
            {contexts
              ? <>พบ <span>{formatCount(occasions.length)}</span> โอกาสหรือบริบท จาก <span>{formatCount(totalItems)}</span> ชุดการแสดง</>
              : "กำลังรวบรวมโอกาสสำคัญจากฐานข้อมูล"}
          </p>
        </div>
      </div>

      {!contexts ? (
        <LoadingState message="กำลังโหลดโอกาสสำคัญ..." />
      ) : occasions.length === 0 ? (
        <EmptyState
          title="ยังไม่มีโอกาสสำคัญในระบบ"
          message="เมื่อมีบริบทงานในฐานข้อมูล รายการจะแสดงที่หน้านี้"
        />
      ) : (
        <div className="occasions-grid" aria-label="รายการโอกาสสำคัญทั้งหมด">
          {occasions.map((occ, idx) => (
            <Link
              key={occ.context.id}
              href={`/items?context=${occ.context.id}`}
              className="occasion-card"
            >
              <img
                src={occasionImageFor(occ.context.name, occ.groupLabel, idx)}
                alt=""
                aria-hidden="true"
              />
              <span className="occasion-card-body">
                <span className="occasion-card-kicker">
                  <span aria-hidden="true">{chipIcon(occ.groupLabel || occ.context.name)}</span>
                  {occ.groupLabel}
                </span>
                <strong>{occ.context.name}</strong>
                <small>{formatCount(occ.context.active_item_count)} ชุดการแสดงตามโอกาสนี้</small>
              </span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

function buildOccasionSummaries(contexts: ContextOut[]): OccasionSummary[] {
  return groupContexts(contexts).flatMap((group) =>
    group.contexts.map((context) => ({
      context,
      groupLabel: group.label,
    })),
  );
}

function formatCount(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  return new Intl.NumberFormat("th-TH").format(n);
}

function occasionImageFor(contextName: string, groupLabel: string, idx: number): string {
  return (
    OCCASION_IMAGE_BY_NAME[contextName] ??
    OCCASION_IMAGE_BY_GROUP[groupLabel] ??
    OCCASION_IMAGES[idx % OCCASION_IMAGES.length]
  );
}

function chipIcon(label: string): string {
  if (label.includes("เทศกาล")) return "✣";
  if (label.includes("เผยแพร่")) return "❋";
  if (label.includes("ราชพิธี")) return "♜";
  if (label.includes("อวมงคล")) return "♢";
  if (label.includes("มงคล")) return "✦";
  return "♧";
}
