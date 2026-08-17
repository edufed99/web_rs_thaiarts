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
  const [facetsLoading, setFacetsLoading] = useState(true);
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

      <Field label="โอกาสการแสดง">
        <select
          value={fields.context_names[0] ?? ""}
          onChange={(e) =>
            update(
              "context_names",
              e.target.value ? [e.target.value] : [],
            )
          }
          disabled={facetsLoading}
          style={inputStyle}
        >
          <option value="">
            {facetsLoading ? "กำลังโหลด..." : "— เลือกโอกาสการแสดง —"}
          </option>
          {contextOptions.map((ctx) => (
            <option key={ctx.id} value={ctx.name}>
              {ctx.name}
            </option>
          ))}
        </select>
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

      <Field label="คำสำคัญที่รู้แล้ว (คั่นด้วยจุลภาค, ไม่บังคับ)">
        <input
          placeholder="เช่น โขน, ละคร, นาฏศิลป์"
          value={fields.keyword_names.join(", ")}
          onChange={(e) =>
            update(
              "keyword_names",
              e.target.value.split(",").map((s) => s.trim()),
            )
          }
          style={inputStyle}
        />
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
