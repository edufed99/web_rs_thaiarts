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

interface CatalogueSnapshot {
  items: CatalogueItem[];
  contexts: CatalogueContext[];
  keywords: CatalogueKeyword[];
  taxonomyNodes: TaxonomyNode[];
  itemContexts: ItemContextLink[];
  itemKeywords: ItemKeywordLink[];
}

const anonymousState = { liked: false, saved: false, rating: 0 } as const;

// fallow-ignore-next-line complexity -- Browse, prioritized search, and context-ranked modes share one public catalogue contract.
export async function listItems(options: {
  search?: string;
  limit: number;
  offset: number;
  contextId?: number;
}): Promise<ItemListOut | undefined> {
  const snapshot = await loadSnapshot();
  let items = snapshot.items.filter((item) => item.isActive);

  if (options.contextId !== undefined) {
    const context = snapshot.contexts.find(
      (row) => stableId("context", row.name) === options.contextId,
    );
    if (!context) return undefined;
    const eligibleInternalIds = itemIdsForContext(snapshot, numberOf(context.id));
    const ranked = items
      .filter((item) => eligibleInternalIds.has(numberOf(item.id)))
      .map((item) => toItemOut(snapshot, item))
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
      .map((item) => toItemOut(snapshot, item)),
    total,
  };
}

export async function getItem(artifactItemId: number): Promise<ItemOut | undefined> {
  const snapshot = await loadSnapshot();
  const item = activeItemByArtifactId(snapshot, artifactItemId);
  return item ? toItemOut(snapshot, item) : undefined;
}

export async function getItemsBatch(artifactItemIds: number[]): Promise<ItemListOut> {
  const snapshot = await loadSnapshot();
  const byArtifactId = new Map(
    snapshot.items
      .filter((item) => item.isActive)
      .map((item) => [numberOf(item.artifactItemId), item]),
  );
  const items = artifactItemIds
    .map((artifactId) => byArtifactId.get(artifactId))
    .filter((item): item is CatalogueItem => item !== undefined)
    .map((item) => toItemOut(snapshot, item));
  return { items, total: items.length };
}

export async function getSimilarItems(
  artifactItemId: number,
  limit: number,
): Promise<ItemListOut | undefined> {
  const snapshot = await loadSnapshot();
  const reference = activeItemByArtifactId(snapshot, artifactItemId);
  if (!reference) return undefined;

  const referenceMetadata = itemMetadata(snapshot, reference);
  const items = snapshot.items
    .filter(
      (candidate) =>
        candidate.isActive && numberOf(candidate.artifactItemId) !== artifactItemId,
    )
    .map((candidate) => ({
      candidate,
      score: metadataSimilarity(referenceMetadata, itemMetadata(snapshot, candidate)),
    }))
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.candidate.name.localeCompare(right.candidate.name, "th") ||
        numberOf(left.candidate.artifactItemId) - numberOf(right.candidate.artifactItemId),
    )
    .slice(0, limit)
    .map(({ candidate }) => toItemOut(snapshot, candidate));
  return { items, total: items.length };
}

export async function listContexts(): Promise<ContextOut[]> {
  const snapshot = await loadSnapshot();
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
  const snapshot = await loadSnapshot();
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

async function loadSnapshot(): Promise<CatalogueSnapshot> {
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

function toItemOut(snapshot: CatalogueSnapshot, item: CatalogueItem): ItemOut {
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

function keywordOut(snapshot: CatalogueSnapshot, keyword: CatalogueKeyword): KeywordOut {
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

function itemMetadata(snapshot: CatalogueSnapshot, item: CatalogueItem) {
  const itemId = numberOf(item.id);
  return {
    category: item.categoryGroup,
    contexts: linkedIds(snapshot.itemContexts, itemId, "contextId"),
    keywords: linkedIds(snapshot.itemKeywords, itemId, "keywordId"),
  };
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

function metadataSimilarity(
  left: ReturnType<typeof itemMetadata>,
  right: ReturnType<typeof itemMetadata>,
): number {
  return (
    0.45 * jaccard(left.keywords, right.keywords) +
    0.35 * jaccard(left.contexts, right.contexts) +
    0.2 * Number(Boolean(left.category) && left.category === right.category)
  );
}

function jaccard(left: Set<number>, right: Set<number>): number {
  const union = new Set([...left, ...right]);
  if (union.size === 0) return 0;
  let intersection = 0;
  for (const value of left) if (right.has(value)) intersection += 1;
  return intersection / union.size;
}

function searchTerms(search?: string): string[] {
  return (search ?? "")
    .split("|")
    .map((term) => term.trim().toLocaleLowerCase())
    .filter(Boolean);
}

function stableId(namespace: string, value: string): number {
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
