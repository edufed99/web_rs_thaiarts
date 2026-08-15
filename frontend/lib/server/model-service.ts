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
  const serviceUrl = (
    process.env.PRIVATE_MODEL_SERVICE_URL || "http://model-service:8001"
  ).replace(/\/+$/, "");
  const credential = process.env.MODEL_SERVICE_SHARED_SECRET?.trim();
  if (!credential) {
    throw new ModelServiceUnavailableError(
      "The Internal Service Credential is not configured.",
    );
  }
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

// fallow-ignore-next-line complexity -- Environment input must be an integer inside operational timeout bounds.
function boundedTimeout(raw: string | undefined): number {
  const parsed = Number(raw ?? 5000);
  return Number.isSafeInteger(parsed) && parsed >= 100 && parsed <= 30_000
    ? parsed
    : 5000;
}
