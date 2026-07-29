"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";

import { ContextPicker } from "@/components/ContextPicker";
import { KeywordPicker } from "@/components/KeywordPicker";

export default function RecommendPage() {
  const router = useRouter();
  const [contextId, setContextId] = useState<number | null>(null);
  const [keywordIds, setKeywordIds] = useState<number[]>([]);
  const [topK, setTopK] = useState(10);
  const [submitting, setSubmitting] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (contextId === null) return;
    setSubmitting(true);
    const params = new URLSearchParams();
    params.set("context_id", String(contextId));
    params.set("top_k", String(topK));
    if (keywordIds.length > 0) {
      params.set("keyword_ids", keywordIds.join(","));
    }
    router.push(`/results?${params.toString()}`);
  }

  const canSubmit = contextId !== null && !submitting;

  return (
    <form onSubmit={handleSubmit} className="section-stack">
      <section className="page-hero">
        <div>
          <p className="eyebrow">Recommendation workflow</p>
          <h1>ค้นหาชุดการแสดง</h1>
          <p className="muted">
            เลือกบริบทและคำสำคัญที่สนใจ ระบบจะกรอง candidate และจัดอันดับด้วย hybrid recommender
          </p>
        </div>
      </section>

      <section className="form-panel">
        <ContextPicker value={contextId} onChange={setContextId} />
        <KeywordPicker selectedIds={keywordIds} onChange={setKeywordIds} />
        <label className="field" style={{ maxWidth: "180px" }}>
          <span>จำนวนผลลัพธ์ (top-K)</span>
          <input
            type="number"
            min={1}
            max={50}
            value={topK}
            onChange={(e) => {
              const n = parseInt(e.target.value, 10);
              if (!isNaN(n) && n >= 1 && n <= 50) setTopK(n);
            }}
          />
        </label>

        <button
          type="submit"
          disabled={!canSubmit}
          style={{ justifySelf: "start", minWidth: "180px" }}
        >
          {submitting ? "กำลังส่งคำขอ..." : "ขอคำแนะนำ"}
        </button>
      </section>
    </form>
  );
}
