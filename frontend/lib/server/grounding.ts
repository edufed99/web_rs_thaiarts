/**
 * grounding.ts — Integrated 3-Stage Grounding & Semantic Engine.
 *
 * Implements the methodology from the paper §2.3, §3.1.1, §3.1.2, §3.1.3:
 * 1. Layer A (Step 3 Grounding): Domain-aware Lexical Matcher with CUSTOM_WORDS.
 * 2. Layer B (Step 1 & 2): Gemini-assisted Stopword Filtering & Taxonomy Classification.
 * 3. Layer C: UI Review & Selection Gate.
 */

import {
  CUSTOM_WORDS,
  GENERIC_TERMS_PREDEFINED,
  domainAwareTokenize,
  filterStopwordsWithGemini,
  normalizeThaiText,
} from "./semantic-pipeline";
import {
  CANONICAL_TAXONOMY_PATHS,
  classifyNewKeywordsWithGemini,
} from "./taxonomy-classifier";
import type { KeywordProposal } from "@/lib/types";

const STOPWORD_PATHS = new Set(["stopword", "sw"]);
const JACCARD_MIN = 0.34;

export interface GroundingVocabEntry {
  id: number;
  name: string;
  taxonomyPath: string;
}

/**
 * Layer A: Rule-based exact_token matcher (Paper §3.1.3)
 */
export function autoGroundKeywords(
  item: { name?: string; description?: string; category_group?: string; performance_type?: string },
  vocab: GroundingVocabEntry[],
): number[] {
  if (!vocab || vocab.length === 0) return [];
  const textRaw = [item.name, item.description, item.category_group, item.performance_type]
    .map((value) => value ?? "")
    .join(" ");
  const text = normalizeThaiText(textRaw);
  if (!text) return [];

  const vocabNames = vocab.map((v) => v.name);
  const itemTokens = domainAwareTokenize(text, vocabNames);

  const seen = new Set<number>();
  const matched: number[] = [];

  for (const entry of vocab) {
    if (STOPWORD_PATHS.has(entry.taxonomyPath.toLocaleLowerCase())) continue;
    if (seen.has(entry.id)) continue;
    if (GENERIC_TERMS_PREDEFINED.has(entry.name.trim())) continue;

    const kwNorm = normalizeThaiText(entry.name);
    if (!kwNorm || kwNorm.length < 2) continue;
    const kwTokens = domainAwareTokenize(entry.name, [entry.name]);

    // 1. Exact token match
    if (itemTokens.has(kwNorm)) {
      seen.add(entry.id);
      matched.push(entry.id);
      continue;
    }
    // 2. Substring match
    if (text.includes(kwNorm)) {
      seen.add(entry.id);
      matched.push(entry.id);
      continue;
    }
    // 3. Token-set Jaccard overlap
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

/**
 * Extract candidate phrase fragments from text that are not yet matched in the vocabulary.
 */
function extractUnmatchedCandidatePhrases(
  text: string,
  matchedVocabNames: Set<string>,
): string[] {
  const normText = normalizeThaiText(text);
  if (!normText) return [];

  // Match words from CUSTOM_WORDS and potential domain phrases
  const candidates = new Set<string>();

  for (const cw of CUSTOM_WORDS) {
    const normCw = normalizeThaiText(cw);
    if (normCw && normText.includes(normCw) && !matchedVocabNames.has(normCw)) {
      if (!GENERIC_TERMS_PREDEFINED.has(normCw)) {
        candidates.add(cw);
      }
    }
  }

  // Also extract space-delimited segments of 3-30 chars that look like domain terms
  const rawSegments = text.split(/[\s,.;:()\[\]{}'"\-–—\/]+/);
  for (const seg of rawSegments) {
    const s = seg.trim();
    if (s.length >= 3 && s.length <= 30 && !GENERIC_TERMS_PREDEFINED.has(s)) {
      const normS = normalizeThaiText(s);
      if (!matchedVocabNames.has(normS) && !candidates.has(s)) {
        candidates.add(s);
      }
    }
  }

  return Array.from(candidates).slice(0, 40); // Cap batch size for Gemini
}

/**
 * End-to-end Semantic Pipeline Grounding (Step 1 -> Step 2 -> Step 3)
 */
export async function executeSemanticPipelineGrounding(
  item: { name: string; description?: string; category_group?: string; performance_type?: string },
  vocab: GroundingVocabEntry[],
): Promise<KeywordProposal[]> {
  const proposals: KeywordProposal[] = [];
  const matchedVocabNames = new Set<string>();

  // 1. Layer A (Grounding from Master 584 Vocab)
  const layerAIds = autoGroundKeywords(item, vocab);
  for (const id of layerAIds) {
    const entry = vocab.find((v) => v.id === id);
    if (entry) {
      matchedVocabNames.add(normalizeThaiText(entry.name));
      proposals.push({
        id: entry.id,
        name: entry.name,
        source: "auto",
        confidence: 1.0,
        taxonomy_path: entry.taxonomyPath,
        is_new: false,
      });
    }
  }

  // 2. Step 1 (Stopword Filtering) & Step 2 (Taxonomy Classification) for Candidate Words
  const fullText = `${item.name} ${item.description || ""} ${item.category_group || ""} ${item.performance_type || ""}`;
  const candidatePhrases = extractUnmatchedCandidatePhrases(fullText, matchedVocabNames);

  if (candidatePhrases.length > 0 && process.env.GEMINI_API_KEY?.trim()) {
    try {
      // Step 1: Filter Stopwords
      const nonStopwords = await filterStopwordsWithGemini(candidatePhrases, item);
      // Remove any that happen to match existing proposals
      const newNonStopwords = nonStopwords.filter(
        (w) => !matchedVocabNames.has(normalizeThaiText(w)),
      );

      if (newNonStopwords.length > 0) {
        // Step 2: Classify into 23 Taxonomy Paths
        const classifications = await classifyNewKeywordsWithGemini(newNonStopwords);
        let tempId = -1;
        for (const [word, cls] of classifications.entries()) {
          proposals.push({
            id: tempId--,
            name: word,
            source: "llm",
            confidence: cls.confidence,
            taxonomy_path: cls.fullPath,
            is_new: true,
          });
        }
      }
    } catch (e) {
      console.warn("[grounding] Semantic pipeline AI step encountered error:", e);
    }
  }

  return proposals;
}
