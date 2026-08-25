// lib/server/recommendations.ts — Application Backend recommendation service.
//
// The Next.js Application Backend owns everything the Private Model Service
// contract leaves outside: the Eligible Candidate Set (eligibility gate over
// the live catalogue), keyword resolution, live personalization inputs in
// immutable Artifact Item Identifier space, response enrichment (catalogue
// details, media, member state, Thai explanations, suitability hint),
// persisted request/result analytics, and the clearly identified
// Recommendation Fallback when the model service errors or times out.
//
// Algorithm behavior mirrors the legacy FastAPI orchestrator
// (backend/app/services/recommendation_service.py) and the ADR:
// eligibility-gated hybrid = CBF + CF ItemKNN + Hybrid WeightedSum, cold
// start CBF-only, negative ratings as monotonic additive demotion.

import { randomUUID } from "node:crypto";

import type { ApplicationUser } from "@/db/entities/Members";
import {
  InteractionLogEntity,
  LikeEntity,
  RatingEntity,
  SavedItemEntity,
} from "@/db/entities/Members";
import {
  CatalogueItemEntity,
  type CatalogueContext,
  type CatalogueItem,
} from "@/db/entities/Catalogue";
import { getDataSource } from "@/db/connection";
import {
  CatalogueSnapshot,
  eligibleItemsForContext,
  keywordOut,
  loadCatalogueSnapshot,
  stableId,
  catalogueItemOut,
} from "@/lib/server/catalogue";
import {
  ModelServiceUnavailableError,
  rankInferenceCandidates,
  type InferenceRankedCandidate,
} from "@/lib/server/model-service";
import {
  RecommendationRequestEntity,
  RecommendationRequestSelectedKeywordEntity,
  RecommendationResultEntity,
} from "@/db/entities/RecommendationRequests";
import type {
  ContextOut,
  KeywordOut,
  ProfileRecommendationResponseOut,
  RecommendationResponseOut,
  RecommendationResultOut,
  UserState,
} from "@/lib/types";

/** Domain error mapped to the stable public error envelope by the routes. */
export class RecommendationError extends Error {
  readonly status: number;
  readonly code: string;
  readonly extra: Record<string, unknown>;

  constructor(
    status: number,
    code: string,
    message: string,
    extra: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "RecommendationError";
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export interface RecommendationRequestInput {
  contextId: number;
  keywordIds: number[];
  topK: number;
  /** Resolved personalization key: ``user:<id>`` for sessions, ``anon:<uuid>`` for visitors, "" for anonymous. */
  userKey: string;
  /** Live ``users.id`` when the request came from a session member. */
  userId?: number | null;
}

interface PersonalizationState {
  positive_history: Array<{ artifact_item_id: number; rating_weight: number }>;
  negative_ratings: Array<{ artifact_item_id: number; rating: number }>;
  history_artifact_ids: Set<number>;
  user_state_by_artifact: Map<number, UserState>;
}

interface HistoryEvidence {
  rows: CatalogueItem[];
  states: Map<number, UserState>;
}

const METHOD_TAG = "Hybrid-WeightedSum";
const PROFILE_METHOD_TAG = "Profile-ItemKNN";
const POSITIVE_RATING_THRESHOLD = 4;
const FALLBACK_EXPLANATION =
  "ขณะนี้ระบบโมเดลไม่พร้อมใช้งาน จึงแสดงรายการในบริบทนี้เรียงตามความนิยมชั่วคราว";
const PROFILE_FALLBACK_EXPLANATION =
  "ขณะนี้ระบบโมเดลไม่พร้อมใช้งาน จึงแสดงรายการที่ใกล้เคียงความสนใจจากแคตตาล็อกชั่วคราว";

// --- Context recommendations -------------------------------------------------

// fallow-ignore-next-line complexity -- Eligibility, inference, enrichment, fallback, and telemetry share one stable public workflow.
export async function generateRecommendations(
  input: RecommendationRequestInput,
): Promise<RecommendationResponseOut> {
  const snapshot = await loadCatalogueSnapshot();
  const context = snapshot.contexts.find(
    (row) => stableId("context", row.name) === input.contextId,
  );
  if (!context) {
    throw new RecommendationError(
      404,
      "context_not_found",
      `Context id ${input.contextId} is not known.`,
      { context_id: input.contextId },
    );
  }

  const keywordResolution = resolveSelectedKeywords(snapshot, input.keywordIds);
  const caps = eligibilityCaps();
  const eligible = eligibleItemsForContext(
    snapshot,
    Number(context.id),
    keywordResolution.names,
    caps,
  );
  const personalization = await livePersonalization(input.userKey);
  const candidateCount = eligible.length;
  const contextOut = selectedContextOut(snapshot, context);
  const base = {
    selected_context: contextOut,
    selected_keywords: keywordResolution.objs,
    candidate_count: candidateCount,
    top_k: input.topK,
  };

  if (candidateCount === 0) {
    // No eligible candidates — nothing to score; mirror the legacy empty
    // response (still recorded so the analytics chain sees the attempt).
    const requestId = await recordRecommendation({
      userId: input.userId ?? null,
      userKey: input.userKey,
      contextInternalId: Number(context.id),
      candidateCount: 0,
      topK: input.topK,
      method: METHOD_TAG,
      fallback: false,
      metadata: {
        user_key_provided: Boolean(input.userKey),
        selected_keyword_names: keywordResolution.names,
        note: "no candidates in this context",
      },
      results: [],
      selectedKeywordInternalIds: keywordResolution.internalIds,
    });
    return {
      request_id: requestId || randomUUID(),
      ...base,
      method: METHOD_TAG,
      embedding_backend: "e5",
      embedding_latency_ms: 0,
      metadata: {
        ...modelConfigMetadata(caps),
        user_key_provided: Boolean(input.userKey),
        selected_keyword_names: keywordResolution.names,
        note: "no candidates in this context",
        persisted_to_db: Boolean(requestId),
        model_service: "private-v1",
        ...fallbackFlags(null),
      },
      results: [],
    };
  }

  const eligibleArtifactIds = eligible.map((item) => Number(item.artifactItemId));
  const byArtifactId = new Map(
    eligible.map((item) => [Number(item.artifactItemId), item]),
  );
  const inferenceRequest = {
    eligibleCandidateArtifactItemIds: eligibleArtifactIds,
    personalization: {
      context_name: context.name,
      keyword_names: keywordResolution.names,
      positive_history: personalization.positive_history,
      negative_ratings: personalization.negative_ratings,
    },
    topK: input.topK,
  };

  let ranked: InferenceRankedCandidate[] = [];
  let fallbackReason: string | null = null;
  let latencyMs = 0;
  try {
    const startedAt = Date.now();
    ranked = await rankInferenceCandidates(inferenceRequest);
    latencyMs = Date.now() - startedAt;
  } catch (error) {
    fallbackReason =
      error instanceof ModelServiceUnavailableError
        ? error.message
        : error instanceof Error
        ? error.message
        : "Model inference fallback";
  }

  const historyEvidence: HistoryEvidence = {
    rows: snapshot.items.filter((item) =>
      personalization.history_artifact_ids.has(Number(item.artifactItemId)),
    ),
    states: personalization.user_state_by_artifact,
  };

  let results: RecommendationResultOut[] = [];
  if (fallbackReason === null && ranked.length > 0) {
    results = ranked
      .map((candidate, index) => {
        const item = byArtifactId.get(candidate.artifact_item_id);
        if (!item) return null;
        return buildResultRow(
          snapshot,
          item,
          candidate,
          context.name,
          keywordResolution.names,
          personalization,
          historyEvidence,
          index + 1,
        );
      })
      .filter((r): r is RecommendationResultOut => r !== null)
      .slice(0, input.topK);
  }

  if (results.length === 0) {
    results = await fallbackRanking(snapshot, eligible, personalization, input.topK);
  }

  const requestId = await recordRecommendation({
    userId: input.userId ?? null,
    userKey: input.userKey,
    contextInternalId: Number(context.id),
    candidateCount,
    topK: input.topK,
    method: METHOD_TAG,
    fallback: fallbackReason !== null,
    metadata: {
      ...modelConfigMetadata(caps),
      user_key_provided: Boolean(input.userKey),
      user_state_resolved: Boolean(input.userKey),
      negative_ratings_applied: personalization.negative_ratings.length > 0,
      selected_keyword_names: keywordResolution.names,
      model_service: "private-v1",
      ...fallbackFlags(fallbackReason),
    },
    results: results.map((result) => ({
      internalItemId: internalIdFor(byArtifactId, result.item.id),
      rank: result.rank,
      cbf: result.scores.cbf,
      cf: result.scores.cf,
      hybrid: result.scores.hybrid,
      matchedKeywords: result.matched_keywords,
      explanation: result.explanation,
    })),
    selectedKeywordInternalIds: keywordResolution.internalIds,
  });

  return {
    request_id: requestId || randomUUID(),
    ...base,
    method: METHOD_TAG,
    embedding_backend: "e5",
    embedding_latency_ms: latencyMs,
    metadata: {
      ...modelConfigMetadata(caps),
      user_key_provided: Boolean(input.userKey),
      db_enabled: true,
      user_state_resolved: Boolean(input.userKey),
      negative_ratings_applied: personalization.negative_ratings.length > 0,
      persisted_to_db: Boolean(requestId),
      model_service: "private-v1",
      latency_measured_at: "application-backend",
      ...fallbackFlags(fallbackReason),
    },
    results,
  };
}

/** Model configuration surfaced in response metadata (parity with the legacy service). */
function modelConfigMetadata(caps: { maxCands?: number; minCands: number }): Record<string, unknown> {
  return {
    cbf_model: "precomputed-E5",
    cf_model: "ItemKNN",
    hybrid_alpha: envFloat("RECSYS_HYBRID_ALPHA", 0.8),
    cbf_keyword_boost: envFloat("RECSYS_CBF_KEYWORD_BOOST", 0.05),
    itemknn_k: envInt("RECSYS_ITEMKNN_K", 10),
    itemknn_shrink: envFloat("RECSYS_ITEMKNN_SHRINK", 50.0),
    max_cands: caps.maxCands ?? null,
    negative_penalty_strength: envFloat("RECSYS_NEGATIVE_PENALTY_ALPHA", 1.0),
  };
}

/** Explicit fallback identification: every response states whether the model scored it. */
function fallbackFlags(fallbackReason: string | null): Record<string, unknown> {
  return fallbackReason !== null
    ? { fallback: true, fallback_reason: "model_service_unavailable", fallback_note: fallbackReason }
    : { fallback: false };
}

// --- Profile recommendations -------------------------------------------------

// fallow-ignore-next-line complexity -- The profile blend (ItemKNN + content affinity) and its content-only fallback share one boundary.
export async function generateProfileRecommendations(
  user: ApplicationUser,
  topK: number,
): Promise<ProfileRecommendationResponseOut> {
  const userKeyValue = `user:${Number(user.id)}`;
  const snapshot = await loadCatalogueSnapshot();
  const personalization = await livePersonalization(userKeyValue);
  const historyCount = personalization.history_artifact_ids.size;

  if (historyCount === 0) {
    return {
      request_id: randomUUID(),
      top_k: topK,
      method: PROFILE_METHOD_TAG,
      history_count: 0,
      metadata: {
        profile_key: userKeyValue,
        current_user_key: userKeyValue,
        live_actions_included: true,
        note: "no positive history for this user",
        fallback: false,
      },
      results: [],
    };
  }

  const activeItems = snapshot.items
    .filter((item) => item.isActive)
    .sort(
      (left, right) =>
        left.name.localeCompare(right.name, "th") || Number(left.id) - Number(right.id),
    );
  const eligible = activeItems.filter(
    (item) => !personalization.history_artifact_ids.has(Number(item.artifactItemId)),
  );
  const eligibleArtifactIds = eligible.map((item) => Number(item.artifactItemId));
  const byArtifactId = new Map(
    eligible.map((item) => [Number(item.artifactItemId), item]),
  );

  let ranked: InferenceRankedCandidate[] = [];
  let fallbackReason: string | null = null;
  let latencyMs = 0;
  if (eligibleArtifactIds.length > 0) {
    try {
      const startedAt = Date.now();
      ranked = await rankInferenceCandidates({
        eligibleCandidateArtifactItemIds: eligibleArtifactIds,
        personalization: {
          context_name: "",
          keyword_names: [],
          positive_history: personalization.positive_history,
          negative_ratings: personalization.negative_ratings,
        },
        // Score as much of the eligible set as the contract allows; the
        // zero-score filter below then slices to topK.
        topK: Math.min(eligibleArtifactIds.length, 50),
      });
      latencyMs = Date.now() - startedAt;
    } catch (error) {
      if (error instanceof ModelServiceUnavailableError) {
        fallbackReason = error.message;
      } else {
        throw error;
      }
    }
  }

  const affinity = profileContentAffinity(snapshot, personalization.history_artifact_ids, eligible);
  const historySummary = profileHistorySummary(snapshot, personalization.history_artifact_ids);

  let results: RecommendationResultOut[];
  if (fallbackReason !== null) {
    // Content-only fallback: rank by catalogue affinity (the component that
    // needs no model service) and flag the response as a fallback.
    results = eligible
      .map((item) => ({ item, score: affinity.get(Number(item.artifactItemId)) ?? 0 }))
      .filter((row) => row.score > 0)
      .sort((left, right) => right.score - left.score || left.item.name.localeCompare(right.item.name, "th"))
      .slice(0, topK)
      .map((row, index) =>
        profileResultRow(snapshot, row.item, { cbf: row.score, cf: 0, final: row.score }, historySummary, personalization, PROFILE_FALLBACK_EXPLANATION, index + 1),
      );
  } else {
    results = ranked
      .map((candidate) => {
        const cf = candidate.scores.cf;
        const affinityScore = affinity.get(candidate.artifact_item_id) ?? 0;
        return {
          candidate,
          cf,
          final: 0.75 * Math.max(cf, 0) + 0.25 * affinityScore,
        };
      })
      .filter((row) => row.final > 0)
      .sort((left, right) => right.final - left.final)
      .slice(0, topK)
      .map((row, index) =>
        profileResultRow(
          snapshot,
          byArtifactId.get(row.candidate.artifact_item_id)!,
          { cbf: affinity.get(row.candidate.artifact_item_id) ?? 0, cf: row.cf, final: row.final },
          historySummary,
          personalization,
          "",
          index + 1,
        ),
      );
  }

  return {
    request_id: randomUUID(),
    top_k: topK,
    method: PROFILE_METHOD_TAG,
    history_count: historyCount,
    metadata: {
      profile_key: userKeyValue,
      current_user_key: userKeyValue,
      candidate_count: eligibleArtifactIds.length,
      history_summary: historySummary,
      live_actions_included: true,
      model_service: "private-v1",
      latency_measured_at: "application-backend",
      ...(fallbackReason !== null
        ? { fallback: true, fallback_reason: "model_service_unavailable", fallback_note: fallbackReason }
        : { fallback: false }),
    },
    results,
  };
}

// --- Result row builders -----------------------------------------------------

function buildResultRow(
  snapshot: CatalogueSnapshot,
  item: CatalogueItem,
  candidate: InferenceRankedCandidate,
  contextName: string,
  selectedKeywordNames: string[],
  personalization: PersonalizationState,
  historyEvidence: HistoryEvidence,
  rank: number,
): RecommendationResultOut {
  const itemOut = catalogueItemOut(snapshot, item);
  const itemKeywordNames = itemOut.keywords.map((keyword) => keyword.name);
  const matched = selectedKeywordNames.filter((name) => itemKeywordNames.includes(name));
  const historyReason =
    candidate.scores.cf > 0 ? historyReasonForItem(item, historyEvidence) : "";
  const explanation = buildExplanation({
    contextName,
    selectedKeywordNames,
    cbfScore: candidate.scores.cbf,
    cfScore: candidate.scores.cf,
    matchedKeywords: matched,
    historyReason,
  });
  return {
    rank,
    item: withUserState(itemOut, personalization.user_state_by_artifact.get(candidate.artifact_item_id)),
    scores: { cbf: candidate.scores.cbf, cf: candidate.scores.cf, hybrid: candidate.scores.final },
    is_context_valid: true,
    matched_keywords: matched,
    explanation,
    match_percent: itemOut.match_percent ?? 82,
    suitability_label: itemOut.suitability_label ?? "เหมาะใช้ได้",
  };
}

function profileResultRow(
  snapshot: CatalogueSnapshot,
  item: CatalogueItem,
  scores: { cbf: number; cf: number; final: number },
  historySummary: ProfileHistorySummary,
  personalization: PersonalizationState,
  overrideExplanation: string,
  rank: number,
): RecommendationResultOut {
  const itemOut = catalogueItemOut(snapshot, item);
  return {
    rank,
    item: withUserState(itemOut, personalization.user_state_by_artifact.get(Number(item.artifactItemId))),
    scores: { cbf: scores.cbf, cf: scores.cf, hybrid: scores.final },
    is_context_valid: true,
    matched_keywords: [],
    explanation:
      overrideExplanation || profileCardExplanation(snapshot, item, historySummary),
    match_percent: itemOut.match_percent ?? 82,
    suitability_label: itemOut.suitability_label ?? "เหมาะใช้ได้",
  };
}

function withUserState(
  itemOut: ReturnType<typeof catalogueItemOut>,
  state: UserState | undefined,
): ReturnType<typeof catalogueItemOut> {
  return state ? { ...itemOut, user_state: state } : itemOut;
}

// --- Recommendation Fallback -------------------------------------------------

/**
 * Non-personalized catalogue ranking used when the model service errors or
 * times out: context-valid items ordered by live engagement (likes + saves +
 * positive ratings), then the display-only suitability hint, then name.
 * The response is explicitly flagged (``metadata.fallback``) and every row
 * carries zero model scores plus a fallback explanation.
 */
async function fallbackRanking(
  snapshot: CatalogueSnapshot,
  eligible: CatalogueItem[],
  personalization: PersonalizationState,
  topK: number,
): Promise<RecommendationResultOut[]> {
  const engagement = await engagementByInternalItemIds(
    eligible.map((item) => Number(item.id)),
  );
  return eligible
    .map((item) => {
      const itemOut = catalogueItemOut(snapshot, item);
      return {
        itemOut,
        engagement: engagement.get(Number(item.id)) ?? 0,
      };
    })
    .sort(byEngagementThenSuitability)
    .slice(0, topK)
    .map((row, index) => ({
      rank: index + 1,
      item: withUserState(row.itemOut, personalization.user_state_by_artifact.get(row.itemOut.id)),
      scores: { cbf: 0, cf: 0, hybrid: 0 },
      is_context_valid: true,
      matched_keywords: [],
      explanation: FALLBACK_EXPLANATION,
      match_percent: row.itemOut.match_percent ?? 82,
      suitability_label: row.itemOut.suitability_label ?? "เหมาะใช้ได้",
    }));
}

// fallow-ignore-next-line complexity -- Like, save, and positive-rating counts aggregate in three parallel grouped queries.
async function engagementByInternalItemIds(
  internalItemIds: number[],
): Promise<Map<number, number>> {
  if (internalItemIds.length === 0) return new Map();
  const dataSource = await getDataSource();
  const counts = new Map<number, number>();
  const [likeRows, saveRows, ratingRows] = await Promise.all([
    dataSource
      .getRepository(LikeEntity)
      .createQueryBuilder("state")
      .select("state.item_id", "item_id")
      .addSelect("COUNT(*)", "count")
      .where("state.item_id IN (:...internalItemIds)", { internalItemIds })
      .groupBy("state.item_id")
      .getRawMany<{ item_id: string; count: string }>(),
    dataSource
      .getRepository(SavedItemEntity)
      .createQueryBuilder("state")
      .select("state.item_id", "item_id")
      .addSelect("COUNT(*)", "count")
      .where("state.item_id IN (:...internalItemIds)", { internalItemIds })
      .groupBy("state.item_id")
      .getRawMany<{ item_id: string; count: string }>(),
    dataSource
      .getRepository(RatingEntity)
      .createQueryBuilder("state")
      .select("state.item_id", "item_id")
      .addSelect("COUNT(*)", "count")
      .where("state.item_id IN (:...internalItemIds)", { internalItemIds })
      .andWhere("state.rating >= :threshold", { threshold: POSITIVE_RATING_THRESHOLD })
      .groupBy("state.item_id")
      .getRawMany<{ item_id: string; count: string }>(),
  ]);
  for (const rows of [likeRows, saveRows, ratingRows]) {
    for (const row of rows) {
      const internalId = Number(row.item_id);
      counts.set(internalId, (counts.get(internalId) ?? 0) + Number(row.count));
    }
  }
  return counts;
}

// --- Live personalization ----------------------------------------------------

// fallow-ignore-next-line complexity -- Likes, saves, ratings, and their artifact-id translation are read in one live-state pass.
async function livePersonalization(userKeyValue: string): Promise<PersonalizationState> {
  const emptyState: PersonalizationState = {
    positive_history: [],
    negative_ratings: [],
    history_artifact_ids: new Set(),
    user_state_by_artifact: new Map(),
  };
  if (!userKeyValue) return emptyState;
  const dataSource = await getDataSource();
  const [likes, saves, ratings] = await Promise.all([
    dataSource.getRepository(LikeEntity).findBy({ userKey: userKeyValue }),
    dataSource.getRepository(SavedItemEntity).findBy({ userKey: userKeyValue }),
    dataSource.getRepository(RatingEntity).findBy({ userKey: userKeyValue }),
  ]);
  const internalIds = [...new Set([...likes, ...saves, ...ratings].map((row) => Number(row.itemId)))];
  if (internalIds.length === 0) return emptyState;

  const identities = await dataSource
    .getRepository(CatalogueItemEntity)
    .createQueryBuilder("item")
    .where("item.id IN (:...internalIds)", { internalIds })
    .getMany();
  const artifactByInternal = new Map(
    identities.map((row) => [Number(row.id), Number(row.artifactItemId)]),
  );
  const likedInternal = new Set(likes.map((row) => Number(row.itemId)));
  const savedInternal = new Set(saves.map((row) => Number(row.itemId)));
  const ratingByInternal = new Map(ratings.map((row) => [Number(row.itemId), row.rating]));

  const positiveHistory: Array<{ artifact_item_id: number; rating_weight: number }> = [];
  const negativeRatings: Array<{ artifact_item_id: number; rating: number }> = [];
  const historyArtifactIds = new Set<number>();
  const userStateByArtifact = new Map<number, UserState>();
  const seenPositive = new Set<number>();

  for (const internalId of internalIds) {
    const artifactId = artifactByInternal.get(internalId);
    if (artifactId === undefined) continue;
    const rating = ratingByInternal.get(internalId) ?? 0;
    userStateByArtifact.set(artifactId, {
      liked: likedInternal.has(internalId),
      saved: savedInternal.has(internalId),
      rating,
    });
    if (rating >= 1 && rating <= 3) {
      negativeRatings.push({ artifact_item_id: artifactId, rating });
    }
    if (
      likedInternal.has(internalId) ||
      savedInternal.has(internalId) ||
      rating >= POSITIVE_RATING_THRESHOLD
    ) {
      if (!seenPositive.has(artifactId)) {
        seenPositive.add(artifactId);
        historyArtifactIds.add(artifactId);
        // Live positives carry weight 1.0 — the same effective weight the
        // legacy merge used (cf_service._merged_cf_index setdefault 1.0).
        positiveHistory.push({ artifact_item_id: artifactId, rating_weight: 1.0 });
      }
    }
  }
  positiveHistory.sort((left, right) => left.artifact_item_id - right.artifact_item_id);
  negativeRatings.sort((left, right) => left.artifact_item_id - right.artifact_item_id);
  return {
    positive_history: positiveHistory,
    negative_ratings: negativeRatings,
    history_artifact_ids: historyArtifactIds,
    user_state_by_artifact: userStateByArtifact,
  };
}

// --- Keyword resolution ------------------------------------------------------

// fallow-ignore-next-line complexity -- Live DB ids and artifact stable-hash ids resolve through one deduped lookup.
function resolveSelectedKeywords(
  snapshot: CatalogueSnapshot,
  keywordIds: number[],
): { objs: KeywordOut[]; internalIds: number[]; names: string[] } {
  const seen = new Set<number>();
  const objs: KeywordOut[] = [];
  const internalIds: number[] = [];
  for (const rawId of keywordIds) {
    const keywordId = Number(rawId);
    if (!Number.isSafeInteger(keywordId) || keywordId <= 0 || seen.has(keywordId)) continue;
    seen.add(keywordId);
    // /keywords serves live DB ids; the artifact stable-hash space is also
    // accepted so older clients keep working (mirrors the legacy resolver).
    const row =
      snapshot.keywords.find((keyword) => Number(keyword.id) === keywordId) ??
      snapshot.keywords.find(
        (keyword) => stableId("keyword", keyword.name) === keywordId,
      );
    if (!row) continue;
    objs.push(keywordOut(snapshot, row));
    internalIds.push(Number(row.id));
  }
  return { objs, internalIds, names: objs.map((keyword) => keyword.name) };
}

// --- Thai explanation builders (ports of backend/app/explanations.py) --------

// fallow-ignore-next-line complexity -- Every branch emits a distinct Thai explanation case from the legacy builder.
function buildExplanation(options: {
  contextName: string;
  selectedKeywordNames: string[];
  cbfScore: number;
  cfScore: number;
  matchedKeywords: string[];
  historyReason: string;
}): string {
  const hasContext = options.contextName.trim().length > 0;
  const hasKeywordMatch = options.matchedKeywords.length > 0;
  const hasKeywordQuery = options.selectedKeywordNames.some(
    (name) => name.trim().length > 0,
  );
  const hasContentSignal = options.cbfScore > 0;
  const cleanHistoryReason = options.historyReason.trim().replace(/\.$/, "");
  const hasHistorySignal = cleanHistoryReason.length > 0;

  const shownKeywords = options.matchedKeywords
    .slice(0, 3)
    .map((keyword) => `“${keyword}”`)
    .join(" และ ");
  let mainReason: string;
  if (hasContext && hasKeywordMatch) {
    mainReason = `ตรงกับ “${options.contextName}” และคำสำคัญ ${shownKeywords}`;
  } else if (hasContext && hasKeywordQuery && hasContentSignal) {
    mainReason = `ตรงกับ “${options.contextName}” และใกล้เคียงคำสำคัญที่เลือก`;
  } else if (hasKeywordMatch) {
    mainReason = `ตรงกับคำสำคัญ ${shownKeywords}`;
  } else if (hasContext) {
    mainReason = `ตรงกับ “${options.contextName}”`;
  } else if (hasContentSignal) {
    mainReason = "ใกล้เคียงคำสำคัญที่เลือก";
  } else if (hasHistorySignal) {
    mainReason = cleanHistoryReason;
  } else {
    mainReason = "เหมาะกับเงื่อนไขที่เลือก";
  }

  const historyText =
    hasHistorySignal && mainReason !== cleanHistoryReason
      ? ` และ${cleanHistoryReason}`
      : "";
  return `แนะนำเพราะ${mainReason}${historyText}.`;
}

// fallow-ignore-next-line complexity -- Category, then performance-type evidence chains into the action-grounded reason.
function historyReasonForItem(
  item: CatalogueItem,
  evidence: HistoryEvidence,
): string {
  if (evidence.rows.length === 0) return "";
  const category = item.categoryGroup.trim();
  if (category) {
    const matchingIds = evidence.rows
      .filter((row) => row.categoryGroup.trim() === category)
      .map((row) => Number(row.artifactItemId));
    if (matchingIds.length > 0) {
      return historyActionPhrase(matchingIds, categoryGroupPhrase(category), evidence);
    }
  }
  const performanceType = item.performanceType.trim();
  if (performanceType) {
    const matchingIds = evidence.rows
      .filter((row) => row.performanceType.trim() === performanceType)
      .map((row) => Number(row.artifactItemId));
    if (matchingIds.length > 0) {
      return historyActionPhrase(matchingIds, performanceTypePhrase(performanceType), evidence);
    }
  }
  return "";
}

function historyActionPhrase(
  matchingIds: number[],
  traitPhrase: string,
  evidence: HistoryEvidence,
): string {
  if (matchingIds.some((id) => evidence.states.get(id)?.liked)) {
    return `คุณเคยกดถูกใจ${traitPhrase}`;
  }
  if (matchingIds.some((id) => evidence.states.get(id)?.saved)) {
    return `คุณเคยบันทึก${traitPhrase}`;
  }
  if (matchingIds.some((id) => (evidence.states.get(id)?.rating ?? 0) >= 4)) {
    return `คุณเคยให้คะแนนสูงแก่${traitPhrase}`;
  }
  // Static artifact CF history is not exposed to the Application Backend.
  return "";
}

function performanceTypePhrase(performanceType: string): string {
  const labels: Record<string, string> = {
    "การแสดง ระบำ รำ ฟ้อน": "การแสดงประเภทระบำ รำ และฟ้อน",
    "การแสดงโขน - ละคร": "การแสดงประเภทโขนและละคร",
    "การแสดงสร้างสรรค์": "การแสดงสร้างสรรค์",
  };
  if (labels[performanceType]) return labels[performanceType];
  if (performanceType === "การแสดง") return "การแสดงในรูปแบบเดียวกัน";
  return `การแสดงประเภท${performanceType}`;
}

function categoryGroupPhrase(category: string): string {
  if (category === "กลุ่ม") return "การแสดงในกลุ่มเดียวกัน";
  if (category.startsWith("การแสดง")) return category;
  return `การแสดงกลุ่ม${category}`;
}

// fallow-ignore-next-line complexity -- Engagement, suitability hint, and name form the documented fallback ordering.
function byEngagementThenSuitability(
  left: { itemOut: ReturnType<typeof catalogueItemOut>; engagement: number },
  right: { itemOut: ReturnType<typeof catalogueItemOut>; engagement: number },
): number {
  return (
    right.engagement - left.engagement ||
    (right.itemOut.match_percent ?? 0) - (left.itemOut.match_percent ?? 0) ||
    left.itemOut.name.localeCompare(right.itemOut.name, "th")
  );
}

// --- Profile summary + affinity (ports of recommendation_service.py) --------

interface ProfileHistorySummary {
  history_item_names: string[];
  top_contexts: string[];
  top_keywords: string[];
  top_performance_types: string[];
  sentence: string;
}

// fallow-ignore-next-line complexity -- Context, keyword, and performance-type counters each aggregate in their own branch.
function profileHistorySummary(
  snapshot: CatalogueSnapshot,
  historyArtifactIds: Set<number>,
): ProfileHistorySummary {
  if (historyArtifactIds.size === 0) {
    return {
      history_item_names: [],
      top_contexts: [],
      top_keywords: [],
      top_performance_types: [],
      sentence: "ยังไม่มีประวัติความชอบมากพอให้สรุปรูปแบบเดิม",
    };
  }
  const rows = snapshot.items.filter((item) =>
    historyArtifactIds.has(Number(item.artifactItemId)),
  );
  const itemNames: string[] = [];
  const contextCounter = new Map<string, number>();
  const keywordCounter = new Map<string, number>();
  const typeCounter = new Map<string, number>();

  for (const row of rows) {
    const name = row.name.trim();
    if (name) itemNames.push(name);
    for (const context of contextsOf(snapshot, row)) {
      if (context.name) increment(contextCounter, context.name);
    }
    for (const keyword of keywordsOf(snapshot, row)) {
      if (keyword.name) increment(keywordCounter, keyword.name);
    }
    const performanceType = row.performanceType.trim();
    const categoryGroup = row.categoryGroup.trim();
    if (performanceType) increment(typeCounter, performanceType);
    else if (categoryGroup) increment(typeCounter, categoryGroup);
  }

  const topContexts = topCounts(contextCounter, 3);
  const topKeywords = topCounts(keywordCounter, 4);
  const topTypes = topCounts(typeCounter, 3);
  const itemExamples = itemNames.slice(0, 3);

  const parts: string[] = [];
  if (itemExamples.length > 0) parts.push(`คุณเคยสนใจรายการ เช่น ${itemExamples.join(", ")}`);
  if (topTypes.length > 0) parts.push(`โดยมักเป็นกลุ่ม ${topTypes.join(", ")}`);
  if (topContexts.length > 0) parts.push(`ในบริบท ${topContexts.join(", ")}`);
  if (topKeywords.length > 0) parts.push(`มีคุณลักษณะเด่น เช่น ${topKeywords.join(", ")}`);

  return {
    history_item_names: itemNames,
    top_contexts: topContexts,
    top_keywords: topKeywords,
    top_performance_types: topTypes,
    sentence: parts.join(" ") || "ยังไม่มีประวัติความชอบมากพอให้สรุปรูปแบบเดิม",
  };
}

// fallow-ignore-next-line complexity -- Overlap chains (keyword, context, type) pick the most specific Thai reason.
function profileCardExplanation(
  snapshot: CatalogueSnapshot,
  item: CatalogueItem,
  summary: ProfileHistorySummary,
): string {
  const historyItems = summary.history_item_names.filter(Boolean);
  const topContexts = summary.top_contexts;
  const topKeywords = summary.top_keywords;
  const topTypes = summary.top_performance_types;

  const itemContexts = new Set(contextsOf(snapshot, item).map((context) => context.name));
  const itemKeywords = new Set(keywordsOf(snapshot, item).map((keyword) => keyword.name));
  const itemType = item.performanceType.trim() || item.categoryGroup.trim();

  const contextOverlap = topContexts.filter((name) => itemContexts.has(name)).slice(0, 1);
  const keywordOverlap = topKeywords.filter((name) => itemKeywords.has(name)).slice(0, 2);
  const typeOverlap = topTypes.filter((name) => name && name === itemType).slice(0, 1);

  const reason =
    historyItems.length > 0
      ? `แนะนำเพราะในอดีตคุณเคยชอบ ${historyItems[0]}`
      : "แนะนำจากรายการที่คุณเคยถูกใจหรือให้คะแนนสูง";
  if (keywordOverlap.length > 0) {
    return `${reason} และรายการนี้มีคุณลักษณะใกล้เคียง เช่น ${keywordOverlap.join(", ")}`;
  }
  if (contextOverlap.length > 0) {
    return `${reason} ในบริบทใกล้เคียง เช่น ${contextOverlap[0]}`;
  }
  if (typeOverlap.length > 0) {
    return `${reason} ซึ่งอยู่ในกลุ่มการแสดงคล้ายกัน`;
  }
  return `${reason} แล้วพบว่ามีรูปแบบผู้ใช้ใกล้เคียงกัน`;
}

function profileContentAffinity(
  snapshot: CatalogueSnapshot,
  historyArtifactIds: Set<number>,
  candidateItems: CatalogueItem[],
): Map<number, number> {
  const historyRows = snapshot.items.filter((item) =>
    historyArtifactIds.has(Number(item.artifactItemId)),
  );
  if (historyRows.length === 0) {
    return new Map(candidateItems.map((item) => [Number(item.artifactItemId), 0]));
  }
  const historyKeywords = new Set(
    historyRows.flatMap((row) => keywordsOf(snapshot, row).map((keyword) => keyword.name)),
  );
  const historyContexts = new Set(
    historyRows.flatMap((row) => contextsOf(snapshot, row).map((context) => context.name)),
  );
  const historyCategories = new Set(
    historyRows.map((row) => row.categoryGroup).filter((value) => value.length > 0),
  );

  const overlap = (current: string[], history: Set<string>): number => {
    const currentSet = new Set(current.filter((value) => value.length > 0));
    if (currentSet.size === 0 && history.size === 0) return 0;
    const union = new Set([...currentSet, ...history]);
    return [...currentSet].filter((value) => history.has(value)).length / union.size;
  };

  const scores = new Map<number, number>();
  for (const item of candidateItems) {
    const artifactId = Number(item.artifactItemId);
    scores.set(
      artifactId,
      0.55 * overlap(keywordsOf(snapshot, item).map((keyword) => keyword.name), historyKeywords) +
        0.3 * overlap(contextsOf(snapshot, item).map((context) => context.name), historyContexts) +
        0.15 * Number(historyCategories.has(item.categoryGroup)),
    );
  }
  return scores;
}

// --- Catalogue helpers -------------------------------------------------------

function selectedContextOut(snapshot: CatalogueSnapshot, context: CatalogueContext): ContextOut {
  const activeItemCount = snapshot.items.filter(
    (item) =>
      item.isActive &&
      snapshot.itemContexts.some(
        (link) =>
          Number(link.itemId) === Number(item.id) &&
          Number(link.contextId) === Number(context.id),
      ),
  ).length;
  return {
    id: stableId("context", context.name),
    name: context.name,
    group: context.groupName,
    description: context.description,
    active_item_count: activeItemCount,
  };
}

function contextsOf(snapshot: CatalogueSnapshot, item: CatalogueItem): CatalogueContext[] {
  const contextIds = new Set(
    snapshot.itemContexts
      .filter((link) => Number(link.itemId) === Number(item.id))
      .map((link) => Number(link.contextId)),
  );
  return snapshot.contexts.filter((context) => contextIds.has(Number(context.id)));
}

function keywordsOf(
  snapshot: CatalogueSnapshot,
  item: CatalogueItem,
): Array<{ id: number; name: string }> {
  const keywordIds = new Set(
    snapshot.itemKeywords
      .filter((link) => Number(link.itemId) === Number(item.id))
      .map((link) => Number(link.keywordId)),
  );
  return snapshot.keywords
    .filter((keyword) => keywordIds.has(Number(keyword.id)))
    .map((keyword) => ({ id: Number(keyword.id), name: keyword.name }));
}

function increment(counter: Map<string, number>, key: string): void {
  counter.set(key, (counter.get(key) ?? 0) + 1);
}

function topCounts(counter: Map<string, number>, limit: number): string[] {
  return [...counter.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, limit)
    .map(([name]) => name);
}

function internalIdFor(
  byArtifactId: Map<number, CatalogueItem>,
  artifactItemId: number,
): number {
  return Number(byArtifactId.get(artifactItemId)?.id ?? 0);
}

// --- Analytics persistence ---------------------------------------------------

/**
 * Persist one recommendation request plus its ranked results into the live
 * ``recommendation_requests`` / ``recommendation_results`` tables (the same
 * tables the legacy dashboard trend reads). Returns the persisted row id as
 * the public ``request_id``, or "" when persistence is unavailable — the
 * caller then falls back to a uuid exactly like the legacy service.
 */
async function recordRecommendation(options: {
  userId: number | null;
  userKey: string;
  contextInternalId: number;
  candidateCount: number;
  topK: number;
  method: string;
  fallback: boolean;
  metadata: Record<string, unknown>;
  results: Array<{
    internalItemId: number;
    rank: number;
    cbf: number;
    cf: number;
    hybrid: number;
    matchedKeywords: string[];
    explanation: string;
  }>;
  selectedKeywordInternalIds: number[];
}): Promise<string> {
  try {
    const dataSource = await getDataSource();
    let requestId = "";
    await dataSource.transaction(async (manager) => {
      const request = await manager.getRepository(RecommendationRequestEntity).save({
        userId: options.userId,
        selectedContextId: options.contextInternalId,
        candidateCount: options.candidateCount,
        topK: options.topK,
        method: options.method,
        metadataJson: JSON.stringify({
          ...options.metadata,
          fallback: options.fallback,
          user_key: options.userKey || null,
        }),
      });
      requestId = String(Number(request.id));
      if (options.selectedKeywordInternalIds.length > 0) {
        await manager.getRepository(RecommendationRequestSelectedKeywordEntity).save(
          options.selectedKeywordInternalIds.map((keywordId) => ({
            requestId: Number(request.id),
            keywordId,
          })),
        );
      }
      if (options.results.length > 0) {
        await manager.getRepository(RecommendationResultEntity).save(
          options.results.map((result) => ({
            requestId: Number(request.id),
            itemId: result.internalItemId,
            rank: result.rank,
            cbfScore: result.cbf,
            cfScore: result.cf,
            hybridScore: result.hybrid,
            isContextValid: true,
            matchedKeywordsJson: JSON.stringify(result.matchedKeywords),
            explanation: result.explanation,
          })),
        );
      }
      const effectiveUserKey =
        options.userKey || (options.userId ? `user:${options.userId}` : "anon:visitor");
      await manager.getRepository(InteractionLogEntity).save({
        userKey: effectiveUserKey,
        itemId: null,
        actionType: "search",
        metadataJson: JSON.stringify({
          context_id: options.contextInternalId,
          keyword_ids: options.selectedKeywordInternalIds,
          candidate_count: options.candidateCount,
          top_k: options.topK,
          method: options.method,
        }),
        recommendationRequestId: Number(request.id),
      });
    });
    return requestId;
  } catch {
    // Telemetry writes must never break the recommendation response.
    return "";
  }
}

// --- Configuration -----------------------------------------------------------

// fallow-ignore-next-line complexity -- Env parsing keeps the empty-string "no cap" and integer bounds explicit.
function eligibilityCaps(): { maxCands?: number; minCands: number } {
  const rawMax = process.env.RECSYS_MAX_CANDS ?? "";
  const parsedMax = Number(rawMax);
  const maxCands =
    rawMax !== "" && Number.isSafeInteger(parsedMax) && parsedMax > 0
      ? parsedMax
      : undefined;
  const minCands = Math.max(1, envInt("RECSYS_MIN_CANDS", 10));
  return { maxCands, minCands };
}

function envFloat(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = Number(raw);
  return raw !== undefined && Number.isFinite(parsed) ? parsed : fallback;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = Number(raw);
  return raw !== undefined && Number.isSafeInteger(parsed) ? parsed : fallback;
}
