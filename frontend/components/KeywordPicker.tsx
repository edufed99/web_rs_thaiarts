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
      <div style={{ marginBottom: "0.5rem", fontWeight: 600 }}>
        เลือกคำสำคัญ (เลือกได้หลายคำ)
      </div>
      <input
        type="text"
        placeholder="ค้นหาคำสำคัญ..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{
          width: "100%",
          maxWidth: "320px",
          padding: "0.5rem",
          marginBottom: "0.75rem",
          border: "1px solid #ccc",
          borderRadius: "4px",
        }}
      />
      {filtered.length === 0 ? (
        <p style={{ color: "#777" }}>ไม่พบคำสำคัญที่ตรงกับการค้นหา</p>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
          {filtered.map((k) => {
            const active = selectedSet.has(k.id);
            return (
              <button
                key={k.id}
                type="button"
                onClick={() => toggle(k.id)}
                aria-pressed={active}
                style={{
                  padding: "0.4rem 0.8rem",
                  border: "1px solid",
                  borderColor: active ? "#1e6fd9" : "#ccc",
                  backgroundColor: active ? "#1e6fd9" : "#fff",
                  color: active ? "#fff" : "#222",
                  borderRadius: "999px",
                  cursor: "pointer",
                  fontSize: "0.9rem",
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