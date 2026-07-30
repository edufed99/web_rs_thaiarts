"use client";

import React, { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { CatalogItemCard } from "@/components/CatalogItemCard";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { LoadingState } from "@/components/LoadingState";

import { ApiClientError, getContexts, getItems } from "@/lib/api";
import { groupContexts } from "@/lib/contextGroups";
import type { ContextOut, ItemListOut, ItemOut, UserState } from "@/lib/types";
import { useAuthHeaders } from "@/lib/useAuthHeaders";
import { getUserKey } from "@/lib/user";

const FETCH_LIMIT = 200;
const DISPLAY_LIMIT = 24;

function ItemsContent() {
  const router = useRouter();
  const params = useSearchParams();

  const searchInput = params.get("q") ?? "";
  const contextIdStr = params.get("context");
  const contextId = contextIdStr ? Number(contextIdStr) : null;
  const categoryInput = params.get("category") ?? "";
  const rawSortInput = params.get("sort") ?? "name-asc";
  const sortInput = rawSortInput === "updated" ? "newest" : rawSortInput;

  const [data, setData] = useState<ItemListOut | null>(null);
  const [contexts, setContexts] = useState<ContextOut[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | undefined>(undefined);
  const [userKey, setUserKey] = useState<string>("");
  const [reloadKey, setReloadKey] = useState(0);
  const [searchDraft, setSearchDraft] = useState<string>(searchInput);
  const authHeaders = useAuthHeaders();

  useEffect(() => {
    setUserKey(getUserKey());
  }, []);

  useEffect(() => {
    setSearchDraft(searchInput);
  }, [searchInput]);

  useEffect(() => {
    let cancelled = false;
    getContexts()
      .then((resp) => {
        if (!cancelled) setContexts(resp.contexts);
      })
      .catch(() => {
        // Non-fatal: the context dropdown can simply stay empty.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setData(null);
    getItems({
      search: searchInput || undefined,
      contextId: contextId ?? undefined,
      userKey: userKey || undefined,
      extraHeaders: authHeaders,
      limit: FETCH_LIMIT,
      offset: 0,
    })
      .then((resp) => {
        if (!cancelled) setData(resp);
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
  }, [searchInput, contextId, userKey, reloadKey, authHeaders]);

  const handleUserStateChange = useCallback((itemId: number, next: UserState) => {
    setData((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        items: prev.items.map((it) =>
          it.id === itemId ? { ...it, user_state: next } : it,
        ),
      };
    });
  }, []);

  const updateUrl = useCallback(
    (next: { q?: string; context?: number | null; category?: string; sort?: string }) => {
      const sp = new URLSearchParams();
      if (next.q) sp.set("q", next.q);
      if (next.context != null && next.context > 0) sp.set("context", String(next.context));
      if (next.category) sp.set("category", next.category);
      if (next.sort && next.sort !== "name-asc") sp.set("sort", next.sort);
      const qs = sp.toString();
      router.push(`/items${qs ? `?${qs}` : ""}`);
    },
    [router],
  );

  const onSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateUrl({
      q: searchDraft.trim(),
      context: contextId,
      category: categoryInput,
      sort: sortInput,
    });
  };

  const onContextChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const v = e.target.value;
    updateUrl({
      q: searchInput,
      context: v ? Number(v) : null,
      category: categoryInput,
      sort: sortInput,
    });
  };

  const onCategoryChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    updateUrl({
      q: searchInput,
      context: contextId,
      category: e.target.value,
      sort: sortInput,
    });
  };

  const onSortChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    updateUrl({
      q: searchInput,
      context: contextId,
      category: categoryInput,
      sort: e.target.value,
    });
  };

  const selectedContext = useMemo(
    () => (contextId != null ? contexts.find((c) => c.id === contextId) ?? null : null),
    [contextId, contexts],
  );
  const contextGroups = useMemo(() => groupContexts(contexts), [contexts]);
  const categoryOptions = useMemo(() => {
    if (!data) return [];
    return Array.from(
      new Set(data.items.map((item) => item.category_group).filter(Boolean)),
    ).sort((a, b) => a.localeCompare(b, "th"));
  }, [data]);
  const filteredItems = useMemo(() => {
    if (!data) return [];
    const byCategory = categoryInput
      ? data.items.filter((item) => item.category_group === categoryInput)
      : data.items;
    return sortCatalogItems(byCategory, sortInput);
  }, [data, categoryInput, sortInput]);
  const visibleItems = filteredItems.slice(0, DISPLAY_LIMIT);

  if (error) {
    return (
      <ErrorState
        message={error}
        code={errorCode}
        onRetry={() => setReloadKey((k) => k + 1)}
      />
    );
  }
  if (!data) {
    return <LoadingState message="กำลังโหลดแคตตาล็อก..." />;
  }

  return (
    <div className="section-stack catalog-page">
      <section className="catalog-search-panel">
        <div className="catalog-title-block">
          <p className="eyebrow">Performance catalog</p>
          <div className="catalog-title-row">
            <span className="catalog-title-icon" aria-hidden="true">◈</span>
            <h1>รายการการแสดง</h1>
          </div>
        </div>

        <form
          onSubmit={onSearchSubmit}
          className="catalog-filter-bar"
        >
          <input
            type="search"
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            placeholder="ค้นหาชื่อหรือคำสำคัญ"
            aria-label="ค้นหาชื่อหรือคำสำคัญ"
          />
          <select
            value={categoryInput}
            onChange={onCategoryChange}
            aria-label="เลือกหมวดหมู่"
          >
            <option value="">ทุกหมวดหมู่</option>
            {categoryOptions.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
          <select
            value={sortInput}
            onChange={onSortChange}
            aria-label="เรียงลำดับรายการ"
          >
            <option value="name-asc">เรียงตามชื่อ ก-ฮ</option>
            <option value="name-desc">เรียงตามชื่อ ฮ-ก</option>
            <option value="newest">รายการใหม่ล่าสุด</option>
          </select>
          <select
            value={contextId ?? ""}
            onChange={onContextChange}
            aria-label="เลือกโอกาสที่ใช้แสดง"
          >
            <option value="">ทุกโอกาสที่ใช้แสดง</option>
            {contextGroups.map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.contexts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <button type="submit">ค้นหา</button>
        </form>
      </section>

      <p className="catalog-result-count">
        กำลังแสดง 1-{visibleItems.length} จากทั้งหมด {filteredItems.length} รายการ
        {selectedContext ? <span> · โอกาสที่ใช้แสดง: {selectedContext.name}</span> : null}
      </p>

      {visibleItems.length === 0 ? (
        <EmptyState
          title="ไม่พบรายการ"
          message={selectedContext
            ? "โอกาสนี้ยังไม่มีรายการที่เปิดใช้งาน"
            : "ลองเปลี่ยนคำค้นหรือเลือกโอกาสที่ใช้แสดงอื่น"}
        />
      ) : (
        <div className="card-grid">
          {visibleItems.map((item, idx) => (
            <CatalogItemCard
              key={item.id}
              item={item}
              userKey={userKey}
              contextId={contextId}
              rank={selectedContext ? idx + 1 : undefined}
              descriptionLimit={selectedContext ? 150 : 180}
              onUserStateChange={handleUserStateChange}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function sortCatalogItems(items: ItemOut[], sort: string): ItemOut[] {
  const next = [...items];
  if (sort === "name-desc") {
    return next.sort((a, b) => b.name.localeCompare(a.name, "th"));
  }
  if (sort === "newest") {
    return next.sort((a, b) => b.id - a.id || a.name.localeCompare(b.name, "th"));
  }
  return next.sort((a, b) => a.name.localeCompare(b.name, "th"));
}

export default function ItemsPage() {
  return (
    <Suspense fallback={<LoadingState message="กำลังเตรียมแคตตาล็อก..." />}>
      <ItemsContent />
    </Suspense>
  );
}
