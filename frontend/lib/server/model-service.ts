interface SimilarityCandidate {
  artifact_item_id: number;
  score: number;
}

interface SimilarityResponse {
  ranked_candidates: SimilarityCandidate[];
}

export class ModelServiceUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelServiceUnavailableError";
  }
}

// fallow-ignore-next-line complexity -- Internal-call configuration, timeout, authentication, and response failures are distinct trust-boundary checks.
export async function rankSimilarArtifactIds(options: {
  referenceArtifactItemId: number;
  candidateArtifactItemIds: number[];
  limit: number;
}): Promise<number[]> {
  if (options.candidateArtifactItemIds.length === 0) return [];
  const serviceUrl = modelServiceUrl();
  const credential = modelServiceCredential();
  const timeoutMs = boundedTimeout(process.env.MODEL_SERVICE_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${serviceUrl}/internal/v1/similarity`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${credential}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        reference_artifact_item_id: options.referenceArtifactItemId,
        candidate_artifact_item_ids: options.candidateArtifactItemIds,
        limit: options.limit,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new ModelServiceUnavailableError(
      error instanceof Error ? error.message : "Private Model Service request failed.",
    );
  }
  if (!response.ok) {
    throw new ModelServiceUnavailableError(
      `Private Model Service returned HTTP ${response.status}.`,
    );
  }

  let body: Partial<SimilarityResponse>;
  try {
    body = (await response.json()) as Partial<SimilarityResponse>;
  } catch {
    throw new ModelServiceUnavailableError("Private Model Service returned invalid JSON.");
  }
  return validateSimilarityResponse(body, options.candidateArtifactItemIds, options.limit);
}

// fallow-ignore-next-line complexity -- Every clause rejects a distinct malformed or untrusted model response condition.
function validateSimilarityResponse(
  body: Partial<SimilarityResponse>,
  candidates: number[],
  limit: number,
): number[] {
  if (!Array.isArray(body.ranked_candidates)) {
    throw new ModelServiceUnavailableError("Private Model Service returned an invalid response.");
  }
  const allowed = new Set(candidates);
  const seen = new Set<number>();
  const ranked: number[] = [];
  for (const row of body.ranked_candidates) {
    if (
      !row ||
      !Number.isSafeInteger(row.artifact_item_id) ||
      !Number.isFinite(row.score) ||
      !allowed.has(row.artifact_item_id) ||
      seen.has(row.artifact_item_id)
    ) {
      throw new ModelServiceUnavailableError("Private Model Service returned an invalid candidate.");
    }
    seen.add(row.artifact_item_id);
    ranked.push(row.artifact_item_id);
  }
  if (ranked.length !== Math.min(limit, candidates.length)) {
    throw new ModelServiceUnavailableError("Private Model Service returned an incomplete ranking.");
  }
  return ranked;
}

// --- Version 1 inference contract (docs/private-model-service.md) ----------
//
// The Application Backend builds the Eligible Candidate Set and maps every
// identifier into immutable Artifact Item Identifier space before calling
// the Private Model Service. The scorer never sees PostgreSQL primary keys.

export interface InferenceScoreComponents {
  cbf: number;
  cf: number;
  final: number;
}

export interface InferenceRankedCandidate {
  artifact_item_id: number;
  scores: InferenceScoreComponents;
}

export interface InferencePersonalizationInputs {
  context_name: string;
  keyword_names: string[];
  positive_history: Array<{ artifact_item_id: number; rating_weight: number }>;
  negative_ratings: Array<{ artifact_item_id: number; rating: number }>;
}

interface InferenceResponse {
  ranked_candidates: InferenceRankedCandidate[];
}

const INFERENCE_RETRY_BACKOFF_MS = 200;
const INFERENCE_MAX_ATTEMPTS = 2;

/**
 * Score exactly the supplied Eligible Candidate Set through the Private
 * Model Service. The service returns ranked Artifact Item Identifiers with
 * component scores (cbf / cf / final); application enrichment stays here.
 *
 * Retry policy: the first attempt is retried once when it fails at the
 * network layer (connect refused, timeout, aborted) or the service answers
 * HTTP >= 500. Validation failures and 4xx responses are never retried.
 * Every attempt runs under the bounded timeout, so the whole call completes
 * within roughly ``2 * timeout`` milliseconds worst case.
 */
// fallow-ignore-next-line complexity -- Timeout, retry, authentication, and validation failures are distinct trust-boundary checks.
export async function rankInferenceCandidates(options: {
  eligibleCandidateArtifactItemIds: number[];
  personalization: InferencePersonalizationInputs;
  topK: number;
}): Promise<InferenceRankedCandidate[]> {
  if (options.eligibleCandidateArtifactItemIds.length === 0) return [];
  const serviceUrl = modelServiceUrl();
  const credential = modelServiceCredential();
  const timeoutMs = boundedTimeout(process.env.MODEL_SERVICE_TIMEOUT_MS);
  const payload = JSON.stringify({
    eligible_candidate_ids: options.eligibleCandidateArtifactItemIds,
    personalization: options.personalization,
    top_k: options.topK,
  });

  let lastError: unknown;
  for (let attempt = 0; attempt < INFERENCE_MAX_ATTEMPTS; attempt += 1) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, INFERENCE_RETRY_BACKOFF_MS));
    }
    let response: Response;
    try {
      response = await fetch(`${serviceUrl}/internal/v1/inference`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${credential}`,
          "Content-Type": "application/json",
        },
        body: payload,
        cache: "no-store",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      lastError = error;
      continue; // network failure or timeout — retry once
    }
    if (response.status >= 500) {
      lastError = new Error(`Private Model Service returned HTTP ${response.status}.`);
      continue; // transient service failure — retry once
    }
    if (!response.ok) {
      throw new ModelServiceUnavailableError(
        `Private Model Service returned HTTP ${response.status}.`,
      );
    }
    let body: Partial<InferenceResponse>;
    try {
      body = (await response.json()) as Partial<InferenceResponse>;
    } catch {
      throw new ModelServiceUnavailableError("Private Model Service returned invalid JSON.");
    }
    return validateInferenceResponse(body, options.eligibleCandidateArtifactItemIds);
  }
  throw new ModelServiceUnavailableError(
    lastError instanceof Error
      ? lastError.message
      : "Private Model Service request failed after retries.",
  );
}

// fallow-ignore-next-line complexity -- Every clause rejects a distinct malformed or untrusted model response condition.
function validateInferenceResponse(
  body: Partial<InferenceResponse>,
  eligibleIds: number[],
): InferenceRankedCandidate[] {
  if (!Array.isArray(body.ranked_candidates)) {
    throw new ModelServiceUnavailableError("Private Model Service returned an invalid response.");
  }
  const allowed = new Set(eligibleIds);
  const seen = new Set<number>();
  const ranked: InferenceRankedCandidate[] = [];
  for (const row of body.ranked_candidates) {
    if (
      !row ||
      !Number.isSafeInteger(row.artifact_item_id) ||
      !row.scores ||
      !Number.isFinite(row.scores.cbf) ||
      !Number.isFinite(row.scores.cf) ||
      !Number.isFinite(row.scores.final) ||
      !allowed.has(row.artifact_item_id) ||
      seen.has(row.artifact_item_id)
    ) {
      throw new ModelServiceUnavailableError("Private Model Service returned an invalid candidate.");
    }
    seen.add(row.artifact_item_id);
    ranked.push({
      artifact_item_id: row.artifact_item_id,
      scores: { cbf: row.scores.cbf, cf: row.scores.cf, final: row.scores.final },
    });
  }
  return ranked;
}

function modelServiceUrl(): string {
  return (
    process.env.PRIVATE_MODEL_SERVICE_URL || "http://backend:8001"
  ).replace(/\/+$/, "");
}

function modelServiceCredential(): string {
  const credential = process.env.MODEL_SERVICE_SHARED_SECRET?.trim();
  if (!credential) {
    throw new ModelServiceUnavailableError(
      "The Internal Service Credential is not configured.",
    );
  }
  return credential;
}

// fallow-ignore-next-line complexity -- Environment input must be an integer inside operational timeout bounds.
function boundedTimeout(raw: string | undefined): number {
  const parsed = Number(raw ?? 5000);
  return Number.isSafeInteger(parsed) && parsed >= 100 && parsed <= 30_000
    ? parsed
    : 5000;
}
