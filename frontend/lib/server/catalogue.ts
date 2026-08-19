import { createHash } from "node:crypto";

import type {
  ContextOut,
  ItemListOut,
  ItemOut,
  KeywordOut,
} from "@/lib/types";
import { getDataSource } from "@/db/connection";
import {
  CatalogueContextEntity,
  CatalogueItemEntity,
  CatalogueKeywordEntity,
  ItemContextEntity,
  ItemKeywordEntity,
  TaxonomyNodeEntity,
  type CatalogueContext,
  type CatalogueItem,
  type CatalogueKeyword,
  type ItemContextLink,
  type ItemKeywordLink,
  type TaxonomyNode,
} from "@/db/entities/Catalogue";
import { rankSimilarArtifactIds } from "@/lib/server/model-service";

export interface CatalogueSnapshot {
  items: CatalogueItem[];
  contexts: CatalogueContext[];
  keywords: CatalogueKeyword[];
  taxonomyNodes: TaxonomyNode[];
  itemContexts: ItemContextLink[];
  itemKeywords: ItemKeywordLink[];
}

/**
 * Eligibility gate port (legacy ``get_context_valid_items``): active items
 * valid for the given sub-context, keyword-matching items first, then an
 * optional candidate cap with adaptive fill back to ``minCands`` when the
 * cap would starve the scorer. Callers use this to build the Eligible
 * Candidate Set for the Private Model Service inference request.
 */
// fallow-ignore-next-line complexity -- Keyword-hit ordering, candidate caps, and adaptive fill mirror the legacy eligibility gate.
export function eligibleItemsForContext(
  snapshot: CatalogueSnapshot,
  contextInternalId: number,
  keywordNames: string[],
  caps: { maxCands?: number; minCands: number },
): CatalogueItem[] {
  const contextItemIds = itemIdsForContext(snapshot, contextInternalId);
  const keywordSet = new Set(keywordNames.filter((name) => name.length > 0));
  let pool = snapshot.items
    .filter(
      (item) =>
        item.isActive &&
        contextItemIds.has(numberOf(item.id)),
    )
    .sort(
      (left, right) =>
        left.name.localeCompare(right.name, "th") || numberOf(left.id) - numberOf(right.id),
    );

  if (keywordSet.size > 0) {
    const hit = pool.filter((item) => {
      const itemKeywords = new Set(
        snapshot.keywords
          .filter((keyword) =>
            snapshot.itemKeywords.some(
              (link) =>
                numberOf(link.itemId) === numberOf(item.id) &&
                numberOf(link.keywordId) === numberOf(keyword.id),
            ),
          )
          .map((keyword) => keyword.name),
      );
      return [...keywordSet].some((name) => itemKeywords.has(name));
    });
    const hitIds = new Set(hit.map((item) => numberOf(item.id)));
    const miss = pool.filter((item) => !hitIds.has(numberOf(item.id)));
    pool = [...hit, ...miss];
  }

  if (caps.maxCands !== undefined && caps.maxCands > 0) {
    const adaptiveMin = Math.min(caps.minCands, pool.length);
    const capped = pool.slice(0, caps.maxCands);
    if (capped.length < adaptiveMin) {
      const selectedIds = new Set(capped.map((item) => numberOf(item.id)));
      const remaining = pool.filter((item) => !selectedIds.has(numberOf(item.id)));
      const fill = remaining.slice(0, adaptiveMin - capped.length);
      pool = [...capped, ...fill];
    } else {
      pool = capped;
    }
  }
  return pool;
}

const anonymousState = { liked: false, saved: false, rating: 0 } as const;

// fallow-ignore-next-line complexity -- Browse, prioritized search, and context-ranked modes share one public catalogue contract.
export async function listItems(options: {
  search?: string;
  limit: number;
  offset: number;
  contextId?: number;
}): Promise<ItemListOut | undefined> {
  const snapshot = await loadCatalogueSnapshot();
  let items = snapshot.items.filter((item) => item.isActive);

  if (options.contextId !== undefined) {
    const context = snapshot.contexts.find(
      (row) => stableId("context", row.name) === options.contextId,
    );
    if (!context) return undefined;
    const eligibleInternalIds = itemIdsForContext(snapshot, numberOf(context.id));
    const ranked = items
      .filter((item) => eligibleInternalIds.has(numberOf(item.id)))
      .map((item) => catalogueItemOut(snapshot, item))
      .sort((left, right) =>
        (right.match_percent ?? 0) - (left.match_percent ?? 0) ||
        left.name.localeCompare(right.name, "th"),
      )
      .slice(0, 10);
    return { items: ranked, total: ranked.length };
  }

  const terms = searchTerms(options.search);
  if (terms.length > 0) {
    for (const field of ["name", "categoryGroup", "description"] as const) {
      const matches = items.filter((item) =>
        terms.every((term) => item[field].toLocaleLowerCase().includes(term)),
      );
      if (matches.length > 0) {
        items = matches;
        break;
      }
      if (field === "description") items = [];
    }
  }
  const total = items.length;
  return {
    items: items
      .slice(options.offset, options.offset + options.limit)
      .map((item) => catalogueItemOut(snapshot, item)),
    total,
  };
}

export async function getItem(artifactItemId: number): Promise<ItemOut | undefined> {
  const snapshot = await loadCatalogueSnapshot();
  const item = activeItemByArtifactId(snapshot, artifactItemId);
  return item ? catalogueItemOut(snapshot, item) : undefined;
}

export async function getItemsBatch(artifactItemIds: number[]): Promise<ItemListOut> {
  const snapshot = await loadCatalogueSnapshot();
  const byArtifactId = new Map(
    snapshot.items
      .filter((item) => item.isActive)
      .map((item) => [numberOf(item.artifactItemId), item]),
  );
  const items = artifactItemIds
    .map((artifactId) => byArtifactId.get(artifactId))
    .filter((item): item is CatalogueItem => item !== undefined)
    .map((item) => catalogueItemOut(snapshot, item));
  return { items, total: items.length };
}

export async function getSimilarItems(
  artifactItemId: number,
  limit: number,
): Promise<ItemListOut | undefined> {
  const snapshot = await loadCatalogueSnapshot();
  const reference = activeItemByArtifactId(snapshot, artifactItemId);
  if (!reference) return undefined;
  // Issue #8 publication gate: the model service scores from prebuilt
  // artifacts, so rows edited after the last Artifact Publication must
  // not be ranked as similar candidates. The reference item may itself
  // be pending — it is only the anchor.
  const candidates = snapshot.items
    .filter(
      (candidate) =>
        candidate.isActive &&
        candidate.publishedAt !== null &&
        numberOf(candidate.artifactItemId) !== artifactItemId,
    );
  const candidateIds = candidates.map((candidate) => numberOf(candidate.artifactItemId));
  if (candidateIds.length === 0) {
    return { items: [], total: 0 };
  }

  let rankedIds: number[] = [];
  try {
    rankedIds = await rankSimilarArtifactIds({
      referenceArtifactItemId: artifactItemId,
      candidateArtifactItemIds: candidateIds,
      limit,
    });
  } catch {
    // Private Model Service unavailable or the reference is not in the loaded
    // release — fall back to a local content-overlap ranking so the UI still
    // surfaces related performances.
    const fallback = catalogueSimilarityFallback(snapshot, reference, candidates, limit);
    return { items: fallback, total: fallback.length };
  }

  if (rankedIds.length === 0) {
    const fallback = catalogueSimilarityFallback(snapshot, reference, candidates, limit);
    return { items: fallback, total: fallback.length };
  }

  const byArtifactId = new Map(
    candidates.map((candidate) => [numberOf(candidate.artifactItemId), candidate]),
  );
  const items = rankedIds.map((rankedId) => catalogueItemOut(snapshot, byArtifactId.get(rankedId)!));
  return { items, total: items.length };
}

/**
 * Local content-only fallback for item-to-item similarity.
 *
 * Used when the Private Model Service cannot score the candidate set. It ranks
 * active catalogue neighbours by keyword/context/category/performance-type
 * overlap. This is display-only and never influences the model-backed scorer.
 */
function catalogueSimilarityFallback(
  snapshot: CatalogueSnapshot,
  reference: CatalogueItem,
  candidates: CatalogueItem[],
  limit: number,
): ItemOut[] {
  const refKeywords = keywordNamesForItem(snapshot, numberOf(reference.id));
  const refContexts = contextNamesForItem(snapshot, numberOf(reference.id));
  const refCategory = reference.categoryGroup.trim();
  const refType = reference.performanceType.trim();

  const scored = candidates.map((candidate) => {
    const candKeywords = keywordNamesForItem(snapshot, numberOf(candidate.id));
    const candContexts = contextNamesForItem(snapshot, numberOf(candidate.id));
    const keywordScore = refKeywords.size > 0 || candKeywords.size > 0
      ? setOverlap(refKeywords, candKeywords)
      : 0;
    const contextScore = refContexts.size > 0 || candContexts.size > 0
      ? setOverlap(refContexts, candContexts)
      : 0;
    const categoryScore = refCategory.length > 0 && refCategory === candidate.categoryGroup.trim() ? 1 : 0;
    const typeScore = refType.length > 0 && refType === candidate.performanceType.trim() ? 1 : 0;
    const score = 0.5 * keywordScore + 0.3 * contextScore + 0.15 * categoryScore + 0.05 * typeScore;
    return { candidate, score };
  });

  return scored
    .filter((row) => row.score > 0)
    .sort((left, right) =>
      right.score - left.score || left.candidate.name.localeCompare(right.candidate.name, "th"),
    )
    .slice(0, limit)
    .map((row) => catalogueItemOut(snapshot, row.candidate));
}

function keywordNamesForItem(snapshot: CatalogueSnapshot, itemId: number): Set<string> {
  const keywordIds = new Set(
    snapshot.itemKeywords
      .filter((link) => numberOf(link.itemId) === itemId)
      .map((link) => numberOf(link.keywordId)),
  );
  return new Set(
    snapshot.keywords
      .filter((keyword) => keywordIds.has(numberOf(keyword.id)))
      .map((keyword) => keyword.name),
  );
}

function contextNamesForItem(snapshot: CatalogueSnapshot, itemId: number): Set<string> {
  const contextIds = new Set(
    snapshot.itemContexts
      .filter((link) => numberOf(link.itemId) === itemId)
      .map((link) => numberOf(link.contextId)),
  );
  return new Set(
    snapshot.contexts
      .filter((context) => contextIds.has(numberOf(context.id)))
      .map((context) => context.name),
  );
}

function setOverlap(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 && right.size === 0) return 0;
  const intersection = new Set([...left].filter((value) => right.has(value)));
  return intersection.size / Math.max(left.size, right.size);
}

export async function listContexts(): Promise<ContextOut[]> {
  const snapshot = await loadCatalogueSnapshot();
  return snapshot.contexts
    .map((context) => {
      const internalId = numberOf(context.id);
      const activeItemCount = activeItemCountForContext(snapshot, internalId);
      return contextOut(context, activeItemCount);
    })
    .sort((left, right) => left.name.localeCompare(right.name, "th") || left.id - right.id);
}

export async function listKeywords(options: {
  search?: string;
  limit: number;
  contextId?: number;
}): Promise<KeywordOut[]> {
  const snapshot = await loadCatalogueSnapshot();
  let allowedKeywordIds: Set<number> | undefined;
  if (options.contextId !== undefined) {
    const context = snapshot.contexts.find(
      (row) => stableId("context", row.name) === options.contextId,
    );
    if (!context) return [];
    const itemIds = itemIdsForContext(snapshot, numberOf(context.id));
    allowedKeywordIds = new Set(
      snapshot.itemKeywords
        .filter((link) => itemIds.has(numberOf(link.itemId)))
        .map((link) => numberOf(link.keywordId)),
    );
  }

  const needle = options.search?.trim().toLocaleLowerCase();
  return snapshot.keywords
    .filter(
      (keyword) =>
        (!allowedKeywordIds || allowedKeywordIds.has(numberOf(keyword.id))) &&
        (!needle || keyword.name.toLocaleLowerCase().includes(needle)),
    )
    .sort((left, right) => left.name.localeCompare(right.name, "th"))
    .slice(0, options.limit)
    .map((keyword) => keywordOut(snapshot, keyword));
}

export async function loadCatalogueSnapshot(): Promise<CatalogueSnapshot> {
  const dataSource = await getDataSource();
  const [items, contexts, keywords, taxonomyNodes, itemContexts, itemKeywords] =
    await Promise.all([
      dataSource.getRepository(CatalogueItemEntity).find({ order: { id: "ASC" } }),
      dataSource.getRepository(CatalogueContextEntity).find(),
      dataSource.getRepository(CatalogueKeywordEntity).find(),
      dataSource.getRepository(TaxonomyNodeEntity).find(),
      dataSource.getRepository(ItemContextEntity).find(),
      dataSource.getRepository(ItemKeywordEntity).find(),
    ]);
  return { items, contexts, keywords, taxonomyNodes, itemContexts, itemKeywords };
}

export function catalogueItemOut(snapshot: CatalogueSnapshot, item: CatalogueItem): ItemOut {
  const internalId = numberOf(item.id);
  const contextIds = new Set(
    snapshot.itemContexts
      .filter((link) => numberOf(link.itemId) === internalId)
      .map((link) => numberOf(link.contextId)),
  );
  const keywordIds = new Set(
    snapshot.itemKeywords
      .filter((link) => numberOf(link.itemId) === internalId)
      .map((link) => numberOf(link.keywordId)),
  );
  const contexts = snapshot.contexts
    .filter((context) => contextIds.has(numberOf(context.id)))
    .map((context) => {
      const activeItemCount = activeItemCountForContext(snapshot, numberOf(context.id));
      return contextOut(context, activeItemCount);
    })
    .sort((left, right) =>
      left.group.localeCompare(right.group, "th") || left.name.localeCompare(right.name, "th"),
    );
  const keywords = snapshot.keywords
    .filter((keyword) => keywordIds.has(numberOf(keyword.id)))
    .map((keyword) => keywordOut(snapshot, keyword))
    .sort((left, right) => left.name.localeCompare(right.name, "th"));
  const matchPercent = catalogueMatchPercent(
    keywords.length,
    contexts.length,
    item.description.length,
  );
  return {
    id: numberOf(item.artifactItemId),
    name: item.name,
    description: item.description,
    category_group: item.categoryGroup,
    performance_type: item.performanceType,
    performers_count: nullableNumber(item.performersCount),
    duration_minutes: nullableNumber(item.durationMinutes),
    price_text: item.priceText,
    image_url: item.imageUrl,
    video_url: item.videoUrl,
    keywords,
    contexts,
    user_state: { ...anonymousState },
    match_percent: matchPercent,
    suitability_label: suitabilityLabel(matchPercent),
  };
}

function contextOut(context: CatalogueContext, activeItemCount: number): ContextOut {
  return {
    id: stableId("context", context.name),
    name: context.name,
    group: context.groupName,
    description: context.description,
    active_item_count: activeItemCount,
  };
}

export function keywordOut(snapshot: CatalogueSnapshot, keyword: CatalogueKeyword): KeywordOut {
  return {
    id: numberOf(keyword.id),
    name: keyword.name,
    taxonomy_path: taxonomyPath(snapshot.taxonomyNodes, keyword.taxonomyNodeId),
  };
}

// fallow-ignore-next-line complexity -- Iterative parent walking includes missing-node and cycle guards.
function taxonomyPath(nodes: TaxonomyNode[], rawNodeId: number | null): string {
  if (rawNodeId === null) return "";
  const byId = new Map(nodes.map((node) => [numberOf(node.id), node]));
  const names: string[] = [];
  const visited = new Set<number>();
  let nodeId: number | null = numberOf(rawNodeId);
  while (nodeId !== null && !visited.has(nodeId)) {
    visited.add(nodeId);
    const node = byId.get(nodeId);
    if (!node) break;
    names.unshift(node.name);
    nodeId = node.parentId === null ? null : numberOf(node.parentId);
  }
  return names.join(" > ");
}

function activeItemByArtifactId(
  snapshot: CatalogueSnapshot,
  artifactItemId: number,
): CatalogueItem | undefined {
  return snapshot.items.find(
    (row) => row.isActive && numberOf(row.artifactItemId) === artifactItemId,
  );
}

function linkedIds<T extends { itemId: number }>(
  links: T[],
  itemId: number,
  target: keyof T,
): Set<number> {
  return new Set(
    links
      .filter((link) => numberOf(link.itemId) === itemId)
      .map((link) => numberOf(link[target] as number)),
  );
}

function itemIdsForContext(snapshot: CatalogueSnapshot, contextId: number): Set<number> {
  return new Set(
    snapshot.itemContexts
      .filter((link) => numberOf(link.contextId) === contextId)
      .map((link) => numberOf(link.itemId)),
  );
}

function activeItemCountForContext(
  snapshot: CatalogueSnapshot,
  contextId: number,
): number {
  const activeItemIds = new Set(
    snapshot.items.filter((item) => item.isActive).map((item) => numberOf(item.id)),
  );
  return new Set(
    [...itemIdsForContext(snapshot, contextId)].filter((itemId) => activeItemIds.has(itemId)),
  ).size;
}

function searchTerms(search?: string): string[] {
  return (search ?? "")
    .split("|")
    .map((term) => term.trim().toLocaleLowerCase())
    .filter(Boolean);
}

export function stableId(namespace: string, value: string): number {
  const digest = createHash("sha256").update(`${namespace}::${value}`, "utf8").digest("hex");
  return Number.parseInt(digest.slice(0, 7), 16);
}

function catalogueMatchPercent(
  keywordCount: number,
  contextCount: number,
  descriptionLength: number,
): number {
  const keywordScore = Math.min(Math.max(keywordCount, 0), 12) / 12;
  const specificityScore = Math.min(1 / Math.max(contextCount, 1), 0.35) / 0.35;
  const descriptionScore = Math.min(Math.max(descriptionLength, 0), 260) / 260;
  const score = 0.74 + 0.1 * keywordScore + 0.07 * specificityScore + 0.05 * descriptionScore + 0.04 * (0.66 / 5);
  return Math.round(Math.max(82, Math.min(score * 100, 98)));
}

function suitabilityLabel(matchPercent: number): string {
  if (matchPercent >= 92) return "เหมาะมาก";
  if (matchPercent >= 87) return "เหมาะสม";
  return "เหมาะใช้ได้";
}

function numberOf(value: number): number {
  return Number(value);
}

function nullableNumber(value: number | null): number | null {
  return value === null ? null : Number(value);
}
