"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { CardPagination } from "@/components/CardPagination";
import {
  ApiClientError,
  deleteAdminItem,
  deleteAdminUser,
  executePublication,
  getAdminUsers,
  getContexts,
  getItems,
  getKeywords,
  getPublicationStatus,
  postAdminUser,
  putAdminItem,
  putAdminUser,
  uploadItemImage,
  uploadItemVideo,
} from "@/lib/api";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import type {
  ContextOut,
  ItemOut,
  KeywordOut,
  ItemUpdate,
  PublicationStatusOut,
  UserOut,
} from "@/lib/types";
import { useCardPagination } from "@/lib/useCardPagination";

type DataManagementTab = "items" | "users" | "publication";
type UserFormMode = "create" | "edit" | null;
type EditSaveStatus = "idle" | "saving" | "success" | "error";

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

interface UserFields {
  username: string;
  email: string;
  display_name: string;
  password: string;
  is_admin: boolean;
}

const EMPTY_USER_FIELDS: UserFields = {
  username: "",
  email: "",
  display_name: "",
  password: "",
  is_admin: false,
};

const USER_PAGE_SIZE = 5;
const ITEM_PAGE_SIZE = 5;

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
  const [editSequence, setEditSequence] = useState<ItemOut[]>([]);
  const [fields, setFields] = useState<EditFields>(EMPTY_EDIT_FIELDS);
  const [selectedKeywordIds, setSelectedKeywordIds] = useState<Set<number>>(new Set());
  const [keywordQuery, setKeywordQuery] = useState("");
  const [keywordResults, setKeywordResults] = useState<KeywordOut[]>([]);
  const [keywordChoices, setKeywordChoices] = useState<KeywordOut[]>([]);
  const [newKeywordNames, setNewKeywordNames] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [deletingItemId, setDeletingItemId] = useState<number | null>(null);
  const [editSaveStatus, setEditSaveStatus] = useState<EditSaveStatus>("idle");
  const [uploadingMedia, setUploadingMedia] = useState<"image" | "video" | null>(null);
  const [activeDataTab, setActiveDataTab] = useState<DataManagementTab>("items");
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);
  const [users, setUsers] = useState<UserOut[]>([]);
  const [userQuery, setUserQuery] = useState("");
  const [userLoading, setUserLoading] = useState(false);
  const [userReloadKey, setUserReloadKey] = useState(0);
  const [userFormMode, setUserFormMode] = useState<UserFormMode>(null);
  const [editingUser, setEditingUser] = useState<UserOut | null>(null);
  const [deletingUserId, setDeletingUserId] = useState<number | null>(null);
  const [userFields, setUserFields] = useState<UserFields>(EMPTY_USER_FIELDS);
  const [publicationStatus, setPublicationStatus] = useState<PublicationStatusOut | null>(null);
  const [publicationLoading, setPublicationLoading] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publicationNote, setPublicationNote] = useState("");
  const [publicationReloadKey, setPublicationReloadKey] = useState(0);
  const tableScrollY = useRef(0);
  const saveFeedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    setCurrentUserId(u.id);
    setReady(true);
  }, [router]);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([
      getItems({ search: query.trim() || undefined, limit: 200 }),
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
    return () => {
      if (saveFeedbackTimer.current) clearTimeout(saveFeedbackTimer.current);
    };
  }, []);

  useEffect(() => {
    const term = keywordQuery.trim();
    if (!term) {
      setKeywordResults([]);
      return;
    }
    let cancelled = false;
    getKeywords(term, 20)
      .then((data) => {
        if (!cancelled) {
          setKeywordResults(data.keywords);
          setKeywordChoices((current) => mergeKeywordOptions(current, data.keywords));
        }
      })
      .catch(() => {
        if (!cancelled) setKeywordResults([]);
      });
    return () => {
      cancelled = true;
    };
  }, [keywordQuery]);

  useEffect(() => {
    if (!ready || activeDataTab !== "users") return;
    let cancelled = false;
    setUserLoading(true);
    setError(null);
    getAdminUsers()
      .then((data) => {
        if (!cancelled) setUsers(data.users);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof ApiClientError ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setUserLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeDataTab, ready, userReloadKey]);

  useEffect(() => {
    if (!ready || activeDataTab !== "publication") return;
    let cancelled = false;
    setPublicationLoading(true);
    setError(null);
    getPublicationStatus()
      .then((data) => {
        if (!cancelled) setPublicationStatus(data);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof ApiClientError ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setPublicationLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeDataTab, ready, publicationReloadKey]);

  async function handlePublish() {
    setPublishing(true);
    setError(null);
    setNotice(null);
    try {
      const result = await executePublication(publicationNote.trim() || undefined);
      setPublicationStatus(await getPublicationStatus());
      setPublicationNote("");
      setNotice(
        `เผยแพร่ Artifact สำเร็จ (build ${result.publication.build_id}) · ครอบคลุม ${result.publication.item_count} รายการ · ยังรอการเผยแพร่ ${result.pending_after} รายการ`,
      );
      setReloadKey((key) => key + 1);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : String(e));
    } finally {
      setPublishing(false);
    }
  }

  const validationStats = useMemo(
    () => ({
      noContext: items.filter((item) => item.contexts.length === 0).length,
      noKeyword: items.filter((item) => item.keywords.length === 0).length,
      noDescription: items.filter((item) => item.description.trim().length === 0).length,
      mediaReady: items.filter((item) => item.image_url || item.video_url).length,
    }),
    [items],
  );

  const {
    page: itemPage,
    setPage: setItemPage,
    pageItems: paginatedItems,
  } = useCardPagination(items, query.trim().toLocaleLowerCase("th"), ITEM_PAGE_SIZE);

  const filteredUsers = useMemo(() => {
    const term = userQuery.trim().toLocaleLowerCase("th");
    if (!term) return users;
    return users.filter((user) =>
      [user.username, user.display_name, user.email, user.role]
        .join(" ")
        .toLocaleLowerCase("th")
        .includes(term),
    );
  }, [userQuery, users]);

  const {
    page: userPage,
    setPage: setUserPage,
    pageItems: paginatedUsers,
  } = useCardPagination(filteredUsers, userQuery.trim().toLocaleLowerCase("th"), USER_PAGE_SIZE);

  const editSequencePosition = useMemo(() => {
    if (!editing) return -1;
    return editSequence.findIndex((item) => item.id === editing.id);
  }, [editSequence, editing]);

  const previousEditItem = editSequencePosition > 0
    ? editSequence[editSequencePosition - 1]
    : null;
  const nextEditItem = editSequencePosition >= 0 && editSequencePosition < editSequence.length - 1
    ? editSequence[editSequencePosition + 1]
    : null;

  function showEditItem(item: ItemOut) {
    setEditing(item);
    setNotice(null);
    setError(null);
    setEditSaveStatus("idle");
    if (saveFeedbackTimer.current) {
      clearTimeout(saveFeedbackTimer.current);
      saveFeedbackTimer.current = null;
    }
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
    setKeywordChoices(item.keywords);
    setNewKeywordNames([]);
    setKeywordQuery("");
    setKeywordResults([]);
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  function beginEdit(item: ItemOut) {
    tableScrollY.current = window.scrollY;
    // Keep a stable snapshot of the filtered table. A save can trigger a
    // background refresh (or change the item name so it no longer matches
    // the current search), but Previous/Next should still follow the order
    // the admin originally chose from.
    setEditSequence(items);
    showEditItem(item);
  }

  function closeEditor() {
    setEditing(null);
    setEditSequence([]);
    setEditSaveStatus("idle");
    if (saveFeedbackTimer.current) {
      clearTimeout(saveFeedbackTimer.current);
      saveFeedbackTimer.current = null;
    }
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: tableScrollY.current, behavior: "auto" });
    });
  }

  function navigateEditor(item: ItemOut | null) {
    if (!item || saving || uploadingMedia !== null) return;
    showEditItem(item);
  }

  function resetEditSaveStatusAfter(delayMs: number) {
    if (saveFeedbackTimer.current) clearTimeout(saveFeedbackTimer.current);
    saveFeedbackTimer.current = setTimeout(() => {
      setEditSaveStatus("idle");
      saveFeedbackTimer.current = null;
    }, delayMs);
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

  function addKeywordFromInput() {
    const name = normalizeKeywordName(keywordQuery);
    if (!name) return;

    const existing = keywordChoices.find(
      (keyword) => normalizeKeywordName(keyword.name).toLocaleLowerCase("th") === name.toLocaleLowerCase("th"),
    );
    if (existing) {
      setSelectedKeywordIds((current) => new Set(current).add(existing.id));
    } else if (!newKeywordNames.some(
      (keywordName) => keywordName.toLocaleLowerCase("th") === name.toLocaleLowerCase("th"),
    )) {
      setNewKeywordNames((current) => [...current, name]);
    }
    setKeywordQuery("");
    setKeywordResults([]);
  }

  function removeNewKeyword(name: string) {
    setNewKeywordNames((current) => current.filter((keywordName) => keywordName !== name));
  }

  async function handleMediaUpload(kind: "image" | "video", file: File | undefined) {
    if (!editing || !file) return;
    setUploadingMedia(kind);
    setError(null);
    setNotice(null);
    try {
      const uploaded = kind === "image"
        ? await uploadItemImage(editing.id, file)
        : await uploadItemVideo(editing.id, file);
      const field = kind === "image" ? "image_url" : "video_url";
      updateField(field, uploaded.url);
      setEditing((previous) => previous ? { ...previous, [field]: uploaded.url } : previous);
      setNotice(
        `${kind === "image" ? "อัปโหลดรูปภาพ" : "อัปโหลดวิดีโอ"}สำเร็จ (${formatFileSize(uploaded.size_bytes)})`,
      );
    } catch (e) {
      setError(e instanceof ApiClientError ? mediaUploadError(e, kind) : String(e));
    } finally {
      setUploadingMedia(null);
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setSaving(true);
    setEditSaveStatus("saving");
    if (saveFeedbackTimer.current) {
      clearTimeout(saveFeedbackTimer.current);
      saveFeedbackTimer.current = null;
    }
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
        new_keyword_names: newKeywordNames,
        is_active: true,
      };
      const out = await putAdminItem(editing.id, body);
      setEditing(out.item);
      setSelectedKeywordIds(new Set(out.item.keywords.map((keyword) => keyword.id)));
      setKeywordChoices(out.item.keywords);
      setNewKeywordNames([]);
      setEditSequence((sequence) =>
        sequence.map((item) => item.id === out.item.id ? out.item : item),
      );
      setItems((currentItems) =>
        currentItems.map((item) => item.id === out.item.id ? out.item : item),
      );
      setEditSaveStatus("success");
      setNotice(`บันทึก "${out.item.name}" แล้ว`);
      setReloadKey((key) => key + 1);
      resetEditSaveStatusAfter(1800);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : String(e));
      setEditSaveStatus("error");
      resetEditSaveStatusAfter(2600);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(item: ItemOut) {
    const ok = window.confirm(`ลบ "${item.name}" ออกจากฐานข้อมูล catalog?`);
    if (!ok) return;
    setDeletingItemId(item.id);
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await deleteAdminItem(item.id);
      if (editing?.id === item.id) closeEditor();
      setNotice(`ลบ "${item.name}" แล้ว`);
      setReloadKey((key) => key + 1);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : String(e));
    } finally {
      setDeletingItemId(null);
      setSaving(false);
    }
  }

  function openCatalogAction(action: "edit" | "delete") {
    setQuery("");
    setError(null);
    setNotice(
      action === "edit"
        ? "เลือกรายการจากตาราง แล้วกดปุ่ม “แก้ไข”"
        : "เลือกรายการจากตาราง แล้วกดปุ่ม “ลบ”",
    );
    window.requestAnimationFrame(() => {
      document.getElementById("catalog-management-table")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  }

  function selectDataTab(tab: DataManagementTab) {
    setActiveDataTab(tab);
    setNotice(null);
    setError(null);
  }

  function openUserAction(action: "create" | "edit" | "delete") {
    setError(null);
    if (action === "create") {
      setEditingUser(null);
      setUserFields(EMPTY_USER_FIELDS);
      setUserFormMode("create");
      setNotice("กรอกข้อมูลบัญชีผู้ใช้ใหม่ แล้วกด “เพิ่มผู้ใช้”");
    } else {
      setUserFormMode(null);
      setEditingUser(null);
      setNotice(
        action === "edit"
          ? "เลือกบัญชีจากตาราง แล้วกดปุ่ม “แก้ไข”"
          : "เลือกบัญชีจากตาราง แล้วกดปุ่ม “ลบ”",
      );
    }
    window.requestAnimationFrame(() => {
      document.getElementById("user-management-table")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  }

  function beginUserEdit(user: UserOut) {
    setEditingUser(user);
    setUserFormMode("edit");
    setUserFields({
      username: user.username,
      email: user.email,
      display_name: user.display_name,
      password: "",
      is_admin: user.is_admin,
    });
    setNotice(null);
    setError(null);
    window.requestAnimationFrame(() => {
      document.getElementById("user-edit-form")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  }

  function updateUserField<K extends keyof UserFields>(key: K, value: UserFields[K]) {
    setUserFields((previous) => ({ ...previous, [key]: value }));
  }

  async function handleUserSave(event: React.FormEvent) {
    event.preventDefault();
    if (!userFormMode) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      if (userFormMode === "create") {
        const created = await postAdminUser({
          username: userFields.username.trim(),
          email: userFields.email.trim() || undefined,
          password: userFields.password,
          display_name: userFields.display_name.trim() || undefined,
          is_admin: userFields.is_admin,
        });
        setNotice(`เพิ่มผู้ใช้ “${created.username}” แล้ว`);
      } else if (editingUser) {
        const updated = await putAdminUser(editingUser.id, {
          username: userFields.username.trim(),
          email: userFields.email.trim(),
          display_name: userFields.display_name.trim(),
          password: userFields.password || undefined,
          is_admin: userFields.is_admin,
        });
        setNotice(`บันทึกข้อมูลผู้ใช้ “${updated.username}” แล้ว`);
      }
      setUserFormMode(null);
      setEditingUser(null);
      setUserFields(EMPTY_USER_FIELDS);
      setUserReloadKey((key) => key + 1);
    } catch (e) {
      setError(e instanceof ApiClientError ? userManagementError(e) : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function handleUserDelete(user: UserOut) {
    const ok = window.confirm(`ลบบัญชี “${user.username}” ออกจากระบบ?`);
    if (!ok) return;
    setDeletingUserId(user.id);
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await deleteAdminUser(user.id);
      if (editingUser?.id === user.id) {
        setEditingUser(null);
        setUserFormMode(null);
      }
      setNotice(`ลบบัญชี “${user.username}” แล้ว`);
      setUserReloadKey((key) => key + 1);
    } catch (e) {
      setError(e instanceof ApiClientError ? userManagementError(e) : String(e));
    } finally {
      setDeletingUserId(null);
      setSaving(false);
    }
  }

  if (!ready) {
    return <div className="panel">กำลังตรวจสอบสิทธิ์...</div>;
  }

  if (editing) {
    return (
      <div className="admin-management-page admin-item-edit-page">
        <section className="admin-item-edit-hero">
          <button type="button" className="secondary" onClick={closeEditor}>
            ← กลับไปตารางจัดการ
          </button>
          <div>
            <p className="eyebrow">Edit Catalog Item</p>
            <h1>แก้ไขข้อมูลชุดการแสดง</h1>
            <p>กำลังแก้ไข “{editing.name}” · รหัสรายการ {editing.id}</p>
          </div>
          <EditSequenceControls
            currentIndex={editSequencePosition}
            total={editSequence.length}
            previousItem={previousEditItem}
            nextItem={nextEditItem}
            disabled={saving || uploadingMedia !== null}
            onNavigate={navigateEditor}
          />
        </section>

        {notice ? <div className="success-panel">{notice}</div> : null}
        {error ? <div role="alert" className="error-panel">{error}</div> : null}

        <form className="research-panel admin-edit-panel admin-edit-panel--full" onSubmit={handleSave}>
          <div className="admin-full-edit-head">
            <div>
              <p className="eyebrow">ข้อมูลหลัก</p>
              <h2>รายละเอียดชุดการแสดง</h2>
              <span>ตรวจสอบข้อมูลให้ครบถ้วนก่อนบันทึกการแก้ไข</span>
            </div>
            <div className="form-actions">
              <button type="button" className="secondary" disabled={saving} onClick={closeEditor}>
                ยกเลิก
              </button>
              <EditSaveButton status={editSaveStatus} disabled={saving} />
            </div>
          </div>

          <section className="admin-edit-section">
            <div className="admin-form-grid admin-form-grid--wide">
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
              <Field label="ระยะเวลา (นาที)">
                <input inputMode="numeric" value={fields.duration_minutes} onChange={(event) => updateField("duration_minutes", event.target.value)} />
              </Field>
              <Field label="ราคา / หมายเหตุ">
                <input value={fields.price_text} onChange={(event) => updateField("price_text", event.target.value)} />
              </Field>
            </div>
          </section>

          <section className="admin-edit-section">
            <div className="admin-edit-section-head">
              <h3>เนื้อหาและบริบท</h3>
              <span>ข้อมูลส่วนนี้ใช้แสดงผลและคำนวณคำแนะนำ</span>
            </div>
            <Field label="คำอธิบาย">
              <textarea rows={8} value={fields.description} onChange={(event) => updateField("description", event.target.value)} />
            </Field>
            <Field label="บริบทที่ใช้ได้ (คั่นด้วย comma)">
              <input value={fields.context_names} onChange={(event) => updateField("context_names", event.target.value)} />
            </Field>
          </section>

          <section className="admin-edit-section">
            <div className="admin-edit-section-head">
              <h3>สื่อประกอบ</h3>
              <span>ระบุ URL รูปภาพและวิดีโอของชุดการแสดง</span>
            </div>
            <div className="admin-media-upload-grid">
              <article className="admin-media-upload-card">
                <div className="admin-media-upload-title">
                  <span aria-hidden="true">▧</span>
                  <div><strong>รูปภาพหน้าปก</strong><small>JPEG, PNG หรือ WebP · ไม่เกิน 5 MB</small></div>
                </div>
                <Field label="รูปภาพ URL">
                  <input value={fields.image_url} onChange={(event) => updateField("image_url", event.target.value)} />
                </Field>
                <label className={`admin-media-upload-button ${uploadingMedia === "image" ? "uploading" : ""}`}>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    disabled={uploadingMedia !== null}
                    onChange={(event) => {
                      const file = event.currentTarget.files?.[0];
                      event.currentTarget.value = "";
                      void handleMediaUpload("image", file);
                    }}
                  />
                  <span>{uploadingMedia === "image" ? "กำลังอัปโหลดรูปภาพ..." : "+ เพิ่มรูปภาพ"}</span>
                </label>
              </article>

              <article className="admin-media-upload-card">
                <div className="admin-media-upload-title">
                  <span aria-hidden="true">▶</span>
                  <div><strong>วิดีโอการแสดง</strong><small>MP4, WebM หรือ MOV · ไม่เกิน 100 MB</small></div>
                </div>
                <Field label="วิดีโอ URL">
                  <input value={fields.video_url} onChange={(event) => updateField("video_url", event.target.value)} />
                </Field>
                <label className={`admin-media-upload-button ${uploadingMedia === "video" ? "uploading" : ""}`}>
                  <input
                    type="file"
                    accept="video/mp4,video/webm,video/quicktime,.mov"
                    disabled={uploadingMedia !== null}
                    onChange={(event) => {
                      const file = event.currentTarget.files?.[0];
                      event.currentTarget.value = "";
                      void handleMediaUpload("video", file);
                    }}
                  />
                  <span>{uploadingMedia === "video" ? "กำลังอัปโหลดวิดีโอ..." : "+ เพิ่ม VDO"}</span>
                </label>
              </article>
            </div>
          </section>

          <section className="admin-edit-section">
            <div className="admin-edit-section-head">
              <h3>Keyword สำหรับระบบแนะนำ</h3>
              <span>กด × เพื่อยกเลิกการเชื่อมโยง หรือค้นหาเพื่อเลือกและเพิ่มคำใหม่</span>
            </div>
            <div className="keyword-editor">
              <label>
                <span>ค้นหา Keyword</span>
                <input
                  type="search"
                  maxLength={255}
                  value={keywordQuery}
                  onChange={(event) => setKeywordQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      addKeywordFromInput();
                    }
                  }}
                  placeholder="เช่น โขน ระบำ งานมงคล"
                />
              </label>
              {selectedKeywordIds.size > 0 || newKeywordNames.length > 0 ? (
                <div className="keyword-token-list selected-keyword-list" aria-label="keyword ที่ผูกอยู่">
                  {keywordChoices.filter((keyword) => selectedKeywordIds.has(keyword.id)).map((keyword) => (
                    <button
                      type="button"
                      key={keyword.id}
                      className="selected"
                      onClick={() => toggleKeyword(keyword.id)}
                      aria-label={`ยกเลิกการเชื่อมโยง ${keyword.name}`}
                      title="ยกเลิกการเชื่อมโยงจากรายการนี้"
                    >
                      {keyword.name} <span aria-hidden="true">×</span>
                    </button>
                  ))}
                  {newKeywordNames.map((name) => (
                    <button
                      type="button"
                      key={`new-${name}`}
                      className="selected pending-keyword"
                      onClick={() => removeNewKeyword(name)}
                      aria-label={`ยกเลิกการเพิ่ม ${name}`}
                      title="ยกเลิกการเพิ่ม Keyword ใหม่"
                    >
                      {name} <span className="keyword-pending-label">ใหม่</span> <span aria-hidden="true">×</span>
                    </button>
                  ))}
                </div>
              ) : null}
              <div className="keyword-token-list">
                {keywordResults.filter((keyword) => !selectedKeywordIds.has(keyword.id)).map((keyword) => (
                  <button
                    type="button"
                    key={keyword.id}
                    onClick={() => toggleKeyword(keyword.id)}
                  >
                    + {keyword.name}
                  </button>
                ))}
              </div>
              {normalizeKeywordName(keywordQuery) ? (
                <button type="button" className="keyword-create-button" onClick={addKeywordFromInput}>
                  + เพิ่ม Keyword “{normalizeKeywordName(keywordQuery)}”
                </button>
              ) : null}
              <small>
                เลือกไว้ {selectedKeywordIds.size + newKeywordNames.length} Keyword
                {newKeywordNames.length > 0 ? ` · คำใหม่รอบันทึก ${newKeywordNames.length}` : ""}
              </small>
            </div>
          </section>

          <div className="admin-full-edit-footer">
            <button type="button" className="danger" disabled={saving} onClick={() => handleDelete(editing)}>
              ลบรายการนี้
            </button>
            <EditSequenceControls
              currentIndex={editSequencePosition}
              total={editSequence.length}
              previousItem={previousEditItem}
              nextItem={nextEditItem}
              disabled={saving || uploadingMedia !== null}
              onNavigate={navigateEditor}
            />
            <div className="form-actions">
              <button type="button" className="secondary" disabled={saving} onClick={closeEditor}>
                ยกเลิก
              </button>
              <EditSaveButton status={editSaveStatus} disabled={saving} />
            </div>
          </div>
        </form>
      </div>
    );
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
          <Link className="secondary" href="/admin">ดูสถิติการใช้งาน</Link>
          <Link className="primary" href="/admin/items/new">เพิ่มการแสดงใหม่</Link>
        </div>
      </section>

      <nav className="admin-mode-tabs" aria-label="เมนูผู้ดูแลระบบ">
        <Link href="/dashboard">Dashboard / สถิติการใช้งาน</Link>
        <Link href="/admin/analytics">วิเคราะห์ข้อมูล</Link>
        <Link className="active" href="/admin/items">บริหารจัดการฐานข้อมูล</Link>
      </nav>

      <nav className="admin-data-subtabs" aria-label="ประเภทข้อมูลที่ต้องการจัดการ" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={activeDataTab === "items"}
          className={activeDataTab === "items" ? "active" : undefined}
          onClick={() => selectDataTab("items")}
        >
          ชุดการแสดง
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeDataTab === "users"}
          className={activeDataTab === "users" ? "active" : undefined}
          onClick={() => selectDataTab("users")}
        >
          ข้อมูลผู้ใช้
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeDataTab === "publication"}
          className={activeDataTab === "publication" ? "active" : undefined}
          onClick={() => selectDataTab("publication")}
        >
          Artifact Publication
        </button>
      </nav>

      {activeDataTab === "items" ? (
        <section className="admin-database-grid" aria-label="จัดการชุดการแสดง">
          <button type="button" onClick={() => router.push("/admin/items/new")}>
            <strong>เพิ่ม</strong>
            <span>เพิ่มข้อมูลชุดการแสดงใหม่</span>
          </button>
          <button type="button" onClick={() => openCatalogAction("delete")}>
            <strong>ลบ</strong>
            <span>ลบข้อมูลชุดการแสดงที่ไม่ต้องการ</span>
          </button>
          <button type="button" onClick={() => openCatalogAction("edit")}>
            <strong>แก้ไข</strong>
            <span>แก้ไขรายละเอียด Context และ Keyword</span>
          </button>
        </section>
      ) : activeDataTab === "publication" ? (
        <section className="admin-database-grid" aria-label="Artifact Publication">
          <button type="button" onClick={() => selectDataTab("publication")}>
            <strong>สถานะ</strong>
            <span>ตรวจสอบ build ที่กำลังให้บริการและรายการที่รอเผยแพร่</span>
          </button>
          <button type="button" disabled={publishing} onClick={() => void handlePublish()}>
            <strong>เผยแพร่</strong>
            <span>ประกาศให้ Artifact build ปัจจุบันครอบคลุมรายการที่รออยู่</span>
          </button>
        </section>
      ) : (
        <section className="admin-database-grid" aria-label="จัดการข้อมูลผู้ใช้">
          <button type="button" onClick={() => openUserAction("create")}>
            <strong>เพิ่ม</strong>
            <span>เพิ่มบัญชีผู้ใช้ใหม่</span>
          </button>
          <button type="button" onClick={() => openUserAction("delete")}>
            <strong>ลบ</strong>
            <span>ลบบัญชีผู้ใช้ที่ไม่ต้องการ</span>
          </button>
          <button type="button" onClick={() => openUserAction("edit")}>
            <strong>แก้ไข</strong>
            <span>แก้ไขชื่อ อีเมล รหัสผ่าน และสิทธิ์</span>
          </button>
        </section>
      )}

      {notice ? <div className="success-panel">{notice}</div> : null}
      {error ? <div role="alert" className="error-panel">{error}</div> : null}

      {activeDataTab === "items" ? (
        <>
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

      <section id="catalog-management-table" className="admin-workspace">
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
                {paginatedItems.map((item) => (
                  <tr key={item.id}>
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
                        <button type="button" disabled={saving} onClick={() => beginEdit(item)}>แก้ไข</button>
                        <button
                          type="button"
                          className={`danger ${deletingItemId === item.id ? "is-pending" : ""}`}
                          disabled={saving}
                          aria-busy={deletingItemId === item.id}
                          onClick={() => handleDelete(item)}
                        >
                          {deletingItemId === item.id ? (
                            <><span className="row-action-spinner" aria-hidden="true" /> กำลังลบ...</>
                          ) : "ลบ"}
                        </button>
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
          <CardPagination
            currentPage={itemPage}
            totalItems={items.length}
            onPageChange={setItemPage}
            pageSize={ITEM_PAGE_SIZE}
            scrollTargetId="catalog-management-table"
            ariaLabel="เปลี่ยนหน้าตารางชุดการแสดง"
            itemLabel="ชุดการแสดง"
          />
        </div>

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
      </section>
        </>
      ) : activeDataTab === "publication" ? (
        <>
          <section className="admin-command-bar">
            <label>
              <span>บันทึกหมายเหตุสำหรับการเผยแพร่ครั้งถัดไป</span>
              <input
                type="text"
                maxLength={255}
                value={publicationNote}
                onChange={(event) => setPublicationNote(event.target.value)}
                placeholder="เช่น อัปเดตข้อมูลโขนจากงานวิจัยรอบ 2"
              />
            </label>
            <span>
              {publicationLoading
                ? "กำลังโหลดสถานะ..."
                : publicationStatus
                  ? `${publicationStatus.pending.count} รายการรอเผยแพร่`
                  : "ไม่สามารถโหลดสถานะได้"}
            </span>
          </section>

          <section className="admin-workspace" aria-label="Artifact Publication">
            <div className="research-panel admin-table-panel">
              <div className="panel-head compact-head">
                <div>
                  <p className="eyebrow">Artifact Publication</p>
                  <h2>สถานะการเผยแพร่ Artifact</h2>
                </div>
                <button
                  type="button"
                  className="secondary"
                  disabled={publicationLoading}
                  onClick={() => setPublicationReloadKey((key) => key + 1)}
                >
                  รีเฟรช
                </button>
              </div>

              {publicationStatus ? (
                <div className="publication-status-grid">
                  <div className="validation-list">
                    <PublicationItem
                      label="Model Service"
                      value={publicationStatus.model.reachable ? "เชื่อมต่อแล้ว" : "ไม่พร้อมใช้งาน"}
                      tone={publicationStatus.model.reachable ? "success" : "danger"}
                      detail={
                        publicationStatus.model.reachable
                          ? `artifact version ${publicationStatus.model.artifact_version} · ${publicationStatus.model.artifact_item_count} items`
                          : publicationStatus.model.error ?? "Private Model Service ตรวจไม่พบ"
                      }
                    />
                    <PublicationItem
                      label="Build ล่าสุดที่เผยแพร่"
                      value={publicationStatus.published ? publicationStatus.published.build_id : "ยังไม่เคยเผยแพร่"}
                      tone={publicationStatus.published ? "success" : "neutral"}
                      detail={
                        publicationStatus.published
                          ? `เผยแพร่เมื่อ ${formatAdminDate(publicationStatus.published.published_at)} · ครอบคลุม ${publicationStatus.published.item_count} รายการ`
                          : "รอการเผยแพร่ครั้งแรก"
                      }
                    />
                    <PublicationItem
                      label="รายการที่รอเผยแพร่"
                      value={String(publicationStatus.pending.count)}
                      tone={publicationStatus.pending.count > 0 ? "warning" : "success"}
                      detail={
                        publicationStatus.pending.count > 0
                          ? "แก้ไขแล้ว ยังไม่เข้าสู่ personalized scoring"
                          : "ข้อมูลทั้งหมดอยู่ใน build ปัจจุบันแล้ว"
                      }
                    />
                  </div>

                  {publicationStatus.pending.count > 0 ? (
                    <div className="management-table-wrap">
                      <table className="management-table">
                        <thead>
                          <tr>
                            <th>รายการที่รอการเผยแพร่</th>
                          </tr>
                        </thead>
                        <tbody>
                          {publicationStatus.pending.items.map((item) => (
                            <tr key={item.id}>
                              <td>{item.name}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : null}

                  <div className="publication-actions">
                    <p className="muted">
                      การแก้ไข catalog จะแสดงผลทันทีในหน้ารายการ แต่จะไม่ถูกใช้ใน
                      การให้คะแนนส่วนบุคคล (personalized scoring) จนกว่าการเผยแพร่
                      จะสำเร็จ
                    </p>
                    <button
                      type="button"
                      className="primary"
                      disabled={publishing || !publicationStatus.model.reachable}
                      onClick={() => void handlePublish()}
                    >
                      {publishing ? "กำลังเผยแพร่..." : "เผยแพร่ Artifact ฉบับปัจจุบัน"}
                    </button>
                  </div>
                </div>
              ) : (
                <p className="muted">กำลังโหลดสถานะ...</p>
              )}
            </div>
          </section>
        </>
      ) : (
        <>
          <section className="admin-command-bar">
            <label>
              <span>ค้นหาข้อมูลผู้ใช้</span>
              <input
                type="search"
                value={userQuery}
                onChange={(event) => setUserQuery(event.target.value)}
                placeholder="ชื่อผู้ใช้ ชื่อที่แสดง หรืออีเมล"
              />
            </label>
            <span>{userLoading ? "กำลังโหลด..." : `${filteredUsers.length}/${users.length} บัญชี`}</span>
          </section>

          <section id="user-management-table" className="admin-workspace admin-user-workspace">
            <div className="research-panel admin-table-panel">
              <div className="panel-head compact-head">
                <div>
                  <p className="eyebrow">User Table</p>
                  <h2>ตารางจัดการข้อมูลผู้ใช้</h2>
                </div>
                <button type="button" className="secondary" onClick={() => setUserReloadKey((key) => key + 1)}>
                  รีเฟรช
                </button>
              </div>
              <div className="management-table-wrap">
                <table className="management-table admin-crud-table admin-user-table">
                  <thead>
                    <tr>
                      <th>ผู้ใช้</th>
                      <th>อีเมล</th>
                      <th>สิทธิ์</th>
                      <th>เข้าใช้ล่าสุด</th>
                      <th>จัดการ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedUsers.map((user) => (
                      <tr key={user.id} className={editingUser?.id === user.id ? "selected-row" : undefined}>
                        <td>
                          <strong>{user.display_name || user.username}</strong>
                          <small>@{user.username}{user.id === currentUserId ? " · บัญชีที่ใช้อยู่" : ""}</small>
                        </td>
                        <td>{user.email || "-"}</td>
                        <td>
                          <span className={`status-pill ${user.is_admin ? "active" : "muted"}`}>
                            {user.is_admin ? "ผู้ดูแลระบบ" : "ผู้ใช้"}
                          </span>
                        </td>
                        <td>{formatAdminDate(user.last_login_at)}</td>
                        <td>
                          <div className="row-actions">
                            <button
                              type="button"
                              className={editingUser?.id === user.id ? "is-active" : undefined}
                              disabled={saving}
                              aria-pressed={editingUser?.id === user.id}
                              onClick={() => beginUserEdit(user)}
                            >
                              {editingUser?.id === user.id ? "แก้ไขอยู่" : "แก้ไข"}
                            </button>
                            <button
                              type="button"
                              className={`danger ${deletingUserId === user.id ? "is-pending" : ""}`}
                              disabled={user.id === currentUserId || saving}
                              aria-busy={deletingUserId === user.id}
                              title={user.id === currentUserId ? "ไม่สามารถลบบัญชีที่กำลังใช้งาน" : undefined}
                              onClick={() => handleUserDelete(user)}
                            >
                              {deletingUserId === user.id ? (
                                <><span className="row-action-spinner" aria-hidden="true" /> กำลังลบ...</>
                              ) : "ลบ"}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {!userLoading && filteredUsers.length === 0 ? (
                      <tr>
                        <td colSpan={5}>ไม่พบผู้ใช้ที่ตรงกับเงื่อนไข</td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
              <CardPagination
                currentPage={userPage}
                totalItems={filteredUsers.length}
                onPageChange={setUserPage}
                pageSize={USER_PAGE_SIZE}
                scrollTargetId="user-management-table"
                ariaLabel="เปลี่ยนหน้าตารางข้อมูลผู้ใช้"
                itemLabel="บัญชี"
              />
            </div>

            {userFormMode ? (
              <form id="user-edit-form" className="research-panel admin-edit-panel admin-user-form" onSubmit={handleUserSave}>
                <div className="panel-head compact-head">
                  <div>
                    <p className="eyebrow">{userFormMode === "create" ? "New User" : "Edit User"}</p>
                    <h2>{userFormMode === "create" ? "เพิ่มข้อมูลผู้ใช้" : "แก้ไขข้อมูลผู้ใช้"}</h2>
                  </div>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => {
                      setUserFormMode(null);
                      setEditingUser(null);
                    }}
                  >
                    ปิด
                  </button>
                </div>
                <Field label="ชื่อผู้ใช้">
                  <input
                    required
                    minLength={3}
                    value={userFields.username}
                    onChange={(event) => updateUserField("username", event.target.value)}
                  />
                </Field>
                <Field label="ชื่อที่แสดง">
                  <input
                    value={userFields.display_name}
                    onChange={(event) => updateUserField("display_name", event.target.value)}
                  />
                </Field>
                <Field label="อีเมล">
                  <input
                    type="email"
                    value={userFields.email}
                    onChange={(event) => updateUserField("email", event.target.value)}
                  />
                </Field>
                <Field label={userFormMode === "create" ? "รหัสผ่าน" : "รหัสผ่านใหม่ (เว้นว่างหากไม่เปลี่ยน)"}>
                  <input
                    type="password"
                    minLength={8}
                    required={userFormMode === "create"}
                    value={userFields.password}
                    onChange={(event) => updateUserField("password", event.target.value)}
                  />
                </Field>
                <label className="admin-role-toggle">
                  <input
                    type="checkbox"
                    checked={userFields.is_admin}
                    disabled={editingUser?.id === currentUserId}
                    onChange={(event) => updateUserField("is_admin", event.target.checked)}
                  />
                  <span>
                    <strong>สิทธิ์ผู้ดูแลระบบ</strong>
                    <small>อนุญาตให้เข้าถึงหน้า Admin และจัดการฐานข้อมูล</small>
                  </span>
                </label>
                {editingUser?.id === currentUserId ? (
                  <small className="admin-safety-note">ไม่สามารถยกเลิกสิทธิ์ของบัญชีที่กำลังใช้งานได้</small>
                ) : null}
                <div className="form-actions">
                  <button type="submit" className="primary" disabled={saving}>
                    {saving
                      ? "กำลังบันทึก..."
                      : userFormMode === "create"
                        ? "เพิ่มผู้ใช้"
                        : "บันทึกการแก้ไข"}
                  </button>
                  {userFormMode === "edit" && editingUser?.id !== currentUserId ? (
                    <button type="button" className="danger" disabled={saving} onClick={() => editingUser && handleUserDelete(editingUser)}>
                      ลบบัญชีนี้
                    </button>
                  ) : null}
                </div>
              </form>
            ) : (
              <aside className="research-panel admin-edit-panel admin-user-summary">
                <div className="panel-head compact-head">
                  <div>
                    <p className="eyebrow">User Summary</p>
                    <h2>ภาพรวมบัญชี</h2>
                  </div>
                </div>
                <div className="validation-list">
                  <ValidationItem value={users.length} label="บัญชีทั้งหมด" detail="บัญชีที่อยู่ในระบบปัจจุบัน" tone="neutral" />
                  <ValidationItem value={users.filter((user) => user.is_admin).length} label="ผู้ดูแลระบบ" detail="บัญชีที่เข้าถึงหน้า Admin ได้" tone="success" />
                  <ValidationItem value={users.filter((user) => !user.is_admin).length} label="ผู้ใช้งานทั่วไป" detail="บัญชีสมาชิกที่ไม่มีสิทธิ์ Admin" tone="neutral" />
                </div>
              </aside>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function PublicationItem({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string;
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

function EditSaveButton({
  status,
  disabled,
}: {
  status: EditSaveStatus;
  disabled: boolean;
}) {
  const label = status === "saving"
    ? "กำลังบันทึก..."
    : status === "success"
      ? "บันทึกแล้ว"
      : status === "error"
        ? "บันทึกไม่สำเร็จ"
        : "บันทึกการแก้ไข";

  return (
    <button
      type="submit"
      className={`primary admin-save-button admin-save-button--${status}`}
      disabled={disabled}
      aria-live="polite"
    >
      {status === "saving" ? <span className="admin-save-spinner" aria-hidden="true" /> : null}
      {status === "success" ? <span className="admin-save-icon" aria-hidden="true">✓</span> : null}
      {status === "error" ? <span className="admin-save-icon" aria-hidden="true">!</span> : null}
      <span>{label}</span>
    </button>
  );
}

function EditSequenceControls({
  currentIndex,
  total,
  previousItem,
  nextItem,
  disabled,
  onNavigate,
}: {
  currentIndex: number;
  total: number;
  previousItem: ItemOut | null;
  nextItem: ItemOut | null;
  disabled: boolean;
  onNavigate: (item: ItemOut | null) => void;
}) {
  const position = currentIndex >= 0 ? currentIndex + 1 : 0;

  return (
    <nav className="admin-edit-sequence" aria-label="ไปยังรายการชุดการแสดงก่อนหน้าหรือถัดไป">
      <span className="admin-edit-position" aria-live="polite">
        รายการที่ <strong>{position}</strong> จาก {total}
      </span>
      <div className="admin-edit-sequence-buttons">
        <button
          type="button"
          className="secondary"
          disabled={disabled || previousItem === null}
          title={previousItem ? `แก้ไขรายการก่อนหน้า: ${previousItem.name}` : "นี่คือรายการแรก"}
          onClick={() => onNavigate(previousItem)}
        >
          <span aria-hidden="true">←</span> ก่อนหน้า
        </button>
        <button
          type="button"
          className="secondary"
          disabled={disabled || nextItem === null}
          title={nextItem ? `แก้ไขรายการถัดไป: ${nextItem.name}` : "นี่คือรายการสุดท้าย"}
          onClick={() => onNavigate(nextItem)}
        >
          ถัดไป <span aria-hidden="true">→</span>
        </button>
      </div>
    </nav>
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

function normalizeKeywordName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function mergeKeywordOptions(current: KeywordOut[], incoming: KeywordOut[]): KeywordOut[] {
  const merged = new Map<number, KeywordOut>();
  for (const keyword of [...current, ...incoming]) merged.set(keyword.id, keyword);
  return Array.from(merged.values());
}

function formatAdminDate(value: string | null): string {
  if (!value) return "ยังไม่เคยเข้าสู่ระบบ";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function mediaUploadError(error: ApiClientError, kind: "image" | "video"): string {
  switch (error.code) {
    case "image_invalid_type":
      return "รองรับเฉพาะไฟล์รูปภาพ JPEG, PNG และ WebP";
    case "image_too_large":
      return "รูปภาพมีขนาดเกิน 5 MB";
    case "video_invalid_type":
      return "รองรับเฉพาะไฟล์วิดีโอ MP4, WebM และ MOV";
    case "video_too_large":
      return "วิดีโอมีขนาดเกิน 100 MB";
    default:
      return kind === "image" ? `อัปโหลดรูปภาพไม่สำเร็จ: ${error.message}` : `อัปโหลดวิดีโอไม่สำเร็จ: ${error.message}`;
  }
}

function userManagementError(error: ApiClientError): string {
  switch (error.code) {
    case "duplicate_username":
      return "ชื่อผู้ใช้นี้มีอยู่ในระบบแล้ว";
    case "cannot_delete_self":
      return "ไม่สามารถลบบัญชีที่กำลังใช้งานอยู่ได้";
    case "cannot_demote_self":
      return "ไม่สามารถยกเลิกสิทธิ์ผู้ดูแลของบัญชีที่กำลังใช้งานอยู่ได้";
    case "user_not_found":
      return "ไม่พบบัญชีผู้ใช้ที่เลือก กรุณารีเฟรชข้อมูลแล้วลองอีกครั้ง";
    default:
      return error.message;
  }
}
