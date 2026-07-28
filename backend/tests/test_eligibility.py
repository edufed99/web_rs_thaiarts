"""Tests for services.eligibility."""
from __future__ import annotations

from app.services.eligibility import (
    build_context_id_map,
    context_name_for_id,
    get_context_valid_items,
)

from .conftest import context_id, item_id


def test_context_id_map_built_from_items(loader):
    m = build_context_id_map(loader)
    # two contexts from conftest
    assert len(m) == 2
    assert context_id("งานบวช") in m
    assert context_id("งานเลี้ยงสังสรรค์") in m


def test_context_name_for_id_caches(loader):
    # First call builds + caches, second uses cache.
    name = context_name_for_id(loader, context_id("งานบวช"))
    assert name == "งานบวช"
    cached = loader.metadata.get("context_id_to_name")
    assert cached is not None
    # Repeat returns the same
    assert context_name_for_id(loader, context_id("งานบวช")) == "งานบวช"


def test_context_name_for_id_unknown(loader):
    assert context_name_for_id(loader, 9999999) is None


def test_get_items_filters_by_context(loader):
    items = get_context_valid_items(loader, context_id("งานบวช"))
    names = [it["name"] for it in items]
    assert set(names) == {"ระบำพรหมาสตร์", "โขน", "หุ่นกระบอก"}


def test_get_items_other_context(loader):
    items = get_context_valid_items(loader, context_id("งานเลี้ยงสังสรรค์"))
    names = [it["name"] for it in items]
    assert set(names) == {"ลิเก", "วงดนตรีไทย"}


def test_get_items_unknown_context_returns_empty(loader):
    assert get_context_valid_items(loader, 9999999) == []


def test_keyword_hit_items_ranked_first(loader):
    items = get_context_valid_items(
        loader, context_id("งานบวช"),
        selected_keyword_names=["ผู้หญิง"],
    )
    # ระบำ has ผู้หญิง → hit; โขน and หุ่นกระบอก do not → miss.
    names = [it["name"] for it in items]
    assert names[0] == "ระบำพรหมาสตร์"
    assert set(names[1:]) == {"โขน", "หุ่นกระบอก"}


def test_max_cands_cap(loader):
    """When pool is smaller than min_cands, max_cands is effectively ignored
    (adaptive fill expands back to min of pool size / min_cands)."""
    # Pool has 3 items; min_cands default 10 > 3 → no cap applies.
    items = get_context_valid_items(
        loader, context_id("งานบวช"),
        max_cands=2,
    )
    assert len(items) == 3  # adaptive fill expands to pool size

    # To actually cap at 2 we need min_cands=2.
    items = get_context_valid_items(
        loader, context_id("งานบวช"),
        max_cands=2, min_cands=2,
    )
    assert len(items) == 2


def test_max_cands_adaptive_fill(loader):
    """When cap < min_cands, the pool grows back to min_cands."""
    items = get_context_valid_items(
        loader, context_id("งานบวช"),
        max_cands=1, min_cands=3,
    )
    assert len(items) == 3


def test_within_group_sort_by_name(loader):
    items = get_context_valid_items(loader, context_id("งานบวช"))
    # Miss group ordered by name asc
    miss_group = [it["name"] for it in items[1:]]  # first is the lone hit
    assert miss_group == sorted(miss_group)


def test_empty_keyword_list(loader):
    """selected_keyword_names=[] should not raise."""
    items = get_context_valid_items(loader, context_id("งานบวช"), selected_keyword_names=[])
    assert len(items) == 3