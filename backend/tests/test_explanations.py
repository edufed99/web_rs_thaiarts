"""Tests for app.explanations."""
from __future__ import annotations

from app.explanations import (
    _collaborative_signal_phrase,
    _content_signal_phrase,
    _taxonomy_summaries,
    build_explanation,
)


def test_content_signal_phrase_thresholds():
    assert "มาก" in _content_signal_phrase(0.9)
    assert "ปานกลาง" in _content_signal_phrase(0.5)
    assert "สัญญาณใกล้เคียง" in _content_signal_phrase(0.1)
    assert _content_signal_phrase(0) == ""
    assert _content_signal_phrase(-0.5) == ""


def test_collaborative_signal_phrase_thresholds():
    assert "ชัดเจน" in _collaborative_signal_phrase(0.8)
    assert _collaborative_signal_phrase(0.3) == "คล้ายกับความสนใจในอดีต"
    assert _collaborative_signal_phrase(0) == ""


def test_taxonomy_summaries_dedup():
    out = _taxonomy_summaries(
        {"taxonomy_paths": ["A > B", "A > B", "C"]},
        matched_keywords=[],
    )
    assert out == ["A > B", "C"]


def test_taxonomy_summaries_empty():
    out = _taxonomy_summaries({"taxonomy_paths": []}, matched_keywords=[])
    assert out == []


def test_build_explanation_includes_context_sentence():
    text = build_explanation(
        item={"keyword_names": [], "taxonomy_paths": []},
        context_name="งานบวช",
        selected_keyword_names=[],
        cbf_score=0.0, cf_score=0.0,
        matched_keywords=[],
    )
    assert "งานบวช" in text
    assert text == 'แนะนำเพราะตรงกับ “งานบวช”.'


def test_build_explanation_matched_keywords():
    text = build_explanation(
        item={
            "keyword_names": ["ผู้หญิง"],
            "taxonomy_paths": ["ผู้แสดง"],
        },
        context_name="งานบวช",
        selected_keyword_names=["ผู้หญิง"],
        cbf_score=0.8, cf_score=0.7,
        matched_keywords=["ผู้หญิง"],
        history_reason="คุณเคยกดถูกใจการแสดงประเภทระบำ",
    )
    assert "ผู้หญิง" in text
    assert "ตรงกับ “งานบวช” และคำสำคัญ “ผู้หญิง”" in text
    assert "คุณเคยกดถูกใจการแสดงประเภทระบำ" in text
    assert len(text) < 140


def test_build_explanation_no_match_path():
    text = build_explanation(
        item={"keyword_names": [], "taxonomy_paths": []},
        context_name="งานบวช",
        selected_keyword_names=["ผู้หญิง"],
        cbf_score=0.1, cf_score=0.0,
        matched_keywords=[],
    )
    assert "ตรงกับ “งานบวช” และใกล้เคียงคำสำคัญที่เลือก" in text


def test_build_explanation_empty_context():
    text = build_explanation(
        item={"keyword_names": [], "taxonomy_paths": []},
        context_name="",
        selected_keyword_names=[],
        cbf_score=0.0, cf_score=0.0,
        matched_keywords=[],
    )
    # No context sentence should appear
    assert "บริบท" not in text
    assert text == "แนะนำเพราะเหมาะกับเงื่อนไขที่เลือก."


def test_build_explanation_keyword_only():
    text = build_explanation(
        item={},
        context_name="",
        selected_keyword_names=["ผู้หญิง"],
        cbf_score=0.0,
        cf_score=0.0,
        matched_keywords=["ผู้หญิง"],
    )
    assert text == 'แนะนำเพราะตรงกับคำสำคัญ “ผู้หญิง”.'


def test_build_explanation_content_signal_only():
    text = build_explanation(
        item={},
        context_name="",
        selected_keyword_names=[],
        cbf_score=0.2,
        cf_score=0.0,
        matched_keywords=[],
    )
    assert text == "แนะนำเพราะใกล้เคียงคำสำคัญที่เลือก."


def test_build_explanation_history_signal_only():
    text = build_explanation(
        item={},
        context_name="",
        selected_keyword_names=[],
        cbf_score=0.0,
        cf_score=0.2,
        matched_keywords=[],
        history_reason="คุณเคยให้คะแนนสูงแก่การแสดงประเภทโขนและละคร",
    )
    assert text == "แนะนำเพราะคุณเคยให้คะแนนสูงแก่การแสดงประเภทโขนและละคร."


def test_build_explanation_does_not_treat_popularity_as_personal_history():
    text = build_explanation(
        item={},
        context_name="งานบวช",
        selected_keyword_names=[],
        cbf_score=0.0,
        cf_score=0.8,
        matched_keywords=[],
    )
    assert text == 'แนะนำเพราะตรงกับ “งานบวช”.'
