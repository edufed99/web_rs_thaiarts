"""
model_loader.py — Loads and serves the static artifacts produced by the
pipeline.

The loader is instantiated once during FastAPI startup (see ``app.lifespan``).
After that, all service code reads from in-memory attributes — never from disk.

Required layout under ``artifact_dir``::

    artifacts/
        models/
            item_embeddings.npz
            item_embedding_ids.json
            cf_user_item.json
            cf_item_users.json
            cf_user_item_rating.json
        outputs/
            catalog.parquet
            metadata.json
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd

from .core.exceptions import ArtifactsNotLoadedError


REQUIRED_OUTPUTS = ["catalog.parquet", "metadata.json"]
REQUIRED_MODELS = [
    "item_embeddings.npz",
    "item_embedding_ids.json",
    "cf_user_item.json",
    "cf_item_users.json",
    "cf_user_item_rating.json",
]


@dataclass
class ArtifactLoader:
    """
    Holds in-memory copies of the recommender artifacts. Created empty; call
    ``load()`` to populate it. Designed to be instantiated once at startup.
    """

    artifact_dir: Optional[Path] = None
    _items: Optional[pd.DataFrame] = field(default=None, init=False)
    _item_ids: List[int] = field(default_factory=list, init=False)
    _embeddings: Optional[np.ndarray] = field(default=None, init=False)
    _id_to_row: Dict[int, int] = field(default_factory=dict, init=False)
    _cf_user_item: Dict[str, List[int]] = field(default_factory=dict, init=False)
    _cf_item_users: Dict[int, List[str]] = field(default_factory=dict, init=False)
    _cf_rating_weight: Dict[str, float] = field(default_factory=dict, init=False)
    _metadata: Dict[str, Any] = field(default_factory=dict, init=False)
    _best_model_config: Dict[str, Any] = field(default_factory=dict, init=False)
    _loaded_at: Optional[str] = field(default=None, init=False)

    # ---- public state ----

    @property
    def is_loaded(self) -> bool:
        return self._items is not None

    @property
    def items(self) -> pd.DataFrame:
        if self._items is None:
            raise ArtifactsNotLoadedError(
                "Artifacts are not loaded. Did startup run successfully?"
            )
        return self._items

    @property
    def item_ids(self) -> List[int]:
        return list(self._item_ids)

    @property
    def embeddings(self) -> np.ndarray:
        if self._embeddings is None:
            raise ArtifactsNotLoadedError("Embeddings not loaded.")
        return self._embeddings

    @property
    def id_to_row(self) -> Dict[int, int]:
        return dict(self._id_to_row)

    @property
    def cf_user_item(self) -> Dict[str, List[int]]:
        return dict(self._cf_user_item)

    @property
    def cf_item_users(self) -> Dict[int, List[str]]:
        return dict(self._cf_item_users)

    @property
    def cf_rating_weight(self) -> Dict[str, float]:
        return dict(self._cf_rating_weight)

    @property
    def metadata(self) -> Dict[str, Any]:
        return dict(self._metadata)

    @property
    def best_model_config(self) -> Dict[str, Any]:
        return dict(self._best_model_config)

    @property
    def loaded_at(self) -> Optional[str]:
        return self._loaded_at

    # ---- helpers ----

    def item_row(self, item_id: int) -> Optional[pd.Series]:
        """Return the row for an item id, or None if not present."""
        idx = self._id_to_row.get(int(item_id))
        if idx is None:
            return None
        return self._items.iloc[idx]

    def embedding_for(self, item_id: int) -> Optional[np.ndarray]:
        """Return the embedding vector for an item id, or None."""
        idx = self._id_to_row.get(int(item_id))
        if idx is None:
            return None
        return self._embeddings[idx]

    def user_rating_weight(self, user_key: str, item_id: int) -> float:
        """Look up the cached rating weight for a (user, item) pair."""
        return self._cf_rating_weight.get(f"{user_key}::{int(item_id)}", 1.0)

    # ---- loading ----

    def load(self, artifact_dir: Path) -> "ArtifactLoader":
        """Read all artifacts from disk into memory. Raises on any missing file."""
        artifact_dir = Path(artifact_dir).resolve()
        if not artifact_dir.exists():
            raise ArtifactsNotLoadedError(
                f"Artifact directory not found: {artifact_dir}"
            )

        models_dir = artifact_dir / "models"
        outputs_dir = artifact_dir / "outputs"
        self._raise_if_missing(models_dir, REQUIRED_MODELS, "models")
        self._raise_if_missing(outputs_dir, REQUIRED_OUTPUTS, "outputs")

        try:
            # --- outputs/catalog.parquet ---
            items = pd.read_parquet(outputs_dir / "catalog.parquet")
            # item_id column is required
            if "item_id" not in items.columns:
                raise ArtifactsNotLoadedError(
                    "catalog.parquet missing required 'item_id' column."
                )
            # Normalize column dtypes
            if "is_active" not in items.columns:
                items["is_active"] = True
            else:
                items["is_active"] = items["is_active"].fillna(True).astype(bool)

            for col in ("keyword_names", "context_names", "taxonomy_paths"):
                if col not in items.columns:
                    items[col] = [[] for _ in range(len(items))]
                else:
                    items[col] = items[col].apply(_ensure_list)

            self._items = items.reset_index(drop=True)

            # --- outputs/metadata.json ---
            with (outputs_dir / "metadata.json").open("r", encoding="utf-8") as fh:
                self._metadata = json.load(fh)
            self._best_model_config = _load_best_model_config(outputs_dir, self._metadata)
            if self._best_model_config:
                self._metadata.setdefault("best_model_config", self._best_model_config)

            # --- models/item_embeddings.npz ---
            with np.load(models_dir / "item_embeddings.npz") as data:
                vectors = data["vectors"]
            self._embeddings = vectors.astype(np.float32, copy=False)

            # --- models/item_embedding_ids.json ---
            with (models_dir / "item_embedding_ids.json").open("r", encoding="utf-8") as fh:
                ids = json.load(fh)
            self._item_ids = [int(x) for x in ids]

            # Validate embedding matrix dimensions
            if self._embeddings.shape[0] != len(self._item_ids):
                raise ArtifactsNotLoadedError(
                    f"item_embeddings.npz has {self._embeddings.shape[0]} rows but "
                    f"item_embedding_ids.json has {len(self._item_ids)} ids."
                )

            # Build id -> row index map using the embeddings order (matches pipeline)
            self._id_to_row = {int(iid): idx for idx, iid in enumerate(self._item_ids)}

            # Cross-check: every id should exist in items dataframe
            missing = [iid for iid in self._item_ids if int(iid) not in set(items["item_id"].astype(int))]
            if missing:
                # Not fatal — but log via metadata flag
                self._metadata["ids_missing_in_catalog"] = len(missing)

            # --- models/cf_user_item.json ---
            with (models_dir / "cf_user_item.json").open("r", encoding="utf-8") as fh:
                self._cf_user_item = {
                    str(k): [int(x) for x in v] for k, v in json.load(fh).items()
                }

            # --- models/cf_item_users.json ---
            with (models_dir / "cf_item_users.json").open("r", encoding="utf-8") as fh:
                raw = json.load(fh)
            self._cf_item_users = {int(k): [str(u) for u in v] for k, v in raw.items()}

            # --- models/cf_user_item_rating.json ---
            with (models_dir / "cf_user_item_rating.json").open("r", encoding="utf-8") as fh:
                self._cf_rating_weight = {str(k): float(v) for k, v in json.load(fh).items()}

        except ArtifactsNotLoadedError:
            raise
        except Exception as exc:  # noqa: BLE001
            raise ArtifactsNotLoadedError(
                f"Failed to load artifacts from {artifact_dir}: {exc}"
            ) from exc

        # Stamp load time (ISO-8601 UTC)
        from datetime import datetime, timezone
        self._loaded_at = datetime.now(timezone.utc).isoformat()
        self.artifact_dir = artifact_dir
        return self

    @staticmethod
    def _raise_if_missing(directory: Path, required: List[str], label: str) -> None:
        missing = [name for name in required if not (directory / name).exists()]
        if missing:
            raise ArtifactsNotLoadedError(
                f"Missing artifact files in {label}/: {', '.join(missing)} "
                f"(looked under {directory})"
            )

def _ensure_list(value):
    """Coerce None / NaN / ndarray to a Python list.

    Strings are treated as scalar (wrapped to a single-element list), not as
    iterables of characters.
    """
    if value is None:
        return []
    if isinstance(value, list):
        return value
    if isinstance(value, (str, bytes)):
        return [value]
    try:
        import pandas as pd  # local import to avoid touching module-level import cost
        if pd.isna(value):
            return []
    except Exception:
        pass
    try:
        return list(value)
    except TypeError:
        return [value]


def _load_best_model_config(outputs_dir: Path, metadata: Dict[str, Any]) -> Dict[str, Any]:
    """Load optional serving config manifest without making artifacts fail.

    ``best_model_config.json`` is intentionally optional so older artifacts
    and local test fixtures keep loading. Corrupt manifests are ignored and
    surfaced through metadata flags; runtime settings still fall back to env
    and code defaults.
    """
    embedded = metadata.get("best_model_config")
    if isinstance(embedded, dict):
        return embedded

    path = outputs_dir / "best_model_config.json"
    if not path.exists():
        return {}

    try:
        with path.open("r", encoding="utf-8") as fh:
            loaded = json.load(fh)
        return loaded if isinstance(loaded, dict) else {}
    except Exception as exc:  # noqa: BLE001
        metadata["best_model_config_error"] = str(exc)
        return {}


# Module-level singleton placeholder. Real instance is created in
# app.private_main (the only ASGI entry point since issue #10).
_singleton: Optional[ArtifactLoader] = None


def set_singleton(loader: ArtifactLoader) -> None:
    global _singleton
    _singleton = loader


def get_singleton() -> ArtifactLoader:
    if _singleton is None:
        raise ArtifactsNotLoadedError(
            "ArtifactLoader singleton not initialized. Backend startup did not complete."
        )
    return _singleton


def reset_singleton() -> None:
    """Test helper."""
    global _singleton
    _singleton = None
