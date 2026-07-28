"""
explanations.py — Port of recommender/explanations.py.

Generate natural-language Thai explanations for a recommendation.
"""
from __future__ import annotations

from typing import Iterable, List, Tuple


def build_explanation(
    item: dict,
    context_name: str,
    selected_keyword_names: Iterable[str],
    cbf_score: float,
    cf_score: float,
    matched_keywords: List[str],
) -> str:
    """
    Returns a single Thai-language paragraph explaining the recommendation.
    """
    sentences: List[str] = []

    if context_name:
        sentences.append(
            f'รายการนี้ผ่านเงื่อนไขบริบท "{context_name}" '
            "จึงอยู่ในกลุ่มการแสดงที่เหมาะกับงานนี้ก่อนเข้าสู่การจัดอันดับ"
        )

    if matched_keywords:
        shown = ", ".join(f'"{w}"' for w in matched_keywords[:5])
        sentences.append(
            f"จุดที่ตรงกับความต้องการของผู้ใช้คือคำสำคัญ {shown}"
        )
        # Taxonomy summary if available
        taxonomy_labels = _taxonomy_summaries(item, matched_keywords)
        if taxonomy_labels:
            labels = ", ".join(f'"{l}"' for l in taxonomy_labels[:3])
            sentences.append(
                f"คำสำคัญเหล่านี้เชื่อมโยงกับหมวดความหมาย {labels}"
            )
    elif cbf_score > 0:
        sentences.append(
            "แม้ไม่มีคำสำคัญที่ตรงแบบคำต่อคำ แต่ข้อความอธิบายและ keyword "
            "ของรายการนี้ใกล้เคียงกับสิ่งที่ผู้ใช้เลือก"
        )

    content_phrase = _content_signal_phrase(cbf_score)
    if content_phrase:
        sentences.append(content_phrase)

    collab_phrase = _collaborative_signal_phrase(cf_score)
    if collab_phrase:
        sentences.append(collab_phrase)

    return " ".join(s + "." for s in sentences)


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
        return "ด้านเนื้อหา ระบบพบความใกล้เคียงเชิงความหมายในระดับสูง"
    if score >= 0.45:
        return "ด้านเนื้อหา ระบบพบความใกล้เคียงเชิงความหมายในระดับปานกลาง"
    if score > 0:
        return "ด้านเนื้อหา รายการนี้ยังมีสัญญาณความเกี่ยวข้องกับคำที่เลือก"
    return ""


def _collaborative_signal_phrase(score: float) -> str:
    if score >= 0.65:
        return "ด้านพฤติกรรมผู้ใช้เดิม รายการนี้มีสัญญาณสนับสนุนค่อนข้างชัดเจน"
    if score > 0:
        return "ด้านพฤติกรรมผู้ใช้เดิม รายการนี้มีสัญญาณสนับสนุนบางส่วน"
    return ""