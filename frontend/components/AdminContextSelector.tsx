"use client";

import React, { useEffect, useMemo, useState } from "react";

import { getContexts } from "@/lib/api";
import type { ContextOut } from "@/lib/types";
import { CreateContextForm } from "./CreateContextForm";

export interface AdminContextSelectorProps {
  selectedNames: string[];
  onChange: (names: string[]) => void;
  disabled?: boolean;
}

export function AdminContextSelector({
  selectedNames,
  onChange,
  disabled = false,
}: AdminContextSelectorProps) {
  const [allContexts, setAllContexts] = useState<ContextOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");
  const [searchTerm, setSearchTerm] = useState("");

  const refreshContexts = () => {
    setLoading(true);
    setError("");
    getContexts()
      .then((res) => {
        setAllContexts(res.contexts || []);
        setLoading(false);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "โหลดรายการบริบทไม่สำเร็จ");
        setLoading(false);
      });
  };

  useEffect(() => {
    refreshContexts();
  }, []);

  // Distinct list of existing main groups
  const existingGroups = useMemo(() => {
    const groups = new Set<string>();
    for (const c of allContexts) {
      if (c.group && c.group.trim()) {
        groups.add(c.group.trim());
      }
    }
    return Array.from(groups).sort();
  }, [allContexts]);

  // Group contexts by main group
  const groupedContexts = useMemo(() => {
    const groups: Record<string, ContextOut[]> = {};
    const filtered = allContexts.filter((c) =>
      searchTerm.trim()
        ? c.name.toLowerCase().includes(searchTerm.toLowerCase().trim()) ||
          c.group.toLowerCase().includes(searchTerm.toLowerCase().trim())
        : true,
    );

    for (const ctx of filtered) {
      const gName = ctx.group && ctx.group.trim() ? ctx.group.trim() : "บริบททั่วไป / อื่นๆ";
      if (!groups[gName]) {
        groups[gName] = [];
      }
      groups[gName].push(ctx);
    }

    return groups;
  }, [allContexts, searchTerm]);

  const selectedSet = useMemo(() => new Set(selectedNames), [selectedNames]);

  const toggleContext = (name: string) => {
    if (disabled) return;
    const next = new Set(selectedNames);
    if (next.has(name)) {
      next.delete(name);
    } else {
      next.add(name);
    }
    onChange(Array.from(next));
  };

  const selectAllInGroup = (contexts: ContextOut[]) => {
    if (disabled) return;
    const next = new Set(selectedNames);
    const allSelected = contexts.every((c) => next.has(c.name));
    if (allSelected) {
      for (const c of contexts) next.delete(c.name);
    } else {
      for (const c of contexts) next.add(c.name);
    }
    onChange(Array.from(next));
  };

  const handleCreated = (created: ContextOut) => {
    setAllContexts((prev) => {
      const exists = prev.some((c) => c.id === created.id || c.name === created.name);
      if (exists) return prev;
      return [...prev, created];
    });

    if (!selectedSet.has(created.name)) {
      onChange([...selectedNames, created.name]);
    }
  };

  return (
    <div className="admin-context-selector" style={{ display: "grid", gap: "0.85rem" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "0.5rem",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <span style={{ fontSize: "0.9rem", fontWeight: 600, color: "var(--navy-800, #061b3c)" }}>
            บริบทที่เลือก ({selectedNames.length} รายการ)
          </span>
          {selectedNames.length > 0 ? (
            <button
              type="button"
              onClick={() => onChange([])}
              disabled={disabled}
              style={{
                background: "none",
                border: "none",
                color: "#c33",
                fontSize: "0.8rem",
                cursor: "pointer",
                padding: "2px 6px",
              }}
            >
              ล้างทั้งหมด
            </button>
          ) : null}
        </div>

        <CreateContextForm
          existingGroups={existingGroups}
          onCreated={handleCreated}
          disabled={disabled}
        />
      </div>

      {/* Search filter for contexts */}
      {allContexts.length > 8 ? (
        <input
          type="search"
          placeholder="ค้นหาบริบท..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          style={{
            width: "100%",
            padding: "6px 10px",
            borderRadius: "6px",
            border: "1px solid #dce4ee",
            fontSize: "0.85rem",
          }}
        />
      ) : null}

      {loading ? (
        <div style={{ color: "#666", fontSize: "0.85rem", padding: "8px 0" }}>กำลังโหลดบริบท...</div>
      ) : error ? (
        <div style={{ color: "#c33", fontSize: "0.85rem" }}>{error}</div>
      ) : Object.keys(groupedContexts).length === 0 ? (
        <div style={{ color: "#666", fontSize: "0.85rem" }}>ไม่พบบริบทที่ตรงกับการค้นหา</div>
      ) : (
        <div
          style={{
            maxHeight: "320px",
            overflowY: "auto",
            border: "1px solid #e2e8f0",
            borderRadius: "8px",
            padding: "0.75rem",
            background: "#fff",
            display: "grid",
            gap: "0.85rem",
          }}
        >
          {Object.entries(groupedContexts).map(([groupName, contexts]) => {
            const allSelected = contexts.every((c) => selectedSet.has(c.name));

            return (
              <div
                key={groupName}
                style={{
                  borderBottom: "1px solid #f1f5f9",
                  paddingBottom: "0.6rem",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: "0.4rem",
                  }}
                >
                  <span
                    style={{
                      fontSize: "0.82rem",
                      fontWeight: 700,
                      color: "var(--navy-700, #0a2540)",
                      textTransform: "uppercase",
                      letterSpacing: "0.3px",
                    }}
                  >
                    📂 {groupName}
                  </span>
                  <button
                    type="button"
                    onClick={() => selectAllInGroup(contexts)}
                    disabled={disabled}
                    style={{
                      background: "none",
                      border: "none",
                      color: "#4a7bb0",
                      fontSize: "0.75rem",
                      cursor: "pointer",
                      padding: "1px 4px",
                    }}
                  >
                    {allSelected ? "ยกเลิกทั้งหมวด" : "เลือกทั้งหมวด"}
                  </button>
                </div>

                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: "0.4rem",
                  }}
                >
                  {contexts.map((ctx) => {
                    const isChecked = selectedSet.has(ctx.name);
                    return (
                      <label
                        key={ctx.id}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "5px",
                          padding: "4px 9px",
                          borderRadius: "6px",
                          fontSize: "0.82rem",
                          cursor: disabled ? "not-allowed" : "pointer",
                          backgroundColor: isChecked ? "rgba(197, 145, 59, 0.15)" : "#f8fafc",
                          border: isChecked ? "1px solid #c5913b" : "1px solid #e2e8f0",
                          color: isChecked ? "#684812" : "#334155",
                          fontWeight: isChecked ? 600 : 400,
                          transition: "all 0.15s ease",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          disabled={disabled}
                          onChange={() => toggleContext(ctx.name)}
                          style={{ cursor: "pointer", margin: 0 }}
                        />
                        <span>{ctx.name}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
