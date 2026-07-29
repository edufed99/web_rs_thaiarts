"use client";

import React, { useEffect, useMemo, useState } from "react";

import { ApiClientError, getKeywords } from "@/lib/api";
import type { KeywordOut } from "@/lib/types";

import { ErrorState } from "./ErrorState";
import { LoadingState } from "./LoadingState";

export interface KeywordPickerProps {
  selectedIds: number[];
  onChange: (ids: number[]) => void;
  /** Max number of search suggestions shown. */
  limit?: number;
}

export function KeywordPicker({ selectedIds, onChange, limit = 12 }: KeywordPickerProps) {
  const [keywords, setKeywords] = useState<KeywordOut[] | null>(null);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | undefined>(undefined);
  const [reloadKey, setReloadKey] = useState(0);
  const [taxonomyModalOpen, setTaxonomyModalOpen] = useState(false);
  const [selectedKeywordLevel1, setSelectedKeywordLevel1] = useState("");
  const [selectedKeywordLevel2, setSelectedKeywordLevel2] = useState("");
  const [selectedKeywordLevel3, setSelectedKeywordLevel3] = useState("");

  useEffect(() => {
    let cancelled = false;
    setError(null);
    getKeywords()
      .then((data) => {
        if (!cancelled) setKeywords(data.keywords);
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

  const filtered = (() => {
    if (!keywords) return [];
    const needle = search.trim().toLowerCase();
    if (needle.length === 0) return [];
    return keywords
      .filter((k) =>
        `${k.name} ${k.taxonomy_path}`.toLowerCase().includes(needle),
      )
      .slice(0, limit);
  })();

  const keywordTree = useMemo(() => buildKeywordTaxonomy(keywords ?? []), [keywords]);
  const level1Node = keywordTree.find((node) => node.label === selectedKeywordLevel1);
  const level2Options = level1Node?.children ?? [];
  const level2Node = level2Options.find((node) => node.label === selectedKeywordLevel2);
  const level3Options = level2Node?.children ?? [];
  const level3Node = level3Options.find((node) => node.label === selectedKeywordLevel3);
  const keywordOptions = level3Node?.keywords ?? [];

  if (error) {
    return (
      <ErrorState
        message={error}
        code={errorCode}
        onRetry={() => setReloadKey((k) => k + 1)}
      />
    );
  }
  if (!keywords) {
    return <LoadingState message="กำลังโหลดคำสำคัญ..." />;
  }

  const selectedSet = new Set(selectedIds);
  const selectedKeywords = keywords.filter((k) => selectedSet.has(k.id));

  function toggle(id: number) {
    const next = new Set(selectedSet);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    onChange(Array.from(next));
  }

  return (
    <div>
      <div className="form-label" style={{ marginBottom: "0.5rem" }}>
        เลือกคุณลักษณะที่สนใจ (ไม่บังคับ)
      </div>
      <div className="taxonomy-search-row" style={{ maxWidth: "760px", marginBottom: "0.75rem" }}>
        <input
          type="text"
          placeholder="พิมพ์เพื่อค้นหาคำสำคัญ เช่น ราช โขน พิธี ภาคใต้"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: "100%" }}
        />
        <button
          type="button"
          className="taxonomy-browse-button"
          onClick={() => setTaxonomyModalOpen(true)}
          disabled={keywordTree.length === 0}
        >
          เลือกจากหมวดหมู่
        </button>
      </div>
      {selectedKeywords.length > 0 ? (
        <div style={{ marginBottom: "0.85rem" }}>
          <div className="meta-line" style={{ marginBottom: "0.4rem" }}>
            คุณลักษณะที่เลือกแล้ว
          </div>
          <div className="pill-row">
            {selectedKeywords.map((k) => (
              <button
                key={k.id}
                type="button"
                onClick={() => toggle(k.id)}
                className="keyword-pill"
                aria-label={`ลบ ${k.name}`}
                title={k.taxonomy_path || k.name}
                style={{ cursor: "pointer" }}
              >
                {k.name} ×
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {search.trim() ? (
        filtered.length === 0 ? (
          <p style={{ color: "#777", margin: 0 }}>ไม่พบคำสำคัญที่ตรงกับการค้นหา</p>
        ) : (
          <div>
            <div className="meta-line" style={{ marginBottom: "0.4rem" }}>
              ผลการค้นหา
            </div>
            <div className="pill-row">
              {filtered.map((k) => {
                const active = selectedSet.has(k.id);
                return (
                  <button
                    key={k.id}
                    type="button"
                    onClick={() => toggle(k.id)}
                    aria-pressed={active}
                    title={k.taxonomy_path || k.name}
                    style={{
                      padding: "0.45rem 0.85rem",
                      border: "1px solid",
                      borderColor: active ? "#c5913b" : "rgba(197, 145, 59, 0.38)",
                      backgroundColor: active ? "#102a4a" : "#fff7e5",
                      color: active ? "#fffaf0" : "#8a5b17",
                      borderRadius: "8px",
                      cursor: "pointer",
                      fontSize: "0.9rem",
                      fontWeight: 800,
                    }}
                  >
                    {active ? "เลือกแล้ว · " : null}
                    {k.name}
                  </button>
                );
              })}
            </div>
          </div>
        )
      ) : (
        <p className="muted" style={{ margin: 0, fontSize: "0.9rem" }}>
          พิมพ์คำที่สนใจหรือเลือกจากหมวดหมู่ ระบบจะแสดงเฉพาะคำที่ตรง ไม่แสดงรายการทั้งหมดในครั้งเดียว
        </p>
      )}
      {taxonomyModalOpen ? (
        <div
          className="taxonomy-modal-backdrop"
          role="presentation"
          onClick={() => setTaxonomyModalOpen(false)}
        >
          <div
            className="taxonomy-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="keyword-taxonomy-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="taxonomy-modal-head">
              <div>
                <strong id="keyword-taxonomy-modal-title">เลือกจากหมวดหมู่ Keyword Taxonomy</strong>
                <span>เลือก Level 1-3 แล้วกดคำสำคัญมาตรฐานที่ต้องการใช้คำนวณคำแนะนำ</span>
              </div>
              <button
                type="button"
                onClick={() => setTaxonomyModalOpen(false)}
                aria-label="ปิดหน้าต่างเลือกหมวดหมู่"
              >
                ×
              </button>
            </div>

            <div className="taxonomy-browser-grid">
              <TaxonomyOptionList
                title="Level 1"
                options={keywordTree.map((node) => node.label)}
                selected={selectedKeywordLevel1}
                onSelect={(value) => {
                  setSelectedKeywordLevel1(value);
                  setSelectedKeywordLevel2("");
                  setSelectedKeywordLevel3("");
                }}
              />

              <TaxonomyOptionList
                title="Level 2"
                options={level2Options.map((node) => node.label)}
                selected={selectedKeywordLevel2}
                onSelect={(value) => {
                  setSelectedKeywordLevel2(value);
                  setSelectedKeywordLevel3("");
                }}
                emptyText={selectedKeywordLevel1 ? "ไม่มี Level 2" : "เลือก Level 1 ก่อน"}
              />

              <TaxonomyOptionList
                title="Level 3"
                options={level3Options.map((node) => node.label)}
                selected={selectedKeywordLevel3}
                onSelect={(value) => setSelectedKeywordLevel3(value)}
                emptyText={selectedKeywordLevel2 ? "ไม่มี Level 3" : "เลือก Level 2 ก่อน"}
              />

              <div className="taxonomy-level-panel">
                <div className="taxonomy-level-title">Keyword</div>
                {keywordOptions.length > 0 ? (
                  <div className="taxonomy-option-grid">
                    {keywordOptions.map((keyword) => {
                      const active = selectedSet.has(keyword.id);
                      return (
                        <button
                          key={keyword.id}
                          type="button"
                          className={active ? "taxonomy-option active" : "taxonomy-option"}
                          onClick={() => toggle(keyword.id)}
                        >
                          {active ? "เลือกแล้ว · " : null}
                          {keyword.name}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className="taxonomy-empty">
                    {selectedKeywordLevel3 ? "ไม่มีคำศัพท์ในหมวดนี้" : "เลือก Level 3 ก่อน"}
                  </p>
                )}
              </div>
            </div>

            <div className="taxonomy-modal-actions">
              {selectedIds.length > 0 ? (
                <button
                  type="button"
                  className="taxonomy-text-button"
                  onClick={() => onChange([])}
                >
                  ล้างคุณลักษณะที่เลือก
                </button>
              ) : null}
              <button type="button" onClick={() => setTaxonomyModalOpen(false)}>
                เสร็จสิ้น
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function TaxonomyOptionList({
  title,
  options,
  selected,
  onSelect,
  emptyText = "ไม่มีตัวเลือก",
}: {
  title: string;
  options: string[];
  selected: string;
  onSelect: (value: string) => void;
  emptyText?: string;
}) {
  return (
    <div className="taxonomy-level-panel">
      <div className="taxonomy-level-title">{title}</div>
      {options.length > 0 ? (
        <div className="taxonomy-option-grid">
          {options.map((option) => (
            <button
              key={option}
              type="button"
              className={option === selected ? "taxonomy-option active" : "taxonomy-option"}
              onClick={() => onSelect(option)}
            >
              {option}
            </button>
          ))}
        </div>
      ) : (
        <p className="taxonomy-empty">{emptyText}</p>
      )}
    </div>
  );
}

interface KeywordTaxonomyLevel3 {
  label: string;
  keywords: KeywordOut[];
}

interface KeywordTaxonomyLevel2 {
  label: string;
  children: KeywordTaxonomyLevel3[];
}

interface KeywordTaxonomyLevel1 {
  label: string;
  children: KeywordTaxonomyLevel2[];
}

function buildKeywordTaxonomy(keywords: KeywordOut[]): KeywordTaxonomyLevel1[] {
  const tree = new Map<string, Map<string, Map<string, KeywordOut[]>>>();
  for (const keyword of keywords) {
    const [level1, level2, level3] = taxonomyLevelsFor(keyword);
    if (!tree.has(level1)) tree.set(level1, new Map());
    const level2Map = tree.get(level1)!;
    if (!level2Map.has(level2)) level2Map.set(level2, new Map());
    const level3Map = level2Map.get(level2)!;
    level3Map.set(level3, [...(level3Map.get(level3) ?? []), keyword]);
  }

  return Array.from(tree.entries())
    .map(([level1, level2Map]) => ({
      label: level1,
      children: Array.from(level2Map.entries())
        .map(([level2, level3Map]) => ({
          label: level2,
          children: Array.from(level3Map.entries())
            .map(([level3, groupKeywords]) => ({
              label: level3,
              keywords: groupKeywords.sort((a, b) => a.name.localeCompare(b.name, "th")),
            }))
            .sort((a, b) => a.label.localeCompare(b.label, "th")),
        }))
        .sort((a, b) => a.label.localeCompare(b.label, "th")),
    }))
    .sort((a, b) => {
      if (a.label === "คำศัพท์ทั่วไป") return 1;
      if (b.label === "คำศัพท์ทั่วไป") return -1;
      return a.label.localeCompare(b.label, "th");
    });
}

function taxonomyLevelsFor(keyword: KeywordOut): [string, string, string] {
  const parts = (keyword.taxonomy_path || "")
    .split(">")
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === 0) {
    return ["คำศัพท์ทั่วไป", "คำค้นจากรายการการแสดง", "คำสำคัญมาตรฐาน"];
  }

  return [
    parts[0] || "คำศัพท์ทั่วไป",
    parts[1] || "คำค้นจากรายการการแสดง",
    parts[2] || "คำสำคัญมาตรฐาน",
  ];
}
