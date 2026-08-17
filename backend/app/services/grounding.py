"""
services/grounding.py — Layer A + Layer B + Layer C keyword grounding.

Mirrors the methodology in the thesis paper §2.3 + §3.1.3:

* **Layer A** — rule-based grounding: exact token, substring, and
  token-set Jaccard matching between item text and the existing
  vocabulary. Conservative (paper F1 = 0.886).
* **Layer B** — Gemini-assisted grounding: ask the LLM to suggest at
  most ``max_suggest`` keywords from the existing vocabulary that best
  describe the item. Optional; falls back to ``[]`` when the API key is
  missing or ``grounding_use_llm=False``.
* **Layer C** — handled by the admin UI: the user edits the proposed
  keyword list before committing. The backend exposes
  ``KeywordProposal`` + ``ItemCommit`` schemas for that flow.

The vocabulary is built lazily from the in-memory artifact's catalog
via ``load_vocab`` and cached as a module singleton.
"""
from __future__ import annotations

import json
import logging
import re
import unicodedata
from typing import Dict, List, NamedTuple, Optional, Set

from ..core.config import get_settings
from ..model_loader import ArtifactLoader, get_singleton


logger = logging.getLogger("recsys.grounding")


# --- Vocab entry ------------------------------------------------------------


class VocabEntry(NamedTuple):
    """A single keyword in the universe of selectable vocabulary."""

    id: int
    name: str
    taxonomy_path: str = ""


# --- Vocab cache ------------------------------------------------------------


_vocab_cache: Optional[List[VocabEntry]] = None
_vocab_by_name: Dict[str, VocabEntry] = {}


# taxonomy_paths the paper explicitly excludes (stopword category).
_STOPWORD_PATHS = {"stopword", "sw"}


def load_vocab(loader: ArtifactLoader) -> List[VocabEntry]:
    """Build the deduplicated keyword universe from the artifact.

    Reads ``loader.items["keyword_names"]`` and the parallel
    ``taxonomy_paths`` column. Cached so repeated ingest calls share
    the same VocabEntry objects.

    Synthetic corpora may have non-integer ids — we only emit ids that
    fit in ``int`` (int64). Entries with no id column are skipped.
    """
    global _vocab_cache
    if _vocab_cache is not None:
        return _vocab_cache
    if loader is None or loader.items is None:
        return []

    items = loader.items
    has_kw = "keyword_names" in items.columns
    has_tax = "taxonomy_paths" in items.columns
    if not has_kw:
        _vocab_cache = []
        return _vocab_cache

    entries: Dict[str, VocabEntry] = {}
    # The artifact assigns synthetic ids when running with --synthetic-embeddings;
    # we derive a stable id per name via stable_id("keyword", name) so the
    # proposals survive across builds.
    from ._ids import stable_id

    for idx in range(len(items)):
        kws = items.iloc[idx].get("keyword_names") or []
        taxs = items.iloc[idx].get("taxonomy_paths") if has_tax else None
        if not isinstance(kws, (list, tuple)):
            continue
        if not taxs or not isinstance(taxs, (list, tuple)):
            taxs = [""] * len(kws)
        for kw_name, tax_path in zip(kws, taxs):
            if not isinstance(kw_name, str) or not kw_name.strip():
                continue
            name = kw_name.strip()
            tax = (tax_path or "").strip()
            if tax.lower() in _STOPWORD_PATHS:
                continue
            key = name.lower()
            if key in entries:
                continue
            entries[key] = VocabEntry(
                id=stable_id("keyword", name),
                name=name,
                taxonomy_path=tax,
            )
    _vocab_cache = list(entries.values())
    _vocab_by_name.clear()
    _vocab_by_name.update({v.name.lower(): v for v in _vocab_cache})
    return _vocab_cache


def reset_vocab_cache() -> None:
    """Drop the vocab cache. Test helper for ``ArtifactLoader`` reload."""
    global _vocab_cache
    _vocab_cache = None
    _vocab_by_name.clear()


# --- Tokenisation -----------------------------------------------------------


def _normalize(text: str) -> str:
    if not isinstance(text, str):
        return ""
    text = unicodedata.normalize("NFKC", text).strip().lower()
    # Strip Thai diacritics (่-์) and zero-width chars.
    text = re.sub(r"[่-์​-‏]", "", text)
    return text


def _tokenize_thai(text: str) -> Set[str]:
    """Tokenise Thai text into a set of normalised tokens.

    Uses ``pythainlp.word_tokenize(..., engine="newmm")`` when available;
    falls back to whitespace split if pythainlp isn't installed (dev
    sandbox without network).
    """
    text = _normalize(text)
    if not text:
        return set()
    try:  # pragma: no cover — exercised when pythainlp is installed
        from pythainlp.tokenize import word_tokenize  # type: ignore

        return {tok for tok in word_tokenize(text, engine="newmm") if tok}
    except Exception:
        return {tok for tok in text.split() if tok}


# --- Layer A ----------------------------------------------------------------


# Minimum Jaccard threshold (paper's "high-precision lexical evidence" — at
# 95 threshold only exact matches and token-set matches pass; we use 0.34
# for token-set to capture small-vocab items).
_JACCARD_MIN = 0.34


def auto_ground_keywords(
    item: Dict,
    vocab: List[VocabEntry],
    *,
    jaccard_min: float = _JACCARD_MIN,
) -> List[int]:
    """Layer A: rule-based auto-ground. Returns deduplicated vocab ids.

    Three matchers run, in order of strictness:

    1. **Exact token** — vocab.name appears as a token in item name+description.
    2. **Substring** — vocab.name is a substring of item text (catches
       multi-word compound keywords like "ชุดไทย" or "การแสดงนาฏศิลป์").
    3. **Token-set Jaccard** — ``|kw_tokens ∩ item_tokens| /
       |kw_tokens ∪ item_tokens| >= jaccard_min``.

    Stopword entries (taxonomy_path in ``_STOPWORD_PATHS``) are skipped.
    """
    if not vocab or not isinstance(item, dict):
        return []
    text_raw = " ".join(
        str(item.get(k, "") or "")
        for k in ("name", "description", "category_group", "performance_type")
    )
    text = _normalize(text_raw)
    if not text:
        return []
    item_tokens = _tokenize_thai(text)

    seen: Set[int] = set()
    matched: List[int] = []

    for entry in vocab:
        if entry.taxonomy_path.lower() in _STOPWORD_PATHS:
            continue
        if entry.id in seen:
            continue
        kw_norm = _normalize(entry.name)
        if not kw_norm:
            continue
        kw_tokens = _tokenize_thai(entry.name)

        # 1. Exact token match.
        if kw_norm in item_tokens:
            seen.add(entry.id)
            matched.append(entry.id)
            continue
        # 2. Substring match (covers multi-word keywords).
        if kw_norm in text:
            seen.add(entry.id)
            matched.append(entry.id)
            continue
        # 3. Token-set Jaccard.
        if kw_tokens and item_tokens:
            inter = len(kw_tokens & item_tokens)
            union = len(kw_tokens | item_tokens)
            if union and (inter / union) >= jaccard_min:
                seen.add(entry.id)
                matched.append(entry.id)
    return matched


# --- Layer B ----------------------------------------------------------------


def _call_gemini(prompt: str, model_name: str, api_key: str) -> str:
    """Call Gemini and return the raw response text.

    Imported lazily so the rest of the module loads without the dependency.
    """
    import google.generativeai as genai  # type: ignore

    genai.configure(api_key=api_key)
    model = genai.GenerativeModel(model_name)
    resp = model.generate_content(
        prompt,
        generation_config={
            "temperature": 0.0,
            "response_mime_type": "application/json",
        },
    )
    return resp.text or ""


_GEMINI_PROMPT = """You are an expert curator of Thai performing-arts metadata.

Given an item and the controlled vocabulary, return at most {max_suggest} vocabulary
names that culturally and contextually describe the item. Only return names from
the vocabulary — do not invent new keywords. If nothing matches, return an empty
array.

Item name: {name}
Item description: {description}
Category group: {category}
Performance type: {ptype}

Vocabulary (name — taxonomy path):
{vocab}

Respond strictly as JSON in this shape:
{{"names": ["<vocab name>", ...]}}
"""


def llm_ground_keywords(
    item: Dict,
    vocab: List[VocabEntry],
    *,
    max_suggest: int = 8,
) -> List[int]:
    """Layer B: ask Gemini for keyword suggestions over the existing vocab.

    Returns ``[]`` if the API key is missing or
    ``settings.grounding_use_llm=False``.
    """
    settings = get_settings()
    if not settings.grounding_use_llm or not settings.gemini_api_key:
        return []
    if not vocab or not isinstance(item, dict):
        return []

    # Cap the vocab we ship to Gemini — the catalog has hundreds of keywords.
    sample = vocab[:200]
    vocab_block = "\n".join(
        f"- {v.name} — {v.taxonomy_path or '(no path)'}" for v in sample
    )
    prompt = _GEMINI_PROMPT.format(
        max_suggest=max_suggest,
        name=item.get("name", "") or "",
        description=item.get("description", "") or "",
        category=item.get("category_group", "") or "",
        ptype=item.get("performance_type", "") or "",
        vocab=vocab_block,
    )
    try:
        raw = _call_gemini(prompt, settings.gemini_model, settings.gemini_api_key)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Gemini grounding failed: %s", exc)
        return []
    try:
        parsed = json.loads(raw)
        names = parsed.get("names", []) if isinstance(parsed, dict) else []
    except (ValueError, TypeError):
        logger.warning("Gemini grounding returned non-JSON: %r", raw[:200])
        return []
    if not isinstance(names, list):
        return []

    matched: List[int] = []
    seen: Set[int] = set()
    for n in names:
        if not isinstance(n, str):
            continue
        entry = _vocab_by_name.get(_normalize(n)) or _vocab_by_name.get(n.strip().lower())
        if entry is None or entry.id in seen:
            continue
        seen.add(entry.id)
        matched.append(entry.id)
        if len(matched) >= max_suggest:
            break
    return matched


# --- Combined entry point ---------------------------------------------------


def ground_keywords(
    item: Dict,
    vocab: List[VocabEntry],
    *,
    use_llm: bool = True,
    jaccard_min: float = _JACCARD_MIN,
    max_llm: int = 8,
) -> Dict[str, List[int]]:
    """Run Layer A then Layer B; return per-layer ids plus the merged set.

    ``merged_ids`` preserves Layer A first (stable, deterministic) followed
    by Layer B additions.
    """
    layer_a_ids = auto_ground_keywords(item, vocab, jaccard_min=jaccard_min)
    layer_b_ids = llm_ground_keywords(item, vocab, max_suggest=max_llm) if use_llm else []
    seen: Set[int] = set(layer_a_ids)
    merged = list(layer_a_ids)
    for kid in layer_b_ids:
        if kid in seen:
            continue
        seen.add(kid)
        merged.append(kid)
    return {
        "layer_a_ids": layer_a_ids,
        "layer_b_ids": layer_b_ids,
        "merged_ids": merged,
    }


def vocab_for_loader(loader: Optional[ArtifactLoader] = None) -> List[VocabEntry]:
    """Convenience: load vocab from the singleton loader if not provided."""
    if loader is None:
        loader = get_singleton()
    return load_vocab(loader)