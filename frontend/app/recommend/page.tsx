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
    <form onSubmit={handleSubmit} style={{ display: "grid", gap: "1.5rem" }}>
      <section>
        <h2 style={{ marginTop: 0 }}>ขอคำแนะนำ</h2>
        <p style={{ color: "#555", marginTop: 0 }}>
          เลือกบริบทและคำสำคัญที่สนใจ ระบบจะแนะนำรายการที่เหมาะสมที่สุด
        </p>
      </section>

      <section>
        <ContextPicker value={contextId} onChange={setContextId} />
      </section>

      <section>
        <KeywordPicker selectedIds={keywordIds} onChange={setKeywordIds} />
      </section>

      <section>
        <label style={{ display: "block" }}>
          <span style={{ display: "block", marginBottom: "0.5rem", fontWeight: 600 }}>
            จำนวนผลลัพธ์ (top-K)
          </span>
          <input
            type="number"
            min={1}
            max={50}
            value={topK}
            onChange={(e) => {
              const n = parseInt(e.target.value, 10);
              if (!isNaN(n) && n >= 1 && n <= 50) setTopK(n);
            }}
            style={{
              padding: "0.5rem",
              fontSize: "1rem",
              border: "1px solid #ccc",
              borderRadius: "4px",
              width: "100px",
            }}
          />
        </label>
      </section>

      <div>
        <button
          type="submit"
          disabled={!canSubmit}
          style={{
            padding: "0.75rem 1.5rem",
            backgroundColor: canSubmit ? "#1e6fd9" : "#999",
            color: "#fff",
            border: "none",
            borderRadius: "4px",
            fontSize: "1rem",
            fontWeight: 600,
            cursor: canSubmit ? "pointer" : "not-allowed",
          }}
        >
          {submitting ? "กำลังส่งคำขอ..." : "ขอคำแนะนำ"}
        </button>
      </div>
    </form>
  );
}