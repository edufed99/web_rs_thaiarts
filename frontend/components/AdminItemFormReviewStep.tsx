"use client";
// Step 2 of the admin item-create form — the keyword selection panel.
import React, { useEffect, useMemo, useState } from "react";
import { getKeywords } from "@/lib/api";
import type { ItemDraftOut, KeywordOut, KeywordProposal } from "@/lib/types";
import { ErrorBlock, inputStyle } from "./AdminItemFormShared";

const SOURCE_COLOR: Record<KeywordProposal["source"], { bg: string; fg: string; label: string }> = {
  auto: { bg: "#e8f1ff", fg: "#1e6fd9", label: "คำหลัก (584 คำ)" },
  llm: { bg: "#f5e8ff", fg: "#7a3aaa", label: "คำศัพท์ใหม่ (AI)" },
  human: { bg: "#fff5d6", fg: "#8a6500", label: "ผู้ดูแลเพิ่มเอง" },
};

const DOMAIN_TABS = [
  { id: "all", label: "ทั้งหมด" },
  { id: "ศิลปะการแสดงและดนตรี", label: "🎭 ศิลปะการแสดงและดนตรี" },
  { id: "วัฒนธรรมวัตถุ ศิลปกรรม และงานช่าง", label: "🎨 วัฒนธรรมวัตถุฯ" },
  { id: "กลุ่มชาติพันธุ์ ชุมชน และวิถีชีวิต", label: "👥 กลุ่มชาติพันธุ์/วิถีชีวิต" },
  { id: "พิธีกรรม ความเชื่อ และจารีตวัฒนธรรม", label: "🕯️ พิธีกรรม/ความเชื่อ" },
  { id: "วรรณคดีและสิ่งมีชีวิตเชิงตำนาน", label: "📜 วรรณคดี/ตัวละคร" },
  { id: "บริบทเชิงประวัติศาสตร์ ภูมิศาสตร์ และพื้นที่", label: "🗺️ ประวัติศาสตร์/พื้นที่" },
];

export interface AdminItemFormReviewStepProps {
  draftResult: ItemDraftOut | null;
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
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [allMasterKeywords, setAllMasterKeywords] = useState<KeywordOut[]>([]);
  const [activeDomainTab, setActiveDomainTab] = useState<string>("all");
  const [loadingMaster, setLoadingMaster] = useState(true);

  // Load all master vocabulary once on mount
  useEffect(() => {
    let cancelled = false;
    setLoadingMaster(true);
    getKeywords(undefined, 1000)
      .then((data) => {
        if (cancelled) return;
        setAllMasterKeywords(data.keywords || []);
        setLoadingMaster(false);
      })
      .catch(() => {
        if (cancelled) return;
        setLoadingMaster(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const proposals = draftResult?.proposals ?? [];

  // Group proposals by Level-1 Semantic Domain
  const groupedProposals = useMemo(() => {
    const groups: Record<string, KeywordProposal[]> = {};
    for (const p of proposals) {
      const domain = p.taxonomy_path ? p.taxonomy_path.split(">")[0].trim() : "ศิลปะการแสดงและดนตรี";
      if (!groups[domain]) groups[domain] = [];
      groups[domain].push(p);
    }
    return groups;
  }, [proposals]);

  const domainNames = Object.keys(groupedProposals);

  // Filter master keywords based on active domain tab and search term
  const filteredMasterKeywords = useMemo(() => {
    let list = allMasterKeywords;
    if (activeDomainTab !== "all") {
      list = list.filter((k) => k.taxonomy_path && k.taxonomy_path.startsWith(activeDomainTab));
    }
    const q = searchTerm.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (k) =>
          k.name.toLowerCase().includes(q) ||
          (k.taxonomy_path && k.taxonomy_path.toLowerCase().includes(q)),
      );
    }
    return list;
  }, [allMasterKeywords, activeDomainTab, searchTerm]);

  return (
    <form onSubmit={handleCommit} className="form-panel">
      <div>
        <p className="eyebrow">Step 2</p>
        <h2 style={{ margin: 0 }}>ตรวจสอบและเลือกคำสำคัญ</h2>
      </div>
      <p className="muted" style={{ margin: 0, fontSize: "0.9rem" }}>
        ระบบวิเคราะห์และจัดหมวดหมู่คำสำคัญผ่าน Semantic Artifact Pipeline สำหรับ &quot;{itemName}&quot;
        คุณสามารถเลือก/ตัดคำที่ไม่เกี่ยวข้องออก หรือคลิกเลือกคำสำคัญเพิ่มเติมจากคลังได้ทันที
      </p>

      {/* 1. System Proposals */}
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.6rem", flexWrap: "wrap", gap: "0.5rem" }}>
          <h3 style={{ margin: 0 }}>ข้อเสนอจากระบบ ({proposals.length} คำ)</h3>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <span style={{ fontSize: "0.85rem", color: "#666" }}>
              เลือกแล้ว: <strong>{selectedIds.size}</strong> คำ
            </span>
            {proposals.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={() => proposals.forEach((p) => { if (!selectedIds.has(p.id)) toggleProposal(p.id); })}
                  style={{
                    fontSize: "0.75rem",
                    padding: "0.2rem 0.5rem",
                    borderRadius: "4px",
                    border: "1px solid #c5913b",
                    background: "#fff7e5",
                    color: "#8a6015",
                    cursor: "pointer",
                    fontWeight: 600,
                  }}
                >
                  เลือกข้อเสนอทั้งหมด
                </button>
                <button
                  type="button"
                  onClick={() => proposals.forEach((p) => { if (selectedIds.has(p.id)) toggleProposal(p.id); })}
                  style={{
                    fontSize: "0.75rem",
                    padding: "0.2rem 0.5rem",
                    borderRadius: "4px",
                    border: "1px solid #ddd",
                    background: "#f8f8f8",
                    color: "#666",
                    cursor: "pointer",
                  }}
                >
                  ล้างที่เลือก
                </button>
              </>
            )}
          </div>
        </div>

        {proposals.length === 0 ? (
          <p style={{ color: "#777", margin: 0, padding: "1rem", background: "#fcfaf7", borderRadius: "6px" }}>
            ไม่มีข้อเสนอ — สามารถเลือกคำสำคัญจากคลังด้านล่างได้ทันที
          </p>
        ) : (
          <div style={{ display: "grid", gap: "1rem" }}>
            {domainNames.map((domain) => {
              const domainProposals = groupedProposals[domain];
              return (
                <div
                  key={domain}
                  style={{
                    border: "1px solid #e0d8c8",
                    borderRadius: "8px",
                    padding: "0.75rem",
                    backgroundColor: "#faf8f5",
                  }}
                >
                  <div style={{ fontWeight: 600, fontSize: "0.95rem", color: "#6b4f1d", marginBottom: "0.5rem" }}>
                    📁 หมวด: {domain} ({domainProposals.length})
                  </div>
                  <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: "0.35rem" }}>
                    {domainProposals.map((p) => {
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
                              borderRadius: "6px",
                              cursor: "pointer",
                              backgroundColor: checked ? "#fff7e5" : "#ffffff",
                              transition: "all 0.15s ease",
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleProposal(p.id)}
                            />
                            <div style={{ display: "flex", flexDirection: "column", gap: "0.1rem" }}>
                              <span style={{ fontWeight: 600, fontSize: "0.9rem" }}>{p.name}</span>
                              {p.taxonomy_path ? (
                                <span style={{ fontSize: "0.75rem", color: "#666" }}>
                                  เส้นทาง: {p.taxonomy_path}
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
                                whiteSpace: "nowrap",
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
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 2. Interactive Master Keywords Browser */}
      <div
        style={{
          border: "1px solid #dfd7c7",
          borderRadius: "8px",
          padding: "1rem",
          backgroundColor: "#fffdf9",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem", flexWrap: "wrap", gap: "0.5rem" }}>
          <div>
            <h3 style={{ margin: 0 }}>คลังคำสำคัญ Master (584 คำ)</h3>
            <span style={{ fontSize: "0.8rem", color: "#777" }}>
              คลิกเพื่อเพิ่มคำสำคัญที่เกี่ยวข้องได้ทันที โดยไม่ต้องพิมพ์เอง
            </span>
          </div>
          <span style={{ fontSize: "0.85rem", color: "#666" }}>
            แสดง {filteredMasterKeywords.length} คำ
          </span>
        </div>

        {/* Search Filter */}
        <input
          placeholder="พิมพ์ค้นหาคำสำคัญในคลัง..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          style={{
            ...inputStyle,
            padding: "0.4rem 0.6rem",
            fontSize: "0.85rem",
            marginBottom: "0.6rem",
          }}
        />

        {/* Domain Tabs */}
        <div
          style={{
            display: "flex",
            gap: "0.3rem",
            overflowX: "auto",
            paddingBottom: "0.4rem",
            marginBottom: "0.6rem",
            borderBottom: "1px solid #eee",
          }}
        >
          {DOMAIN_TABS.map((tab) => {
            const isActive = activeDomainTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveDomainTab(tab.id)}
                style={{
                  padding: "0.3rem 0.6rem",
                  borderRadius: "6px",
                  border: isActive ? "1px solid #c5913b" : "1px solid #e3e3e3",
                  backgroundColor: isActive ? "#fff7e5" : "#ffffff",
                  color: isActive ? "#8a6015" : "#555",
                  fontWeight: isActive ? 600 : 400,
                  fontSize: "0.8rem",
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Master Keywords Chip Grid */}
        {loadingMaster ? (
          <p style={{ color: "#888", fontSize: "0.85rem", margin: 0 }}>กำลังโหลดคลังคำสำคัญ...</p>
        ) : filteredMasterKeywords.length === 0 ? (
          <p style={{ color: "#888", fontSize: "0.85rem", margin: 0 }}>ไม่พบคำสำคัญที่ค้นหา</p>
        ) : (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "0.4rem",
              maxHeight: "240px",
              overflowY: "auto",
              padding: "2px",
            }}
          >
            {filteredMasterKeywords.map((k) => {
              const isSelected = selectedIds.has(k.id);
              return (
                <button
                  key={k.id}
                  type="button"
                  onClick={() => addFromSearch(k.id)}
                  title={k.taxonomy_path}
                  style={{
                    padding: "0.3rem 0.65rem",
                    borderRadius: "999px",
                    border: isSelected ? "1.5px solid #c5913b" : "1px solid #dcd5c7",
                    backgroundColor: isSelected ? "#fff7e5" : "#ffffff",
                    color: isSelected ? "#8a6015" : "#333333",
                    fontWeight: isSelected ? 600 : 400,
                    fontSize: "0.82rem",
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "0.3rem",
                    transition: "all 0.15s ease",
                    boxShadow: isSelected ? "0 1px 3px rgba(197, 145, 59, 0.2)" : "none",
                  }}
                >
                  <span style={{ fontWeight: 700, color: isSelected ? "#c5913b" : "#888" }}>
                    {isSelected ? "✓" : "+"}
                  </span>
                  <span>{k.name}</span>
                </button>
              );
            })}
          </div>
        )}
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
