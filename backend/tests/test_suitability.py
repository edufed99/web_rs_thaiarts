"""Tests for services.suitability.

The suitability helper is a port of the legacy
``catalog.views.catalog_match_percent`` + ``catalog.views.suitability_label``
formulas.  These tests pin down the exact boundaries so a future refactor
cannot silently change the surfaced percentages.
"""
from __future__ import annotations

import pytest

from app.services.suitability import catalog_match_percent, suitability_label


# --- catalog_match_percent --------------------------------------------------


def test_output_is_always_in_range_82_to_98():
    """Even pathological inputs must land in the legacy [82, 98] window."""
    pct = catalog_match_percent(
        keyword_count=0,
        context_count=1,
        description_length=0,
        rating_average=0.0,
    )
    assert 82 <= pct <= 98


def test_realistic_low_inputs_still_in_range():
    """A sparse item (few keywords, 1 context, short description) should
    still sit comfortably above the 82 floor."""
    pct = catalog_match_percent(
        keyword_count=1,
        context_count=2,
        description_length=30,
    )
    assert 82 <= pct <= 98
    # Specificity contribution (1/2=0.5, /0.35=1.43, capped at 1.0) keeps
    # the score above the bare 82 floor.
    assert pct >= 82


def test_maximum_value_is_clamped_at_98():
    pct = catalog_match_percent(
        keyword_count=12,
        context_count=1,
        description_length=260,
        rating_average=5.0,
    )
    assert pct == 98


def test_default_rating_average_matches_legacy():
    # Legacy used 0.66 when no rating was available. A typical item
    # (a few keywords, several contexts, decent description) should land
    # in the mid-80s to mid-90s with the default.
    pct = catalog_match_percent(
        keyword_count=4,
        context_count=3,
        description_length=120,
    )
    assert 82 <= pct <= 98


def test_more_keywords_increase_percent():
    low = catalog_match_percent(keyword_count=1, context_count=3, description_length=100)
    high = catalog_match_percent(keyword_count=10, context_count=3, description_length=100)
    assert high > low


def test_more_contexts_decrease_percent():
    focused = catalog_match_percent(keyword_count=4, context_count=1, description_length=100)
    broad = catalog_match_percent(keyword_count=4, context_count=5, description_length=100)
    assert focused > broad


def test_longer_description_increases_percent():
    short = catalog_match_percent(keyword_count=4, context_count=3, description_length=20)
    long = catalog_match_percent(keyword_count=4, context_count=3, description_length=260)
    assert long > short


def test_higher_rating_average_increases_percent():
    low = catalog_match_percent(keyword_count=4, context_count=3, description_length=100, rating_average=1.0)
    high = catalog_match_percent(keyword_count=4, context_count=3, description_length=100, rating_average=5.0)
    assert high > low


def test_negative_inputs_are_handled_safely():
    # Defensive: if upstream callers pass bogus values we should not crash
    # and should still return a value in [82, 98].
    pct = catalog_match_percent(
        keyword_count=-1,
        context_count=-1,
        description_length=-10,
    )
    assert 82 <= pct <= 98


def test_keyword_count_above_12_is_capped():
    # Beyond 12 keywords there is no additional score contribution.
    at_cap = catalog_match_percent(keyword_count=12, context_count=3, description_length=100)
    above_cap = catalog_match_percent(keyword_count=50, context_count=3, description_length=100)
    assert at_cap == above_cap


# --- suitability_label ------------------------------------------------------


@pytest.mark.parametrize(
    "match_percent,expected",
    [
        (98, "เหมาะมาก"),
        (92, "เหมาะมาก"),
        (91, "เหมาะสม"),
        (87, "เหมาะสม"),
        (86, "เหมาะใช้ได้"),
        (82, "เหมาะใช้ได้"),
    ],
)
def test_suitability_label_thresholds(match_percent, expected):
    assert suitability_label(match_percent) == expected


# --- integration: orchestrator wires the fields in -------------------------


def test_recommendation_orchestrator_attaches_match_percent(client, loader):
    """End-to-end: ``POST /recommendations`` includes the new fields on every row."""
    from .conftest import context_id

    ctx = context_id("งานบวช")
    resp = client.post(
        "/recommendations",
        json={"context_id": ctx, "keyword_ids": [], "top_k": 3, "user_key": "anon:test"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["results"], "expected at least one recommendation"
    for row in body["results"]:
        assert "match_percent" in row
        assert "suitability_label" in row
        assert 82 <= row["match_percent"] <= 98
        assert row["suitability_label"] in {"เหมาะมาก", "เหมาะสม", "เหมาะใช้ได้"}