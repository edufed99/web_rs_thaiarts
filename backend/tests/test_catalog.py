"""Tests for the /items and /items/{id} endpoints."""
from __future__ import annotations

from fastapi.testclient import TestClient

from tests.conftest import item_id


def test_list_items_default(client: TestClient):
    r = client.get("/items")
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
    r = client.get("/items", params={"search": "โขน"})
    assert r.status_code == 200
    body = r.json()
    assert body["total"] >= 1
    assert any("โขน" in item["name"] for item in body["items"])


def test_list_items_pagination(client: TestClient):
    r = client.get("/items", params={"limit": 2, "offset": 1})
    assert r.status_code == 200
    body = r.json()
    assert len(body["items"]) == 2
    assert body["total"] == 5


def test_list_items_limit_validation(client: TestClient):
    r = client.get("/items", params={"limit": 0})
    assert r.status_code == 422
    r = client.get("/items", params={"limit": 1000})
    assert r.status_code == 422


def test_get_item_ok(client: TestClient):
    rid = item_id("ระบำพรหมาสตร์")
    r = client.get(f"/items/{rid}")
    assert r.status_code == 200
    body = r.json()
    assert body["id"] == rid
    assert body["name"] == "ระบำพรหมาสตร์"
    assert any(k["name"] == "ผู้หญิง" for k in body["keywords"])


def test_get_item_not_found(client: TestClient):
    r = client.get("/items/99999")
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "item_not_found"