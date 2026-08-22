import { getDataSource } from "@/db/connection";
import { CatalogueItemEntity } from "@/db/entities/Catalogue";
import {
  InteractionLogEntity,
  LikeEntity,
  MemberProfileEntity,
  RatingEntity,
  SavedItemEntity,
  type ApplicationUser,
} from "@/db/entities/Members";
import type { ItemOut, MemberProfileOut, UserSummaryOut } from "@/lib/types";
import { getItem } from "@/lib/server/catalogue";

function userKey(user: ApplicationUser): string {
  return `user:${Number(user.id)}`;
}

async function itemIdentity(artifactItemId: number) {
  const dataSource = await getDataSource();
  return dataSource.getRepository(CatalogueItemEntity).findOneBy({ artifactItemId });
}

async function userState(user: ApplicationUser, internalItemId: number) {
  const dataSource = await getDataSource();
  const key = userKey(user);
  const [liked, saved, rating] = await Promise.all([
    dataSource.getRepository(LikeEntity).exist({ where: { userKey: key, itemId: internalItemId } }),
    dataSource.getRepository(SavedItemEntity).exist({ where: { userKey: key, itemId: internalItemId } }),
    dataSource.getRepository(RatingEntity).findOneBy({ userKey: key, itemId: internalItemId }),
  ]);
  return { liked, saved, rating: rating?.rating ?? 0 };
}

async function itemForUser(user: ApplicationUser, artifactItemId: number): Promise<ItemOut | undefined> {
  const identity = await itemIdentity(artifactItemId);
  const item = await getItem(artifactItemId);
  if (!identity || !item) return undefined;
  return { ...item, user_state: await userState(user, Number(identity.id)) };
}

export async function personalizeItems(user: ApplicationUser, items: ItemOut[]): Promise<ItemOut[]> {
  if (items.length === 0) return [];
  const dataSource = await getDataSource();
  const artifactIds = items.map((item) => item.id);
  const identities = await dataSource.getRepository(CatalogueItemEntity)
    .createQueryBuilder("item")
    .where("item.artifact_item_id IN (:...artifactIds)", { artifactIds })
    .getMany();
  const identityByArtifact = new Map(identities.map((row) => [Number(row.artifactItemId), Number(row.id)]));
  const key = userKey(user);
  const internalIds = identities.map((row) => Number(row.id));
  const [likes, saves, ratings] = internalIds.length ? await Promise.all([
    dataSource.getRepository(LikeEntity).createQueryBuilder("state").where("state.user_key = :key", { key }).andWhere("state.item_id IN (:...internalIds)", { internalIds }).getMany(),
    dataSource.getRepository(SavedItemEntity).createQueryBuilder("state").where("state.user_key = :key", { key }).andWhere("state.item_id IN (:...internalIds)", { internalIds }).getMany(),
    dataSource.getRepository(RatingEntity).createQueryBuilder("state").where("state.user_key = :key", { key }).andWhere("state.item_id IN (:...internalIds)", { internalIds }).getMany(),
  ]) : [[], [], []];
  const liked = new Set(likes.map((row) => Number(row.itemId)));
  const saved = new Set(saves.map((row) => Number(row.itemId)));
  const ratingByItem = new Map(ratings.map((row) => [Number(row.itemId), row.rating]));
  return items.map((item) => {
    const internalId = identityByArtifact.get(item.id);
    return internalId === undefined ? item : { ...item, user_state: { liked: liked.has(internalId), saved: saved.has(internalId), rating: ratingByItem.get(internalId) ?? 0 } };
  });
}

/**
 * Resolve a public recommendation ``request_id`` to the persisted
 * ``recommendation_requests`` row id, or null when the id is not a
 * persisted numeric row (e.g. the fallback uuid) — attribution is only
 * meaningful against rows the analytics tables actually own.
 */
// fallow-ignore-next-line complexity -- Empty-string, integer, and positive-value guards are one validation.
function persistedRequestId(requestId: string | null | undefined): number | null {
  const raw = String(requestId ?? "").trim();
  const parsed = Number(raw);
  return raw !== "" && Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

// fallow-ignore-next-line complexity -- Five idempotent action verbs share one transaction and audit-log boundary.
export async function setStateAction(
  user: ApplicationUser,
  artifactItemId: number,
  action: "like" | "unlike" | "save" | "unsave" | "rate",
  rating?: number,
  requestId?: string | null,
) {
  const identity = await itemIdentity(artifactItemId);
  if (!identity) return undefined;
  const dataSource = await getDataSource();
  const key = userKey(user);
  const attributedRequestId = persistedRequestId(requestId);
  // fallow-ignore-next-line complexity -- The action branches must share one atomic state+audit transaction.
  await dataSource.transaction(async (manager) => {
    if (action === "like") {
      await manager.getRepository(LikeEntity).upsert({ userKey: key, itemId: Number(identity.id) }, ["userKey", "itemId"]);
    } else if (action === "unlike") {
      await manager.getRepository(LikeEntity).delete({ userKey: key, itemId: Number(identity.id) });
    } else if (action === "save") {
      await manager.getRepository(SavedItemEntity).upsert({ userKey: key, itemId: Number(identity.id) }, ["userKey", "itemId"]);
    } else if (action === "unsave") {
      await manager.getRepository(SavedItemEntity).delete({ userKey: key, itemId: Number(identity.id) });
    } else {
      await manager.getRepository(RatingEntity).upsert({ userKey: key, itemId: Number(identity.id), rating: rating! }, ["userKey", "itemId"]);
    }
    await manager.getRepository(InteractionLogEntity).save({
      userKey: key,
      itemId: Number(identity.id),
      actionType: action,
      metadataJson: JSON.stringify(rating ? { rating } : {}),
      recommendationRequestId: attributedRequestId,
    });
  });
  const item = await itemForUser(user, artifactItemId);
  return item && {
    item,
    action: action === "like" ? "liked" : action === "unlike" ? "unliked" : action === "save" ? "saved" : action === "unsave" ? "unsaved" : "rated",
    rating: item.user_state.rating || null,
    metadata: rating ? { rating } : {},
  };
}

export async function logView(user: ApplicationUser, artifactItemId: number, requestId?: string | null) {
  const identity = await itemIdentity(artifactItemId);
  if (!identity) return undefined;
  const dataSource = await getDataSource();
  const key = userKey(user);
  const attributedRequestId = persistedRequestId(requestId);
  const cutoff = new Date(Date.now() - 30 * 60 * 1000);
  const existing = await dataSource.getRepository(InteractionLogEntity)
    .createQueryBuilder("log")
    .where("log.user_key = :key", { key })
    .andWhere("log.item_id = :itemId", { itemId: Number(identity.id) })
    .andWhere("log.action_type = 'item_view'")
    .andWhere("log.created_at >= :cutoff", { cutoff })
    .getOne();
  if (!existing) {
    await dataSource.getRepository(InteractionLogEntity).save({
      userKey: key, itemId: Number(identity.id), actionType: "item_view",
      metadataJson: "{}", recommendationRequestId: attributedRequestId,
    });
  }
  return { action: "viewed", item_id: artifactItemId, deduped: Boolean(existing) };
}

export async function artifactIdsFor(user: ApplicationUser, kind: "liked" | "saved") {
  const dataSource = await getDataSource();
  const entity = kind === "liked" ? LikeEntity : SavedItemEntity;
  const rows = await dataSource.getRepository(entity)
    .createQueryBuilder("state")
    .innerJoin("items", "item", "item.id = state.item_id")
    .select("item.artifact_item_id", "item_id")
    .where("state.user_key = :key", { key: userKey(user) })
    .orderBy("state.created_at", "DESC")
    .getRawMany<{ item_id: string }>();
  return rows.map((row) => Number(row.item_id));
}

export async function ratedItems(user: ApplicationUser) {
  const dataSource = await getDataSource();
  const rows = await dataSource.getRepository(RatingEntity)
    .createQueryBuilder("rating")
    .innerJoin("items", "item", "item.id = rating.item_id")
    .select("item.artifact_item_id", "item_id")
    .addSelect("rating.rating", "rating")
    .addSelect("rating.updated_at", "updated_at")
    .where("rating.user_key = :key", { key: userKey(user) })
    .orderBy("rating.updated_at", "DESC")
    .getRawMany<{ item_id: string; rating: number; updated_at: Date }>();
  return rows.map((row) => ({ item_id: Number(row.item_id), rating: Number(row.rating), updated_at: new Date(row.updated_at).toISOString() }));
}

export async function memberSummary(user: ApplicationUser): Promise<UserSummaryOut> {
  const dataSource = await getDataSource();
  const key = userKey(user);
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [likedCount, savedCount, ratedCount, viewRows] = await Promise.all([
    dataSource.getRepository(LikeEntity).countBy({ userKey: key }),
    dataSource.getRepository(SavedItemEntity).countBy({ userKey: key }),
    dataSource.getRepository(RatingEntity).countBy({ userKey: key }),
    dataSource.getRepository(InteractionLogEntity).createQueryBuilder("log").select("COUNT(DISTINCT log.item_id)", "count").where("log.user_key = :key", { key }).andWhere("log.action_type = 'item_view'").andWhere("log.created_at >= :cutoff", { cutoff }).getRawOne<{ count: string }>(),
  ]);
  const recentViewCount = Number(viewRows?.count ?? 0);
  return { user_key: key, liked_count: likedCount, saved_count: savedCount, rated_count: ratedCount, recent_view_count: recentViewCount, interests: [], has_activity: likedCount + savedCount + ratedCount + recentViewCount > 0, source: "postgres" };
}

// fallow-ignore-next-line complexity -- Backward-compatible profile adoption and safe serialization stay in one boundary.
export async function ensureProfile(user: ApplicationUser): Promise<MemberProfileOut> {
  const dataSource = await getDataSource();
  let profile = await dataSource.getRepository(MemberProfileEntity).findOneBy({ userId: Number(user.id) });
  if (!profile) profile = await dataSource.getRepository(MemberProfileEntity).save({ userId: Number(user.id), displayName: user.displayName, role: user.isAdmin ? "super_admin" : "user", userGroup: user.isAdmin ? "super_admin" : "user" });
  return {
    user_id: Number(user.id), username: user.username, email: user.email,
    display_name: profile.displayName || user.displayName || user.username,
    avatar_url: profile.avatarUrl, bio: profile.bio, role: user.isAdmin ? "super_admin" : "user",
    consent_accepted: Boolean(profile.consentAccepted),
    consent_version: profile.consentVersion || "",
    consent_accepted_at: profile.consentAcceptedAt?.toISOString?.() ?? null,
    consent_withdrawn_at: profile.consentWithdrawnAt?.toISOString?.() ?? null,
    created_at: user.createdAt?.toISOString?.() ?? null, last_login_at: user.lastLoginAt?.toISOString?.() ?? null,
    updated_at: profile.updatedAt?.toISOString?.() ?? null,
  };
}

export async function history(user: ApplicationUser, limit = 20) {
  const dataSource = await getDataSource();
  const rows = await dataSource.getRepository(InteractionLogEntity).createQueryBuilder("log")
    .innerJoin("items", "item", "item.id = log.item_id")
    .select("log.id", "log_id").addSelect("item.artifact_item_id", "item_id").addSelect("item.name", "item_name")
    .addSelect("log.action_type", "action_type").addSelect("log.metadata_json", "metadata_json").addSelect("log.created_at", "created_at")
    .where("log.user_key = :key", { key: userKey(user) }).andWhere("log.action_type <> 'item_view'")
    .orderBy("log.created_at", "DESC").limit(limit).getRawMany();
  return { items: rows.map((row) => { let metadata: Record<string, unknown> = {}; try { metadata = JSON.parse(row.metadata_json || "{}"); } catch {} return { log_id: Number(row.log_id), item_id: Number(row.item_id), item_name: row.item_name, context_name: "", action_type: row.action_type, rating: typeof metadata.rating === "number" ? metadata.rating : null, created_at: new Date(row.created_at).toISOString() }; }), total: rows.length };
}

export async function recentViews(user: ApplicationUser, days = 30, limit = 20) {
  const dataSource = await getDataSource();
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const rows = await dataSource.getRepository(InteractionLogEntity).createQueryBuilder("log")
    .innerJoin("items", "item", "item.id = log.item_id")
    .select("item.artifact_item_id", "item_id").addSelect("item.name", "item_name").addSelect("MAX(log.created_at)", "viewed_at")
    .where("log.user_key = :key", { key: userKey(user) }).andWhere("log.action_type = 'item_view'").andWhere("log.created_at >= :cutoff", { cutoff })
    .groupBy("item.artifact_item_id").addGroupBy("item.name").orderBy("MAX(log.created_at)", "DESC").limit(limit).getRawMany();
  return { items: rows.map((row) => ({ item_id: Number(row.item_id), item_name: row.item_name, viewed_at: new Date(row.viewed_at).toISOString() })), total: rows.length, window_days: days };
}
