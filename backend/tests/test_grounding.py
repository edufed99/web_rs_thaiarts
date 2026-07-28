"""Tests for ``services.grounding`` — Layer A (rule) + Layer B (LLM).

Layer A is a pure function over an in-memory vocab list. Layer B is
monkeypatched via ``_call_gemini`` so no network is hit.
"""
from __future__ import annotations

from typing import List

import pytest

from app.core.config import get_settings
from app.services import grounding
from app.services.grounding import VocabEntry


# --- Vocab cache ----------------------------------------------------------


@pytest.fixture(autouse=True)
def _reset():
    grounding.reset_vocab_cache()
    yield
    grounding.reset_vocab_cache()


def _vocab() -> List[VocabEntry]:
    return [
        VocabEntry(id=1, name="ผู้หญิง", taxonomy_path="ผู้แสดง/เพศ"),
        VocabEntry(id=2, name="ผู้ชาย", taxonomy_path="ผู้แสดง/เพศ"),
        VocabEntry(id=3, name="ชุดไทย", taxonomy_path="เครื่องแต่งกาย"),
        VocabEntry(id=4, name="หน้าจอ", taxonomy_path="อุปกรณ์การแสดง"),
        VocabEntry(id=5, name="โขน", taxonomy_path="ประเภทการแสดง"),
        VocabEntry(id=6, name="stopword1", taxonomy_path="stopword"),
    ]


# --- Layer A --------------------------------------------------------------


def test_layer_a_exact_token_match():
    item = {"name": "โขนหน้าจอ", "description": "การแสดงโขนแบบหน้าจอ"}
    ids = grounding.auto_ground_keywords(item, _vocab())
    assert 5 in ids  # โขน
    assert 4 in ids  # หน้าจอ


def test_layer_a_substring_match():
    item = {"name": "ระบำชุดไทย", "description": ""}
    ids = grounding.auto_ground_keywords(item, _vocab())
    assert 3 in ids  # ชุดไทย


def test_layer_a_token_jaccard_match():
    # "ผู้หญิง" shares no exact substring with "การแสดงของผู้หญิง"
    # but token overlap is 1/4 = 0.25 — below 0.34 → no match.
    item = {"name": "การแสดง", "description": "ของผู้หญิงในงานบวช"}
    ids = grounding.auto_ground_keywords(item, _vocab())
    # 1 = ผู้หญิง matches via substring (ผู้หญิง in "ของผู้หญิงในงานบวช")
    assert 1 in ids


def test_layer_a_skips_stopword_taxonomy():
    item = {"name": "stopword1 ทดสอบ", "description": ""}
    ids = grounding.auto_ground_keywords(item, _vocab())
    assert 6 not in ids


def test_layer_a_dedups():
    item = {"name": "โขน โขน โขน", "description": ""}
    ids = grounding.auto_ground_keywords(item, _vocab())
    assert ids.count(5) == 1


def test_layer_a_handles_missing_description():
    item = {"name": "โขน"}
    ids = grounding.auto_ground_keywords(item, _vocab())
    assert 5 in ids


def test_layer_a_empty_vocab_returns_empty():
    assert grounding.auto_ground_keywords({"name": "X"}, []) == []


def test_layer_a_empty_item_returns_empty():
    assert grounding.auto_ground_keywords({}, _vocab()) == []


def test_layer_a_jaccard_below_threshold_skips():
    """Construct an item where the keyword token-set Jaccard is below 0.34."""
    # Vocab has "ผู้หญิง" → tokens = {"ผู้หญิง"}
    # Item "ผู้หญิง เด็ก ชาย หญิง" tokens = 4 distinct → Jaccard = 1/4 = 0.25
    item = {"name": "ผู้หญิง เด็ก ชาย หญิง", "description": ""}
    ids = grounding.auto_ground_keywords(item, _vocab(), jaccard_min=0.5)
    # 1 = ผู้หญิง matches via substring ("ผู้หญิง" appears verbatim).
    # Substring matches first, so it IS present.
    assert 1 in ids


def test_layer_a_normalizes_thai_text():
    item = {"name": "โขน", "description": "  ผู้หญิง  "}
    ids = grounding.auto_ground_keywords(item, _vocab())
    assert 1 in ids


# --- Layer B (mocked) -----------------------------------------------------


def test_layer_b_skips_when_no_api_key(monkeypatch):
    monkeypatch.setattr(get_settings(), "gemini_api_key", "", raising=False)
    monkeypatch.setattr(get_settings(), "grounding_use_llm", True, raising=False)
    assert grounding.llm_ground_keywords({"name": "X"}, _vocab()) == []


def test_layer_b_skips_when_use_llm_false(monkeypatch):
    monkeypatch.setattr(get_settings(), "gemini_api_key", "fake", raising=False)
    monkeypatch.setattr(get_settings(), "grounding_use_llm", False, raising=False)
    assert grounding.llm_ground_keywords({"name": "X"}, _vocab()) == []


def test_layer_b_happy_path(monkeypatch):
    monkeypatch.setattr(get_settings(), "gemini_api_key", "fake", raising=False)
    monkeypatch.setattr(get_settings(), "grounding_use_llm", True, raising=False)
    monkeypatch.setattr(
        grounding, "_call_gemini",
        lambda *a, **kw: '{"names": ["ผู้หญิง", "โขน"]}',
    )
    # llm_ground_keywords uses _vocab_by_name (module cache). Populate it
    # so the names resolve.
    grounding._vocab_by_name.update(
        {"ผู้หญิง": VocabEntry(1, "ผู้หญิง", ""), "โขน": VocabEntry(5, "โขน", "")}
    )
    ids = grounding.llm_ground_keywords({"name": "X"}, _vocab(), max_suggest=5)
    assert 1 in ids
    assert 5 in ids


def test_layer_b_handles_malformed_json(monkeypatch):
    monkeypatch.setattr(get_settings(), "gemini_api_key", "fake", raising=False)
    monkeypatch.setattr(get_settings(), "grounding_use_llm", True, raising=False)
    monkeypatch.setattr(
        grounding, "_call_gemini",
        lambda *a, **kw: "not json at all",
    )
    assert grounding.llm_ground_keywords({"name": "X"}, _vocab()) == []


def test_layer_b_handles_exception(monkeypatch):
    monkeypatch.setattr(get_settings(), "gemini_api_key", "fake", raising=False)
    monkeypatch.setattr(get_settings(), "grounding_use_llm", True, raising=False)
    def _boom(*a, **kw):
        raise RuntimeError("network down")
    monkeypatch.setattr(grounding, "_call_gemini", _boom)
    assert grounding.llm_ground_keywords({"name": "X"}, _vocab()) == []


# --- Combined ground_keywords --------------------------------------------


def test_ground_keywords_merges_layers(monkeypatch):
    monkeypatch.setattr(get_settings(), "gemini_api_key", "fake", raising=False)
    monkeypatch.setattr(get_settings(), "grounding_use_llm", True, raising=False)
    monkeypatch.setattr(
        grounding, "_call_gemini",
        lambda *a, **kw: '{"names": ["ผู้ชาย"]}',
    )
    grounding._vocab_by_name.update(
        {"ผู้ชาย": VocabEntry(2, "ผู้ชาย", "")}
    )
    item = {"name": "โขนหน้าจอ", "description": ""}
    result = grounding.ground_keywords(item, _vocab())
    assert 5 in result["layer_a_ids"]    # โขน
    assert 4 in result["layer_a_ids"]    # หน้าจอ
    assert 2 in result["layer_b_ids"]    # ผู้ชาย
    assert set(result["merged_ids"]) >= {2, 4, 5}


def test_ground_keywords_without_llm(monkeypatch):
    monkeypatch.setattr(get_settings(), "grounding_use_llm", False, raising=False)
    item = {"name": "โขน", "description": ""}
    result = grounding.ground_keywords(item, _vocab(), use_llm=False)
    assert result["layer_b_ids"] == []
    assert 5 in result["layer_a_ids"]


# --- Vocab loader (cache + dedup) ----------------------------------------


class _FakeLoader:
    def __init__(self, df):
        self._items = df

    @property
    def items(self):
        return self._items


def test_load_vocab_dedup_and_skip_stopwords():
    import pandas as pd
    df = pd.DataFrame(
        [
            {
                "item_id": 1,
                "name": "X",
                "keyword_names": ["โขน", "ผู้หญิง", "stopword1", "โขน"],
                "taxonomy_paths": ["", "", "stopword", ""],
            },
            {
                "item_id": 2,
                "name": "Y",
                "keyword_names": ["โขน"],
                "taxonomy_paths": ["extra"],
            },
        ]
    )
    entries = grounding.load_vocab(_FakeLoader(df))
    names = sorted(e.name for e in entries)
    assert names == ["ผู้หญิง", "โขน"]


def test_load_vocab_handles_missing_taxonomy():
    import pandas as pd
    df = pd.DataFrame(
        [{"item_id": 1, "name": "X", "keyword_names": ["โขน"], "taxonomy_paths": []}]
    )
    entries = grounding.load_vocab(_FakeLoader(df))
    assert len(entries) == 1
    assert entries[0].taxonomy_path == ""


def test_load_vocab_returns_empty_for_no_keyword_column():
    import pandas as pd
    df = pd.DataFrame([{"item_id": 1, "name": "X"}])
    # No keyword_names column → empty vocab.
    assert grounding.load_vocab(_FakeLoader(df)) == []


def test_vocab_for_loader_uses_singleton(monkeypatch):
    """``vocab_for_loader`` returns the cached vocab when a populated singleton exists."""
    from app.model_loader import ArtifactLoader, set_singleton, reset_singleton
    import pandas as pd

    grounding.reset_vocab_cache()
    loader = ArtifactLoader()
    df = pd.DataFrame([{
        "item_id": 1,
        "name": "X",
        "keyword_names": ["โขน"],
        "taxonomy_paths": [""],
    }])
    loader._items = df
    set_singleton(loader)
    try:
        result = grounding.vocab_for_loader()
        assert isinstance(result, list)
        assert any(e.name == "โขน" for e in result)
    finally:
        reset_singleton()
        grounding.reset_vocab_cache()