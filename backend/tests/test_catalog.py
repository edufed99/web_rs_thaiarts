"""Tests for the /items and /items/{id} endpoints."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.routers.catalog import _matches_all_terms
from tests.conftest import context_id, item_id


_ANON = {"user_key": "anon:test"}


def test_list_items_default(client: TestClient):
    r = client.get("/items", params=_ANON)
    assert r.status_code == 200
    body = r.json()
    assert body["total"] == 5
    assert len(body["items"]) == 5
    first = body["items"][0]
    assert "id" in first
    assert "name" in first
    assert isinstance(first["keywords"], list)
    assert isinstance(first["contexts"], list)


def test_list_items_search(client: TestClient):
    r = client.get("/items", params={"search": "โขน", **_ANON})
    assert r.status_code == 200
    body = r.json()
    assert body["total"] >= 1
    assert any("โขน" in item["name"] for item in body["items"])


def test_list_items_pagination(client: TestClient):
    r = client.get("/items", params={"limit": 2, "offset": 1, **_ANON})
    assert r.status_code == 200
    body = r.json()
    assert len(body["items"]) == 2
    assert body["total"] == 5


def test_list_items_limit_validation(client: TestClient):
    r = client.get("/items", params={"limit": 0, **_ANON})
    assert r.status_code == 422
    r = client.get("/items", params={"limit": 1000, **_ANON})
    assert r.status_code == 422


def test_get_item_ok(client: TestClient):
    rid = item_id("ระบำพรหมาสตร์")
    r = client.get(f"/items/{rid}", params=_ANON)
    assert r.status_code == 200
    body = r.json()
    assert body["id"] == rid
    assert body["name"] == "ระบำพรหมาสตร์"
    assert any(k["name"] == "ผู้หญิง" for k in body["keywords"])


def test_get_item_not_found(client: TestClient):
    r = client.get("/items/99999", params=_ANON)
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "item_not_found"


# --- ranked-by-context mode (legacy top-10 behaviour) --------------------


def test_list_items_context_mode_returns_top_10(client: TestClient):
    """?context=<id> returns the top-10 context-valid items sorted by match_percent desc."""
    ctx = context_id("งานบวช")
    r = client.get("/items", params={"context": ctx, **_ANON})
    assert r.status_code == 200
    body = r.json()
    # Synthetic corpus has 3 items in งานบวช — well below the top-10 cap.
    assert body["total"] == len(body["items"])
    assert 1 <= len(body["items"]) <= 10
    # Each row must carry a populated match_percent + suitability_label.
    for it in body["items"]:
        assert "match_percent" in it and it["match_percent"] is not None
        assert "suitability_label" in it and it["suitability_label"] is not None
        assert 82 <= it["match_percent"] <= 98
        assert it["suitability_label"] in {"เหมาะมาก", "เหมาะสม", "เหมาะใช้ได้"}


def test_list_items_context_mode_sorted_by_match_percent_desc(client: TestClient):
    ctx = context_id("งานบวช")
    r = client.get("/items", params={"context": ctx, **_ANON})
    assert r.status_code == 200
    items = r.json()["items"]
    percents = [it["match_percent"] for it in items]
    assert percents == sorted(percents, reverse=True)


def test_list_items_context_mode_ignores_limit(client: TestClient):
    """Legacy top-10 cap wins over the ``limit`` query parameter."""
    ctx = context_id("งานบวช")
    r = client.get("/items", params={"context": ctx, "limit": 1, **_ANON})
    assert r.status_code == 200
    # Even with limit=1, ranked mode returns up to 10 context-valid items.
    assert len(r.json()["items"]) >= 1


def test_list_items_context_mode_unknown_context_returns_404(client: TestClient):
    r = client.get("/items", params={"context": 99999, **_ANON})
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "context_not_found"


def test_list_items_context_mode_filters_by_context(client: TestClient):
    """Items NOT valid for the chosen context must not appear."""
    ctx_b = context_id("งานบวช")
    ctx_p = context_id("งานเลี้ยงสังสรรค์")
    body_b = client.get("/items", params={"context": ctx_b, **_ANON}).json()["items"]
    body_p = client.get("/items", params={"context": ctx_p, **_ANON}).json()["items"]
    ids_b = {it["id"] for it in body_b}
    ids_p = {it["id"] for it in body_p}
    assert ids_b.isdisjoint(ids_p), "ranked mode returned an item in both contexts"


# --- browse mode (default) -------------------------------------------------


@pytest.mark.parametrize("field", ["match_percent", "suitability_label"])
def test_list_items_default_includes_suitability(client: TestClient, field):
    """Browse mode also populates the suitability hint on every row."""
    r = client.get("/items", params=_ANON)
    assert r.status_code == 200
    for it in r.json()["items"]:
        assert field in it


def test_list_items_search_matches_keyword_name(client: TestClient):
    """The legacy search covers keyword names as well as name + description."""
    # "ผู้หญิง" is a keyword attached to ระบำพรหมาสตร์ in the synthetic corpus.
    r = client.get("/items", params={"search": "ผู้หญิง", **_ANON})
    assert r.status_code == 200
    body = r.json()
    assert body["total"] >= 1
    assert any(item_id("ระบำพรหมาสตร์") == it["id"] for it in body["items"])


def test_list_items_search_matches_taxonomy_path(client: TestClient):
    """The home-page taxonomy selector can search by taxonomy path level."""
    r = client.get("/items", params={"search": "เครื่องแต่งกาย", **_ANON})
    assert r.status_code == 200
    body = r.json()
    assert body["total"] >= 1
    assert any(item_id("ระบำพรหมาสตร์") == it["id"] for it in body["items"])


def test_list_items_search_matches_multiple_taxonomy_chips(client: TestClient):
    """Multiple selected chips are matched as separate search terms."""
    r = client.get("/items", params={"search": "ผู้หญิง|เครื่องแต่งกาย", **_ANON})
    assert r.status_code == 200
    body = r.json()
    assert body["total"] >= 1
    assert any(item_id("ระบำพรหมาสตร์") == it["id"] for it in body["items"])


def test_search_does_not_match_thai_prefix_inside_longer_word():
    assert not _matches_all_terms(["ทำนา"], ["พิเภกทำนายฝัน"])
    assert _matches_all_terms(["ทำนา"], ["การแสดงเกี่ยวกับการทำนา"])
    assert _matches_all_terms(["โขน"], ["การแสดงโขนเรื่องรามเกียรติ์"])


def test_get_item_includes_suitability(client: TestClient):
    """Detail endpoint also carries the suitability fields."""
    rid = item_id("ระบำพรหมาสตร์")
    r = client.get(f"/items/{rid}", params=_ANON)
    assert r.status_code == 200
    body = r.json()
    assert "match_percent" in body
    assert "suitability_label" in body
    assert 82 <= body["match_percent"] <= 98
