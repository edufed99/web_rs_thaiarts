"use client";

import React, { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { CatalogItemCard } from "@/components/CatalogItemCard";
import { CardPagination } from "@/components/CardPagination";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { LoadingState } from "@/components/LoadingState";
import { useTranslation } from "@/contexts/LanguageContext";
import { ApiClientError, getContexts, getItems } from "@/lib/api";
import { getContextGroupName, groupContexts, GROUP_LABELS_EN } from "@/lib/contextGroups";
import type { ContextOut, ItemListOut, ItemOut, UserState } from "@/lib/types";
import { useAuthHeaders } from "@/lib/useAuthHeaders";
import { getUserKey } from "@/lib/user";
import { useCardPagination } from "@/lib/useCardPagination";

const FETCH_LIMIT = 200;
const ITEMS_PAGE_SIZE = 12;

function ItemsContent() {
  const router = useRouter();
  const params = useSearchParams();
  const { locale, t } = useTranslation();

  const searchInput = params.get("q") ?? "";
  const contextIdStr = params.get("context");
  const contextId = contextIdStr ? Number(contextIdStr) : null;
  const occasionInput = params.get("occasion") ?? "";
  const categoryInput = params.get("category") ?? "";
  const durationInput = params.get("duration") ?? "";
  const performersInput = params.get("performers") ?? "";
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
      duration?: string;
      performers?: string;
      sort?: string;
    }) => {
      const sp = new URLSearchParams();
      const q = next.q?.trim();
      if (q) sp.set("q", q);
      if (next.context != null && next.context > 0) sp.set("context", String(next.context));
      if (next.occasion) sp.set("occasion", next.occasion);
      if (next.category) sp.set("category", next.category);
      if (next.duration) sp.set("duration", next.duration);
      if (next.performers) sp.set("performers", next.performers);
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
      duration: durationInput,
      performers: performersInput,
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
      duration: durationInput,
      performers: performersInput,
      sort: sortInput,
    });
  };

  const onCategoryChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    updateUrl({
      q: searchInput,
      context: contextId,
      occasion: occasionInput,
      category: e.target.value,
      duration: durationInput,
      performers: performersInput,
      sort: sortInput,
    });
  };

  const onDurationChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    updateUrl({
      q: searchInput,
      context: contextId,
      occasion: occasionInput,
      category: categoryInput,
      duration: e.target.value,
      performers: performersInput,
      sort: sortInput,
    });
  };

  const onPerformersChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    updateUrl({
      q: searchInput,
      context: contextId,
      occasion: occasionInput,
      category: categoryInput,
      duration: durationInput,
      performers: e.target.value,
      sort: sortInput,
    });
  };

  const onSortChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    updateUrl({
      q: searchInput,
      context: contextId,
      occasion: occasionInput,
      category: categoryInput,
      duration: durationInput,
      performers: performersInput,
      sort: e.target.value,
    });
  };

  const selectedContext = useMemo(
    () => (contextId != null ? contexts.find((c) => c.id === contextId) ?? null : null),
    [contextId, contexts],
  );
  const selectedContextName = useMemo(() => {
    if (!selectedContext) return undefined;
    return locale === "en" && selectedContext.name_en ? selectedContext.name_en : selectedContext.name;
  }, [selectedContext, locale]);

  const contextGroups = useMemo(() => groupContexts(contexts), [contexts]);
  const categoryOptions = useMemo(() => {
    if (!data) return [];
    const map = new Map<string, { value: string; label: string }>();
    for (const item of data.items) {
      const g = item.category_group;
      if (!g) continue;
      if (!map.has(g)) {
        const label = locale === "en" && item.category_group_en ? item.category_group_en : g;
        map.set(g, { value: g, label });
      }
    }
    return Array.from(map.values()).sort((a, b) =>
      a.label.localeCompare(b.label, locale === "en" ? "en" : "th"),
    );
  }, [data, locale]);

  const displayCategory = useMemo(() => {
    if (!categoryInput) return "";
    if (locale === "en" && data) {
      const matched = data.items.find(
        (it) => it.category_group === categoryInput || it.category_group_en === categoryInput,
      );
      if (matched?.category_group_en) return matched.category_group_en;
    }
    return categoryInput;
  }, [categoryInput, data, locale]);

  const displayOccasion = useMemo(() => {
    if (!occasionInput) return "";
    if (locale === "en" && GROUP_LABELS_EN[occasionInput]) {
      return GROUP_LABELS_EN[occasionInput];
    }
    return occasionInput;
  }, [occasionInput, locale]);

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
      ? byOccasion.filter(
          (item) =>
            item.category_group === categoryInput ||
            (item.category_group_en != null && item.category_group_en === categoryInput),
        )
      : byOccasion;
    const byDuration = durationInput
      ? byCategory.filter((item) => {
          const d = item.duration_minutes;
          if (d == null) return false;
          if (durationInput === "short") return d < 15;
          if (durationInput === "medium") return d >= 15 && d <= 30;
          if (durationInput === "long") return d > 30;
          return true;
        })
      : byCategory;
    const byPerformers = performersInput
      ? byDuration.filter((item) => {
          const p = item.performers_count;
          if (p == null) return false;
          if (performersInput === "solo") return p <= 2;
          if (performersInput === "small") return p >= 3 && p <= 5;
          if (performersInput === "large") return p >= 6;
          return true;
        })
      : byDuration;
    return sortCatalogItems(byPerformers, sortInput, locale);
  }, [data, searchInput, contextId, occasionInput, categoryInput, durationInput, performersInput, sortInput, locale]);

  const paginationResetKey = `${searchInput}|${contextId ?? ""}|${occasionInput}|${categoryInput}|${durationInput}|${performersInput}|${sortInput}`;
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

  const hasActiveFilters = Boolean(
    searchInput ||
      categoryInput ||
      occasionInput ||
      contextId != null ||
      durationInput ||
      performersInput ||
      (sortInput && sortInput !== "name-asc"),
  );

  if (error) {
    return <ErrorState message={error} code={errorCode} onRetry={() => setReloadKey((k) => k + 1)} />;
  }

  return (
    <section className="catalog-page section-stack" aria-label={t("items.catalogTitle")}>
      <div className="catalog-search-panel">
        <div className="catalog-title-block">
          <div className="catalog-title-row">
            <span className="catalog-title-icon" aria-hidden="true">⌕</span>
            <h1>{pageTitle(searchInput, selectedContextName, displayOccasion, displayCategory, t)}</h1>
          </div>
          <p className="catalog-result-count">
            {categoryInput && !searchInput && !selectedContext ? (
              <>
                {t("items.allInCategory")} <span>{displayCategory}</span>
              </>
            ) : searchInput ? (
              <>
                {t("items.searchQuery")} <span>"{searchInput}"</span>
                {selectedContext ? <> {t("items.inOccasion")} <span>{selectedContextName}</span></> : null}
                {occasionInput ? <> {t("items.inOccasionGroup")} <span>{displayOccasion}</span></> : null}
                {categoryInput ? <> {t("items.categoryLabel")} <span>{displayCategory}</span></> : null}
              </>
            ) : selectedContext ? (
              <>
                {t("items.itemsForOccasion")} <span>{selectedContextName}</span>
                {categoryInput ? <> {t("items.categoryLabel")} <span>{displayCategory}</span></> : null}
              </>
            ) : occasionInput ? (
              <>
                {t("items.itemsInOccasionGroup")} <span>{displayOccasion}</span>
                {categoryInput ? <> {t("items.categoryLabel")} <span>{displayCategory}</span></> : null}
              </>
            ) : (
              t("items.exploreAllSubtitle")
            )}
          </p>
        </div>

        <form onSubmit={onSearchSubmit} className="catalog-filter-bar" aria-label={t("items.filterBar")}>
          <input
            type="search"
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            placeholder={t("items.searchPlaceholder")}
            aria-label={t("items.searchPlaceholder")}
          />
          <select value={categoryInput} onChange={onCategoryChange} aria-label={t("items.filterCategory")}>
            <option value="">{t("items.allCategories")}</option>
            {categoryOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <select
            value={occasionInput ? `group:${occasionInput}` : contextId ?? ""}
            onChange={onContextChange}
            aria-label={t("items.filterOccasion")}
          >
            <option value="">{t("items.allOccasions")}</option>
            {contextGroups.map((group) => {
              const groupLabelDisplay = locale === "en" ? (GROUP_LABELS_EN[group.label] ?? group.label) : group.label;
              return (
                <optgroup key={group.label} label={groupLabelDisplay}>
                  <option value={`group:${group.label}`}>{groupLabelDisplay} ({t("common.all")})</option>
                  {group.contexts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {locale === "en" && c.name_en ? c.name_en : c.name}
                    </option>
                  ))}
                </optgroup>
              );
            })}
          </select>
          <select value={durationInput} onChange={onDurationChange} aria-label={t("items.filterDuration")}>
            <option value="">{t("items.allDurations")}</option>
            <option value="short">{t("items.durationShort")}</option>
            <option value="medium">{t("items.durationMedium")}</option>
            <option value="long">{t("items.durationLong")}</option>
          </select>
          <select value={performersInput} onChange={onPerformersChange} aria-label={t("items.filterPerformers")}>
            <option value="">{t("items.allPerformers")}</option>
            <option value="solo">{t("items.performersSolo")}</option>
            <option value="small">{t("items.performersSmall")}</option>
            <option value="large">{t("items.performersLarge")}</option>
          </select>
          <select value={sortInput} onChange={onSortChange} aria-label={t("items.sortLabel")}>
            <option value="name-asc">{t("items.sortNameAsc")}</option>
            <option value="name-desc">{t("items.sortNameDesc")}</option>
            <option value="newest">{t("items.sortNewest")}</option>
            <option value="recommended">{t("items.sortRecommended")}</option>
            <option value="popular">{t("items.sortPopular")}</option>
          </select>
          <button type="submit">{t("common.search")}</button>
        </form>

        {hasActiveFilters ? (
          <div className="catalog-active-filters" aria-label={t("items.activeFilters")}>
            <span className="active-filter-title">{t("items.activeFilters")}</span>
            {searchInput ? (
              <span className="filter-badge">
                {t("items.filterBadgeSearch")}: "{searchInput}"
                <button
                  type="button"
                  aria-label={`Remove search filter ${searchInput}`}
                  onClick={() => {
                    setSearchDraft("");
                    updateUrl({
                      q: "",
                      context: contextId,
                      occasion: occasionInput,
                      category: categoryInput,
                      duration: durationInput,
                      performers: performersInput,
                      sort: sortInput,
                    });
                  }}
                >
                  ×
                </button>
              </span>
            ) : null}
            {categoryInput ? (
              <span className="filter-badge">
                {t("items.filterBadgeCategory")}: {displayCategory}
                <button
                  type="button"
                  aria-label={`Remove category filter ${displayCategory}`}
                  onClick={() =>
                    updateUrl({
                      q: searchInput,
                      context: contextId,
                      occasion: occasionInput,
                      category: "",
                      duration: durationInput,
                      performers: performersInput,
                      sort: sortInput,
                    })
                  }
                >
                  ×
                </button>
              </span>
            ) : null}
            {selectedContext ? (
              <span className="filter-badge">
                {t("items.filterBadgeOccasion")}: {selectedContextName}
                <button
                  type="button"
                  aria-label={`Remove occasion filter ${selectedContextName}`}
                  onClick={() =>
                    updateUrl({
                      q: searchInput,
                      context: null,
                      occasion: occasionInput,
                      category: categoryInput,
                      duration: durationInput,
                      performers: performersInput,
                      sort: sortInput,
                    })
                  }
                >
                  ×
                </button>
              </span>
            ) : occasionInput ? (
              <span className="filter-badge">
                {t("items.filterBadgeOccasion")}: {displayOccasion}
                <button
                  type="button"
                  aria-label={`Remove occasion filter ${displayOccasion}`}
                  onClick={() =>
                    updateUrl({
                      q: searchInput,
                      context: null,
                      occasion: "",
                      category: categoryInput,
                      duration: durationInput,
                      performers: performersInput,
                      sort: sortInput,
                    })
                  }
                >
                  ×
                </button>
              </span>
            ) : null}
            {durationInput ? (
              <span className="filter-badge">
                {t("items.filterBadgeDuration")}:{" "}
                {durationInput === "short"
                  ? t("items.durationShort")
                  : durationInput === "medium"
                  ? t("items.durationMedium")
                  : t("items.durationLong")}
                <button
                  type="button"
                  aria-label={`Remove duration filter ${durationInput}`}
                  onClick={() =>
                    updateUrl({
                      q: searchInput,
                      context: contextId,
                      occasion: occasionInput,
                      category: categoryInput,
                      duration: "",
                      performers: performersInput,
                      sort: sortInput,
                    })
                  }
                >
                  ×
                </button>
              </span>
            ) : null}
            {performersInput ? (
              <span className="filter-badge">
                {t("items.filterBadgePerformers")}:{" "}
                {performersInput === "solo"
                  ? t("items.performersSolo")
                  : performersInput === "small"
                  ? t("items.performersSmall")
                  : t("items.performersLarge")}
                <button
                  type="button"
                  aria-label={`Remove performers filter ${performersInput}`}
                  onClick={() =>
                    updateUrl({
                      q: searchInput,
                      context: contextId,
                      occasion: occasionInput,
                      category: categoryInput,
                      duration: durationInput,
                      performers: "",
                      sort: sortInput,
                    })
                  }
                >
                  ×
                </button>
              </span>
            ) : null}
            <button
              type="button"
              className="catalog-clear-btn"
              onClick={() => {
                setSearchDraft("");
                router.push("/items");
              }}
            >
              {t("items.clearFilters")}
            </button>
          </div>
        ) : null}
      </div>

      {!data ? (
        <LoadingState message={t("items.loadingResults")} />
      ) : visibleItems.length === 0 ? (
        <EmptyState
          title={t("items.emptyTitle")}
          message={t("items.emptyMessage")}
        />
      ) : (
        <>
          <p className="catalog-result-count">
            {t("items.foundResults")} <span>{filteredItems.length}</span> {t("items.resultsUnit")}
          </p>
          <div id="catalog-card-results" className="card-grid catalog-results-grid" aria-label={t("items.searchResults")}>
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

function sortCatalogItems(items: ItemOut[], sort: string, locale: "th" | "en" = "th"): ItemOut[] {
  const next = [...items];
  const lang = locale === "en" ? "en" : "th";
  const getItemName = (it: ItemOut) => (locale === "en" && it.name_en ? it.name_en : it.name);

  if (sort === "name-desc") {
    return next.sort((a, b) => getItemName(b).localeCompare(getItemName(a), lang));
  }
  if (sort === "newest") {
    return next.sort((a, b) => b.id - a.id || getItemName(a).localeCompare(getItemName(b), lang));
  }
  if (sort === "popular") {
    return next.sort((a, b) => (b.match_percent ?? 0) - (a.match_percent ?? 0) || getItemName(a).localeCompare(getItemName(b), lang));
  }
  if (sort === "recommended") {
    return next.sort((a, b) => (b.match_percent ?? 0) - (a.match_percent ?? 0) || getItemName(a).localeCompare(getItemName(b), lang));
  }
  return next.sort((a, b) => getItemName(a).localeCompare(getItemName(b), lang));
}

function pageTitle(
  search: string,
  contextName: string | undefined,
  occasion: string,
  category: string,
  t: (k: string) => string,
): string {
  if (search) return t("items.searchResults");
  if (category && !contextName && !occasion) return t("items.categoryItems");
  if (occasion || contextName) return t("items.occasionItems");
  return t("items.catalogTitle");
}

export default function ItemsPage() {
  const { t } = useTranslation();
  return (
    <Suspense fallback={<LoadingState message={t("items.preparingResults")} />}>
      <ItemsContent />
    </Suspense>
  );
}
