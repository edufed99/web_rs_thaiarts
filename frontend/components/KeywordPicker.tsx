"use client";

import React, { useEffect, useState } from "react";

import { ApiClientError, getKeywords } from "@/lib/api";
import type { KeywordOut } from "@/lib/types";

import { ErrorState } from "./ErrorState";
import { LoadingState } from "./LoadingState";

export interface KeywordPickerProps {
  selectedIds: number[];
  onChange: (ids: number[]) => void;
  /** Max number of keywords shown. */
  limit?: number;
}

export function KeywordPicker({ selectedIds, onChange, limit = 200 }: KeywordPickerProps) {
  const [keywords, setKeywords] = useState<KeywordOut[] | null>(null);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | undefined>(undefined);
  const [reloadKey, setReloadKey] = useState(0);

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
    if (search.trim().length === 0) return keywords.slice(0, limit);
    const needle = search.toLowerCase();
    return keywords
      .filter((k) => k.name.toLowerCase().includes(needle))
      .slice(0, limit);
  })();

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
        เลือกคำสำคัญ (เลือกได้หลายคำ)
      </div>
      <input
        type="text"
        placeholder="ค้นหาคำสำคัญ..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{ maxWidth: "360px", marginBottom: "0.75rem" }}
      />
      {filtered.length === 0 ? (
        <p style={{ color: "#777" }}>ไม่พบคำสำคัญที่ตรงกับการค้นหา</p>
      ) : (
        <div className="pill-row">
          {filtered.map((k) => {
            const active = selectedSet.has(k.id);
            return (
              <button
                key={k.id}
                type="button"
                onClick={() => toggle(k.id)}
                aria-pressed={active}
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
                {k.name}
              </button>
            );
          })}
        </div>
      )}
      {selectedIds.length > 0 ? (
        <p style={{ marginTop: "0.75rem", color: "#555" }}>
          เลือกแล้ว {selectedIds.length} คำ
        </p>
      ) : null}
    </div>
  );
}
