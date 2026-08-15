"use client";

import Link from "next/link";
import React, { useEffect, useMemo, useState } from "react";

import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { LoadingState } from "@/components/LoadingState";
import { ApiClientError, getContexts } from "@/lib/api";
import { buildOccasionSummaries, occasionImageFor } from "@/lib/occasionCatalog";
import type { ContextOut } from "@/lib/types";

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

function formatCount(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  return new Intl.NumberFormat("th-TH").format(n);
}

function chipIcon(label: string): string {
  if (label.includes("เทศกาล")) return "✣";
  if (label.includes("เผยแพร่")) return "❋";
  if (label.includes("ราชพิธี")) return "♜";
  if (label.includes("อวมงคล")) return "♢";
  if (label.includes("มงคล")) return "✦";
  return "♧";
}
