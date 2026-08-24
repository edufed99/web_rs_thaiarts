/**
 * grounding.ts — Integrated 3-Stage Grounding & Semantic Engine.
 *
 * Implements the methodology from the paper §2.3, §3.1.1, §3.1.2, §3.1.3:
 * 1. Layer A: Exact token and substring matching against Master Vocab.
 * 2. Layer B: Two-Tier Gemini recommendation from Master Vocab + New Non-stopword classification.
 * 3. Layer C: UI Review & Selection Gate.
 */

import {
  CUSTOM_WORDS,
  GENERIC_TERMS_PREDEFINED,
  cleanKeywordString,
  domainAwareTokenize,
  recommendTwoTierKeywordsWithGemini,
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
 * End-to-end Semantic Pipeline Grounding (Step 1 -> Step 2 -> Step 3)
 */
export async function executeSemanticPipelineGrounding(
  item: { name: string; description?: string; category_group?: string; performance_type?: string },
  vocab: GroundingVocabEntry[],
): Promise<KeywordProposal[]> {
  const proposals: KeywordProposal[] = [];
  const seenNormalizedNames = new Set<string>();

  // Lookup map from normalized name to vocab entry
  const vocabByNormName = new Map<string, GroundingVocabEntry>();
  for (const v of vocab) {
    vocabByNormName.set(normalizeThaiText(v.name), v);
  }

  // 1. Layer A: Exact & Substring Match from Master Vocab
  const layerAIds = autoGroundKeywords(item, vocab);
  for (const id of layerAIds) {
    const entry = vocab.find((v) => v.id === id);
    if (entry) {
      const norm = normalizeThaiText(entry.name);
      if (!seenNormalizedNames.has(norm)) {
        seenNormalizedNames.add(norm);
        proposals.push({
          id: entry.id,
          name: cleanKeywordString(entry.name),
          source: "auto",
          confidence: 1.0,
          taxonomy_path: entry.taxonomyPath,
          is_new: false,
        });
      }
    }
  }

  // 2. Layer B: Two-Tier Gemini Recommendation & New Keyword Classification
  if (process.env.GEMINI_API_KEY?.trim()) {
    try {
      const masterWordsList = vocab.map((v) => v.name);
      const aiResult = await recommendTwoTierKeywordsWithGemini(item, masterWordsList);

      // (A) Process AI Recommended Master Keywords
      for (const recMaster of aiResult.master_keywords) {
        const norm = normalizeThaiText(recMaster);
        if (!seenNormalizedNames.has(norm)) {
          const matchedEntry = vocabByNormName.get(norm);
          if (matchedEntry) {
            seenNormalizedNames.add(norm);
            proposals.push({
              id: matchedEntry.id,
              name: cleanKeywordString(matchedEntry.name),
              source: "auto",
              confidence: 0.95,
              taxonomy_path: matchedEntry.taxonomyPath,
              is_new: false,
            });
          }
        }
      }

      // (B) Process AI Discovered New Keywords
      const newKeywordsToClassify: string[] = [];
      for (const rawNew of aiResult.new_keywords) {
        const clean = cleanKeywordString(rawNew);
        const norm = normalizeThaiText(clean);
        if (norm.length >= 2 && !seenNormalizedNames.has(norm) && !GENERIC_TERMS_PREDEFINED.has(clean)) {
          // If it matches a master word in DB, treat as master word instead
          const existingEntry = vocabByNormName.get(norm);
          if (existingEntry) {
            seenNormalizedNames.add(norm);
            proposals.push({
              id: existingEntry.id,
              name: cleanKeywordString(existingEntry.name),
              source: "auto",
              confidence: 0.95,
              taxonomy_path: existingEntry.taxonomyPath,
              is_new: false,
            });
          } else {
            seenNormalizedNames.add(norm);
            newKeywordsToClassify.push(clean);
          }
        }
      }

      if (newKeywordsToClassify.length > 0) {
        const classifications = await classifyNewKeywordsWithGemini(newKeywordsToClassify);
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
      console.warn("[grounding] Semantic pipeline AI recommendation encountered error:", e);
    }
  }

  return proposals;
}
