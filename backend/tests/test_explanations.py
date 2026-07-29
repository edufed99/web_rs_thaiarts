"""Tests for app.explanations."""
from __future__ import annotations

from app.explanations import (
    _collaborative_signal_phrase,
    _content_signal_phrase,
    _taxonomy_summaries,
    build_explanation,
)


def test_content_signal_phrase_thresholds():
    assert "สูง" in _content_signal_phrase(0.9)
    assert "ปานกลาง" in _content_signal_phrase(0.5)
    assert "สัญญาณความเกี่ยวข้อง" in _content_signal_phrase(0.1)
    assert _content_signal_phrase(0) == ""
    assert _content_signal_phrase(-0.5) == ""


def test_collaborative_signal_phrase_thresholds():
    assert "ค่อนข้างชัดเจน" in _collaborative_signal_phrase(0.8)
    assert "บางส่วน" in _collaborative_signal_phrase(0.3)
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
    )
    assert "ผู้หญิง" in text
    assert "สูง" in text or "ค่อนข้างชัดเจน" in text


def test_build_explanation_no_match_path():
    text = build_explanation(
        item={"keyword_names": [], "taxonomy_paths": []},
        context_name="งานบวช",
        selected_keyword_names=["ผู้หญิง"],
        cbf_score=0.1, cf_score=0.0,
        matched_keywords=[],
    )
    assert "แม้ไม่มีคุณลักษณะที่ตรง" in text


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
