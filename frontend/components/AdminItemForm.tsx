"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import {
  ApiClientError,
  getItem,
  getKeywords,
  postItemCommit,
  postItemDraft,
} from "@/lib/api";
import type {
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
  context_names: string[];
  keyword_names: string[];
}

const EMPTY_FIELDS: DraftFields = {
  name: "",
  description: "",
  category_group: "",
  performance_type: "",
  context_names: [],
  keyword_names: [],
};

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
  const [error, setError] = useState<string | null>(null);

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

  async function handleDraft(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!fields.name.trim()) {
      setError("กรุณากรอกชื่อการแสดง");
      return;
    }
    setSubmitting(true);
    try {
      const body: ItemDraft = {
        name: fields.name.trim(),
        description: fields.description.trim(),
        category_group: fields.category_group.trim(),
        performance_type: fields.performance_type.trim(),
        context_names: fields.context_names
          .map((s) => s.trim())
          .filter((s) => s.length > 0),
        keyword_names: fields.keyword_names
          .map((s) => s.trim())
          .filter((s) => s.length > 0),
      };
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
          <Field label="หมวดหมู่">
            <input
              maxLength={255}
              value={fields.category_group}
              onChange={(e) => update("category_group", e.target.value)}
              style={inputStyle}
            />
          </Field>
          <Field label="ประเภทการแสดง">
            <input
              maxLength={255}
              value={fields.performance_type}
              onChange={(e) => update("performance_type", e.target.value)}
              style={inputStyle}
            />
          </Field>
        </div>

        <Field label="บริบท (คั่นด้วยจุลภาค, สร้างใหม่ได้ถ้ายังไม่มี)">
          <input
            placeholder="เช่น งานเทศกาล, การแสดงกลางคืน"
            value={fields.context_names.join(", ")}
            onChange={(e) =>
              update(
                "context_names",
                e.target.value.split(",").map((s) => s.trim()),
              )
            }
            style={inputStyle}
          />
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

        <button
          type="submit"
          disabled={submitting}
        >
          {submitting ? "กำลังวิเคราะห์..." : "ดูคำสำคัญที่เสนอ"}
        </button>
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

function ErrorBlock({ message }: { message: string }) {
  return (
    <div role="alert" className="error-panel">
      {message}
    </div>
  );
}
