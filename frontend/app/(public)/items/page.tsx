"use client";

import React, { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { CatalogItemCard } from "@/components/CatalogItemCard";
import { CardPagination } from "@/components/CardPagination";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { LoadingState } from "@/components/LoadingState";
import { ApiClientError, getContexts, getItems } from "@/lib/api";
import { getContextGroupName, groupContexts } from "@/lib/contextGroups";
import type { ContextOut, ItemListOut, ItemOut, UserState } from "@/lib/types";
import { useAuthHeaders } from "@/lib/useAuthHeaders";
import { getUserKey } from "@/lib/user";
import { useCardPagination } from "@/lib/useCardPagination";

const FETCH_LIMIT = 200;
const ITEMS_PAGE_SIZE = 12;

function ItemsContent() {
  const router = useRouter();
  const params = useSearchParams();

  const searchInput = params.get("q") ?? "";
  const contextIdStr = params.get("context");
  const contextId = contextIdStr ? Number(contextIdStr) : null;
  const occasionInput = params.get("occasion") ?? "";
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
      .catch(() => {});
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
      contextId: searchInput ? undefined : contextId ?? undefined,
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

  const updateUrl = useCallback(
    (next: {
      q?: string;
      context?: number | null;
      occasion?: string;
      category?: string;
      sort?: string;
    }) => {
      const sp = new URLSearchParams();
      const q = next.q?.trim();
      if (q) sp.set("q", q);
      if (next.context != null && next.context > 0) sp.set("context", String(next.context));
      if (next.occasion) sp.set("occasion", next.occasion);
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
      q: searchDraft,
      context: contextId,
      occasion: occasionInput,
      category: categoryInput,
      sort: sortInput,
    });
  };

  const onContextChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const v = e.target.value;
    const isGroup = v.startsWith("group:");
    updateUrl({
      q: searchInput,
      context: v && !isGroup ? Number(v) : null,
      occasion: isGroup ? v.slice("group:".length) : "",
      category: categoryInput,
      sort: sortInput,
    });
  };

  const onCategoryChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    updateUrl({
      q: searchInput,
      context: contextId,
      occasion: occasionInput,
      category: e.target.value,
      sort: sortInput,
    });
  };

  const onSortChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    updateUrl({
      q: searchInput,
      context: contextId,
      occasion: occasionInput,
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
    const byContext =
      searchInput && contextId != null
        ? data.items.filter((item) => item.contexts.some((ctx) => ctx.id === contextId))
        : data.items;
    const byOccasion = occasionInput
      ? byContext.filter((item) =>
          item.contexts.some((ctx) => getContextGroupName(ctx) === occasionInput),
        )
      : byContext;
    const byCategory = categoryInput
      ? byOccasion.filter((item) => item.category_group === categoryInput)
      : byOccasion;
    return sortCatalogItems(byCategory, sortInput);
  }, [data, searchInput, contextId, occasionInput, categoryInput, sortInput]);
  const paginationResetKey = `${searchInput}|${contextId ?? ""}|${occasionInput}|${categoryInput}|${sortInput}`;
  const {
    page,
    setPage,
    pageItems: visibleItems,
    startIndex,
  } = useCardPagination(filteredItems, paginationResetKey, ITEMS_PAGE_SIZE);

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

  if (error) {
    return <ErrorState message={error} code={errorCode} onRetry={() => setReloadKey((k) => k + 1)} />;
  }

  return (
    <section className="catalog-page section-stack" aria-label="ค้นหาชุดการแสดง">
      <div className="catalog-search-panel">
        <div className="catalog-title-block">
          <div className="catalog-title-row">
            <span className="catalog-title-icon" aria-hidden="true">⌕</span>
            <h1>{pageTitle(searchInput, selectedContext?.name, occasionInput, categoryInput)}</h1>
          </div>
          <p className="catalog-result-count">
            {categoryInput && !searchInput && !selectedContext ? (
              <>
                ชุดการแสดงทั้งหมดในหมวดหมู่ <span>{categoryInput}</span>
              </>
            ) : searchInput ? (
              <>
                คำค้น <span>"{searchInput}"</span>
                {selectedContext ? <> ในโอกาส <span>{selectedContext.name}</span></> : null}
                {occasionInput ? <> ในกลุ่มโอกาส <span>{occasionInput}</span></> : null}
                {categoryInput ? <> หมวดหมู่ <span>{categoryInput}</span></> : null}
              </>
            ) : selectedContext ? (
              <>
                ชุดการแสดงในโอกาส <span>{selectedContext.name}</span>
                {categoryInput ? <> หมวดหมู่ <span>{categoryInput}</span></> : null}
              </>
            ) : occasionInput ? (
              <>
                ชุดการแสดงทั้งหมดในกลุ่มโอกาส <span>{occasionInput}</span>
                {categoryInput ? <> หมวดหมู่ <span>{categoryInput}</span></> : null}
              </>
            ) : (
              "สำรวจชุดการแสดงทั้งหมดจากฐานข้อมูลนาฏศิลป์ไทย"
            )}
          </p>
        </div>

        <form onSubmit={onSearchSubmit} className="catalog-filter-bar" aria-label="ตัวกรองรายการ">
          <input
            type="search"
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            placeholder="ค้นหาชื่อชุดการแสดง หมวดหมู่ หรือคำอธิบาย"
            aria-label="ค้นหาชื่อชุดการแสดง หมวดหมู่ หรือคำอธิบาย"
          />
          <select value={categoryInput} onChange={onCategoryChange} aria-label="เลือกหมวดหมู่">
            <option value="">ทุกหมวดหมู่</option>
            {categoryOptions.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
          <select value={sortInput} onChange={onSortChange} aria-label="เรียงลำดับ">
            <option value="name-asc">เรียงตามชื่อ ก-ฮ</option>
            <option value="name-desc">เรียงตามชื่อ ฮ-ก</option>
            <option value="newest">รายการใหม่ล่าสุด</option>
          </select>
          <select
            value={occasionInput ? `group:${occasionInput}` : contextId ?? ""}
            onChange={onContextChange}
            aria-label="เลือกโอกาส"
          >
            <option value="">ทุกโอกาส</option>
            {contextGroups.map((group) => (
              <optgroup key={group.label} label={group.label}>
                <option value={`group:${group.label}`}>{group.label} (ทั้งหมด)</option>
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
      </div>

      {!data ? (
        <LoadingState message="กำลังโหลดผลลัพธ์..." />
      ) : visibleItems.length === 0 ? (
        <EmptyState
          title="ไม่พบชุดการแสดงที่เกี่ยวข้อง"
          message="ลองเปลี่ยนคำค้น หรือล้างตัวกรองหมวดหมู่/โอกาส"
        />
      ) : (
        <>
          <p className="catalog-result-count">
            พบ <span>{filteredItems.length}</span> รายการที่เกี่ยวข้อง
          </p>
          <div id="catalog-card-results" className="card-grid catalog-results-grid" aria-label="ผลลัพธ์ชุดการแสดง">
            {visibleItems.map((item, idx) => (
              <CatalogItemCard
                key={item.id}
                item={item}
                userKey={userKey}
                contextId={contextId}
                rank={contextId && !searchInput ? startIndex + idx + 1 : undefined}
                onUserStateChange={handleUserStateChange}
              />
            ))}
          </div>
          <CardPagination
            currentPage={page}
            totalItems={filteredItems.length}
            onPageChange={setPage}
            pageSize={ITEMS_PAGE_SIZE}
            scrollTargetId="catalog-card-results"
          />
        </>
      )}
    </section>
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

function pageTitle(
  search: string,
  contextName: string | undefined,
  occasion: string,
  category: string,
): string {
  if (search) return "ผลลัพธ์การค้นหา";
  if (category && !contextName && !occasion) return "รายการในหมวดหมู่";
  if (occasion) return "ชุดการแสดงตามโอกาส";
  if (contextName) return "ชุดการแสดงตามโอกาส";
  return "ค้นหาชุดการแสดง";
}

export default function ItemsPage() {
  return (
    <Suspense fallback={<LoadingState message="กำลังเตรียมผลลัพธ์..." />}>
      <ItemsContent />
    </Suspense>
  );
}
