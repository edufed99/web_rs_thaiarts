"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import {
  ApiClientError,
  deleteAdminItem,
  getContexts,
  getItems,
  getKeywords,
  putAdminItem,
} from "@/lib/api";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import type { ContextOut, ItemOut, KeywordOut, ItemUpdate } from "@/lib/types";

interface EditFields {
  name: string;
  description: string;
  category_group: string;
  performance_type: string;
  performers_count: string;
  duration_minutes: string;
  price_text: string;
  image_url: string;
  video_url: string;
  context_names: string;
}

const EMPTY_EDIT_FIELDS: EditFields = {
  name: "",
  description: "",
  category_group: "",
  performance_type: "",
  performers_count: "",
  duration_minutes: "",
  price_text: "",
  image_url: "",
  video_url: "",
  context_names: "",
};

export default function AdminItemsListPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [items, setItems] = useState<ItemOut[]>([]);
  const [total, setTotal] = useState(0);
  const [contexts, setContexts] = useState<ContextOut[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<ItemOut | null>(null);
  const [fields, setFields] = useState<EditFields>(EMPTY_EDIT_FIELDS);
  const [selectedKeywordIds, setSelectedKeywordIds] = useState<Set<number>>(new Set());
  const [keywordQuery, setKeywordQuery] = useState("");
  const [keywordResults, setKeywordResults] = useState<KeywordOut[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const u = getCurrentUser();
    if (!u) {
      router.replace("/login?next=/admin/items");
      return;
    }
    if (!isAdmin()) {
      router.replace("/?denied=admin_only");
      return;
    }
    setReady(true);
  }, [router]);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([
      getItems({ search: query.trim() || undefined, limit: 100 }),
      getContexts(),
    ])
      .then(([itemData, contextData]) => {
        if (cancelled) return;
        setItems(itemData.items);
        setTotal(itemData.total);
        setContexts(contextData.contexts);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof ApiClientError ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [ready, query, reloadKey]);

  useEffect(() => {
    const term = keywordQuery.trim();
    if (!term) {
      setKeywordResults([]);
      return;
    }
    let cancelled = false;
    getKeywords(term, 20)
      .then((data) => {
        if (!cancelled) setKeywordResults(data.keywords);
      })
      .catch(() => {
        if (!cancelled) setKeywordResults([]);
      });
    return () => {
      cancelled = true;
    };
  }, [keywordQuery]);

  const validationStats = useMemo(
    () => ({
      noContext: items.filter((item) => item.contexts.length === 0).length,
      noKeyword: items.filter((item) => item.keywords.length === 0).length,
      noDescription: items.filter((item) => item.description.trim().length === 0).length,
      mediaReady: items.filter((item) => item.image_url || item.video_url).length,
    }),
    [items],
  );

  function beginEdit(item: ItemOut) {
    setEditing(item);
    setNotice(null);
    setError(null);
    setFields({
      name: item.name,
      description: item.description,
      category_group: item.category_group,
      performance_type: item.performance_type,
      performers_count: item.performers_count == null ? "" : String(item.performers_count),
      duration_minutes: item.duration_minutes == null ? "" : String(item.duration_minutes),
      price_text: item.price_text,
      image_url: item.image_url,
      video_url: item.video_url,
      context_names: item.contexts.map((context) => context.name).join(", "),
    });
    setSelectedKeywordIds(new Set(item.keywords.map((keyword) => keyword.id)));
    setKeywordQuery("");
    setKeywordResults([]);
  }

  function updateField<K extends keyof EditFields>(key: K, value: EditFields[K]) {
    setFields((prev) => ({ ...prev, [key]: value }));
  }

  function toggleKeyword(id: number) {
    setSelectedKeywordIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const body: ItemUpdate = {
        name: fields.name.trim(),
        description: fields.description.trim(),
        category_group: fields.category_group.trim(),
        performance_type: fields.performance_type.trim(),
        performers_count: parseOptionalInt(fields.performers_count),
        duration_minutes: parseOptionalInt(fields.duration_minutes),
        price_text: fields.price_text.trim(),
        image_url: fields.image_url.trim(),
        video_url: fields.video_url.trim(),
        context_names: fields.context_names
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
        keyword_ids: Array.from(selectedKeywordIds),
        is_active: true,
      };
      const out = await putAdminItem(editing.id, body);
      setEditing(out.item);
      setNotice(`บันทึก "${out.item.name}" แล้ว`);
      setReloadKey((key) => key + 1);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(item: ItemOut) {
    const ok = window.confirm(`ลบ "${item.name}" ออกจากฐานข้อมูล catalog?`);
    if (!ok) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await deleteAdminItem(item.id);
      if (editing?.id === item.id) setEditing(null);
      setNotice(`ลบ "${item.name}" แล้ว`);
      setReloadKey((key) => key + 1);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  if (!ready) {
    return <div className="panel">กำลังตรวจสอบสิทธิ์...</div>;
  }

  return (
    <div className="admin-management-page">
      <section className="page-hero admin-hero">
        <div>
          <p className="eyebrow">Data & Knowledge Base Management</p>
          <h1>บริหารจัดการฐานข้อมูลชุดการแสดง</h1>
          <p className="muted">
            เพิ่ม แก้ไข ลบ และตรวจคุณภาพข้อมูล catalog จากหน้า admin โดยไม่ต้องเปิด PostgreSQL โดยตรง
          </p>
        </div>
        <div className="actions" style={{ marginTop: 0 }}>
          <Link className="secondary" href="/dashboard">ดูสถิติการใช้งาน</Link>
          <Link className="primary" href="/admin/items/new">เพิ่มการแสดงใหม่</Link>
        </div>
      </section>

      <nav className="admin-mode-tabs" aria-label="เมนูผู้ดูแลระบบ">
        <Link href="/dashboard">Dashboard / สถิติการใช้งาน</Link>
        <Link className="active" href="/admin/items">บริหารจัดการฐานข้อมูล</Link>
      </nav>

      <section className="admin-database-grid">
        <button type="button" onClick={() => router.push("/admin/items/new")}>
          <strong>เพิ่มชุดการแสดง</strong>
          <span>สร้างรายการใหม่ พร้อม keyword proposal</span>
        </button>
        <button type="button" onClick={() => setReloadKey((key) => key + 1)}>
          <strong>รีเฟรช catalog</strong>
          <span>{total} รายการที่เปิดใช้งาน</span>
        </button>
        <button type="button" onClick={() => setQuery("")}>
          <strong>Context tags</strong>
          <span>{contexts.length} บริบทในระบบ</span>
        </button>
        <button type="button" onClick={() => setKeywordQuery("นาฏศิลป์")}>
          <strong>Keyword taxonomy</strong>
          <span>ค้นหาและผูก keyword กับรายการ</span>
        </button>
      </section>

      <section className="admin-command-bar">
        <label>
          <span>ค้นหา catalog</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="ชื่อการแสดง คำอธิบาย keyword"
          />
        </label>
        <span>{loading ? "กำลังโหลด..." : `${items.length}/${total} รายการ`}</span>
      </section>

      {notice ? <div className="success-panel">{notice}</div> : null}
      {error ? <div role="alert" className="error-panel">{error}</div> : null}

      <section className="admin-workspace">
        <div className="research-panel admin-table-panel">
          <div className="panel-head compact-head">
            <div>
              <p className="eyebrow">Catalog Table</p>
              <h2>ตารางจัดการชุดการแสดง</h2>
            </div>
            <button type="button" className="secondary" onClick={() => setReloadKey((key) => key + 1)}>
              รีเฟรช
            </button>
          </div>
          <div className="management-table-wrap">
            <table className="management-table admin-crud-table">
              <thead>
                <tr>
                  <th>ชุดการแสดง</th>
                  <th>หมวดหมู่</th>
                  <th>บริบท</th>
                  <th>Keyword</th>
                  <th>สถานะ</th>
                  <th>จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className={editing?.id === item.id ? "selected-row" : undefined}>
                    <td>
                      <strong>{item.name}</strong>
                      <small>{item.description ? item.description.slice(0, 80) : "ยังไม่มีคำอธิบาย"}</small>
                    </td>
                    <td>{item.category_group || item.performance_type || "-"}</td>
                    <td>{item.contexts.length}</td>
                    <td>{item.keywords.length}</td>
                    <td><span className="status-pill active">{item.suitability_label || "Active"}</span></td>
                    <td>
                      <div className="row-actions">
                        <button type="button" onClick={() => beginEdit(item)}>แก้ไข</button>
                        <button type="button" className="danger" onClick={() => handleDelete(item)}>ลบ</button>
                      </div>
                    </td>
                  </tr>
                ))}
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={6}>ไม่พบรายการที่ตรงกับเงื่อนไข</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        {editing ? (
          <form className="research-panel admin-edit-panel" onSubmit={handleSave}>
            <div className="panel-head compact-head">
              <div>
                <p className="eyebrow">Edit Item</p>
                <h2>แก้ไขข้อมูล</h2>
              </div>
              <button type="button" className="secondary" onClick={() => setEditing(null)}>
                ปิด
              </button>
            </div>

            <div className="admin-form-grid">
              <Field label="ชื่อการแสดง">
                <input value={fields.name} onChange={(event) => updateField("name", event.target.value)} required />
              </Field>
              <Field label="หมวดหมู่">
                <input value={fields.category_group} onChange={(event) => updateField("category_group", event.target.value)} />
              </Field>
              <Field label="ประเภท">
                <input value={fields.performance_type} onChange={(event) => updateField("performance_type", event.target.value)} />
              </Field>
              <Field label="จำนวนผู้แสดง">
                <input inputMode="numeric" value={fields.performers_count} onChange={(event) => updateField("performers_count", event.target.value)} />
              </Field>
              <Field label="ระยะเวลา">
                <input inputMode="numeric" value={fields.duration_minutes} onChange={(event) => updateField("duration_minutes", event.target.value)} />
              </Field>
              <Field label="ราคา / หมายเหตุ">
                <input value={fields.price_text} onChange={(event) => updateField("price_text", event.target.value)} />
              </Field>
            </div>

            <Field label="คำอธิบาย">
              <textarea rows={5} value={fields.description} onChange={(event) => updateField("description", event.target.value)} />
            </Field>
            <Field label="บริบทที่ใช้ได้ (คั่นด้วย comma)">
              <input value={fields.context_names} onChange={(event) => updateField("context_names", event.target.value)} />
            </Field>
            <Field label="รูปภาพ URL">
              <input value={fields.image_url} onChange={(event) => updateField("image_url", event.target.value)} />
            </Field>
            <Field label="วิดีโอ URL">
              <input value={fields.video_url} onChange={(event) => updateField("video_url", event.target.value)} />
            </Field>

            <div className="keyword-editor">
              <label>
                <span>ค้นหา keyword เพื่อผูกกับรายการ</span>
                <input
                  type="search"
                  value={keywordQuery}
                  onChange={(event) => setKeywordQuery(event.target.value)}
                  placeholder="เช่น โขน ระบำ งานมงคล"
                />
              </label>
              {editing.keywords.length > 0 ? (
                <div className="keyword-token-list selected-keyword-list" aria-label="keyword ที่ผูกอยู่">
                  {editing.keywords.map((keyword) => (
                    <button
                      type="button"
                      key={keyword.id}
                      className={selectedKeywordIds.has(keyword.id) ? "selected" : undefined}
                      onClick={() => toggleKeyword(keyword.id)}
                    >
                      {keyword.name}
                    </button>
                  ))}
                </div>
              ) : null}
              <div className="keyword-token-list">
                {keywordResults.map((keyword) => (
                  <button
                    type="button"
                    key={keyword.id}
                    className={selectedKeywordIds.has(keyword.id) ? "selected" : undefined}
                    onClick={() => toggleKeyword(keyword.id)}
                  >
                    {keyword.name}
                  </button>
                ))}
              </div>
              <small>เลือกไว้ {selectedKeywordIds.size} keyword</small>
            </div>

            <div className="form-actions">
              <button type="submit" className="primary" disabled={saving}>
                {saving ? "กำลังบันทึก..." : "บันทึกการแก้ไข"}
              </button>
              <button type="button" className="danger" disabled={saving} onClick={() => handleDelete(editing)}>
                ลบรายการนี้
              </button>
            </div>
          </form>
        ) : (
          <aside className="research-panel admin-edit-panel">
            <div className="panel-head compact-head">
              <div>
                <p className="eyebrow">Rule Validation</p>
                <h2>ตรวจคุณภาพข้อมูล</h2>
              </div>
            </div>
            <div className="validation-list">
              <ValidationItem value={validationStats.noContext} label="รายการไม่มีบริบท" detail="ควรเพิ่ม context เพื่อผ่าน context gate" tone="warning" />
              <ValidationItem value={validationStats.noKeyword} label="รายการไม่มี keyword" detail="กระทบ CBF และ hybrid ranking" tone="danger" />
              <ValidationItem value={validationStats.noDescription} label="รายการไม่มีคำอธิบาย" detail="ข้อมูลอธิบายช่วยให้ผู้ใช้และ embedding ทำงานดีขึ้น" tone="neutral" />
              <ValidationItem value={validationStats.mediaReady} label="รายการมีสื่อประกอบ" detail="ใช้ตรวจความพร้อมของ catalog display" tone="success" />
            </div>
          </aside>
        )}
      </section>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="field compact-field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function ValidationItem({
  value,
  label,
  detail,
  tone,
}: {
  value: number;
  label: string;
  detail: string;
  tone: "warning" | "danger" | "neutral" | "success";
}) {
  return (
    <div className={`validation-item ${tone}`}>
      <strong>{value}</strong>
      <span>{label}</span>
      <small>{detail}</small>
    </div>
  );
}

function parseOptionalInt(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isNaN(parsed) ? null : parsed;
}
