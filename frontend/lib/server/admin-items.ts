import type { EntityManager } from "typeorm";

import { getDataSource } from "@/db/connection";
import {
  CatalogueContextEntity,
  CatalogueItemEntity,
  CatalogueKeywordEntity,
  ItemContextEntity,
  ItemKeywordEntity,
  TaxonomyNodeEntity,
  type CatalogueItem,
} from "@/db/entities/Catalogue";
import type { ApplicationUser } from "@/db/entities/Members";
import type { ItemOut, KeywordProposal } from "@/lib/types";
import {
  loadCatalogueSnapshot,
  catalogueItemOut,
  stableId,
} from "@/lib/server/catalogue";
import {
  autoGroundKeywords,
  executeSemanticPipelineGrounding,
  type GroundingVocabEntry,
} from "@/lib/server/grounding";
import { markItemsUnpublished } from "@/lib/server/publication";

/**
 * Admin catalogue management (issue #8). Behavioural parity with the
 * legacy FastAPI ``/admin/items*`` routes, minus the in-process artifact
 * loader mutation: Next.js owns Postgres, and every mutation marks the
 * affected row as unpublished-for-scoring until an explicit Artifact
 * Publication succeeds. The immutable ``artifact_item_id`` is assigned
 * once at creation (stable id of the name) and never updated — the DB
 * trigger added by migration 0004 enforces that.
 */

export class AdminItemError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "AdminItemError";
    this.status = status;
    this.code = code;
  }
}

// --- Draft store (in-memory, TTL 30 min — parity with the legacy service) ---
//
// Next.js compiles each route handler as its own module instance, so a
// module-level Map would be invisible to the commit route. The drafts
// live on ``globalThis`` (the same cross-module singleton pattern as
// ``db/connection.ts``) and expire after 30 minutes. A single-process
// deployment is the documented topology; multi-instance deployments
// must move this to a shared TTL store, exactly like the legacy service.

const DRAFT_TTL_SECONDS = 30 * 60;
interface ItemDraftPayload {
  name: string;
  description: string;
  category_group: string;
  performance_type: string;
  performers_count: number | null;
  duration_minutes: number | null;
  price_text: string;
  context_ids: number[];
  layer_a_ids: number[];
  additional_keyword_ids: number[];
  expiresAt: number;
}

const globalForDrafts = globalThis as typeof globalThis & {
  adminItemDrafts?: Map<string, ItemDraftPayload>;
};

function draftsStore(): Map<string, ItemDraftPayload> {
  if (!globalForDrafts.adminItemDrafts) {
    globalForDrafts.adminItemDrafts = new Map();
  }
  return globalForDrafts.adminItemDrafts;
}

function saveDraft(payload: Omit<ItemDraftPayload, "expiresAt">): string {
  const draftId = randomDraftId();
  draftsStore().set(draftId, { ...payload, expiresAt: Date.now() + DRAFT_TTL_SECONDS * 1000 });
  return draftId;
}

function randomDraftId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function consumeDraft(draftId: string): ItemDraftPayload {
  const drafts = draftsStore();
  const payload = drafts.get(draftId);
  if (!payload) {
    throw new AdminItemError(400, "unknown_draft", "Unknown or expired draft_id.");
  }
  if (payload.expiresAt < Date.now()) {
    drafts.delete(draftId);
    throw new AdminItemError(400, "draft_expired", "Draft has expired.");
  }
  drafts.delete(draftId);
  return payload;
}

// --- Shared helpers ---------------------------------------------------------

async function activeItemOut(artifactId: number): Promise<ItemOut | undefined> {
  const snapshot = await loadCatalogueSnapshot();
  const item = snapshot.items.find(
    (row) => row.isActive && Number(row.artifactItemId) === artifactId,
  );
  return item ? catalogueItemOut(snapshot, item) : undefined;
}

// --- Facets ----------------------------------------------------------------

// fallow-ignore-next-line complexity -- Distinct-value aggregation over three projections stays one query.
export async function itemFacets(): Promise<{
  category_groups: string[];
  performance_types: string[];
  category_groups_by_performance_type: Record<string, string[]>;
  source: "db";
}> {
  const dataSource = await getDataSource();
  const rows = await dataSource.getRepository(CatalogueItemEntity)
    .createQueryBuilder("item")
    .select("item.categoryGroup", "category_group")
    .addSelect("item.performanceType", "performance_type")
    .where("item.isActive = true")
    .getRawMany<{ category_group: string; performance_type: string }>();
  const categories = new Set<string>();
  const performanceTypes = new Set<string>();
  const byPerformance = new Map<string, Set<string>>();
  for (const row of rows) {
    const category = String(row.category_group ?? "").trim();
    const performance = String(row.performance_type ?? "").trim();
    if (category) categories.add(category);
    if (performance) performanceTypes.add(performance);
    if (category && performance) {
      if (!byPerformance.has(performance)) byPerformance.set(performance, new Set());
      byPerformance.get(performance)!.add(category);
    }
  }
  return {
    category_groups: [...categories].sort((a, b) => a.localeCompare(b, "th")),
    performance_types: [...performanceTypes].sort((a, b) => a.localeCompare(b, "th")),
    category_groups_by_performance_type: Object.fromEntries(
      [...byPerformance.entries()].map(([performance, values]) => [
        performance,
        [...values].sort((a, b) => a.localeCompare(b, "th")),
      ]),
    ),
    source: "db",
  };
}

// --- Draft (Layer A + Layer B Semantic Pipeline) ----------------------------

// fallow-ignore-next-line complexity -- Grounding, context resolution, and draft persistence are one workflow.
export async function createItemDraft(input: {
  name: string;
  description?: string;
  category_group?: string;
  performance_type?: string;
  performers_count?: number | null;
  duration_minutes?: number | null;
  price_text?: string;
  context_names: string[];
  keyword_names: string[];
}): Promise<{
  draft_id: string;
  proposals: KeywordProposal[];
  context_ids: number[];
  warnings: string[];
}> {
  const name = (input.name ?? "").trim();
  if (!name) {
    throw new AdminItemError(422, "validation_error", "name is required.");
  }
  const dataSource = await getDataSource();
  const vocab = await keywordVocabulary(dataSource.manager);
  const proposals = await executeSemanticPipelineGrounding(
    {
      name,
      description: input.description ?? "",
      category_group: input.category_group ?? "",
      performance_type: input.performance_type ?? "",
    },
    vocab,
  );
  const layerAIds = proposals.filter((p) => !p.is_new && p.id > 0).map((p) => p.id);
  const { context_ids: contextIds, warnings } = await resolveContextNames(
    dataSource.manager,
    input.context_names ?? [],
  );
  const additionalKeywordIds = await resolveExistingKeywordIds(
    dataSource.manager,
    input.keyword_names ?? [],
  );
  const draftId = saveDraft({
    name,
    description: (input.description ?? "").trim(),
    category_group: (input.category_group ?? "").trim(),
    performance_type: (input.performance_type ?? "").trim(),
    performers_count: input.performers_count ?? null,
    duration_minutes: input.duration_minutes ?? null,
    price_text: (input.price_text ?? "").trim(),
    context_ids: contextIds,
    layer_a_ids: layerAIds,
    additional_keyword_ids: additionalKeywordIds,
  });
  return { draft_id: draftId, proposals, context_ids: contextIds, warnings };
}

async function ensureTaxonomyNodeId(manager: EntityManager, taxonomyPath?: string): Promise<number | null> {
  if (!taxonomyPath) return null;
  const parts = taxonomyPath.split(">").map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return null;

  let parentId: number | null = null;
  for (let level = 0; level < parts.length; level++) {
    const name = parts[level];
    const levelNum = level + 1;
    const repo = manager.getRepository(TaxonomyNodeEntity);
    let nodeQuery = repo
      .createQueryBuilder("node")
      .where("node.name = :name AND node.level = :level", { name, level: levelNum });
    if (parentId !== null) {
      nodeQuery = nodeQuery.andWhere("node.parentId = :parentId", { parentId });
    } else {
      nodeQuery = nodeQuery.andWhere("node.parentId IS NULL");
    }
    let node = await nodeQuery.getOne();
    if (!node) {
      node = await repo.save({
        name,
        level: levelNum,
        parentId,
      });
    }
    parentId = Number(node.id);
  }
  return parentId;
}

// fallow-ignore-next-line complexity -- Draft merge, uniqueness, and link persistence are one transaction.
export async function commitItemDraft(
  _admin: ApplicationUser,
  input: {
    draft_id: string;
    additional_keyword_ids: number[];
    removed_keyword_ids: number[];
    new_keywords?: { name: string; taxonomy_path?: string }[];
  },
): Promise<{ item: ItemOut; warnings: string[] }> {
  const payload = consumeDraft(input.draft_id);
  const merged: number[] = [];
  const seen = new Set<number>();
  for (const id of [...payload.layer_a_ids, ...payload.additional_keyword_ids, ...(input.additional_keyword_ids ?? [])]) {
    const value = Number(id);
    if (!Number.isSafeInteger(value) || seen.has(value) || value <= 0) continue;
    seen.add(value);
    merged.push(value);
  }
  const removed = new Set((input.removed_keyword_ids ?? []).map((id) => Number(id)));
  const finalKeywordIds = merged.filter((id) => !removed.has(id));

  const dataSource = await getDataSource();
  let artifactId = 0;
  const warnings: string[] = [];
  // fallow-ignore-next-line complexity -- Draft merge, uniqueness, and link persistence are one transaction.
  await dataSource.transaction(async (manager) => {
    const repo = manager.getRepository(CatalogueItemEntity);
    const duplicate = await repo
      .createQueryBuilder("item")
      .where("LOWER(item.name) = LOWER(:name)", { name: payload.name })
      .getOne();
    if (duplicate) {
      throw new AdminItemError(409, "already_exists", `An item named "${payload.name}" already exists.`);
    }
    // The artifact item identifier is derived once from the name and is
    // immutable afterwards (migration 0004 trigger). Two different names
    // colliding on the same hash are rejected by the unique constraint.
    artifactId = stableId("item", payload.name);
    const existing = await repo.findOneBy({ artifactItemId: artifactId });
    if (existing) {
      throw new AdminItemError(409, "already_exists", `Artifact id ${artifactId} is already assigned to another item.`);
    }
    const saved = await repo.save({
      artifactItemId: artifactId,
      name: payload.name,
      description: payload.description,
      categoryGroup: payload.category_group,
      performanceType: payload.performance_type,
      performersCount: payload.performers_count,
      durationMinutes: payload.duration_minutes,
      priceText: payload.price_text,
      imageUrl: "",
      videoUrl: "",
      isActive: true,
      // New content has never been part of any artifact build: it stays
      // unavailable to personalized scoring until a publication.
      publishedAt: null,
    });
    const internalId = Number(saved.id);
    for (const contextId of payload.context_ids) {
      await manager.getRepository(ItemContextEntity).save({
        itemId: internalId,
        contextId: Number(contextId),
        validityStatus: "valid",
      });
    }

    // Persist and link existing keywords
    for (const keywordId of finalKeywordIds) {
      await manager.getRepository(ItemKeywordEntity).save({
        itemId: internalId,
        keywordId,
        source: "human",
      });
    }

    // Persist and link newly discovered keywords from AI pipeline
    if (Array.isArray(input.new_keywords) && input.new_keywords.length > 0) {
      const keywordRepo = manager.getRepository(CatalogueKeywordEntity);
      for (const newKw of input.new_keywords) {
        const kwName = (newKw.name || "").trim();
        if (!kwName) continue;
        let kwRow = await keywordRepo
          .createQueryBuilder("k")
          .where("LOWER(k.name) = LOWER(:name)", { name: kwName })
          .getOne();
        if (!kwRow) {
          const taxonomyNodeId = await ensureTaxonomyNodeId(manager, newKw.taxonomy_path);
          kwRow = await keywordRepo.save({
            name: kwName,
            taxonomyNodeId,
          });
          warnings.push(`Created keyword: "${kwName}"`);
        }
        const kwId = Number(kwRow.id);
        await manager.getRepository(ItemKeywordEntity).save({
          itemId: internalId,
          keywordId: kwId,
          source: "llm",
        });
      }
    }
  });
  const item = await activeItemOut(artifactId);
  if (!item) {
    throw new AdminItemError(404, "item_not_found", `Item id ${artifactId} not found.`);
  }
  return { item, warnings };
}

// --- Update -----------------------------------------------------------------

export async function updateAdminItem(
  admin: ApplicationUser,
  artifactId: number,
  body: Record<string, unknown>,
): Promise<{ item: ItemOut; warnings: string[] }> {
  const dataSource = await getDataSource();
  const warnings: string[] = [];
  // fallow-ignore-next-line complexity -- Scalar fields, relationship replacement, and the dirty flip share one transaction.
  await dataSource.transaction(async (manager) => {
    const repo = manager.getRepository(CatalogueItemEntity);
    const item = await repo.findOneBy({ artifactItemId: artifactId });
    if (!item) {
      throw new AdminItemError(404, "item_not_found", `Item id ${artifactId} not found.`);
    }
    applyScalarFields(item, body);
    if (body.context_names !== undefined) {
      if (!Array.isArray(body.context_names)) {
        throw new AdminItemError(422, "validation_error", "context_names must be an array.");
      }
      const names = (body.context_names as unknown[])
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter(Boolean);
      const { context_ids: contextIds, warnings: contextWarnings } = await resolveContextNames(manager, names);
      warnings.push(...contextWarnings);
      await manager.getRepository(ItemContextEntity).delete({ itemId: Number(item.id) });
      for (const contextId of contextIds) {
        await manager.getRepository(ItemContextEntity).save({
          itemId: Number(item.id),
          contextId,
          validityStatus: "valid",
        });
      }
    }
    if (body.keyword_ids !== undefined || body.new_keyword_names !== undefined) {
      const keywordWarnings = await replaceKeywordLinks(manager, item, body);
      warnings.push(...keywordWarnings);
    }
    await repo.save(item);
    // The edit is live in browsing now; personalized scoring must wait
    // for an explicit Artifact Publication.
    await markItemsUnpublished(manager, [Number(item.id)]);
  });
  const item = await activeItemOut(artifactId);
  if (!item) {
    throw new AdminItemError(404, "item_not_found", `Item id ${artifactId} not found.`);
  }
  return { item, warnings };
}

// fallow-ignore-next-line complexity -- Each scalar maps to the legacy ItemUpdate contract field-for-field.
function applyScalarFields(item: CatalogueItem, body: Record<string, unknown>): void {
  if (typeof body.name === "string") item.name = body.name.trim();
  if (typeof body.description === "string") item.description = body.description.trim();
  if (typeof body.category_group === "string") item.categoryGroup = body.category_group.trim();
  if (typeof body.performance_type === "string") item.performanceType = body.performance_type.trim();
  if (body.performers_count !== undefined && body.performers_count !== null) {
    const value = Number(body.performers_count);
    if (!Number.isSafeInteger(value)) throw new AdminItemError(422, "validation_error", "Invalid performers_count.");
    item.performersCount = value;
  } else if (body.performers_count === null) {
    item.performersCount = null;
  }
  if (body.duration_minutes !== undefined && body.duration_minutes !== null) {
    const value = Number(body.duration_minutes);
    if (!Number.isSafeInteger(value)) throw new AdminItemError(422, "validation_error", "Invalid duration_minutes.");
    item.durationMinutes = value;
  } else if (body.duration_minutes === null) {
    item.durationMinutes = null;
  }
  if (typeof body.price_text === "string") item.priceText = body.price_text.trim();
  if (typeof body.image_url === "string") item.imageUrl = body.image_url.trim();
  if (typeof body.video_url === "string") item.videoUrl = body.video_url.trim();
  if (typeof body.is_active === "boolean") item.isActive = body.is_active;
}

// fallow-ignore-next-line complexity -- Unknown ids, new names, and the keyword-length cap are distinct warning/error branches.
// fallow-ignore-next-line complexity -- Unknown ids, new names, and the keyword-length cap are distinct warning/error branches.
async function replaceKeywordLinks(
  manager: EntityManager,
  item: CatalogueItem,
  body: Record<string, unknown>,
): Promise<string[]> {
  const warnings: string[] = [];
  let requestedIds: number[] = [];
  if (Array.isArray(body.keyword_ids)) {
    requestedIds = (body.keyword_ids as unknown[])
      .map((value) => Number(value))
      .filter((value) => Number.isSafeInteger(value) && value > 0);
  } else if (body.keyword_ids !== undefined) {
    throw new AdminItemError(422, "validation_error", "keyword_ids must be an array.");
  }
  const keywordRepo = manager.getRepository(CatalogueKeywordEntity);
  const knownRows = requestedIds.length
    ? await keywordRepo.createQueryBuilder("keyword")
        .where("keyword.id IN (:...ids)", { ids: requestedIds })
        .getMany()
    : [];
  const knownById = new Map(knownRows.map((row) => [Number(row.id), row]));
  const missing = requestedIds.filter((id) => !knownById.has(id));
  if (missing.length > 0) {
    warnings.push(`Ignored unknown keyword ids: ${missing.join(", ")}`);
  }
  const seenNames = new Set(
    knownRows.map((row) => String(row.name).trim().toLocaleLowerCase("th")),
  );
  const keywordIds = requestedIds.filter((id) => knownById.has(id));
  for (const raw of (body.new_keyword_names ?? []) as unknown[]) {
    if (typeof raw !== "string") continue;
    const name = raw.trim().replace(/\s+/g, " ");
    if (!name) continue;
    if (name.length > 255) {
      throw new AdminItemError(400, "keyword_name_too_long", "Keyword must not exceed 255 characters.");
    }
    if (seenNames.has(name.toLocaleLowerCase("th"))) continue;
    let row = await keywordRepo
      .createQueryBuilder("keyword")
      .where("LOWER(keyword.name) = LOWER(:name)", { name })
      .getOne();
    if (!row) {
      row = await keywordRepo.save({ name });
      warnings.push(`Created keyword: "${name}"`);
    }
    const id = Number(row.id);
    keywordIds.push(id);
    seenNames.add(name.toLocaleLowerCase("th"));
  }
  const uniqueIds = [...new Set(keywordIds)];
  await manager.getRepository(ItemKeywordEntity).delete({ itemId: Number(item.id) });
  for (const keywordId of uniqueIds) {
    await manager.getRepository(ItemKeywordEntity).save({
      itemId: Number(item.id),
      keywordId,
      source: "admin",
    });
  }
  return warnings;
}

// --- Delete -----------------------------------------------------------------

export async function deleteAdminItem(
  _admin: ApplicationUser,
  artifactId: number,
): Promise<{ item_id: number; deleted: boolean; warnings: string[] }> {
  const dataSource = await getDataSource();
  await dataSource.transaction(async (manager) => {
    const repo = manager.getRepository(CatalogueItemEntity);
    const item = await repo.findOneBy({ artifactItemId: artifactId });
    if (!item) {
      throw new AdminItemError(404, "item_not_found", `Item id ${artifactId} not found.`);
    }
    const internalId = Number(item.id);
    await manager.getRepository(ItemKeywordEntity).delete({ itemId: internalId });
    await manager.getRepository(ItemContextEntity).delete({ itemId: internalId });
    await manager.query("DELETE FROM likes WHERE item_id = $1", [internalId]);
    await manager.query("DELETE FROM saved_items WHERE item_id = $1", [internalId]);
    await manager.query("DELETE FROM ratings WHERE item_id = $1", [internalId]);
    await manager.query("UPDATE interaction_logs SET item_id = NULL WHERE item_id = $1", [internalId]);
    if (await tableExists(manager, "legacy_interactions")) {
      await manager.query("DELETE FROM legacy_interactions WHERE item_id = $1", [internalId]);
    }
    await repo.delete({ id: internalId });
  });
  return { item_id: artifactId, deleted: true, warnings: [] };
}

async function tableExists(manager: EntityManager, table: string): Promise<boolean> {
  const rows = await manager.query(
    "SELECT to_regclass($1) AS name",
    [table],
  );
  return Boolean(rows?.[0]?.name);
}

// --- Vocabulary + context resolution ----------------------------------------

async function keywordVocabulary(manager: EntityManager): Promise<GroundingVocabEntry[]> {
  const keywords = await manager.getRepository(CatalogueKeywordEntity).find();
  const taxonomyNodes = await manager.query("SELECT id, name, parent_id FROM taxonomy_nodes");
  const byNodeId = new Map(
    (taxonomyNodes as { id: number | string; name: string; parent_id: number | string | null }[])
      .map((row) => [Number(row.id), row]),
  );
  // fallow-ignore-next-line complexity -- Iterative parent walking includes missing-node and cycle guards.
  const pathFor = (nodeId: number | null): string => {
    if (nodeId === null) return "";
    const names: string[] = [];
    const visited = new Set<number>();
    let current: number | null = nodeId;
    while (current !== null && !visited.has(current)) {
      visited.add(current);
      const node = byNodeId.get(current);
      if (!node) break;
      names.unshift(node.name);
      current = node.parent_id === null ? null : Number(node.parent_id);
    }
    return names.join(" > ");
  };
  return keywords.map((keyword) => ({
    id: Number(keyword.id),
    name: keyword.name,
    taxonomyPath: pathFor(keyword.taxonomyNodeId === null ? null : Number(keyword.taxonomyNodeId)),
  }));
}

async function resolveContextNames(
  manager: EntityManager,
  names: string[],
): Promise<{ context_ids: number[]; warnings: string[] }> {
  const contextIds: number[] = [];
  const warnings: string[] = [];
  const repo = manager.getRepository(CatalogueContextEntity);
  for (const raw of names) {
    const name = raw.trim();
    if (!name) continue;
    let row = await repo.findOneBy({ name });
    if (!row) {
      row = await repo.save({ name, groupName: "", description: "" });
      warnings.push(`Created missing context: "${name}"`);
    }
    contextIds.push(Number(row.id));
  }
  return { context_ids: contextIds, warnings };
}

async function resolveExistingKeywordIds(manager: EntityManager, names: string[]): Promise<number[]> {
  const ids: number[] = [];
  const repo = manager.getRepository(CatalogueKeywordEntity);
  for (const raw of names) {
    const name = raw.trim();
    if (!name) continue;
    const row = await repo.findOneBy({ name });
    if (row) ids.push(Number(row.id));
  }
  return ids;
}
