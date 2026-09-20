"use client";

import React, { useEffect, useMemo, useState } from "react";

import { ApiClientError, getKeywords } from "@/lib/api";
import type { KeywordOut } from "@/lib/types";
import { useTranslation } from "@/contexts/LanguageContext";

import { ErrorState } from "./ErrorState";
import { LoadingState } from "./LoadingState";

export const TAXONOMY_NODE_EN: Record<string, string> = {
  "วรรณคดีและสิ่งมีชีวิตเชิงตำนาน": "Literature and Mythological Beings",
  "นามานุกรมและประเภทตัวละคร": "Character Onomastics and Roles",
  "เทวปกรณ์ อสูร และอมนุษย์": "Mythological Deities, Asuras, and Supernatural Beings",
  "ตัวละครหลักและบทบาทในบทละคร": "Protagonists and Dramatic Roles",
  "สถานภาพและลำดับชั้นทางสังคมในวรรณกรรม": "Social Hierarchy and Status in Literature",
  "ฐานันดรศักดิ์และระบบเครือญาติ": "Royal Titles and Kinship Systems",
  "ศิลปะการแสดงและดนตรี": "Performing Arts and Music",
  "นาฏยศิลป์และการแสดง": "Dramatic Arts and Dance Choreography",
  "กระบวนท่ารำและจารีตการแสดง": "Dance Postures and Performance Traditions",
  "รูปแบบการแสดงและนาฏศิลป์ท้องถิ่น": "Performance Styles and Regional Dances",
  "ดุริยางคศิลป์และคีตศิลป์": "Musicology and Vocal Arts",
  "ระเบียบวิธีทางดนตรีและประเภทบทเพลง": "Musical Modes and Song Typology",
  "เครื่องดนตรีและวงดนตรี": "Musical Instruments and Ensembles",
  "บุคลากรและทักษะทางศิลปะ": "Artists, Roles, and Artistic Virtuosity",
  "กลวิธีและสมรรถนะการแสดง": "Performance Techniques and Stage Skills",
  "พิธีกรรม ความเชื่อ และจารีตวัฒนธรรม": "Rituals, Beliefs, and Cultural Traditions",
  "ระบบความเชื่อและศาสนา": "Religious and Belief Systems",
  "คติทางศาสนาและสิ่งศักดิ์สิทธิ์": "Sacred Concepts and Holy Entities",
  "จารีตประเพณีและพิธีกรรม": "Traditions, Customs, and Ceremonies",
  "พิธีการสำคัญและจารีตทางสังคม": "Key Ceremonies and Social Observances",
  "คติความเชื่อและไสยศาสตร์": "Animism, Folklore, and Esotericism",
  "การขจัดปัดเป่าและอำนาจเหนือธรรมชาติ": "Spiritual Apotropaism and Supernatural Powers",
  "บริบทเชิงประวัติศาสตร์ ภูมิศาสตร์ และพื้นที่": "Historical, Geographical, and Spatial Context",
  "ภูมิศาสตร์และอาณาบริเวณ": "Geography and Territories",
  "เขตปกครองและภูมิภาค": "Administrative Regions and Topography",
  "พื้นที่ในคติความเชื่อและประวัติศาสตร์": "Mythical Realms and Historical Landscapes",
  "ยุคสมัยและเหตุการณ์สำคัญ": "Historical Eras and Notable Events",
  "ลำดับเวลาและประวัติศาสตร์การสงคราม": "Chronology and Military History",
  "พื้นที่ทางวัฒนธรรมและสถาบัน": "Cultural Spaces and Institutions",
  "สถานที่จัดแสดงและเขตพระราชฐาน": "Performance Venues and Royal Precincts",
  "วัฒนธรรมวัตถุ ศิลปกรรม และงานช่าง": "Material Culture, Fine Arts, and Craftsmanship",
  "ประณีตศิลป์และทัศนศิลป์": "Fine Arts and Visual Arts",
  "งานช่างศิลปกรรมและเทคนิควิธี": "Artistic Craftsmanship and Traditional Methods",
  "สถาปัตยกรรมและพุทธศิลป์": "Architecture and Buddhist Art",
  "ศาสนสถานและปูชนียวัตถุ": "Sacred Sanctuaries and Religious Artifacts",
  "พัสตราภรณ์และเครื่องแต่งกาย": "Textiles, Regalia, and Costumery",
  "ระเบียบการแต่งกายและอาวุธจำลอง": "Sartorial Conventions and Prop Weaponry",
  "วัสดุและอัญมณี": "Materials and Gemstones",
  "วัสดุธรรมชาติและรัตนชาติ": "Natural Resources and Precious Gems",
  "กลุ่มชาติพันธุ์ ชุมชน และวิถีชีวิต": "Ethnic Groups, Communities, and Ways of Life",
  "อัตลักษณ์ทางสังคมและกลุ่มคน": "Social Identity and Demographics",
  "กลุ่มชาติพันธุ์และชุมชนท้องถิ่น": "Ethnic Minorities and Local Communities",
  "โครงสร้างสังคมและบุคคลสำคัญ": "Social Structure and Historical Figures",
  "ฐานันดรศักดิ์และบทบาททางสังคม": "Social Ranks and Civic Functions",
  "วิถีชีวิตและระบบเศรษฐกิจ": "Traditional Livelihoods and Agrarian Economy",
  "การประกอบอาชีพและโภชนาการ": "Occupational Practices and Culinary Culture",
  "วิถีชีวิตและพฤติกรรมทางสังคม": "Social Customs, Folkways, and Everyday Life",
  "จารีตการปฏิบัติและพรรณไม้ในวิถีชีวิต": "Folk Practices and Ethnobotany",
  "คำศัพท์ทั่วไป": "General Vocabulary",
  "คำค้นจากรายการการแสดง": "Catalogue Keywords",
  "คำสำคัญมาตรฐาน": "Standard Keywords",
  "เครื่องแต่งกาย": "Costumes & Attire",
  "ศีรษะ": "Headwear & Crowns",
  "ผู้หญิง": "Women",
};

export interface KeywordPickerProps {
  selectedIds: number[];
  onChange: (ids: number[]) => void;
  /** Selected context narrows the vocabulary to keywords found in matching items. */
  contextId?: number | null;
  /** Max number of search suggestions shown. */
  limit?: number;
}

export function KeywordPicker({ selectedIds, onChange, contextId, limit = 12 }: KeywordPickerProps) {
  const { locale, t } = useTranslation();
  const [keywords, setKeywords] = useState<KeywordOut[] | null>(null);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | undefined>(undefined);
  const [reloadKey, setReloadKey] = useState(0);
  const [taxonomyModalOpen, setTaxonomyModalOpen] = useState(false);
  const [selectedKeywordLevel1, setSelectedKeywordLevel1] = useState("");
  const [selectedKeywordLevel2, setSelectedKeywordLevel2] = useState("");
  const [selectedKeywordLevel3, setSelectedKeywordLevel3] = useState("");
  const waitsForContext = contextId === null;

  useEffect(() => {
    let cancelled = false;
    setError(null);
    if (waitsForContext) {
      setKeywords([]);
      return () => {
        cancelled = true;
      };
    }
    getKeywords(undefined, 1000, contextId)
      .then((data) => {
        if (!cancelled) setKeywords(data.keywords);
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
  }, [reloadKey, contextId, waitsForContext]);

  useEffect(() => {
    if (!keywords) return;
    const availableIds = new Set(keywords.map((keyword) => keyword.id));
    const nextIds = selectedIds.filter((id) => availableIds.has(id));
    if (nextIds.length !== selectedIds.length) {
      onChange(nextIds);
    }
  }, [keywords, selectedIds, onChange]);

  const filtered = (() => {
    if (!keywords) return [];
    const needle = search.trim().toLowerCase();
    if (needle.length === 0) return [];
    return keywords
      .filter((k) =>
        `${k.name} ${k.name_en ?? ""} ${k.taxonomy_path}`.toLowerCase().includes(needle),
      )
      .slice(0, limit);
  })();

  const keywordTree = useMemo(() => buildKeywordTaxonomy(keywords ?? []), [keywords]);
  const level1Node = keywordTree.find((node) => node.label === selectedKeywordLevel1);
  const level2Options = level1Node?.children ?? [];
  const level2Node = level2Options.find((node) => node.label === selectedKeywordLevel2);
  const level3Options = level2Node?.children ?? [];
  const level3Node = level3Options.find((node) => node.label === selectedKeywordLevel3);
  const keywordOptions = level3Node?.keywords ?? [];

  if (error) {
    return (
      <ErrorState
        message={error}
        code={errorCode}
        onRetry={() => setReloadKey((k) => k + 1)}
      />
    );
  }
  if (!keywords) {
    return <LoadingState message={t("recommend.keywordsLoading")} />;
  }

  const selectedSet = new Set(selectedIds);
  const selectedKeywords = keywords.filter((k) => selectedSet.has(k.id));

  function toggle(id: number) {
    const next = new Set(selectedSet);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    onChange(Array.from(next));
  }

  return (
    <div className="keyword-picker-root">
      <div className="form-label keyword-picker-label">
        {t("recommend.keywordsLabel")}{" "}
        <span className="keyword-picker-optional">{t("recommend.keywordsOptional")}</span>
      </div>
      <div className="taxonomy-search-row">
        <input
          type="text"
          placeholder={
            waitsForContext
              ? t("recommend.keywordsWaitContext")
              : t("recommend.keywordsSearchPlaceholder")
          }
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          disabled={waitsForContext}
        />
        <button
          type="button"
          className="taxonomy-browse-button"
          onClick={() => setTaxonomyModalOpen(true)}
          disabled={keywordTree.length === 0}
        >
          {t("recommend.keywordsBrowseCategories")}
        </button>
      </div>
      {selectedKeywords.length > 0 ? (
        <div style={{ marginBottom: "0.85rem" }}>
          <div className="meta-line" style={{ marginBottom: "0.4rem" }}>
            {t("recommend.keywordsSelectedLabel")}
          </div>
          <div className="pill-row">
            {selectedKeywords.map((k) => {
              const displayName = locale === "en" && k.name_en ? k.name_en : k.name;
              return (
                <button
                  key={k.id}
                  type="button"
                  onClick={() => toggle(k.id)}
                  className="keyword-pill"
                  aria-label={`${locale === "en" ? "Remove" : "ลบ"} ${displayName}`}
                  title={k.taxonomy_path || displayName}
                  style={{ cursor: "pointer" }}
                >
                  {displayName} ×
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
      {search.trim() ? (
        filtered.length === 0 ? (
          <p style={{ color: "#777", margin: 0 }}>{t("recommend.keywordsNotFound")}</p>
        ) : (
          <div>
            <div className="meta-line" style={{ marginBottom: "0.4rem" }}>
              {t("recommend.keywordsSearchResults")}
            </div>
            <div className="pill-row">
              {filtered.map((k) => {
                const active = selectedSet.has(k.id);
                const displayName = locale === "en" && k.name_en ? k.name_en : k.name;
                return (
                  <button
                    key={k.id}
                    type="button"
                    onClick={() => toggle(k.id)}
                    aria-pressed={active}
                    title={k.taxonomy_path || displayName}
                    style={{
                      padding: "0.45rem 0.85rem",
                      border: "1px solid",
                      borderColor: active ? "#c5913b" : "rgba(197, 145, 59, 0.38)",
                      backgroundColor: active ? "#102a4a" : "#fff7e5",
                      color: active ? "#fffaf0" : "#8a5b17",
                      borderRadius: "8px",
                      cursor: "pointer",
                      fontSize: "0.9rem",
                      fontWeight: 800,
                    }}
                  >
                    {active ? t("recommend.keywordsSelectedPrefix") : null}
                    {displayName}
                  </button>
                );
              })}
            </div>
          </div>
        )
      ) : (
        <p className="muted" style={{ margin: 0, fontSize: "0.9rem" }}>
          {waitsForContext
            ? t("recommend.keywordsHelperWaitsContext")
            : t("recommend.keywordsHelperDefault")}
        </p>
      )}
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
            aria-labelledby="keyword-taxonomy-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="taxonomy-modal-head">
              <div>
                <strong id="keyword-taxonomy-modal-title">
                  {t("recommend.taxonomyModalTitle")}
                </strong>
                <span>{t("recommend.taxonomyModalSubtitle")}</span>
              </div>
              <button
                type="button"
                onClick={() => setTaxonomyModalOpen(false)}
                aria-label={t("recommend.taxonomyModalClose")}
              >
                ×
              </button>
            </div>

            <div className="taxonomy-browser-grid">
              <TaxonomyOptionList
                title="Level 1"
                options={keywordTree.map((node) => node.label)}
                selected={selectedKeywordLevel1}
                renderLabel={(opt) =>
                  locale === "en" ? (TAXONOMY_NODE_EN[opt] || opt) : opt
                }
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
                renderLabel={(opt) =>
                  locale === "en" ? (TAXONOMY_NODE_EN[opt] || opt) : opt
                }
                onSelect={(value) => {
                  setSelectedKeywordLevel2(value);
                  setSelectedKeywordLevel3("");
                }}
                emptyText={
                  selectedKeywordLevel1
                    ? t("recommend.taxonomyNoLevel2")
                    : t("recommend.taxonomySelectLevel1First")
                }
              />

              <TaxonomyOptionList
                title="Level 3"
                options={level3Options.map((node) => node.label)}
                selected={selectedKeywordLevel3}
                renderLabel={(opt) =>
                  locale === "en" ? (TAXONOMY_NODE_EN[opt] || opt) : opt
                }
                onSelect={(value) => setSelectedKeywordLevel3(value)}
                emptyText={
                  selectedKeywordLevel2
                    ? t("recommend.taxonomyNoLevel3")
                    : t("recommend.taxonomySelectLevel2First")
                }
              />

              <div className="taxonomy-level-panel">
                <div className="taxonomy-level-title">Keyword</div>
                {keywordOptions.length > 0 ? (
                  <div className="taxonomy-option-grid">
                    {keywordOptions.map((keyword) => {
                      const active = selectedSet.has(keyword.id);
                      const displayName =
                        locale === "en" && keyword.name_en ? keyword.name_en : keyword.name;
                      return (
                        <button
                          key={keyword.id}
                          type="button"
                          className={active ? "taxonomy-option active" : "taxonomy-option"}
                          onClick={() => toggle(keyword.id)}
                        >
                          {active ? t("recommend.keywordsSelectedPrefix") : null}
                          {displayName}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className="taxonomy-empty">
                    {selectedKeywordLevel3
                      ? t("recommend.taxonomyNoKeywords")
                      : t("recommend.taxonomySelectLevel3First")}
                  </p>
                )}
              </div>
            </div>

            <div className="taxonomy-modal-actions">
              {selectedIds.length > 0 ? (
                <button
                  type="button"
                  className="taxonomy-text-button"
                  onClick={() => onChange([])}
                >
                  {t("recommend.taxonomyClearSelected")}
                </button>
              ) : null}
              <button type="button" onClick={() => setTaxonomyModalOpen(false)}>
                {t("recommend.taxonomyDone")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function TaxonomyOptionList({
  title,
  options,
  selected,
  onSelect,
  renderLabel,
  emptyText = "ไม่มีตัวเลือก",
}: {
  title: string;
  options: string[];
  selected: string;
  onSelect: (value: string) => void;
  renderLabel?: (val: string) => string;
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
              {renderLabel ? renderLabel(option) : option}
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
  name_en?: string;
  keywords: KeywordOut[];
}

interface KeywordTaxonomyLevel2 {
  label: string;
  name_en?: string;
  children: KeywordTaxonomyLevel3[];
}

interface KeywordTaxonomyLevel1 {
  label: string;
  name_en?: string;
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
      name_en: TAXONOMY_NODE_EN[level1],
      children: Array.from(level2Map.entries())
        .map(([level2, level3Map]) => ({
          label: level2,
          name_en: TAXONOMY_NODE_EN[level2],
          children: Array.from(level3Map.entries())
            .map(([level3, groupKeywords]) => ({
              label: level3,
              name_en: TAXONOMY_NODE_EN[level3],
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
