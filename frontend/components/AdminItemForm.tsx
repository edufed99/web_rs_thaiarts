"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import {
  ApiClientError,
  getContexts,
  getItem,
  getItemFacets,
  getKeywords,
  postItemCommit,
  postItemDraft,
  uploadItemImage,
} from "@/lib/api";
import type {
  ContextOut,
  ItemDraft,
  ItemDraftOut,
  KeywordOut,
  KeywordProposal,
} from "@/lib/types";

type Step = "draft" | "review";

interface DraftFields {
  name: string;
  description: string;
  category_group: string;
  performance_type: string;
  performers_count: string;
  duration_minutes: string;
  price_text: string;
  context_names: string[];
  keyword_names: string[];
  /**
   * Picked cover image (client-side only). Held in state until the new
   * item is committed; we then POST it to ``/admin/items/{id}/image``
   * before redirecting. Not sent in the draft/commit JSON payload.
   */
  image_file: File | null;
}

const EMPTY_FIELDS: DraftFields = {
  name: "",
  description: "",
  category_group: "",
  performance_type: "",
  performers_count: "",
  duration_minutes: "",
  price_text: "",
  context_names: [],
  keyword_names: [],
  image_file: null,
};

// Client-side pre-check mirrors the backend allow-list + cap. Showing
// the error here gives the admin instant feedback before the form
// submits — the backend will re-validate.
const ALLOWED_IMAGE_MIME = ["image/jpeg", "image/png", "image/webp"] as const;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB
const MAX_IMAGE_LABEL = "5 MB";

const SOURCE_COLOR: Record<KeywordProposal["source"], { bg: string; fg: string; label: string }> = {
  auto: { bg: "#e8f1ff", fg: "#1e6fd9", label: "กฎ (Layer A)" },
  llm: { bg: "#f5e8ff", fg: "#7a3aaa", label: "LLM (Layer B)" },
  human: { bg: "#fff5d6", fg: "#8a6500", label: "ผู้ดูแล" },
};

export function AdminItemForm() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("draft");
  const [fields, setFields] = useState<DraftFields>(EMPTY_FIELDS);
  const [draftResult, setDraftResult] = useState<ItemDraftOut | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [additionalNames, setAdditionalNames] = useState<string>("");
  const [searchResults, setSearchResults] = useState<KeywordOut[]>([]);
  const [submitting, setSubmitting] = useState(false);
  // ``saveMode`` lets the two submit buttons share the ``submitting`` flag
  // while showing different in-progress labels.
  const [saveMode, setSaveMode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Cover-image preview (object URL) + per-field validation message.
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  // Dropdown source data — loaded once when the form mounts. Categories
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

  // Release object URLs when the form unmounts (or the user picks a new
  // file) so the browser doesn't leak the preview image.
  useEffect(() => {
    return () => {
      if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
    };
  }, [imagePreviewUrl]);

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

  function update<K extends keyof DraftFields>(key: K, value: DraftFields[K]) {
    setFields((prev) => ({ ...prev, [key]: value }));
  }

  function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const next = e.target.files?.[0] ?? null;
    setError(null);
    setImageError(null);
    // Clear any existing preview before allocating a new object URL.
    if (imagePreviewUrl) {
      URL.revokeObjectURL(imagePreviewUrl);
      setImagePreviewUrl(null);
    }
    if (!next) {
      update("image_file", null);
      return;
    }
    if (!ALLOWED_IMAGE_MIME.includes(next.type as (typeof ALLOWED_IMAGE_MIME)[number])) {
      setImageError("รองรับเฉพาะไฟล์รูปภาพ JPEG, PNG หรือ WebP เท่านั้น");
      update("image_file", null);
      // Allow the admin to pick again after seeing the error.
      e.target.value = "";
      return;
    }
    if (next.size > MAX_IMAGE_BYTES) {
      setImageError(`ไฟล์ใหญ่เกินไป — สูงสุด ${MAX_IMAGE_LABEL}`);
      update("image_file", null);
      e.target.value = "";
      return;
    }
    setImagePreviewUrl(URL.createObjectURL(next));
    update("image_file", next);
  }

  /**
   * Upload the picked cover image (if any) to the freshly-committed
   * item. Runs after the JSON draft/commit succeeds so we have a real
   * ``artifact_id`` to attach the file to. Failures are surfaced as
   * inline errors but never block the redirect — the catalog row
   * exists either way; the admin can re-upload from the edit page.
   */
  async function uploadCoverIfAny(artifactId: number): Promise<void> {
    if (!fields.image_file) return;
    try {
      await uploadItemImage(artifactId, fields.image_file);
    } catch (e) {
      // Don't throw — the item is already created. Show the message so
      // the admin knows to re-attach the image via the edit page.
      const msg =
        e instanceof ApiClientError
          ? `อัปโหลดรูปไม่สำเร็จ: ${e.message}`
          : "อัปโหลดรูปไม่สำเร็จ";
      // eslint-disable-next-line no-alert
      window.alert(msg);
    }
  }

  async function handleDraft(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaveMode(false);
    if (!fields.name.trim()) {
      setError("กรุณากรอกชื่อการแสดง");
      return;
    }
    setSubmitting(true);
    try {
      const body: ItemDraft = buildDraftBody(fields);
      const result = await postItemDraft(body);
      setDraftResult(result);
      // Pre-select all server proposals — the admin can prune them.
      const ids = new Set<number>();
      result.proposals.forEach((p) => ids.add(p.id));
      setSelectedIds(ids);
      setStep("review");
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  /**
   * Skip Step 2 and commit directly with every server proposal accepted.
   * Useful when the admin trusts the auto/llm suggestions and just wants
   * to persist the row without reviewing the keyword checklist.
   */
  async function handleSave() {
    setError(null);
    setSaveMode(true);
    if (!fields.name.trim()) {
      setError("กรุณากรอกชื่อการแสดง");
      setSaveMode(false);
      return;
    }
    setSubmitting(true);
    try {
      const draft = await postItemDraft(buildDraftBody(fields));
      const out = await postItemCommit({
        draft_id: draft.draft_id,
        additional_keyword_ids: [],
        removed_keyword_ids: [],
      });
      await uploadCoverIfAny(out.item.id);
      try {
        await getItem(out.item.id);
      } catch {
        // ignore
      }
      router.push(`/items/${out.item.id}`);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : String(e));
    } finally {
      setSubmitting(false);
      setSaveMode(false);
    }
  }

  function toggleProposal(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function addFromSearch(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }

  async function handleCommit(e: React.FormEvent) {
    e.preventDefault();
    if (!draftResult) return;
    setError(null);
    setSubmitting(true);
    try {
      const proposalIds = new Set(draftResult.proposals.map((p) => p.id));
      const allSelected = Array.from(selectedIds);
      const additional = allSelected.filter((id) => !proposalIds.has(id));
      const removed = draftResult.proposals
        .map((p) => p.id)
        .filter((id) => !selectedIds.has(id));
      const out = await postItemCommit({
        draft_id: draftResult.draft_id,
        additional_keyword_ids: additional,
        removed_keyword_ids: removed,
      });
      await uploadCoverIfAny(out.item.id);
      // Best-effort: re-fetch the item so we get full context lists, then redirect.
      try {
        await getItem(out.item.id);
      } catch {
        // ignore — the redirect is what matters
      }
      router.push(`/items/${out.item.id}`);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  if (step === "draft") {
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
            accept={ALLOWED_IMAGE_MIME.join(",")}
            onChange={handleImageChange}
            style={inputStyle}
          />
          <small
            className="muted"
            style={{ display: "block", marginTop: "0.25rem" }}
          >
            รองรับไฟล์ JPEG / PNG / WebP ขนาดไม่เกิน {MAX_IMAGE_LABEL}
          </small>
          {imageError ? (
            <div
              role="alert"
              className="error-panel"
              style={{ marginTop: "0.5rem", padding: "0.5rem 0.75rem" }}
            >
              {imageError}
            </div>
          ) : null}
          {imagePreviewUrl ? (
            <div style={{ marginTop: "0.75rem" }}>
              <img
                src={imagePreviewUrl}
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

  // step === "review"
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
        ระบบเสนอคำสำคัญจากกฎ (Layer A) และ LLM (Layer B) สำหรับ &quot;{fields.name}&quot;
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
                    <span style={{ fontWeight: 600 }}>{p.name}</span>
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
              maxHeight: "180px",
              overflowY: "auto",
            }}
          >
            {searchResults.map((k) => (
              <li key={k.id} style={{ padding: "0.2rem 0" }}>
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
                  }}
                >
                  {selectedIds.has(k.id) ? "เพิ่มแล้ว" : "เพิ่ม"} · {k.name}
                </button>
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
          onClick={() => {
            setStep("draft");
            setError(null);
          }}
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

const inputStyle: React.CSSProperties = {
  width: "100%",
};

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="field">
      <span>
        {label}
        {required ? <span style={{ color: "#c00" }}> *</span> : null}
      </span>
      {children}
    </label>
  );
}

/**
 * Parse a numeric form field into ``int | null``. Empty strings, NaN, and
 * negative numbers all collapse to ``null`` so the backend gets a typed
 * optional rather than ``0``.
 */
function parseCount(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.floor(n);
}

/**
 * Map the form's draft field state into an ``ItemDraft`` POST body. Shared
 * by both submit paths (``ดูคำสำคัญที่เสนอ`` → review, and ``บันทึกข้อมูล``
 * → direct commit) so they never drift apart.
 */
function buildDraftBody(fields: DraftFields): ItemDraft {
  return {
    name: fields.name.trim(),
    description: fields.description.trim(),
    category_group: fields.category_group.trim(),
    performance_type: fields.performance_type.trim(),
    performers_count: parseCount(fields.performers_count),
    duration_minutes: parseCount(fields.duration_minutes),
    price_text: fields.price_text.trim(),
    context_names: fields.context_names
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
    keyword_names: fields.keyword_names
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  };
}

/** The "บันทึกข้อมูล" shortcut needs at least a name to make sense. */
function canSave(fields: DraftFields): boolean {
  return fields.name.trim().length > 0;
}

function ErrorBlock({ message }: { message: string }) {
  return (
    <div role="alert" className="error-panel">
      {message}
    </div>
  );
}
