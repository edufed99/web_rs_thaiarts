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
    strength: float = 1.0,
    positive_threshold: int = 4,
) -> Dict[int, float]:
    """Monotonically demote items carrying an explicit negative rating.

    Hybrid scores are z-calibrated and may be negative, so multiplying by a
    factor below one can accidentally *increase* a score (for example,
    ``-1 * 0.2 == -0.2``).  Instead subtract a severity-scaled amount:

    ``adjusted = score - strength * (positive_threshold - rating) /
    (positive_threshold - 1)``

    With the default positive threshold of 4, ratings 1/2/3 receive severity
    1, 2/3, and 1/3 respectively.  The clamped severity guarantees that an
    adjusted score never exceeds its original score.
    """
    if not negative_item_ratings:
        return dict(scores)
    penalty_strength = max(float(strength), 0.0)
    denominator = max(int(positive_threshold) - 1, 1)
    adjusted = dict(scores)
    for item_id, raw_rating in negative_item_ratings.items():
        if item_id not in adjusted:
            continue
        severity = (int(positive_threshold) - int(raw_rating)) / denominator
        severity = min(max(float(severity), 0.0), 1.0)
        adjusted[item_id] = adjusted[item_id] - (penalty_strength * severity)
    return adjusted
