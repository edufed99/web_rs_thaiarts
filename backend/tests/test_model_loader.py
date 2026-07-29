"""Tests for ArtifactLoader."""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from app.core.exceptions import ArtifactsNotLoadedError
from app.model_loader import ArtifactLoader

from .conftest import context_id, item_id


def test_load_succeeds(artifacts_dir: Path):
    loader = ArtifactLoader()
    loader.load(artifacts_dir)
    assert loader.is_loaded
    assert len(loader.item_ids) == 5
    assert loader.embeddings.shape == (5, 4)
    assert loader.embeddings.dtype == np.float32
    assert len(loader.cf_user_item) == 3
    md = loader.metadata
    assert md["item_count"] == 5
    assert md["embedding_dim"] == 4


def test_load_optional_best_model_config(artifacts_dir: Path):
    payload = {
        "selected_model": {
            "method": "Hybrid-WeightedSum",
            "max_cands": 20,
            "hybrid_alpha": 0.8,
        }
    }
    (artifacts_dir / "outputs" / "best_model_config.json").write_text(
        json.dumps(payload), encoding="utf-8"
    )
    loader = ArtifactLoader()
    loader.load(artifacts_dir)
    assert loader.best_model_config == payload
    assert loader.metadata["best_model_config"] == payload


def test_load_corrupt_best_model_config_falls_back(artifacts_dir: Path):
    (artifacts_dir / "outputs" / "best_model_config.json").write_text(
        "{not json", encoding="utf-8"
    )
    loader = ArtifactLoader()
    loader.load(artifacts_dir)
    assert loader.best_model_config == {}
    assert "best_model_config_error" in loader.metadata


def test_load_missing_directory(tmp_path: Path):
    loader = ArtifactLoader()
    with pytest.raises(ArtifactsNotLoadedError, match="Artifact directory not found"):
        loader.load(tmp_path / "does-not-exist")


def test_load_missing_models_file(tmp_path: Path):
    """When a required file is missing, the loader reports which one(s)."""
    models = tmp_path / "models"
    outputs = tmp_path / "outputs"
    models.mkdir()
    outputs.mkdir()
    # Missing item_embeddings.npz
    (tmp_path / "models" / "item_embedding_ids.json").write_text("[]")
    (tmp_path / "models" / "cf_user_item.json").write_text("{}")
    (tmp_path / "models" / "cf_item_users.json").write_text("{}")
    (tmp_path / "models" / "cf_user_item_rating.json").write_text("{}")
    (tmp_path / "outputs" / "catalog.parquet").touch()
    (tmp_path / "outputs" / "metadata.json").write_text("{}")

    loader = ArtifactLoader()
    with pytest.raises(ArtifactsNotLoadedError, match="item_embeddings.npz"):
        loader.load(tmp_path)


def test_load_invalid_json(tmp_path: Path, artifacts_dir: Path):
    """Corrupt JSON surfaces as ArtifactsNotLoadedError, not JSONDecodeError."""
    (artifacts_dir / "models" / "cf_user_item.json").write_text("{not json")
    loader = ArtifactLoader()
    with pytest.raises(ArtifactsNotLoadedError, match="Failed to load artifacts"):
        loader.load(artifacts_dir)


def test_load_embedding_id_mismatch(tmp_path: Path, artifacts_dir: Path):
    """If ids and matrix dimensions disagree, raise clearly."""
    np.savez_compressed(
        artifacts_dir / "models" / "item_embeddings.npz",
        vectors=np.zeros((2, 4), dtype=np.float32),  # only 2 rows
    )
    loader = ArtifactLoader()
    with pytest.raises(ArtifactsNotLoadedError, match="rows but .* has .* ids"):
        loader.load(artifacts_dir)


def test_load_missing_catalog_column(tmp_path: Path, artifacts_dir: Path):
    """catalog.parquet without item_id column is rejected."""
    bad = pd.DataFrame({"name": ["x"]})
    bad.to_parquet(artifacts_dir / "outputs" / "catalog.parquet", index=False)
    loader = ArtifactLoader()
    with pytest.raises(ArtifactsNotLoadedError, match="item_id"):
        loader.load(artifacts_dir)


def test_unloaded_access_raises(tmp_path: Path):
    loader = ArtifactLoader()
    with pytest.raises(ArtifactsNotLoadedError):
        _ = loader.items
    with pytest.raises(ArtifactsNotLoadedError):
        _ = loader.embeddings


def test_item_row_and_embedding(loader):
    """item_row + embedding_for return consistent vectors."""
    rid = item_id("ระบำพรหมาสตร์")
    row = loader.item_row(rid)
    emb = loader.embedding_for(rid)
    assert row is not None
    assert emb is not None
    assert emb.shape == (4,)


def test_item_row_unknown_returns_none(loader):
    assert loader.item_row(9999999) is None
    assert loader.embedding_for(9999999) is None


def test_user_rating_weight_lookup(loader):
    rid = item_id("ระบำพรหมาสตร์")
    # default 1.0 when missing
    assert loader.user_rating_weight("user:u1", rid) == pytest.approx(1.0)
    # explicit 0.8 from fixture
    rid_khon = item_id("โขน")
    assert loader.user_rating_weight("user:u1", rid_khon) == pytest.approx(0.8)


def test_ensure_list_handles_nan_and_none():
    """Cover _ensure_list helper paths."""
    from app.model_loader import _ensure_list
    assert _ensure_list(None) == []
    assert _ensure_list([1, 2]) == [1, 2]
    assert _ensure_list("single") == ["single"]
    assert _ensure_list(float("nan")) == []


def test_singleton_helpers(monkeypatch):
    """Singleton getter/setter behave correctly."""
    from app import model_loader as ml
    ml.reset_singleton()
    with pytest.raises(ArtifactsNotLoadedError, match="singleton not initialized"):
        ml.get_singleton()

    fake = ArtifactLoader()
    ml.set_singleton(fake)
    assert ml.get_singleton() is fake
    ml.reset_singleton()


def test_load_idempotent(artifacts_dir: Path):
    """Calling load twice replaces state cleanly."""
    a = ArtifactLoader()
    a.load(artifacts_dir)
    b = ArtifactLoader()
    b.load(artifacts_dir)
    assert b.is_loaded
    assert b.item_ids == a.item_ids


def test_metadata_loaded_at_set(artifacts_dir: Path):
    loader = ArtifactLoader()
    loader.load(artifacts_dir)
    assert loader.loaded_at is not None
    assert "T" in loader.loaded_at
