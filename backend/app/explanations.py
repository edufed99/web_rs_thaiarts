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
            f'รายการนี้เหมาะกับบริบท "{context_name}" '
            "และผ่านการคัดกรองเบื้องต้นก่อนนำไปจัดอันดับ"
        )

    if matched_keywords:
        shown = ", ".join(f'"{w}"' for w in matched_keywords[:5])
        sentences.append(
            f"คุณลักษณะที่ตรงกับสิ่งที่เลือกคือ {shown}"
        )
        # Taxonomy summary if available
        taxonomy_labels = _taxonomy_summaries(item, matched_keywords)
        if taxonomy_labels:
            labels = ", ".join(f'"{l}"' for l in taxonomy_labels[:3])
            sentences.append(
                f"คุณลักษณะเหล่านี้อยู่ในหมวดความหมาย {labels}"
            )
    elif cbf_score > 0:
        sentences.append(
            "แม้ไม่มีคุณลักษณะที่ตรงแบบคำต่อคำ แต่คำอธิบายและข้อมูลประกอบ "
            "ของรายการนี้ยังใกล้เคียงกับสิ่งที่เลือก"
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
        return "ในด้านเนื้อหา รายการนี้มีความใกล้เคียงเชิงความหมายกับคำค้นในระดับสูง"
    if score >= 0.45:
        return "ในด้านเนื้อหา รายการนี้มีความใกล้เคียงเชิงความหมายกับคำค้นในระดับปานกลาง"
    if score > 0:
        return "ในด้านเนื้อหา รายการนี้ยังมีสัญญาณความเกี่ยวข้องกับคำที่เลือก"
    return ""


def _collaborative_signal_phrase(score: float) -> str:
    if score >= 0.65:
        return "จากพฤติกรรมผู้ใช้เดิม รายการนี้ได้รับสัญญาณสนับสนุนค่อนข้างชัดเจน"
    if score > 0:
        return "จากพฤติกรรมผู้ใช้เดิม รายการนี้ได้รับสัญญาณสนับสนุนบางส่วน"
    return ""
