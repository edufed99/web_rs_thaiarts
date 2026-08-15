/**
 * Layer A rule-based keyword grounding (issue #8).
 *
 * TypeScript port of ``backend/app/services/grounding.py::auto_ground_keywords``
 * — the high-precision lexical matchers the thesis calls Layer A. The
 * vocabulary is the live ``keywords`` table (with taxonomy paths resolved
 * through ``taxonomy_nodes``) instead of the artifact loader's cached
 * vocab, which keeps grounding consistent with everything else the
 * Application Backend reads. Layer B (LLM suggestions) is not ported:
 * it was optional in the legacy service and the admin can add keywords
 * manually at review time.
 */

const STOPWORD_PATHS = new Set(["stopword", "sw"]);

// Paper's "high-precision lexical evidence" threshold.
const JACCARD_MIN = 0.34;

export interface GroundingVocabEntry {
  id: number;
  name: string;
  taxonomyPath: string;
}

function normalizeText(text: string): string {
  return (text ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase()
    // Strip Thai diacritics (่-์) and zero-width chars, mirroring the
    // legacy regex ``[่-์​-‏]``.
    .replace(/[่-์​-‏]/g, "")
    .trim();
}

function tokenizeThai(text: string): Set<string> {
  const normalized = normalizeText(text);
  if (!normalized) return new Set();
  // The legacy fallback (no pythainlp) splits on whitespace; the JS
  // port has no Thai word-segmenter, so it matches that fallback.
  return new Set(normalized.split(/\s+/).filter(Boolean));
}

/**
 * Layer A matchers, in order of strictness:
 * 1. exact token, 2. substring, 3. token-set Jaccard >= 0.34.
 * Returns deduplicated vocabulary ids.
 */
// fallow-ignore-next-line complexity -- Three matcher tiers plus stopword/duplicate guards mirror the legacy Layer A.
export function autoGroundKeywords(
  item: { name?: string; description?: string; category_group?: string; performance_type?: string },
  vocab: GroundingVocabEntry[],
): number[] {
  if (!vocab || vocab.length === 0) return [];
  const textRaw = [item.name, item.description, item.category_group, item.performance_type]
    .map((value) => value ?? "")
    .join(" ");
  const text = normalizeText(textRaw);
  if (!text) return [];
  const itemTokens = tokenizeThai(text);

  const seen = new Set<number>();
  const matched: number[] = [];
  for (const entry of vocab) {
    if (STOPWORD_PATHS.has(entry.taxonomyPath.toLocaleLowerCase())) continue;
    if (seen.has(entry.id)) continue;
    const kwNorm = normalizeText(entry.name);
    if (!kwNorm) continue;
    const kwTokens = tokenizeThai(entry.name);

    if (itemTokens.has(kwNorm)) {
      seen.add(entry.id);
      matched.push(entry.id);
      continue;
    }
    if (text.includes(kwNorm)) {
      seen.add(entry.id);
      matched.push(entry.id);
      continue;
    }
    if (kwTokens.size > 0 && itemTokens.size > 0) {
      let inter = 0;
      for (const token of kwTokens) if (itemTokens.has(token)) inter += 1;
      const union = kwTokens.size + itemTokens.size - inter;
      if (union > 0 && inter / union >= JACCARD_MIN) {
        seen.add(entry.id);
        matched.push(entry.id);
      }
    }
  }
  return matched;
}
