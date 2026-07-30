"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";

import { ApiClientError, getContexts, getItems, getKeywords } from "@/lib/api";
import type { ContextOut, ItemOut, KeywordOut, UserOut } from "@/lib/types";

import { ErrorState } from "@/components/ErrorState";
import { LoadingState } from "@/components/LoadingState";
import PopularPerformanceCard from "@/components/PopularPerformanceCard";
import {
  AUTH_CHANGED_EVENT,
  getCurrentUser,
  getReadableUserName,
  isAdmin,
  STORAGE_KEY,
} from "@/lib/auth";
import { groupContexts } from "@/lib/contextGroups";
import { getUserKey } from "@/lib/user";

export default function HomePage() {
  const [contexts, setContexts] = useState<ContextOut[]>([]);
  const [keywords, setKeywords] = useState<KeywordOut[]>([]);
  const [items, setItems] = useState<ItemOut[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | undefined>(undefined);
  const [reloadKey, setReloadKey] = useState(0);
  const [user, setUser] = useState<UserOut | null>(null);
  const [admin, setAdmin] = useState(false);
  const [selectedTaxonomyTags, setSelectedTaxonomyTags] = useState<SelectedTaxonomyTag[]>([]);
  const [taxonomySearch, setTaxonomySearch] = useState("");
  const [selectedKeywordLevel1, setSelectedKeywordLevel1] = useState("");
  const [selectedKeywordLevel2, setSelectedKeywordLevel2] = useState("");
  const [selectedKeywordLevel3, setSelectedKeywordLevel3] = useState("");
  const [taxonomyOpen, setTaxonomyOpen] = useState(false);
  const [taxonomyModalOpen, setTaxonomyModalOpen] = useState(false);

  useEffect(() => {
    function syncAuth() {
      const currentUser = getCurrentUser();
      setUser(currentUser);
      setAdmin(Boolean(currentUser?.is_admin) || isAdmin());
    }

    syncAuth();
    function onStorage(e: StorageEvent) {
      if (e.key === STORAGE_KEY) syncAuth();
    }
    window.addEventListener(AUTH_CHANGED_EVENT, syncAuth);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(AUTH_CHANGED_EVENT, syncAuth);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    const userKey = getUserKey();
    Promise.all([getContexts(), getItems({ limit: 8, userKey }), getKeywords(undefined, 1000)])
      .then(([c, itemList, keywordList]) => {
        if (cancelled) return;
        setContexts(c.contexts);
        setItems(itemList.items);
        setKeywords(keywordList.keywords);
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
  }, [reloadKey]);

  const keywordTree = useMemo(() => buildKeywordTaxonomy(keywords), [keywords]);
  const level1Node = keywordTree.find((node) => node.label === selectedKeywordLevel1);
  const level2Options = level1Node?.children ?? [];
  const level2Node = level2Options.find((node) => node.label === selectedKeywordLevel2);
  const level3Options = level2Node?.children ?? [];
  const level3Node = level3Options.find((node) => node.label === selectedKeywordLevel3);
  const keywordOptions = level3Node?.keywords ?? [];
  const selectedTaxonomyQuery = selectedTaxonomyTags.map((tag) => tag.query).join("|");
  const selectedTagKeys = useMemo(
    () => new Set(selectedTaxonomyTags.map((tag) => tag.key)),
    [selectedTaxonomyTags],
  );
  const taxonomySuggestions = useMemo(
    () => getTaxonomySuggestions(keywords, taxonomySearch, selectedTagKeys),
    [keywords, taxonomySearch, selectedTagKeys],
  );
  function addTaxonomyTag(tag: SelectedTaxonomyTag) {
    setSelectedTaxonomyTags((current) =>
      current.some((selected) => selected.key === tag.key) ? current : [...current, tag],
    );
    setTaxonomySearch("");
    setTaxonomyOpen(false);
    setTaxonomyModalOpen(false);
  }

  function removeTaxonomyTag(key: string) {
    setSelectedTaxonomyTags((current) => current.filter((tag) => tag.key !== key));
  }

  if (error) {
    return (
      <ErrorState
        title="เชื่อมต่อ backend ไม่ได้"
        message={error}
        code={errorCode}
        onRetry={() => setReloadKey((k) => k + 1)}
      />
    );
  }
  if (!items) {
    return <LoadingState message="กำลังเชื่อมต่อ backend..." />;
  }

  const popularItems = items.slice(0, 4);
  // Group contexts by item so the seasonal band can show the real top-context
  // for each card instead of the hardcoded "วันเข้าพรรษา" pill.
  const contextById = new Map<number, ContextOut>(contexts.map((c) => [c.id, c]));
  const itemTopContexts = (item: ItemOut): string[] =>
    item.contexts
      .map((c) => contextById.get(c.id)?.name ?? c.name)
      .filter(Boolean)
      .slice(0, 2);

  // The "seasonal band" used to advertise a Thai-calendar integration that
  // never shipped. We now show the contexts with the most active items,
  // sourced from the live ``GET /contexts`` payload.
  const topContexts = [...contexts]
    .filter((c) => c.active_item_count > 0)
    .sort((a, b) => b.active_item_count - a.active_item_count)
    .slice(0, 2);
  const topContextNames = topContexts.map((c) => c.name);
  const seasonalHeading = topContextNames.length > 0
    ? `แนะนำชุดการแสดงจากบริบทยอดนิยม: ${topContextNames.join(", ")}`
    : "แนะนำชุดการแสดงจากบริบทยอดนิยม";
  const seasonalSubtitle = topContexts.length > 0
    ? `อ้างอิงจากจำนวนรายการที่เปิดใช้งานในระบบ (${topContexts
        .map((c) => `${c.name}: ${c.active_item_count} รายการ)`)
        .join(" / ")})`
    : "ยังไม่มีข้อมูลบริบทจาก backend";

  // Pick seasonal items by picking items that share at least one of the top
  // contexts; fall back to popular items if none match.
  const topContextIds = new Set(topContexts.map((c) => c.id));
  const seasonalCandidates = items.filter((item) =>
    item.contexts.some((c) => topContextIds.has(c.id)),
  );
  const seasonalItems = seasonalCandidates.length > 0
    ? seasonalCandidates.slice(0, 4)
    : popularItems;

  const contextGroups = groupContexts(contexts);
  const readableUserName = user ? getReadableUserName(user) : "";

  return (
    <div className="section-stack">
      <section className="portal-hero">
        <div className="portal-hero-media">
          <div className="portal-hero-copy">
            <p className="eyebrow hero-badge">Research prototype</p>
            <h1>ค้นหาชุดการแสดงไทยที่เหมาะกับงานของคุณ</h1>
          </div>
        </div>

        <form className="portal-search-card" action="/items">
          <div className="portal-search-intro">
            <strong>ค้นหาชุดการแสดง</strong>
            <span>เลือกโอกาสที่ใช้แสดงหรือเลือกคุณลักษณะจาก keyword taxonomy</span>
          </div>
          <div className="portal-search-fields">
            <label className="field">
              <span>โอกาสที่ใช้แสดง</span>
              <select name="context">
                <option value="">เลือกโอกาสที่ใช้แสดง</option>
                {contextGroups.map((group) => (
                  <optgroup key={group.label} label={group.label}>
                    {group.contexts.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            <div className="field taxonomy-field">
              <span>เลือกคุณลักษณะการแสดงจากคำค้น</span>
              <input type="hidden" name="q" value={selectedTaxonomyQuery} />
              <div className="taxonomy-search-row">
                <div className="taxonomy-combobox">
                  <div className="taxonomy-input-shell">
                    <input
                      type="search"
                      value={taxonomySearch}
                      onChange={(e) => {
                        setTaxonomySearch(e.target.value);
                        setTaxonomyOpen(true);
                      }}
                      onClick={() => setTaxonomyOpen(true)}
                      onFocus={() => setTaxonomyOpen(true)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && taxonomySuggestions.length > 0) {
                          e.preventDefault();
                          addTaxonomyTag(taxonomySuggestions[0]);
                        }
                      }}
                      placeholder={selectedTaxonomyTags.length ? "เพิ่มคุณลักษณะ..." : "พิมพ์ เช่น ราช โขน พิธี ภาคใต้"}
                      disabled={keywordTree.length === 0}
                      aria-label="พิมพ์ค้นหาคุณลักษณะการแสดง"
                    />
                  </div>
                  {taxonomyOpen && taxonomySearch.trim() ? (
                    <div className="taxonomy-menu">
                      <div className="taxonomy-menu-head">
                        <strong>คำศัพท์มาตรฐานที่ตรงกับคำค้น</strong>
                        {selectedTaxonomyTags.length > 0 ? (
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedTaxonomyTags([]);
                              setTaxonomySearch("");
                              setSelectedKeywordLevel1("");
                              setSelectedKeywordLevel2("");
                              setSelectedKeywordLevel3("");
                            }}
                          >
                            ล้าง
                          </button>
                        ) : null}
                      </div>

                      {taxonomySuggestions.length > 0 ? (
                        <div className="taxonomy-suggestion-list">
                          {taxonomySuggestions.map((tag) => (
                            <button
                              key={tag.key}
                              type="button"
                              className="taxonomy-suggestion"
                              onClick={() => addTaxonomyTag(tag)}
                            >
                              <strong>{tag.label}</strong>
                              <span>{level1LabelForPath(tag.path)}</span>
                            </button>
                          ))}
                        </div>
                      ) : null}

                      {taxonomySuggestions.length === 0 ? (
                        <p className="taxonomy-empty">ไม่พบคำศัพท์มาตรฐานที่ตรงกับคำค้นนี้</p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                <button
                  type="button"
                  className="taxonomy-browse-button"
                  onClick={() => setTaxonomyModalOpen(true)}
                  disabled={keywordTree.length === 0}
                >
                  เลือกจากหมวดหมู่
                </button>
              </div>
              {selectedTaxonomyTags.length > 0 ? (
                <div className="taxonomy-selected-list" aria-label="คุณลักษณะที่เลือก">
                  {selectedTaxonomyTags.map((tag) => (
                    <span key={tag.key} className="taxonomy-chip" title={tag.path || tag.label}>
                      {tag.label}
                      <button
                        type="button"
                        onClick={() => removeTaxonomyTag(tag.key)}
                        aria-label={`ลบ ${tag.label}`}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              ) : null}

              {taxonomyModalOpen ? (
                <div
                  className="taxonomy-modal-backdrop"
                  role="presentation"
                  onClick={() => setTaxonomyModalOpen(false)}
                >
                  <div
                    className="taxonomy-modal"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="taxonomy-modal-title"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="taxonomy-modal-head">
                      <div>
                        <strong id="taxonomy-modal-title">เลือกจากหมวดหมู่ Keyword Taxonomy</strong>
                        <span>ไล่เลือก Level 1-3 แล้วเลือกคำศัพท์มาตรฐานที่ต้องการ</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setTaxonomyModalOpen(false)}
                        aria-label="ปิดหน้าต่างเลือกหมวดหมู่"
                      >
                        ×
                      </button>
                    </div>

                    <div className="taxonomy-browser-grid">
                      <TaxonomyOptionList
                        title="Level 1"
                        options={keywordTree.map((node) => node.label)}
                        selected={selectedKeywordLevel1}
                        onSelect={(value) => {
                          setSelectedKeywordLevel1(value);
                          setSelectedKeywordLevel2("");
                          setSelectedKeywordLevel3("");
                        }}
                      />

                      <TaxonomyOptionList
                        title="Level 2"
                        options={level2Options.map((node) => node.label)}
                        selected={selectedKeywordLevel2}
                        onSelect={(value) => {
                          setSelectedKeywordLevel2(value);
                          setSelectedKeywordLevel3("");
                        }}
                        emptyText={selectedKeywordLevel1 ? "ไม่มี Level 2" : "เลือก Level 1 ก่อน"}
                      />

                      <TaxonomyOptionList
                        title="Level 3"
                        options={level3Options.map((node) => node.label)}
                        selected={selectedKeywordLevel3}
                        onSelect={(value) => setSelectedKeywordLevel3(value)}
                        emptyText={selectedKeywordLevel2 ? "ไม่มี Level 3" : "เลือก Level 2 ก่อน"}
                      />

                      <TaxonomyOptionList
                        title="Keyword"
                        options={keywordOptions.map((keyword) => keyword.name)}
                        selected=""
                        onSelect={(value) => {
                          const keyword = keywordOptions.find((item) => item.name === value);
                          if (keyword) addTaxonomyTag(tagFromKeyword(keyword));
                        }}
                        emptyText={selectedKeywordLevel3 ? "ไม่มีคำศัพท์ในหมวดนี้" : "เลือก Level 3 ก่อน"}
                      />
                    </div>

                    <div className="taxonomy-modal-actions">
                      {selectedKeywordLevel1 ? (
                        <button
                          type="button"
                          onClick={() =>
                            addTaxonomyTag(
                              tagFromTaxonomyLevel(
                                [selectedKeywordLevel1, selectedKeywordLevel2, selectedKeywordLevel3],
                              ),
                            )
                          }
                        >
                          เพิ่มหมวดที่เลือก
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="taxonomy-text-button"
                        onClick={() => {
                          setSelectedKeywordLevel1("");
                          setSelectedKeywordLevel2("");
                          setSelectedKeywordLevel3("");
                        }}
                      >
                        ล้างการเลือกหมวด
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
            <button type="submit">ค้นหา</button>
          </div>
        </form>
      </section>

      <section className="personalized-panel">
        <div>
          <p className="eyebrow">Personalized mode</p>
          <h2 style={{ margin: 0, color: "#23386b" }}>คำแนะนำเฉพาะคุณ</h2>
          <p className="muted" style={{ marginBottom: 0 }}>
            {user
              ? `คุณเข้าสู่ระบบเป็น ${readableUserName} แล้ว ระบบจะใช้การบันทึก ถูกใจ คะแนน และประวัติเดิมเพื่อปรับคำแนะนำให้ตรงขึ้น`
              : "เลือกโอกาสและคุณลักษณะที่สนใจเพื่อให้ระบบจัดอันดับชุดการแสดงให้เหมาะกับคุณ และเมื่อเข้าสู่ระบบ ระบบจะใช้การบันทึก ถูกใจ และคะแนนเพื่อปรับคำแนะนำให้ตรงขึ้น"}
          </p>
        </div>
        <div className="actions" style={{ marginTop: 0 }}>
          <Link className="primary" href={user ? "/recommend" : "/login?next=/recommend"}>
            {user ? "ไปที่คำแนะนำเฉพาะคุณ" : "เริ่มรับคำแนะนำ"}
          </Link>
          {user ? (
            <Link className="secondary" href="/profile">ข้อมูลผู้ใช้</Link>
          ) : (
            <Link className="secondary" href="/login">เข้าสู่ระบบ</Link>
          )}
        </div>
      </section>

      <section className="home-section-head">
        <div>
          <p className="eyebrow">Popular performances</p>
          <h2>ชุดการแสดงยอดนิยม</h2>
          <p>รายการที่ได้รับความสนใจจากผู้ใช้ในระบบ เหมาะสำหรับเริ่มสำรวจโดยยังไม่ใช้ข้อมูลเฉพาะบุคคล</p>
        </div>
        <Link className="secondary" href="/items">ดูทั้งหมด</Link>
      </section>

      <section className="popular-performance-grid">
        {popularItems.map((item) => (
          <PopularPerformanceCard
            key={item.id}
            item={item}
            variant="popular"
          />
        ))}
      </section>

      <section className="seasonal-band">
        <div className="seasonal-head">
          <div>
            <h2>{seasonalHeading}</h2>
            <p className="muted" style={{ margin: "8px 0 0" }}>
              {seasonalSubtitle}
            </p>
          </div>
          <div className="seasonal-pill-stack" aria-label="บริบทยอดนิยม">
            {topContextNames.length > 0 ? (
              topContextNames.map((name) => (
                <span key={name} className="context-pill">{name}</span>
              ))
            ) : (
              <span className="context-pill subtle">ไม่มีข้อมูล</span>
            )}
          </div>
        </div>
        <div className="seasonal-grid">
          {seasonalItems.map((item) => (
            <PopularPerformanceCard
              key={item.id}
              item={item}
              variant="seasonal"
              topContexts={itemTopContexts(item)}
            />
          ))}
        </div>
      </section>

      {admin ? (
        <section data-testid="admin-cta" className="panel">
          <p className="eyebrow">Researcher / Admin</p>
          <h2 style={{ marginTop: 0 }}>ศูนย์บริหารข้อมูลและติดตามระบบ</h2>
          <p className="muted">
            เพิ่มการแสดงใหม่ ตรวจ catalog และใช้ Layer A+B grounding เพื่อช่วยเลือกคำสำคัญ
          </p>
          <div className="actions">
            <Link className="primary" href="/dashboard">เปิด Dashboard ผู้วิจัย</Link>
            <Link className="primary" href="/admin/items/new">เพิ่มการแสดงใหม่</Link>
            <Link className="secondary" href="/admin/items">จัดการแคตตาล็อก</Link>
          </div>
        </section>
      ) : null}

    </div>
  );
}

interface SelectedTaxonomyTag {
  key: string;
  label: string;
  path: string;
  query: string;
}

function getTaxonomySuggestions(
  keywords: KeywordOut[],
  search: string,
  selectedKeys: Set<string>,
): SelectedTaxonomyTag[] {
  const needle = search.trim().toLowerCase();
  if (!needle) return [];

  return keywords
    .filter((keyword) => {
      if (selectedKeys.has(keywordTagKey(keyword))) return false;
      const haystack = `${keyword.name} ${keyword.taxonomy_path}`.toLowerCase();
      return haystack.includes(needle);
    })
    .slice(0, 8)
    .map(tagFromKeyword);
}

function tagFromKeyword(keyword: KeywordOut): SelectedTaxonomyTag {
  return {
    key: keywordTagKey(keyword),
    label: keyword.name,
    path: keyword.taxonomy_path,
    query: keyword.name,
  };
}

function tagFromTaxonomyLevel(parts: string[]): SelectedTaxonomyTag {
  const labels = parts.filter(Boolean);
  const label = labels[labels.length - 1] || "keyword taxonomy";
  const path = labels.join(" > ");
  return {
    key: `taxonomy:${path}`,
    label,
    path,
    query: label,
  };
}

function keywordTagKey(keyword: KeywordOut): string {
  return `keyword:${keyword.id}`;
}

function level1LabelForPath(path: string): string {
  const level1 = path
    .split(">")
    .map((part) => part.trim())
    .find(Boolean);
  return level1 ? `หมวดหลัก: ${level1}` : "keyword taxonomy";
}

function TaxonomyOptionList({
  title,
  options,
  selected,
  onSelect,
  emptyText = "ไม่มีตัวเลือก",
}: {
  title: string;
  options: string[];
  selected: string;
  onSelect: (value: string) => void;
  emptyText?: string;
}) {
  return (
    <div className="taxonomy-level-panel">
      <div className="taxonomy-level-title">{title}</div>
      {options.length > 0 ? (
        <div className="taxonomy-option-grid">
          {options.map((option) => (
            <button
              key={option}
              type="button"
              className={option === selected ? "taxonomy-option active" : "taxonomy-option"}
              onClick={() => onSelect(option)}
            >
              {option}
            </button>
          ))}
        </div>
      ) : (
        <p className="taxonomy-empty">{emptyText}</p>
      )}
    </div>
  );
}

interface KeywordTaxonomyLevel3 {
  label: string;
  keywords: KeywordOut[];
}

interface KeywordTaxonomyLevel2 {
  label: string;
  children: KeywordTaxonomyLevel3[];
}

interface KeywordTaxonomyLevel1 {
  label: string;
  children: KeywordTaxonomyLevel2[];
}

function buildKeywordTaxonomy(keywords: KeywordOut[]): KeywordTaxonomyLevel1[] {
  const tree = new Map<string, Map<string, Map<string, KeywordOut[]>>>();
  for (const keyword of keywords) {
    const [level1, level2, level3] = taxonomyLevelsFor(keyword);
    if (!tree.has(level1)) tree.set(level1, new Map());
    const level2Map = tree.get(level1)!;
    if (!level2Map.has(level2)) level2Map.set(level2, new Map());
    const level3Map = level2Map.get(level2)!;
    level3Map.set(level3, [...(level3Map.get(level3) ?? []), keyword]);
  }

  return Array.from(tree.entries())
    .map(([level1, level2Map]) => ({
      label: level1,
      children: Array.from(level2Map.entries())
        .map(([level2, level3Map]) => ({
          label: level2,
          children: Array.from(level3Map.entries())
            .map(([level3, groupKeywords]) => ({
              label: level3,
              keywords: groupKeywords.sort((a, b) => a.name.localeCompare(b.name, "th")),
            }))
            .sort((a, b) => a.label.localeCompare(b.label, "th")),
        }))
        .sort((a, b) => a.label.localeCompare(b.label, "th")),
    }))
    .sort((a, b) => {
      if (a.label === "คำศัพท์ทั่วไป") return 1;
      if (b.label === "คำศัพท์ทั่วไป") return -1;
      return a.label.localeCompare(b.label, "th");
    });
}

function taxonomyLevelsFor(keyword: KeywordOut): [string, string, string] {
  const parts = (keyword.taxonomy_path || "")
    .split(">")
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === 0) {
    return ["คำศัพท์ทั่วไป", "คำค้นจากรายการการแสดง", "คำสำคัญมาตรฐาน"];
  }

  return [
    parts[0] || "คำศัพท์ทั่วไป",
    parts[1] || "คำค้นจากรายการการแสดง",
    parts[2] || "คำสำคัญมาตรฐาน",
  ];
}

function SeasonalPerformanceCard({ item, index }: { item: ItemOut; index: number }) {
  // DEPRECATED — replaced by components/PopularPerformanceCard.tsx which
  // fetches real legacy stats. Kept as a stub for one release to avoid
  // breaking any leftover imports; remove in next refactor.
  void item;
  void index;
  return null;
}
