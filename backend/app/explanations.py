"""
explanations.py — Port of recommender/explanations.py.

Generate natural-language Thai explanations for a recommendation.
"""
from __future__ import annotations

from typing import Iterable, List


def build_explanation(
    item: dict,
    context_name: str,
    selected_keyword_names: Iterable[str],
    cbf_score: float,
    cf_score: float,
    matched_keywords: List[str],
) -> str:
    """
    Returns a concise Thai-language reason for the recommendation.
    """
    has_context = bool(str(context_name or "").strip())
    has_keyword_match = bool(matched_keywords)
    has_keyword_query = bool([name for name in selected_keyword_names if str(name).strip()])
    has_content_signal = cbf_score > 0
    has_history_signal = cf_score > 0

    if has_context and has_keyword_match:
        main_reason = "ตรงบริบทและคำสำคัญ"
    elif has_context and has_keyword_query and has_content_signal:
        main_reason = "ตรงบริบทและใกล้เคียงคำสำคัญ"
    elif has_keyword_match:
        main_reason = "ตรงคำสำคัญ"
    elif has_context:
        main_reason = "ตรงบริบท"
    elif has_content_signal:
        main_reason = "ใกล้เคียงคำสำคัญ"
    elif has_history_signal:
        main_reason = "คล้ายกับความสนใจในอดีต"
    else:
        main_reason = "เหมาะกับเงื่อนไขที่เลือก"

    details: List[str] = []
    if has_context:
        details.append(f'บริบท: "{context_name}"')
    if has_keyword_match:
        shown_keywords = ", ".join(f'"{w}"' for w in matched_keywords[:3])
        details.append(f"คำสำคัญ: {shown_keywords}")

    detail_text = f" ({'; '.join(details)})" if details else ""
    history_text = (
        " และคล้ายกับความสนใจในอดีต"
        if has_history_signal and main_reason != "คล้ายกับความสนใจในอดีต"
        else ""
    )
    return f"แนะนำชุดนี้เพราะ{main_reason}{detail_text}{history_text}."


def _taxonomy_summaries(item: dict, matched_keywords: List[str]) -> List[str]:
    paths = item.get("taxonomy_paths") or []
    seen = set()
    out: List[str] = []
    for path in paths:
        if path and path not in seen:
            seen.add(path)
            out.append(path)
    return out


def _content_signal_phrase(score: float) -> str:
    if score >= 0.75:
        return "ใกล้เคียงคำสำคัญมาก"
    if score >= 0.45:
        return "ใกล้เคียงคำสำคัญปานกลาง"
    if score > 0:
        return "มีสัญญาณใกล้เคียงคำสำคัญ"
    return ""


def _collaborative_signal_phrase(score: float) -> str:
    if score >= 0.65:
        return "คล้ายกับความสนใจในอดีตชัดเจน"
    if score > 0:
        return "คล้ายกับความสนใจในอดีต"
    return ""
