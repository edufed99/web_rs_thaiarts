"use client";
// Step 1 of the admin item-create form — the draft data-entry panel.
// Extracted from ``AdminItemForm.tsx`` (issue #38, ADR-0004 / T11). Owns
// only its presentational state (the category/performance cascade memo,
// the dropdown source data, and the facets-loading flag); the form fields,
// the keyword selection, and the submit handlers are owned by the parent
// and passed down.
import React, { useEffect, useMemo, useState } from "react";
import { getContexts, getItemFacets } from "@/lib/api";
import type { ContextOut } from "@/lib/types";
import { ErrorBlock, Field, inputStyle } from "./AdminItemFormShared";
import type { UseCoverImageReturn } from "./useCoverImage";
import { canSave, type DraftFields } from "./AdminItemFormHelpers";
export interface AdminItemFormDraftStepProps {
  fields: DraftFields;
  setFields: React.Dispatch<React.SetStateAction<DraftFields>>;
  submitting: boolean;
  saveMode: boolean;
  error: string | null;
  handleDraft: (e: React.FormEvent) => void;
  handleSave: () => void;
  cover: UseCoverImageReturn;
}
export function AdminItemFormDraftStep({
  fields,
  setFields,
  submitting,
  saveMode,
  error,
  handleDraft,
  handleSave,
  cover,
}: AdminItemFormDraftStepProps) {
  // Cover image preview + upload (issue #38). The picked file stays
  // in the parent's draft-field state; the hook reads/writes it through
  // ``setFields`` so the save flow is unchanged.
  const update = <K extends keyof DraftFields>(key: K, value: DraftFields[K]) =>
    setFields((prev) => ({ ...prev, [key]: value }));
  // Dropdown source data — loaded once when the step mounts. Categories
  // and performance types come from the admin-only ``/admin/items/facets``
  // endpoint (DB-first, artifact fallback), contexts from the public
  // ``/contexts`` endpoint.
  const [categoryGroups, setCategoryGroups] = useState<string[]>([]);
  const [performanceTypes, setPerformanceTypes] = useState<string[]>([]);
  const [categoryGroupsByPerformance, setCategoryGroupsByPerformance] = useState<
    Record<string, string[]>
  >({});
  const [contextOptions, setContextOptions] = useState<ContextOut[]>([]);
  const [contextSearch, setContextSearch] = useState<string>("");
  const [facetsLoading, setFacetsLoading] = useState(true);

  const filteredContextOptions = useMemo(() => {
    const term = contextSearch.trim().toLowerCase();
    if (!term) return contextOptions;
    return contextOptions.filter(
      (c) =>
        c.name.toLowerCase().includes(term) ||
        (c.group && c.group.toLowerCase().includes(term)),
    );
  }, [contextOptions, contextSearch]);

  // Cascade: when the admin picks ``ประเภทการแสดง`` the ``หมวดหมู่``
  // dropdown is filtered to the categories seen with that performance
  // type. If the previously-picked category no longer matches the new
  // performance we clear it so the form can't submit a stale combo.
  const categoryOptionsForPerformance = useMemo(() => {
    const perf = fields.performance_type;
    if (!perf) return categoryGroups;
    const filtered = categoryGroupsByPerformance[perf];
    if (filtered && filtered.length > 0) return filtered;
    // Defensive fallback — if the cascade map doesn't have this key
    // (yet — facets endpoint might lag), keep the full list visible so
    // the admin isn't stuck with an empty dropdown.
    return categoryGroups;
  }, [fields.performance_type, categoryGroupsByPerformance, categoryGroups]);
  useEffect(() => {
    let cancelled = false;
    setFacetsLoading(true);
    Promise.all([
      getItemFacets().catch(
        () =>
          ({
            category_groups: [],
            performance_types: [],
            category_groups_by_performance_type: {},
            source: "artifact" as const,
          }),
      ),
      getContexts().catch(() => ({ contexts: [] as ContextOut[] })),
    ])
      .then(([facets, ctxResp]) => {
        if (cancelled) return;
        setCategoryGroups(facets.category_groups || []);
        setPerformanceTypes(facets.performance_types || []);
        setCategoryGroupsByPerformance(facets.category_groups_by_performance_type || {});
        setContextOptions(ctxResp.contexts || []);
        setFacetsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return (
    <form
      onSubmit={handleDraft}
      className="form-panel"
    >
      <div>
        <p className="eyebrow">Step 1</p>
        <h2 style={{ margin: 0 }}>กรอกข้อมูลการแสดง</h2>
      </div>

      <Field label="ชื่อการแสดง" required>
        <input
          required
          maxLength={255}
          value={fields.name}
          onChange={(e) => update("name", e.target.value)}
          style={inputStyle}
        />
      </Field>

      <Field label="คำอธิบาย">
        <textarea
          rows={4}
          maxLength={2000}
          value={fields.description}
          onChange={(e) => update("description", e.target.value)}
          style={{ ...inputStyle, fontFamily: "inherit", resize: "vertical" }}
        />
      </Field>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
        <Field label="ประเภทการแสดง">
          <select
            value={fields.performance_type}
            onChange={(e) => {
              const nextPerf = e.target.value;
              setFields((prev) => {
                // Clear the category if it doesn't pair with the new
                // performance_type so the admin can't submit a stale
                // combo.
                const allowed =
                  categoryGroupsByPerformance[nextPerf] ?? categoryGroups;
                const keepCat =
                  nextPerf === "" ||
                  prev.category_group === "" ||
                  allowed.includes(prev.category_group);
                return {
                  ...prev,
                  performance_type: nextPerf,
                  category_group: keepCat ? prev.category_group : "",
                };
              });
            }}
            disabled={facetsLoading}
            style={inputStyle}
          >
            <option value="">
              {facetsLoading ? "กำลังโหลด..." : "— เลือกประเภทการแสดง —"}
            </option>
            {performanceTypes.map((value) => (
              <option key={value} value={value}>{value}</option>
            ))}
          </select>
        </Field>
        <Field label="หมวดหมู่">
          <select
            value={fields.category_group}
            onChange={(e) => update("category_group", e.target.value)}
            disabled={facetsLoading || !fields.performance_type}
            style={inputStyle}
          >
            <option value="">
              {!fields.performance_type
                ? "เลือกประเภทการแสดงก่อน"
                : facetsLoading
                  ? "กำลังโหลด..."
                  : "— เลือกหมวดหมู่ —"}
            </option>
            {categoryOptionsForPerformance.map((value) => (
              <option key={value} value={value}>{value}</option>
            ))}
          </select>
        </Field>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "1rem" }}>
        <Field label="จำนวนผู้แสดง">
          <input
            type="number"
            min={0}
            step={1}
            value={fields.performers_count}
            onChange={(e) => update("performers_count", e.target.value)}
            style={inputStyle}
          />
        </Field>
        <Field label="ระยะเวลาการแสดง (นาที)">
          <input
            type="number"
            min={0}
            step={1}
            value={fields.duration_minutes}
            onChange={(e) => update("duration_minutes", e.target.value)}
            style={inputStyle}
          />
        </Field>
        <Field label="ราคาต่อชุด">
          <input
            maxLength={255}
            placeholder="เช่น 24,000"
            value={fields.price_text}
            onChange={(e) => update("price_text", e.target.value)}
            style={inputStyle}
          />
        </Field>
      </div>

      <Field label="โอกาสการแสดง (เลือกได้หลายโอกาส)">
        <div
          style={{
            border: "1px solid #e0d8c8",
            borderRadius: "8px",
            padding: "0.85rem",
            backgroundColor: "#fffdfa",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "0.6rem",
              flexWrap: "wrap",
              gap: "0.5rem",
            }}
          >
            <div style={{ fontSize: "0.85rem", color: "#666" }}>
              เลือกแล้ว <strong>{fields.context_names.length}</strong> / {contextOptions.length} โอกาส
            </div>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              {fields.context_names.length > 0 && (
                <button
                  type="button"
                  onClick={() => update("context_names", [])}
                  style={{
                    fontSize: "0.75rem",
                    padding: "0.2rem 0.5rem",
                    borderRadius: "4px",
                    border: "1px solid #e3e3e3",
                    background: "#f5f5f5",
                    cursor: "pointer",
                    color: "#666",
                  }}
                >
                  ล้างทั้งหมด
                </button>
              )}
              {fields.context_names.length < contextOptions.length && (
                <button
                  type="button"
                  onClick={() => update("context_names", contextOptions.map((c) => c.name))}
                  style={{
                    fontSize: "0.75rem",
                    padding: "0.2rem 0.5rem",
                    borderRadius: "4px",
                    border: "1px solid #c5913b",
                    background: "#fff7e5",
                    cursor: "pointer",
                    color: "#8a6015",
                    fontWeight: 600,
                  }}
                >
                  เลือกทั้งหมด
                </button>
              )}
            </div>
          </div>

          <input
            type="text"
            placeholder="พิมพ์เพื่อค้นหาโอกาสการแสดง..."
            value={contextSearch}
            onChange={(e) => setContextSearch(e.target.value)}
            style={{
              ...inputStyle,
              padding: "0.35rem 0.6rem",
              fontSize: "0.85rem",
              marginBottom: "0.6rem",
            }}
          />

          {facetsLoading ? (
            <p style={{ color: "#888", fontSize: "0.85rem", margin: 0 }}>กำลังโหลดโอกาสการแสดง...</p>
          ) : filteredContextOptions.length === 0 ? (
            <p style={{ color: "#888", fontSize: "0.85rem", margin: 0 }}>ไม่พบโอกาสการแสดงที่ค้นหา</p>
          ) : (
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "0.4rem",
                maxHeight: "220px",
                overflowY: "auto",
                padding: "2px",
              }}
            >
              {filteredContextOptions.map((ctx) => {
                const selected = fields.context_names.includes(ctx.name);
                return (
                  <button
                    key={ctx.id}
                    type="button"
                    onClick={() => {
                      const next = selected
                        ? fields.context_names.filter((n) => n !== ctx.name)
                        : [...fields.context_names, ctx.name];
                      update("context_names", next);
                    }}
                    style={{
                      padding: "0.35rem 0.75rem",
                      borderRadius: "999px",
                      border: selected ? "1.5px solid #c5913b" : "1px solid #dcd5c7",
                      backgroundColor: selected ? "#fff7e5" : "#ffffff",
                      color: selected ? "#8a6015" : "#333333",
                      fontWeight: selected ? 600 : 400,
                      fontSize: "0.85rem",
                      cursor: "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "0.35rem",
                      transition: "all 0.15s ease",
                      boxShadow: selected ? "0 1px 3px rgba(197, 145, 59, 0.2)" : "none",
                    }}
                  >
                    <span style={{ fontSize: "0.9rem", color: selected ? "#c5913b" : "#888", fontWeight: 700 }}>
                      {selected ? "✓" : "+"}
                    </span>
                    <span>{ctx.name}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </Field>

      <Field label="รูปภาพการแสดง (ไม่บังคับ)">
        <input
          type="file"
          accept={cover.allowedImageMime.join(",")}
          onChange={cover.handleImageChange}
          style={inputStyle}
        />
        <small
          className="muted"
          style={{ display: "block", marginTop: "0.25rem" }}
        >
          รองรับไฟล์ JPEG / PNG / WebP ขนาดไม่เกิน {cover.maxImageLabel}
        </small>
        {cover.imageError ? (
          <div
            role="alert"
            className="error-panel"
            style={{ marginTop: "0.5rem", padding: "0.5rem 0.75rem" }}
          >
            {cover.imageError}
          </div>
        ) : null}
        {cover.imagePreviewUrl ? (
          <div style={{ marginTop: "0.75rem" }}>
            <img
              src={cover.imagePreviewUrl}
              alt="ตัวอย่างรูปภาพ"
              style={{
                maxWidth: "220px",
                maxHeight: "160px",
                borderRadius: "8px",
                border: "1px solid rgba(197, 145, 59, 0.28)",
                objectFit: "cover",
              }}
            />
            <small
              className="muted"
              style={{ display: "block", marginTop: "0.25rem" }}
            >
              รูปจะถูกอัปโหลดหลังจากบันทึกข้อมูลเรียบร้อย
            </small>
          </div>
        ) : null}
      </Field>

      {error ? <ErrorBlock message={error} /> : null}

      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        <button
          type="button"
          disabled={submitting || !canSave(fields)}
          onClick={() => void handleSave()}
          className="secondary"
        >
          {submitting && saveMode ? "กำลังบันทึก..." : "บันทึกข้อมูล"}
        </button>
        <button
          type="submit"
          disabled={submitting}
        >
          {submitting && !saveMode ? "กำลังวิเคราะห์..." : "ดูคำสำคัญที่เสนอ"}
        </button>
      </div>
    </form>
  );
}
