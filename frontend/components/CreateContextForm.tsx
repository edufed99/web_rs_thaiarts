"use client";

import React, { useState } from "react";

import { createAdminContext } from "@/lib/api";
import type { ContextOut } from "@/lib/types";

export interface CreateContextFormProps {
  existingGroups: string[];
  onCreated: (created: ContextOut) => void;
  disabled?: boolean;
}

export function CreateContextForm({
  existingGroups,
  onCreated,
  disabled = false,
}: CreateContextFormProps) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [newSubContext, setNewSubContext] = useState("");
  const [newMainContext, setNewMainContext] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");

  const handleCreateContext = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newSubContext.trim();
    if (!name) {
      setCreateError("กรุณาระบุชื่อบริบทย่อย");
      return;
    }

    setCreating(true);
    setCreateError("");

    try {
      const created = await createAdminContext({
        name,
        group_name: newMainContext.trim(),
        description: newDescription.trim(),
      });

      onCreated(created);

      setNewSubContext("");
      setNewMainContext("");
      setNewDescription("");
      setShowAddForm(false);
    } catch (err: unknown) {
      setCreateError(err instanceof Error ? err.message : "สร้างบริบทไม่สำเร็จ");
    } finally {
      setCreating(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setShowAddForm(!showAddForm)}
        disabled={disabled}
        style={{
          background: showAddForm ? "#f0f4f9" : "rgba(197, 145, 59, 0.12)",
          border: "1px solid rgba(197, 145, 59, 0.4)",
          color: "var(--navy-800, #061b3c)",
          borderRadius: "6px",
          padding: "4px 10px",
          fontSize: "0.85rem",
          fontWeight: 500,
          cursor: "pointer",
        }}
      >
        {showAddForm ? "✕ ปิดฟอร์มเพิ่มบริบท" : "+ เพิ่มบริบทหลัก / บริบทย่อยใหม่"}
      </button>

      {showAddForm ? (
        <form
          onSubmit={handleCreateContext}
          style={{
            background: "#f8fafc",
            border: "1px solid #e2e8f0",
            borderRadius: "8px",
            padding: "0.75rem",
            display: "grid",
            gap: "0.5rem",
            width: "100%",
          }}
        >
          <div style={{ fontWeight: 600, fontSize: "0.85rem", color: "var(--navy-800, #061b3c)" }}>
            เพิ่มบริบทใหม่
          </div>

          {createError ? (
            <div style={{ color: "#c33", fontSize: "0.8rem" }}>{createError}</div>
          ) : null}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
            <div>
              <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 500, marginBottom: "4px" }}>
                บริบทหลัก (หมวดหมู่หลัก)
              </label>
              <input
                list="existing-groups-list"
                placeholder="เช่น งานมงคล, เทศกาลสำคัญ"
                value={newMainContext}
                onChange={(e) => setNewMainContext(e.target.value)}
                style={{ width: "100%", padding: "6px 10px", borderRadius: "6px", border: "1px solid #ccc", fontSize: "0.85rem" }}
              />
              <datalist id="existing-groups-list">
                {existingGroups.map((g) => (
                  <option key={g} value={g} />
                ))}
              </datalist>
            </div>

            <div>
              <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 500, marginBottom: "4px" }}>
                บริบทย่อย (ชื่อบริบทที่นำไปใช้) <span style={{ color: "red" }}>*</span>
              </label>
              <input
                required
                placeholder="เช่น วันขึ้นปีใหม่, พิธีไหว้ครู"
                value={newSubContext}
                onChange={(e) => setNewSubContext(e.target.value)}
                style={{ width: "100%", padding: "6px 10px", borderRadius: "6px", border: "1px solid #ccc", fontSize: "0.85rem" }}
              />
            </div>
          </div>

          <div>
            <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 500, marginBottom: "4px" }}>
              คำอธิบายเพิ่มเติม (ไม่บังคับ)
            </label>
            <input
              placeholder="ระบุรายละเอียดบริบทสำหรับงานวิจัย / การแนะนำ"
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              style={{ width: "100%", padding: "6px 10px", borderRadius: "6px", border: "1px solid #ccc", fontSize: "0.85rem" }}
            />
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem" }}>
            <button
              type="button"
              onClick={() => setShowAddForm(false)}
              style={{ padding: "5px 12px", borderRadius: "6px", border: "1px solid #ccc", background: "#fff", cursor: "pointer", fontSize: "0.85rem" }}
            >
              ยกเลิก
            </button>
            <button
              type="submit"
              disabled={creating}
              style={{
                padding: "5px 14px",
                borderRadius: "6px",
                border: "none",
                background: "var(--gold-600, #c5913b)",
                color: "#fff",
                fontWeight: 600,
                cursor: "pointer",
                fontSize: "0.85rem",
              }}
            >
              {creating ? "กำลังบันทึก..." : "บันทึกและเลือกบริบทนี้"}
            </button>
          </div>
        </form>
      ) : null}
    </>
  );
}
