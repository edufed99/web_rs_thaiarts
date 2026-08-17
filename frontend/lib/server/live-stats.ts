// lib/server/live-stats.ts — per-item legacy interaction stats and live
// engagement counters served by the Application Backend (issue #9).
//
// Ports of the legacy FastAPI ``/items/{id}/legacy-stats``,
// ``/legacy-stats`` and ``/items/engagement`` routes. All ids on the wire
// are artifact ids; the relational tables reference ``items.id`` (DB id),
// so every query translates through ``items.artifact_item_id`` first.
//
// ``legacy_interactions`` is a legacy-only table (created by the old
// Alembic migrations, not by TypeORM). When it does not exist — fresh
// deployments, test databases — the helpers degrade to zeros with
// ``source: "disabled"`` exactly like the legacy service did without the
// DB layer.

import type { EngagementListOut, EngagementOut, LegacyStatsOut } from "@/lib/types";
import { getDataSource } from "@/db/connection";
import { CatalogueItemEntity } from "@/db/entities/Catalogue";
import { LikeEntity, RatingEntity, SavedItemEntity } from "@/db/entities/Members";

const POSITIVE_THRESHOLD = 4;

async function tableExists(table: string): Promise<boolean> {
  const dataSource = await getDataSource();
  const rows = await dataSource.query<Array<{ name: string | null }>>(
    "SELECT to_regclass($1) AS name",
    [`public.${table}`],
  );
  return rows[0]?.name !== null;
}

/** Map artifact ids to DB ids (rows that exist in the catalogue only). */
async function artifactToDbIds(artifactIds: number[]): Promise<Map<number, number>> {
  const dataSource = await getDataSource();
  const rows = await dataSource.getRepository(CatalogueItemEntity)
    .createQueryBuilder("item")
    .select("item.artifact_item_id", "artifact_id")
    .addSelect("item.id", "db_id")
    .where("item.artifact_item_id IN (:...artifactIds)", { artifactIds })
    .getRawMany<{ artifact_id: string; db_id: string }>();
  return new Map(rows.map((row) => [Number(row.artifact_id), Number(row.db_id)]));
}

interface LegacyAggregate {
  count: number;
  avgRating: number;
}

/**
 * ``{count, avg_rating}`` per DB item id across all legacy interactions.
 * Returns an empty map when the legacy table does not exist.
 */
async function liveLegacyStats(): Promise<Map<number, LegacyAggregate>> {
  if (!(await tableExists("legacy_interactions"))) return new Map();
  const dataSource = await getDataSource();
  const rows = await dataSource.query<Array<{ item_id: string; c: string; avg: string | null }>>(
    `SELECT item_id, COUNT(*) AS c, AVG(rating) AS avg
     FROM legacy_interactions
     GROUP BY item_id`,
  );
  return new Map(
    rows.map((row) => [
      Number(row.item_id),
      { count: Number(row.c), avgRating: Number(row.avg ?? 0) },
    ]),
  );
}

// fallow-ignore-next-line complexity -- Ported 1:1 from the legacy analytics service; splitting would break parity with the reference implementation.
function legacyPayload(artifactItemId: number, stats: LegacyAggregate | undefined, source: LegacyStatsOut["source"]): LegacyStatsOut {
  return {
    item_id: artifactItemId,
    count: stats?.count ?? 0,
    avg_rating: stats?.avgRating ?? 0,
    source,
  };
}

/** ``GET /items/{id}/legacy-stats`` — single artifact id. */
export async function legacyStatsForItem(artifactItemId: number): Promise<LegacyStatsOut> {
  const source: LegacyStatsOut["source"] = (await tableExists("legacy_interactions")) ? "postgres" : "disabled";
  const dbId = (await artifactToDbIds([artifactItemId])).get(artifactItemId);
  const aggregate = dbId === undefined ? undefined : (await liveLegacyStats()).get(dbId);
  return legacyPayload(artifactItemId, aggregate, source);
}

/** ``GET /legacy-stats?ids=...`` — batch form (max 200, caller order preserved). */
// fallow-ignore-next-line complexity -- Ported 1:1 from the legacy analytics service; splitting would break parity with the reference implementation.
export async function legacyStatsBatch(rawIds: number[]): Promise<{ stats: LegacyStatsOut[]; source: LegacyStatsOut["source"] }> {
  const seen = new Set<number>();
  const uniqueIds: number[] = [];
  for (const id of rawIds) {
    if (Number.isSafeInteger(id) && !seen.has(id)) {
      seen.add(id);
      uniqueIds.push(id);
    }
  }
  const capped = uniqueIds.slice(0, 200);
  const hasTable = await tableExists("legacy_interactions");
  const source: LegacyStatsOut["source"] = hasTable ? "postgres" : "disabled";
  const dbIds = await artifactToDbIds(capped);
  const aggregate = hasTable ? await liveLegacyStats() : new Map<number, LegacyAggregate>();
  return {
    source,
    stats: capped.map((artifactItemId) => {
      const dbId = dbIds.get(artifactItemId);
      return legacyPayload(artifactItemId, dbId === undefined ? undefined : aggregate.get(dbId), source);
    }),
  };
}

/**
 * ``GET /items/engagement?ids=...`` — likes + saves + positive ratings
 * (rating >= 4) per artifact item, sorted by engagement score descending
 * with one zero row per requested id that has no engagement.
 */
// fallow-ignore-next-line complexity -- Ported 1:1 from the legacy analytics service; splitting would break parity with the reference implementation.
export async function engagementForArtifactIds(
  artifactIds: number[],
  windowDays?: number,
): Promise<EngagementListOut> {
  const uniqueIds = [...new Set(artifactIds.map(Number).filter((id) => Number.isSafeInteger(id)))];
  const dataSource = await getDataSource();
  const dbIds = await artifactToDbIds(uniqueIds);
  const dbFilter = [...dbIds.values()];
  const since = windowDays !== undefined
    ? new Date(Date.now() - Math.max(1, Math.floor(windowDays)) * 24 * 60 * 60 * 1000)
    : undefined;

  const counts = new Map<number, { likes: number; saves: number; ratings: number }>();
  if (dbFilter.length > 0) {
    const [likeRows, saveRows, ratingRows] = await Promise.all([
      dataSource.getRepository(LikeEntity)
        .createQueryBuilder("state")
        .select("state.item_id", "item_id")
        .addSelect("COUNT(*)", "c")
        .where("state.item_id IN (:...dbFilter)", { dbFilter })
        .andWhere(since ? "state.created_at >= :since" : "1=1", since ? { since } : {})
        .groupBy("state.item_id")
        .getRawMany<{ item_id: string; c: string }>(),
      dataSource.getRepository(SavedItemEntity)
        .createQueryBuilder("state")
        .select("state.item_id", "item_id")
        .addSelect("COUNT(*)", "c")
        .where("state.item_id IN (:...dbFilter)", { dbFilter })
        .andWhere(since ? "state.created_at >= :since" : "1=1", since ? { since } : {})
        .groupBy("state.item_id")
        .getRawMany<{ item_id: string; c: string }>(),
      dataSource.getRepository(RatingEntity)
        .createQueryBuilder("state")
        .select("state.item_id", "item_id")
        .addSelect("COUNT(*)", "c")
        .where("state.item_id IN (:...dbFilter)", { dbFilter })
        .andWhere("state.rating >= :threshold", { threshold: POSITIVE_THRESHOLD })
        .andWhere(since ? "state.updated_at >= :since" : "1=1", since ? { since } : {})
        .groupBy("state.item_id")
        .getRawMany<{ item_id: string; c: string }>(),
    ]);
    for (const row of likeRows) counts.set(Number(row.item_id), { likes: Number(row.c), saves: 0, ratings: 0 });
    for (const row of saveRows) {
      const bucket = counts.get(Number(row.item_id)) ?? { likes: 0, saves: 0, ratings: 0 };
      bucket.saves = Number(row.c);
      counts.set(Number(row.item_id), bucket);
    }
    for (const row of ratingRows) {
      const bucket = counts.get(Number(row.item_id)) ?? { likes: 0, saves: 0, ratings: 0 };
      bucket.ratings = Number(row.c);
      counts.set(Number(row.item_id), bucket);
    }
  }

  const engagements: EngagementOut[] = uniqueIds.map((artifactItemId) => {
    const dbId = dbIds.get(artifactItemId);
    return engagementRow(artifactItemId, dbId === undefined ? undefined : counts.get(dbId));
  });
  engagements.sort((left, right) => right.engagement_score - left.engagement_score || left.item_id - right.item_id);
  return { engagements, source: "postgres" };
}

// fallow-ignore-next-line complexity -- Per-item zero-fill across three counters is one row contract.
function engagementRow(artifactItemId: number, bucket: { likes: number; saves: number; ratings: number } | undefined): EngagementOut {
  const likeCount = bucket?.likes ?? 0;
  const saveCount = bucket?.saves ?? 0;
  const ratingCount = bucket?.ratings ?? 0;
  return {
    item_id: artifactItemId,
    like_count: likeCount,
    save_count: saveCount,
    rating_count: ratingCount,
    engagement_score: likeCount + saveCount + ratingCount,
  };
}
