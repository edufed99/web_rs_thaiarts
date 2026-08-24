"use client";
// Step 2 of the admin item-create form — the keyword selection panel.
// Extracted from ``AdminItemForm.tsx`` (issue #38, ADR-0004 / T11). The
// keyword-search box is its own state; the draft result, the selected-id
// set, and the commit handler come from the parent.
import React, { useEffect, useState } from "react";
import { getKeywords } from "@/lib/api";
import type { ItemDraftOut, KeywordOut, KeywordProposal } from "@/lib/types";
import { ErrorBlock, inputStyle } from "./AdminItemFormShared";
const SOURCE_COLOR: Record<KeywordProposal["source"], { bg: string; fg: string; label: string }> = {
  auto: { bg: "#e8f1ff", fg: "#1e6fd9", label: "กฎ (Layer A)" },
  llm: { bg: "#f5e8ff", fg: "#7a3aaa", label: "LLM (Layer B)" },
  human: { bg: "#fff5d6", fg: "#8a6500", label: "ผู้ดูแล" },
};
export interface AdminItemFormReviewStepProps {
  draftResult: ItemDraftOut | null;
  /** Full item name, shown in the panel description. */
  itemName: string;
  selectedIds: Set<number>;
  toggleProposal: (id: number) => void;
  addFromSearch: (id: number) => void;
  submitting: boolean;
  error: string | null;
  handleCommit: (e: React.FormEvent) => void;
  onBack: () => void;
}
export function AdminItemFormReviewStep({
  draftResult,
  itemName,
  selectedIds,
  toggleProposal,
  addFromSearch,
  submitting,
  error,
  handleCommit,
  onBack,
}: AdminItemFormReviewStepProps) {
  const [additionalNames, setAdditionalNames] = useState<string>("");
  const [searchResults, setSearchResults] = useState<KeywordOut[]>([]);
  // Search existing keyword vocabulary when the admin types in the "add" box.
  useEffect(() => {
    const term = additionalNames.trim();
    if (term.length === 0) {
      setSearchResults([]);
      return;
    }
    let cancelled = false;
    getKeywords(term)
      .then((data) => {
        if (cancelled) return;
        setSearchResults(data.keywords || []);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setSearchResults([]);
        // Silent — search is a non-critical helper.
        void e;
      });
    return () => {
      cancelled = true;
    };
  }, [additionalNames]);
  const proposals = draftResult?.proposals ?? [];
  return (
    <form
      onSubmit={handleCommit}
      className="form-panel"
    >
      <div>
        <p className="eyebrow">Step 2</p>
        <h2 style={{ margin: 0 }}>เลือกคำสำคัญ</h2>
      </div>
      <p className="muted" style={{ margin: 0, fontSize: "0.9rem" }}>
        ระบบเสนอคำสำคัญจากกฎ (Layer A) และ LLM (Layer B) สำหรับ &quot;{itemName}&quot;
        คุณสามารถเพิ่ม/ลดได้ตามต้องการก่อนกดยืนยัน
      </p>

      <div>
        <h3 style={{ margin: "0 0 0.5rem 0" }}>ข้อเสนอจากระบบ ({proposals.length})</h3>
        {proposals.length === 0 ? (
          <p style={{ color: "#777", margin: 0 }}>ไม่มีข้อเสนอ — เพิ่มคำสำคัญด้วยตัวเองด้านล่าง</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: "0.35rem" }}>
            {proposals.map((p) => {
              const checked = selectedIds.has(p.id);
              const color = SOURCE_COLOR[p.source] ?? SOURCE_COLOR.auto;
              return (
                <li key={p.id}>
                  <label
                    style={{
                      display: "flex",
                      gap: "0.5rem",
                      alignItems: "center",
                      padding: "0.4rem 0.6rem",
                      border: `1px solid ${checked ? "#c5913b" : "rgba(197, 145, 59, 0.28)"}`,
                      borderRadius: "8px",
                      cursor: "pointer",
                      backgroundColor: checked ? "#fff7e5" : "#fffaf0",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleProposal(p.id)}
                    />
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.15rem" }}>
                      <span style={{ fontWeight: 600 }}>{p.name}</span>
                      {p.taxonomy_path ? (
                        <span style={{ fontSize: "0.75rem", color: "#666" }}>
                          หมวด: {p.taxonomy_path}
                        </span>
                      ) : null}
                    </div>
                    <span
                      style={{
                        fontSize: "0.75rem",
                        backgroundColor: color.bg,
                        color: color.fg,
                        padding: "0.1rem 0.5rem",
                        borderRadius: "999px",
                      }}
                    >
                      {color.label}
                    </span>
                    <span style={{ marginLeft: "auto", fontSize: "0.8rem", color: "#888" }}>
                      conf {p.confidence.toFixed(2)}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div>
        <h3 style={{ margin: "0 0 0.5rem 0" }}>เพิ่มคำสำคัญจากคลัง</h3>
        <input
          placeholder="พิมพ์เพื่อค้นหา..."
          value={additionalNames}
          onChange={(e) => setAdditionalNames(e.target.value)}
          style={inputStyle}
        />
        {searchResults.length > 0 ? (
          <ul
            style={{
              listStyle: "none",
              padding: "0.5rem",
              margin: "0.25rem 0 0 0",
              border: "1px solid #e3e3e3",
              borderRadius: "4px",
              maxHeight: "220px",
              overflowY: "auto",
            }}
          >
            {searchResults.map((k) => (
              <li key={k.id} style={{ padding: "0.25rem 0", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <button
                  type="button"
                  onClick={() => addFromSearch(k.id)}
                  disabled={selectedIds.has(k.id)}
                  style={{
                    padding: "0.25rem 0.5rem",
                    backgroundColor: selectedIds.has(k.id) ? "#e0e0e0" : "#102a4a",
                    color: selectedIds.has(k.id) ? "#777" : "#fffaf0",
                    border: "none",
                    borderRadius: "3px",
                    fontSize: "0.85rem",
                    cursor: selectedIds.has(k.id) ? "default" : "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  {selectedIds.has(k.id) ? "เพิ่มแล้ว" : "เพิ่ม"} · {k.name}
                </button>
                {k.taxonomy_path ? (
                  <span style={{ fontSize: "0.75rem", color: "#666" }}>
                    ({k.taxonomy_path})
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div>
        <strong>เลือกไว้ทั้งหมด: {selectedIds.size} คำ</strong>
      </div>

      {(draftResult?.warnings ?? []).length > 0 ? (
        <div
          style={{
            backgroundColor: "#fff8dc",
            border: "1px solid #f0e0a0",
            borderRadius: "4px",
            padding: "0.5rem 0.75rem",
            fontSize: "0.85rem",
            color: "#7a5b00",
          }}
        >
          {draftResult!.warnings.map((w, i) => (
            <div key={i}>{w}</div>
          ))}
        </div>
      ) : null}

      {error ? <ErrorBlock message={error} /> : null}

      <div style={{ display: "flex", gap: "0.5rem" }}>
        <button
          type="button"
          onClick={onBack}
          disabled={submitting}
          className="secondary"
        >
          ย้อนกลับ
        </button>
        <button
          type="submit"
          disabled={submitting}
        >
          {submitting ? "กำลังบันทึก..." : "ยืนยันเพิ่มการแสดง"}
        </button>
      </div>
    </form>
  );
}
