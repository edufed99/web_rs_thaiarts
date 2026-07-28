"""
services/hybrid_service.py — Port of recommender/hybrid.py.

z-score calibration of CBF and CF scores, then a weighted sum.
"""
from __future__ import annotations

from typing import Dict, Optional

import numpy as np

from ..core.config import Settings


def weighted_sum(
    cbf_scores: Dict[int, float],
    cf_scores: Dict[int, float],
    alpha: Optional[float] = None,
    settings: Optional[Settings] = None,
) -> Dict[int, float]:
    settings = settings or Settings()
    if alpha is None:
        alpha = float(settings.hybrid_alpha)
    item_ids = sorted(set(cbf_scores) | set(cf_scores))
    if not item_ids:
        return {}
    cbf_arr = np.asarray([cbf_scores.get(iid, 0.0) for iid in item_ids], dtype=np.float64)
    cf_arr = np.asarray([cf_scores.get(iid, 0.0) for iid in item_ids], dtype=np.float64)
    cbf_z, cf_z = _calibrate_zscore(cbf_arr, cf_arr)
    fused = (alpha * cbf_z) + ((1.0 - alpha) * cf_z)
    return {iid: float(score) for iid, score in zip(item_ids, fused)}


def _calibrate_zscore(cbf_arr: np.ndarray, cf_arr: np.ndarray):
    return _zscore(cbf_arr), _zscore(cf_arr)


def _zscore(values: np.ndarray) -> np.ndarray:
    std = float(np.std(values))
    if std < 1e-12:
        return np.zeros_like(values, dtype=np.float32)
    return ((values - float(np.mean(values))) / std).astype(np.float32)


def apply_negative_penalty(
    scores: Dict[int, float],
    negative_item_ratings: Dict[int, int],
    alpha: float = 1.0,
) -> Dict[int, float]:
    """
    Mirrors recommender.services.apply_negative_penalty: multiply by
    (raw_rating / 5) ** alpha for each negatively-rated item.
    """
    if not negative_item_ratings:
        return dict(scores)
    adjusted = dict(scores)
    for item_id, raw_rating in negative_item_ratings.items():
        if item_id not in adjusted:
            continue
        factor = (raw_rating / 5.0) ** alpha
        adjusted[item_id] = adjusted[item_id] * factor
    return adjusted