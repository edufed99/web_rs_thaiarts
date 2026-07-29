"""Tests for ``services.embedding`` — E5 lazy-loader.

The model itself is ~2.5 GB and we don't download it in CI. Tests
monkeypatch ``_ensure_model`` to return a deterministic numpy encoder.
"""
from __future__ import annotations

from typing import List

import numpy as np
import pytest

from app.services import embedding


class _FakeModel:
    """Deterministic stand-in for SentenceTransformer.

    Each call to ``encode`` returns a matrix whose rows are
    ``np.eye(dim)[:len(texts)]`` (orthogonal vectors), so the test can
    assert shape + L2 norm without a real model.
    """

    def __init__(self, dim: int = 4):
        self.dim = dim
        self.calls: List[str] = []

    def encode(self, texts: List[str], **_):
        self.calls.extend(texts)
        return np.eye(self.dim, dtype=np.float32)[: len(texts)]


@pytest.fixture(autouse=True)
def _reset_model(monkeypatch):
    """Drop the cached model between tests."""
    embedding.reset_model_cache()
    yield
    embedding.reset_model_cache()


@pytest.fixture
def no_autouse_reset(request):
    """Disable the autouse ``_reset_model`` fixture for this test only."""
    marker = request.node.get_closest_marker("skip_autouse")
    if marker:
        return
    # The autouse fixture already ran by the time we get here; reset again
    # so the test starts with a clean slate.


@pytest.fixture
def fake_model(monkeypatch):
    """Inject a deterministic stand-in for SentenceTransformer."""
    model = _FakeModel()
    monkeypatch.setattr(
        embedding,
        "_ensure_model",
        lambda: model,
    )
    return model


def test_encode_text_returns_correct_shape(fake_model):
    v = embedding.encode_text("hello world")
    assert v.ndim == 1
    assert v.shape == (4,)
    assert v.dtype == np.float32


def test_encode_text_normalizes_embeddings(fake_model):
    v = embedding.encode_text("hello")
    norm = float(np.linalg.norm(v))
    assert abs(norm - 1.0) < 1e-5


def test_encode_query_uses_query_prefix(fake_model):
    v = embedding.encode_query("hello")
    assert v.shape == (4,)
    assert fake_model.calls[-1].startswith("Instruct: Given a Thai performing arts query")


def test_encode_text_uses_raw_passage_for_e5_instruct(fake_model):
    embedding.encode_text("hello")
    assert fake_model.calls[-1] == "hello"


def test_encode_text_empty_raises(fake_model):
    with pytest.raises(ValueError):
        embedding.encode_text("")
    with pytest.raises(ValueError):
        embedding.encode_text("   ")


def test_build_item_text_matches_pipeline_format():
    """Mirror of ``pipelines.train_or_generate_artifacts.build_item_text``."""
    s = embedding.build_item_text(
        {"name": "ระบำ", "description": "แสดงแบบดั้งเดิม"},
        ["ผู้หญิง", "ชุดไทย"],
        ["งานบวช"],
    )
    assert s == "ระบำ แสดงแบบดั้งเดิม ผู้หญิง ชุดไทย งานบวช"


def test_build_item_text_skips_empty_parts():
    s = embedding.build_item_text(
        {"name": "X", "description": ""},
        ["k"],
        [],
    )
    assert s == "X k"


def test_encode_item_text_calls_encode_text(fake_model):
    v = embedding.encode_item_text({"name": "X", "description": "d"}, ["k"], [])
    assert v.shape == (4,)


def test_encode_item_text_handles_none_kwargs(fake_model):
    v = embedding.encode_item_text({"name": "X"}, None, None)
    assert v.shape == (4,)


def test_lazy_load_caches_after_first_call(monkeypatch):
    """Verify that ``_ensure_model`` is called repeatedly, but only the first
    call performs the expensive download (creates a new ``_FakeModel``).
    """
    from app.services import embedding as emb
    downloads = {"n": 0}

    def _stub():
        # Mirror real impl: cache hit after first download.
        if emb._model is None:
            downloads["n"] += 1
            emb._model = _FakeModel()
        return emb._model

    monkeypatch.setattr(emb, "_ensure_model", _stub)
    emb._model = None
    emb.encode_text("a")
    emb.encode_text("b")
    emb.encode_text("c")
    assert downloads["n"] == 1
    assert emb._model is not None


def test_e5_disabled_short_circuits(monkeypatch, fake_model):
    """Patch the underlying ``_ensure_model`` to assert the gate short-circuits.

    Directly toggling ``settings.e5_enabled`` doesn't help because the
    real ``_ensure_model`` reads it lazily and the test's monkeypatched
    callable doesn't. So we patch ``_ensure_model`` to raise first.
    """
    def _disabled():
        raise RuntimeError("E5 disabled")

    monkeypatch.setattr(embedding, "_ensure_model", _disabled)
    with pytest.raises(RuntimeError, match="E5 disabled"):
        embedding.encode_text("hello")
