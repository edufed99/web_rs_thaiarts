import type { EntityManager } from "typeorm";

import { getDataSource } from "@/db/connection";
import {
  ArtifactPublicationEntity,
  type ArtifactPublication,
} from "@/db/entities/ArtifactPublication";
import { CatalogueItemEntity } from "@/db/entities/Catalogue";
import type { ApplicationUser } from "@/db/entities/Members";
import {
  LikeEntity,
  RatingEntity,
  SavedItemEntity,
} from "@/db/entities/Members";
import type { ArtifactPublicationOut, PublicationLiveSignals } from "@/lib/types";
import { ModelServiceUnavailableError } from "@/lib/server/model-service";

/**
 * Artifact Publication workflow (issue #8).
 *
 * Personalized scoring reads prebuilt artifacts inside the Private Model
 * Service, so catalogue rows edited after the last build must not be
 * scored until an explicit Artifact Publication declares a rebuilt build
 * active. Browsing is never gated — only the scoring inputs are.
 *
 * State: ``items.published_at`` is NULL for edited/pending rows and set
 * for rows the active build covers. ``artifact_publications`` is the
 * append-only audit log of successful publications.
 */

export interface ModelServiceHealth {
  reachable: boolean;
  artifact_version: string;
  artifact_item_count: number;
  error?: string;
}

function publicationOut(row: ArtifactPublication): ArtifactPublicationOut {
  return {
    id: Number(row.id),
    build_id: row.buildId,
    published_at: row.publishedAt ? new Date(row.publishedAt).toISOString() : "",
    item_count: Number(row.itemCount),
    created_by: Number(row.createdBy),
    note: row.note,
  };
}

interface PendingItem {
  id: number;
  name: string;
}

export interface PublicationStatus {
  /** Latest recorded publication, or null when none has succeeded yet. */
  published: ArtifactPublicationOut | null;
  pending: {
    count: number;
    items: PendingItem[];
  };
  /** Live interactions recorded in the database. */
  live_signals?: PublicationLiveSignals;
  /** What the Private Model Service reports it is serving. */
  model: ModelServiceHealth;
}

interface ExecutedPublication {
  publication: ArtifactPublicationOut;
  pending_after: number;
  warnings: string[];
}

/**
 * Artifact item ids whose content is covered by the active published
 * build. Personalized-scoring inputs must be restricted to this set.
 * Exported for the recommendations boundary (issue #7) — the similarity
 * gate inside catalogue.ts filters from the snapshot instead.
 */
// fallow-ignore-next-line unused-export -- Scoring-gate helper for the recommendations route.
export async function publishedArtifactIds(): Promise<number[]> {
  const dataSource = await getDataSource();
  const rows = await dataSource.getRepository(CatalogueItemEntity)
    .createQueryBuilder("item")
    .select("item.artifact_item_id", "artifact_item_id")
    .where("item.published_at IS NOT NULL")
    .getRawMany<{ artifact_item_id: string }>();
  return rows.map((row) => Number(row.artifact_item_id));
}

/**
 * Mark catalogue rows as edited after the last publication. Called by
 * every successful admin mutation inside the mutation's transaction so
 * the dirty marker and the edit land atomically.
 */
export async function markItemsUnpublished(
  manager: EntityManager,
  internalItemIds: number[],
): Promise<void> {
  if (internalItemIds.length === 0) return;
  await manager.getRepository(CatalogueItemEntity)
    .createQueryBuilder()
    .update()
    .set({ publishedAt: null })
    .where("id IN (:...ids)", { ids: internalItemIds })
    .execute();
}

export async function publicationStatus(): Promise<PublicationStatus> {
  const dataSource = await getDataSource();
  const [published, pendingRows, liveLikes, liveSaves, liveRatings] = await Promise.all([
    dataSource.getRepository(ArtifactPublicationEntity).find({
      order: { id: "DESC" },
      take: 1,
    }),
    dataSource.getRepository(CatalogueItemEntity)
      .createQueryBuilder("item")
      .select("item.id", "id")
      .addSelect("item.name", "name")
      .addSelect("item.artifact_item_id", "artifact_item_id")
      .where("item.published_at IS NULL")
      .orderBy("item.id", "ASC")
      .getRawMany<{ id: string; name: string }>(),
    dataSource.getRepository(LikeEntity).count(),
    dataSource.getRepository(SavedItemEntity).count(),
    dataSource.getRepository(RatingEntity).count(),
  ]);
  const liveTotal = liveLikes + liveSaves + liveRatings;
  const model = await fetchModelServiceHealth();
  return {
    published: published[0] ? publicationOut(published[0]) : null,
    pending: {
      count: pendingRows.length,
      items: pendingRows.map((row) => ({ id: Number(row.id), name: row.name })),
    },
    live_signals: {
      likes: liveLikes,
      saves: liveSaves,
      ratings: liveRatings,
      total: liveTotal,
    },
    model,
  };
}

/**
 * Execute an explicit Artifact Publication.
 *
 * The workflow succeeds only when the Private Model Service is reachable
 * and authenticated: the recorded build identity comes from the service's
 * own health report, so a publication can never claim a build that the
 * scoring process is not actually serving. Every currently-pending row
 * becomes covered by the new build; the audit row records how many.
 */
// fallow-ignore-next-line complexity -- Model verification and the atomic dirty-flag flip are one workflow.
export async function executePublication(
  admin: ApplicationUser,
  note: string,
): Promise<ExecutedPublication> {
  const health = await fetchModelServiceHealth();
  if (!health.reachable) {
    throw new ModelServiceUnavailableError(
      health.error || "The Private Model Service is not reachable.",
    );
  }
  const buildId = `${health.artifact_version || "unknown"}:${health.artifact_item_count}`;
  const dataSource = await getDataSource();
  let publication: ArtifactPublication | undefined;
  let pendingAfter = 0;
  // fallow-ignore-next-line complexity -- The publication record and the dirty-flag flip must commit atomically.
  await dataSource.transaction(async (manager) => {
    const pendingCount = await manager.getRepository(CatalogueItemEntity)
      .createQueryBuilder("item")
      .where("item.published_at IS NULL")
      .getCount();
    publication = await manager.getRepository(ArtifactPublicationEntity).save({
      buildId,
      publishedAt: new Date(),
      itemCount: pendingCount,
      createdBy: Number(admin.id),
      note: note.slice(0, 255),
    });
    await manager.getRepository(CatalogueItemEntity)
      .createQueryBuilder()
      .update()
      .set({ publishedAt: new Date() })
      .where("published_at IS NULL")
      .execute();
    pendingAfter = await manager.getRepository(CatalogueItemEntity)
      .createQueryBuilder("item")
      .where("item.published_at IS NULL")
      .getCount();
  });
  return {
    publication: publicationOut(publication!),
    pending_after: pendingAfter,
    warnings:
      health.artifact_version === "unknown"
        ? ["The Private Model Service did not report an artifact schema version."]
        : [],
  };
}

// fallow-ignore-next-line complexity -- Reachability, credential, and response-shape checks are distinct failure clauses.
async function fetchModelServiceHealth(): Promise<ModelServiceHealth> {
  const serviceUrl = (
    process.env.PRIVATE_MODEL_SERVICE_URL || "http://backend:8001"
  ).replace(/\/+$/, "");
  const credential = process.env.MODEL_SERVICE_SHARED_SECRET?.trim();
  if (!credential) {
    return {
      reachable: false,
      artifact_version: "",
      artifact_item_count: 0,
      error: "The Internal Service Credential is not configured.",
    };
  }
  try {
    const response = await fetch(`${serviceUrl}/internal/v1/health`, {
      headers: { Authorization: `Bearer ${credential}` },
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      return {
        reachable: false,
        artifact_version: "",
        artifact_item_count: 0,
        error: `Private Model Service returned HTTP ${response.status}.`,
      };
    }
    const body = (await response.json()) as {
      status?: string;
      artifact_version?: string;
      artifact_item_count?: number;
    };
    return {
      reachable: true,
      artifact_version:
        typeof body.artifact_version === "string" ? body.artifact_version : "unknown",
      artifact_item_count:
        Number.isSafeInteger(body.artifact_item_count) ? Number(body.artifact_item_count) : 0,
    };
  } catch (error) {
    return {
      reachable: false,
      artifact_version: "",
      artifact_item_count: 0,
      error: error instanceof Error ? error.message : "Private Model Service request failed.",
    };
  }
}
