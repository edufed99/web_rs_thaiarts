"""Dynamic artifact rebuild service for the Private Model Service."""
from __future__ import annotations

import json
import logging
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List

import numpy as np
import pandas as pd

from ..core.config import Settings
from ..model_loader import ArtifactLoader, get_lock
from ..schemas.inference import (
    ArtifactRebuildRequest,
    ArtifactRebuildResponse,
)
from .embedding import encode_text

logger = logging.getLogger("recsys.rebuild")

SCHEMA_VERSION = "1.0.0"
POSITIVE_THRESHOLD = 4
RATING_MIN = 1
RATING_MAX = 5
RATING_FLOOR = 0.01
EMBEDDING_DIM = 4


def rebuild_artifacts(
    loader: ArtifactLoader,
    request: ArtifactRebuildRequest,
    settings: Settings,
) -> ArtifactRebuildResponse:
    """Rebuild all artifact files from provided catalogue snapshot and interactions,
    then hot-reload them into the ArtifactLoader singleton.
    """
    started_at = time.perf_counter()
    artifact_dir = Path(settings.artifact_dir).resolve()
    models_dir = artifact_dir / "models"
    outputs_dir = artifact_dir / "outputs"
    models_dir.mkdir(parents=True, exist_ok=True)
    outputs_dir.mkdir(parents=True, exist_ok=True)

    # 1. Build DataFrame
    rows: List[Dict[str, Any]] = []
    for item in request.items:
        rows.append({
            "item_id": int(item.item_id),
            "name": str(item.name).strip(),
            "description": str(item.description or "").strip(),
            "category_group": str(item.category_group or "").strip(),
            "performance_type": str(item.performance_type or "").strip(),
            "performers_count": item.performers_count,
            "duration_minutes": item.duration_minutes,
            "price_text": str(item.price_text or "").strip(),
            "is_active": bool(item.is_active),
            "keyword_names": list(item.keyword_names),
            "context_names": list(item.context_names),
            "taxonomy_paths": list(item.taxonomy_paths),
        })

    items_df = pd.DataFrame(rows)
    if items_df.empty:
        raise ValueError("Cannot rebuild artifacts with an empty items list.")

    # 2. Build Item Passages & Embeddings
    passages: List[str] = []
    for _, row in items_df.iterrows():
        parts = [str(row["name"]), str(row.get("description", ""))]
        passages.append(" ".join(p for p in parts if p).strip())

    item_ids: List[int] = items_df["item_id"].astype(int).tolist()
    use_synthetic = request.synthetic_embeddings or not settings.e5_enabled

    if use_synthetic:
        mat = np.zeros((len(item_ids), EMBEDDING_DIM), dtype=np.float32)
        for idx, iid in enumerate(item_ids):
            local_rng = np.random.default_rng(int(iid))
            mat[idx] = local_rng.standard_normal(EMBEDDING_DIM).astype(np.float32)
        norms = np.linalg.norm(mat, axis=1, keepdims=True)
        norms[norms == 0] = 1.0
        vectors = mat / norms
    else:
        vectors_list: List[np.ndarray] = []
        for passage in passages:
            vec = encode_text(passage)
            vectors_list.append(vec)
        vectors = np.stack(vectors_list).astype(np.float32)

    # 3. Build Collaborative Filtering (CF) Indices
    positive_by_user: Dict[str, List[int]] = {}
    item_users: Dict[int, List[str]] = {}
    rating_weight: Dict[str, float] = {}

    for inter in request.interactions:
        user_key = str(inter.user_key).strip()
        iid = int(inter.item_id)
        rating = int(inter.rating)
        if rating < POSITIVE_THRESHOLD or not user_key:
            continue
        positive_by_user.setdefault(user_key, []).append(iid)
        item_users.setdefault(iid, []).append(user_key)
        # Normalize rating weight
        weight = RATING_FLOOR + (1.0 - RATING_FLOOR) * (rating - RATING_MIN) / (RATING_MAX - RATING_MIN)
        rating_weight[f"{user_key}::{iid}"] = float(weight)

    # 4. Save Model Artifacts to Disk
    np.savez_compressed(models_dir / "item_embeddings.npz", vectors=vectors)
    (models_dir / "item_embedding_ids.json").write_text(
        json.dumps(item_ids, ensure_ascii=False), encoding="utf-8"
    )
    (models_dir / "cf_user_item.json").write_text(
        json.dumps(positive_by_user, ensure_ascii=False), encoding="utf-8"
    )
    (models_dir / "cf_item_users.json").write_text(
        json.dumps({str(k): v for k, v in item_users.items()}, ensure_ascii=False),
        encoding="utf-8",
    )
    (models_dir / "cf_user_item_rating.json").write_text(
        json.dumps(rating_weight, ensure_ascii=False), encoding="utf-8"
    )

    # 5. Save Output Artifacts to Disk
    items_df.to_parquet(outputs_dir / "catalog.parquet", index=False)
    metadata = {
        "schema_version": SCHEMA_VERSION,
        "build_timestamp": datetime.now(timezone.utc).isoformat(),
        "item_count": int(len(items_df)),
        "positive_user_count": int(len(positive_by_user)),
        "unique_item_user_edges": int(len(item_users)),
        "embedding_dim": int(vectors.shape[1]),
        "synthetic_embeddings": bool(use_synthetic),
    }
    # Preserve best_model_config if exists
    best_config_path = outputs_dir / "best_model_config.json"
    if best_config_path.exists():
        try:
            metadata["best_model_config"] = json.loads(best_config_path.read_text(encoding="utf-8"))
        except Exception:
            pass

    (outputs_dir / "metadata.json").write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    # 6. Hot-reload into loader memory under lock
    with get_lock():
        loader.load(artifact_dir)

    duration_ms = round((time.perf_counter() - started_at) * 1000, 2)
    logger.info(
        "Rebuilt and hot-reloaded %d items (embedding_dim=%d) in %.2f ms",
        len(items_df),
        vectors.shape[1],
        duration_ms,
    )

    return ArtifactRebuildResponse(
        status="ok",
        artifact_version=SCHEMA_VERSION,
        item_count=len(items_df),
        embedding_dim=int(vectors.shape[1]),
        duration_ms=duration_ms,
    )
