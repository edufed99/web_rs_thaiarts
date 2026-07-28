"""Tests for services.hybrid_service."""
from __future__ import annotations

import numpy as np
import pytest

from app.core.config import Settings
from app.services.hybrid_service import apply_negative_penalty, weighted_sum


def test_weighted_sum_combines_two_dicts():
    cbf = {1: 0.9, 2: 0.5}
    cf = {1: 0.2, 2: 0.8, 3: 0.4}
    fused = weighted_sum(cbf, cf, alpha=0.5)
    assert set(fused) == {1, 2, 3}


def test_zscore_normalization():
    """After z-score, mean ≈ 0 and std ≈ 1 for both inputs."""
    cbf = {1: 0.1, 2: 0.5, 3: 0.9}
    cf = {1: 0.2, 2: 0.4, 3: 0.6}
    fused = weighted_sum(cbf, cf, alpha=0.7)
    arr = np.asarray([fused[k] for k in sorted(fused)])
    assert abs(float(arr.mean())) < 1e-5
    assert abs(float(arr.std()) - 1.0) < 1e-4


def test_alpha_zero_uses_only_cf():
    cbf = {1: 1.0, 2: 0.0}
    cf = {1: 0.0, 2: 1.0}
    fused = weighted_sum(cbf, cf, alpha=0.0)
    # After zscore, fused[i] = cf_z[i]. So fused[1] < fused[2].
    assert fused[1] < fused[2]


def test_alpha_one_uses_only_cbf():
    cbf = {1: 1.0, 2: 0.0}
    cf = {1: 1.0, 2: 0.0}
    fused = weighted_sum(cbf, cf, alpha=1.0)
    assert fused[1] > fused[2]


def test_degenerate_constant_scores_return_zeros():
    """All identical scores → std=0 → zscore=0 → fused=0."""
    cbf = {1: 0.5, 2: 0.5, 3: 0.5}
    cf = {1: 0.5, 2: 0.5, 3: 0.5}
    fused = weighted_sum(cbf, cf, alpha=0.5)
    for v in fused.values():
        assert v == 0.0


def test_alpha_default_from_settings():
    s = Settings(hybrid_alpha=0.3)
    cbf = {1: 1.0, 2: 0.0}
    cf = {1: 0.0, 2: 1.0}
    fused = weighted_sum(cbf, cf, settings=s)
    # alpha=0.3 → cf dominates (0.7 weight on cf_z) → fused[2] > fused[1]
    assert fused[2] > fused[1]
    # Confirm a high alpha flips the ordering
    s2 = Settings(hybrid_alpha=0.8)
    fused2 = weighted_sum(cbf, cf, settings=s2)
    assert fused2[1] > fused2[2]


def test_negative_penalty_scales_by_rating():
    scores = {1: 1.0, 2: 0.5, 3: 0.2}
    adjusted = apply_negative_penalty(
        scores, {2: 3, 3: 1}, alpha=1.0,
    )
    # factor = (rating/5)^1
    assert adjusted[1] == 1.0  # not penalized
    assert adjusted[2] == pytest.approx(0.5 * (3/5))
    assert adjusted[3] == pytest.approx(0.2 * (1/5))


def test_negative_penalty_no_negatives_is_noop():
    scores = {1: 1.0, 2: 0.5}
    assert apply_negative_penalty(scores, {}) == scores


def test_negative_penalty_ignores_unknown_items():
    scores = {1: 1.0}
    adjusted = apply_negative_penalty(scores, {9999: 1})
    assert adjusted == scores


def test_negative_penalty_with_alpha_exponent():
    scores = {1: 1.0}
    adjusted = apply_negative_penalty(scores, {1: 2}, alpha=2.0)
    assert adjusted[1] == pytest.approx(1.0 * (2/5)**2)


def test_empty_inputs_returns_empty():
    assert weighted_sum({}, {}) == {}