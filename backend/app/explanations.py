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
    history_reason: str = "",
) -> str:
    """
    Returns a concise Thai-language reason for the recommendation.
    """
    has_context = bool(str(context_name or "").strip())
    has_keyword_match = bool(matched_keywords)
    has_keyword_query = bool([name for name in selected_keyword_names if str(name).strip()])
    has_content_signal = cbf_score > 0
    # A positive CF score is not sufficient evidence of personal history:
    # cold-start users receive popularity scores through the same field.  Only
    # mention past behaviour when the recommendation service supplies a
    # grounded action + trait sentence.
    clean_history_reason = str(history_reason or "").strip().rstrip(".")
    has_history_signal = bool(clean_history_reason)

    shown_keywords = " และ ".join(f'“{word}”' for word in matched_keywords[:3])
    if has_context and has_keyword_match:
        main_reason = f"ตรงกับ “{context_name}” และคำสำคัญ {shown_keywords}"
    elif has_context and has_keyword_query and has_content_signal:
        main_reason = f"ตรงกับ “{context_name}” และใกล้เคียงคำสำคัญที่เลือก"
    elif has_keyword_match:
        main_reason = f"ตรงกับคำสำคัญ {shown_keywords}"
    elif has_context:
        main_reason = f"ตรงกับ “{context_name}”"
    elif has_content_signal:
        main_reason = "ใกล้เคียงคำสำคัญที่เลือก"
    elif has_history_signal:
        main_reason = clean_history_reason
    else:
        main_reason = "เหมาะกับเงื่อนไขที่เลือก"

    history_text = (
        f" และ{clean_history_reason}"
        if has_history_signal and main_reason != clean_history_reason
        else ""
    )
    return f"แนะนำเพราะ{main_reason}{history_text}."


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
