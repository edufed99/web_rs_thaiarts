"""
conftest.py — Shared pytest fixtures.

Builds a tiny synthetic artifact set in a tmp_path so every test runs against
deterministic, in-memory data without touching the real catalog or CSV files.
"""
from __future__ import annotations

# IMPORTANT: disable the Postgres layer for unit tests so conftest imports
# don't try to connect to a real DB.
import os
os.environ.setdefault("RECSYS_DB_ENABLED", "0")
# Strip RECSYS_* env vars (excluding DB_ENABLED, just set) so unit tests
# run against pure defaults — no admin allow-list, default JWT secret,
# Layer B off, no Gemini key. The .env is also bypassed because Settings
# is re-built with the cleared environ.
for _key in (
    "RECSYS_ADMIN_USERNAMES",
    "RECSYS_JWT_SECRET",
    "RECSYS_GROUNDING_USE_LLM",
    "RECSYS_CORS_ORIGINS",
    "RECSYS_E5_ENABLED",
    "RECSYS_RESEARCH_MODE",
    "RECSYS_PRELOAD_E5",
    "RECSYS_GEMINI_API_KEY",
):
    os.environ.pop(_key, None)
from app.core.config import reset_settings_cache
reset_settings_cache()

import json
from pathlib import Path
from typing import Dict, List

import numpy as np
import pandas as pd
import pytest

from app.model_loader import ArtifactLoader


# --- Synthetic corpus --------------------------------------------------------

ITEM_NAMES = [
    "ระบำพรหมาสตร์",   # 0
    "โขน",              # 1
    "ลิเก",             # 2
    "หุ่นกระบอก",       # 3
    "วงดนตรีไทย",       # 4
]

CONTEXTS = [
    {"name": "งานบวช",          "group": "พิธีกรรม"},   # id 0
    {"name": "งานเลี้ยงสังสรรค์", "group": "งานเลี้ยง"},   # id 1
]

ITEM_CONTEXTS = {
    0: [0],  # ระบำ → งานบวช
    1: [0],  # โขน   → งานบวช
    2: [1],  # ลิเก  → งานเลี้ยง
    3: [0],  # หุ่นกระบอก → งานบวช
    4: [1],  # วงดนตรี → งานเลี้ยง
}

ITEM_KEYWORDS = {
    0: ["ผู้หญิง", "ชุดไทย"],
    1: ["ผู้ชาย", "หน้าจอ"],
    2: ["ผู้หญิง"],
    3: ["หน้าจอ", "ผู้ชาย"],
    4: ["ดนตรี"],
}

KEYWORD_TAXONOMY = {
    "ผู้หญิง": "ผู้แสดง",
    "ผู้ชาย":  "ผู้แสดง",
    "ชุดไทย": "เครื่องแต่งกาย",
    "หน้าจอ": "อุปกรณ์การแสดง",
    "ดนตรี":  "ดนตรี",
}

# CF: user:u1 likes items 0 and 1; user:u2 likes 2 and 4; user:u3 likes 3 and 0.
CF_USER_ITEM = {
    "user:u1": [0, 1],
    "user:u2": [2, 4],
    "user:u3": [3, 0],
}

# All positive (rating=5) → weight=1.0; we'll vary one to test weighted sim.
CF_RATING_WEIGHT_RAW = {
    ("user:u1", 0): 1.0,
    ("user:u1", 1): 0.8,
    ("user:u2", 2): 1.0,
    ("user:u2", 4): 1.0,
    ("user:u3", 3): 1.0,
    ("user:u3", 0): 1.0,
}

EMBEDDING_DIM = 4


def stable_id(kind: str, name: str) -> int:
    """Match pipeline stable_id()."""
    import hashlib
    h = hashlib.sha256(f"{kind}::{name}".encode("utf-8")).hexdigest()
    return int(h[:7], 16)


# --- Fixtures ----------------------------------------------------------------

@pytest.fixture
def artifacts_dir(tmp_path: Path) -> Path:
    """Build a complete artifacts/{models,outputs}/ tree in a tmp dir."""
    models = tmp_path / "models"
    outputs = tmp_path / "outputs"
    models.mkdir(parents=True, exist_ok=True)
    outputs.mkdir(parents=True, exist_ok=True)

    # catalog.parquet
    rows = []
    for idx, name in enumerate(ITEM_NAMES):
        item_id = stable_id("item", name)
        rows.append({
            "item_id": item_id,
            "name": name,
            "description": f"คำอธิบายของ {name}",
            "category_group": "กลุ่ม",
            "performance_type": "การแสดง",
            "performers_count": 5,
            "duration_minutes": 30,
            "price_text": "1000",
            "is_active": True,
            "keyword_names": ITEM_KEYWORDS[idx],
            "context_names": [CONTEXTS[c]["name"] for c in ITEM_CONTEXTS[idx]],
            "taxonomy_paths": [KEYWORD_TAXONOMY[k] for k in ITEM_KEYWORDS[idx]],
        })
    catalog_df = pd.DataFrame(rows)
    catalog_df.to_parquet(outputs / "catalog.parquet", index=False)

    # item_embeddings.npz + ids
    ids = [r["item_id"] for r in rows]
    rng = np.random.default_rng(0)
    vectors = rng.standard_normal((len(ids), EMBEDDING_DIM)).astype(np.float32)
    # L2-normalize
    norms = np.linalg.norm(vectors, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    vectors = vectors / norms
    np.savez_compressed(models / "item_embeddings.npz", vectors=vectors)
    (models / "item_embedding_ids.json").write_text(
        json.dumps(ids, ensure_ascii=False), encoding="utf-8"
    )

    # CF indices — keyed by item_id (using stable_id)
    cf_user_item_id = {
        user: [stable_id("item", ITEM_NAMES[i]) for i in items]
        for user, items in CF_USER_ITEM.items()
    }
    (models / "cf_user_item.json").write_text(
        json.dumps(cf_user_item_id, ensure_ascii=False), encoding="utf-8"
    )

    cf_item_users_id: Dict[int, List[str]] = {}
    for user, items in CF_USER_ITEM.items():
        for i in items:
            iid = stable_id("item", ITEM_NAMES[i])
            cf_item_users_id.setdefault(iid, []).append(user)
    (models / "cf_item_users.json").write_text(
        json.dumps({str(k): v for k, v in cf_item_users_id.items()}, ensure_ascii=False),
        encoding="utf-8",
    )

    cf_rating = {
        f"{user}::{stable_id('item', ITEM_NAMES[i])}": float(w)
        for (user, i), w in CF_RATING_WEIGHT_RAW.items()
    }
    (models / "cf_user_item_rating.json").write_text(
        json.dumps(cf_rating, ensure_ascii=False), encoding="utf-8"
    )

    # metadata.json
    ctx_id_to_name = {
        str(stable_id("context", c["name"])): c["name"] for c in CONTEXTS
    }
    metadata = {
        "schema_version": "1.0.0",
        "build_timestamp": "2026-07-28T00:00:00+00:00",
        "source_root": "synthetic",
        "item_count": len(rows),
        "context_count": len(CONTEXTS),
        "keyword_link_count": sum(len(v) for v in ITEM_KEYWORDS.values()),
        "positive_user_count": len(CF_USER_ITEM),
        "unique_item_user_edges": len(cf_item_users_id),
        "embedding_dim": EMBEDDING_DIM,
        "synthetic_embeddings": True,
        "config_hash": "deadbeef0000",
        "context_id_to_name": ctx_id_to_name,
    }
    (outputs / "metadata.json").write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    return tmp_path


@pytest.fixture
def loader(artifacts_dir: Path) -> ArtifactLoader:
    """An ArtifactLoader loaded from the synthetic artifacts."""
    ldr = ArtifactLoader()
    ldr.load(artifacts_dir)
    return ldr


# --- Test helpers ------------------------------------------------------------

def context_id(name: str) -> int:
    return stable_id("context", name)


def item_id(name: str) -> int:
    return stable_id("item", name)


def keyword_id(name: str) -> int:
    return stable_id("keyword", name)
