import { getDataSource } from "@/db/connection";
import {
  CatalogueContextEntity,
  CatalogueItemEntity,
  CatalogueKeywordEntity,
  ItemContextEntity,
  ItemKeywordEntity,
  TaxonomyNodeEntity,
} from "@/db/entities/Catalogue";
import {
  LikeEntity,
  RatingEntity,
  SavedItemEntity,
} from "@/db/entities/Members";
import { ModelServiceUnavailableError } from "@/lib/server/model-service";

export interface ArtifactRebuildResult {
  status: string;
  artifact_version: string;
  item_count: number;
  embedding_dim: number;
  duration_ms: number;
}

export async function triggerArtifactRebuild(
  options: { synthetic?: boolean } = {},
): Promise<ArtifactRebuildResult> {
  const dataSource = await getDataSource();

  const [
    items,
    contexts,
    keywords,
    taxonomies,
    itemContexts,
    itemKeywords,
    likes,
    saves,
    ratings,
  ] = await Promise.all([
    dataSource.getRepository(CatalogueItemEntity).find({ order: { id: "ASC" } }),
    dataSource.getRepository(CatalogueContextEntity).find(),
    dataSource.getRepository(CatalogueKeywordEntity).find(),
    dataSource.getRepository(TaxonomyNodeEntity).find(),
    dataSource.getRepository(ItemContextEntity).find(),
    dataSource.getRepository(ItemKeywordEntity).find(),
    dataSource.getRepository(LikeEntity).find(),
    dataSource.getRepository(SavedItemEntity).find(),
    dataSource.getRepository(RatingEntity).find(),
  ]);

  const ctxNameMap = new Map(contexts.map((c) => [Number(c.id), c.name]));
  const kwNameMap = new Map(keywords.map((k) => [Number(k.id), k.name]));
  const taxByIdMap = new Map(taxonomies.map((t) => [Number(t.id), t.name]));

  const itemCtxMap = new Map<number, string[]>();
  for (const ic of itemContexts) {
    const iid = Number(ic.itemId);
    const name = ctxNameMap.get(Number(ic.contextId));
    if (name) {
      const list = itemCtxMap.get(iid) || [];
      list.push(name);
      itemCtxMap.set(iid, list);
    }
  }

  const itemKwMap = new Map<number, string[]>();
  const itemTaxPathsMap = new Map<number, string[]>();

  for (const ik of itemKeywords) {
    const iid = Number(ik.itemId);
    const kw = keywords.find((k) => Number(k.id) === Number(ik.keywordId));
    if (kw) {
      const list = itemKwMap.get(iid) || [];
      list.push(kw.name);
      itemKwMap.set(iid, list);

      if (kw.taxonomyNodeId) {
        const taxName = taxByIdMap.get(Number(kw.taxonomyNodeId));
        if (taxName) {
          const tList = itemTaxPathsMap.get(iid) || [];
          tList.push(taxName);
          itemTaxPathsMap.set(iid, tList);
        }
      }
    }
  }

  const itemPayloads = items
    .filter((item) => item.isActive)
    .map((item) => {
      const iid = Number(item.id);
      const kwNames = itemKwMap.get(iid) || [];
      const ctxNames = itemCtxMap.get(iid) || [];
      const taxPaths = itemTaxPathsMap.get(iid) || [];

      return {
        item_id: Number(item.artifactItemId || item.id),
        name: item.name,
        description: item.description || "",
        category_group: item.categoryGroup || "",
        performance_type: item.performanceType || "",
        performers_count: item.performersCount ? Number(item.performersCount) : null,
        duration_minutes: item.durationMinutes ? Number(item.durationMinutes) : null,
        price_text: item.priceText || "",
        is_active: item.isActive,
        keyword_names: kwNames,
        context_names: ctxNames,
        taxonomy_paths: taxPaths,
      };
    });

  const interactionPayloads: Array<{ user_key: string; item_id: number; rating: number }> = [];

  for (const rating of ratings) {
    const targetItem = items.find((i) => Number(i.id) === Number(rating.itemId));
    if (targetItem) {
      interactionPayloads.push({
        user_key: String(rating.userKey),
        item_id: Number(targetItem.artifactItemId || targetItem.id),
        rating: Number(rating.rating),
      });
    }
  }

  for (const like of likes) {
    const targetItem = items.find((i) => Number(i.id) === Number(like.itemId));
    if (targetItem) {
      interactionPayloads.push({
        user_key: String(like.userKey),
        item_id: Number(targetItem.artifactItemId || targetItem.id),
        rating: 5,
      });
    }
  }

  for (const save of saves) {
    const targetItem = items.find((i) => Number(i.id) === Number(save.itemId));
    if (targetItem) {
      interactionPayloads.push({
        user_key: String(save.userKey),
        item_id: Number(targetItem.artifactItemId || targetItem.id),
        rating: 5,
      });
    }
  }

  const serviceUrl = (
    process.env.PRIVATE_MODEL_SERVICE_URL || "http://backend:8001"
  ).replace(/\/+$/, "");
  const credential = process.env.MODEL_SERVICE_SHARED_SECRET?.trim();
  if (!credential) {
    throw new ModelServiceUnavailableError(
      "The Internal Service Credential is not configured.",
    );
  }

  const timeoutMs = 180_000; // 3 minutes for E5 batch encode
  let response: Response;
  try {
    response = await fetch(`${serviceUrl}/internal/v1/artifacts/rebuild`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${credential}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        items: itemPayloads,
        interactions: interactionPayloads,
        synthetic_embeddings: Boolean(options.synthetic),
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new ModelServiceUnavailableError(
      error instanceof Error ? error.message : "Rebuild request to Private Model Service failed.",
    );
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new ModelServiceUnavailableError(
      `Private Model Service rebuild failed (HTTP ${response.status}): ${errorText.slice(0, 200)}`,
    );
  }

  const result = (await response.json()) as ArtifactRebuildResult;
  return result;
}
