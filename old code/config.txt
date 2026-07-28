# -*- coding: utf-8 -*-
"""
config.py — Shared Configuration and Utilities
================================================
Thesis Section 2.3: Eligibility-Gated Recommendation Layer
Maps: Section 2.1 Problem Formulation (parameters and definitions)

This module centralizes all hyperparameters, path settings, and utility
functions used across the recommendation pipeline (Sections 2.3.1–2.3.4).

References:
  - Bouthillier et al. (2021) — multi-seed variance reduction
  - Koren et al. (2009) — BiasedMF
  - Steck (2019) — EASE^R
  - Mao et al. (2021) — SimpleX: Cosine Contrastive Loss
  - Rendle et al. (2021) — simple baselines suffice for small datasets
"""

import re
import ast
import math
import hashlib
import random
import os
import json
import numpy as np
import pandas as pd
import torch

# ═══════════════════════════════════════════════════════════════════════════
# SECTION 2.1 — Problem Formulation: Rating Scale and Thresholds
# ═══════════════════════════════════════════════════════════════════════════
RATING_SCALE_MIN = 1
RATING_SCALE_MAX = 5
# RATING_FLOOR: minimum normalized rating for negative interactions.
# Old value 0.2 was too high — rating=1 maps to 0.2, making negative_penalty
# nearly ineffective because (raw_r/5)^1.0 = 0.2 still preserves 20% of score.
# With 0.01, rating=1 → 0.01, so negative_penalty*(1/5)^1.0 = 0.2 still
# but the normalized value is near-zero, correctly treating dislikes as noise.
# This prevents disliked items from receiving non-trivial CF signal.
RATING_FLOOR = 0.01
# POSITIVE_THRESHOLD: on 5-point Likert, rating >= 4 = "liked" (top-2 box).
# Users with >= 3 positive interactions qualify for leave-2-out evaluation.
POSITIVE_THRESHOLD = 4

# ═══════════════════════════════════════════════════════════════════════════
# GLOBAL SETTINGS (Bouthillier et al., 2021 — multi-seed variance reduction)
# ═══════════════════════════════════════════════════════════════════════════
SEEDS = [42, 123, 999, 2024, 555]
K = 10  # top-K for HR@K, nDCG@K, MRR@K
BATCH_SIZE = 32

# ═══════════════════════════════════════════════════════════════════════════
# SECTION 2.3.1 — Eligibility Gate Parameters
# ═══════════════════════════════════════════════════════════════════════════
ENABLE_CONTEXT_FILTERING = True
ENABLE_FUZZY_CTX = True
FUZZY_CUTOFF_DEFAULT = 0.86
FUZZY_CUTOFF_GRID = [0.80, 0.82, 0.84, 0.86, 0.88, 0.90, 0.92]
FUZZY_CUTOFF = FUZZY_CUTOFF_DEFAULT
MIN_CANDS = 10
CAP_CTX_POOL = None
MAX_CANDS_LIST = [20, 40, 80, None]
CONTEXT_PREFILTER_CF_TRAINING = False

# ═══════════════════════════════════════════════════════════════════════════
# SECTION 2.3.2 — Content-Based Scoring Parameters
# ═══════════════════════════════════════════════════════════════════════════
QK_MIN, QK_MAX = 2, 4
USE_ALL_LOG_KEYWORDS = False
B_RANGE_CBF = [0.0, 0.05, 0.10, 0.15, 0.20, 0.25, 0.30]

# Embedding models for CBF
# ConGen (Thavarpornkit et al., 2023): Thai contrastive learning encoder
# GTE-multilingual (Wang et al., 2024): SOTA multilingual encoder
EMBEDDING_MODELS = [
    'intfloat/multilingual-e5-large-instruct',
    'BAAI/bge-m3',
    'kornwtp/SCT-KD-model-phayathaibert',
    'airesearch/wangchanberta-base-att-spm-uncased',
]

# Map short name (from CBF results) back to full HuggingFace model ID
CBF_SHORT_TO_FULL = {m.split('/')[-1]: m for m in EMBEDDING_MODELS}

# ═══════════════════════════════════════════════════════════════════════════
# SECTION 2.3.3 — Collaborative Filtering Parameters
# ═══════════════════════════════════════════════════════════════════════════
CF_MODELS_TO_TEST = ["EASE_R", "BiasedMF", "BiasedMF-BPR", "ItemKNN", "SimpleX"]
B_RANGE_CF = [0.0, 0.05, 0.10, 0.15, 0.20, 0.25, 0.30]

# ── BiasedMF (Koren et al., 2009) ──
# On a small dataset (~2574 training pairs, 156 users), the previous config
# used batch_size=4096 which exceeds the dataset size, resulting in only
# 1 gradient update per epoch and 40 total updates — far too few.
# Reducing batch_size to 256 yields ~10 updates/epoch, and increasing
# epochs to 100 gives ~1000 total updates. Raising l2 from 1e-4 to 1e-3
# adds stronger regularization to prevent overfitting on sparse data.
# (Rendle et al., 2021) recommend dim=16 for small datasets.
BIASED_MF_CFG = dict(
    dim=16,           # Embedding dimension; 16 is standard for small datasets (Rendle et al., 2021)
    epochs=100,       # 100 epochs with batch_size=256 → ~1000 gradient updates (was 40)
    lr=1e-3,          # Lower lr for stability with more frequent updates (was 5e-3)
    l2=1e-3,          # Stronger regularization to prevent overfitting on 2574 pairs (was 1e-4)
    batch_size=256,    # 256 ensures ~10 batches/epoch instead of 1 (was 4096 > dataset size)
)

# ── EASE^R (Steck, 2019) ──
# Closed-form solution; only hyperparameter is L2 regularization.
# Higher lambda values (10–250) are appropriate for small datasets
# because they prevent the 1022×1022 weight matrix from overfitting.
# Grid search on validation set selects the best lambda.
EASE_R_CFG = dict(l2_reg_grid=[10, 50, 100, 250])

# ── ItemKNN ──
# On sparse data (85.5% sparsity, avg 2–3 shared users per item pair),
# k=20 pulls in distant neighbors with weak signal, and shrink=100
# over-regularizes already-small similarity values.
# k=10 focuses on the most similar neighbors, and shrink=50 provides
# moderate regularization. Grid search on validation to select best.
KNN_CFG = dict(
    k_neighbors=10,   # Reduced from 20; on sparse data, nearest-10 neighbors carry more signal than nearest-20
    shrink=50,         # Reduced from 100; less aggressive shrinkage on sparse similarity matrices
)

# ── SimpleX (Mao et al., CIKM 2021) ──
# MF with Cosine Contrastive Loss (CCL). Key insight: loss function matters
# more than model architecture.
#
# IMPORTANT: neg_ratio must be proportional to the ACTUAL negative pool size.
# With ~2574 training pairs and ~114 items, each user has ~98 negative items
# on average. neg_ratio=200 means sampling 200 negatives from a pool of ~98,
# causing ~2x resampling (duplicates), which weakens contrastive signal.
# Mao et al. recommend neg_ratio=400+ for LARGE datasets (millions of items).
# For our dataset, neg_ratio=20–50 (20–50% of the negative pool) provides
# meaningful contrastive signal without excessive duplication.
# Per-user SGD requires lower lr than mini-batch training.
# L2 regularization is critical to prevent overfitting on small data.
SIMPLEX_CFG = dict(
    dim=16,           # Same as BiasedMF for fair comparison
    epochs=100,       # Increased from 40; per-user SGD needs more passes
    lr=1e-3,          # Lower lr for per-user SGD stability (was 5e-3)
    l2=1e-3,          # L2 regularization on embeddings (was missing from loss!)
    neg_ratio=40,     # ~40% of negative pool (~98 items); Mao et al. recommend 400+ for large data
    pos_margin=0.5,   # Cosine similarity target for positives; reasonable for dim=16
    neg_margin=0.3,   # Reduced from 0.5; random cosine in dim=16 is ~0, so 0.3 is already high
    w_neg=0.3,        # Reduced from 0.5; gives more weight to positive signal
)

# Hard-negative sampling
USE_HARD_NEGATIVES = True
HARD_NEG_RATIO = 0.5
HARD_NEG_PER_POS = 2
USE_POPULARITY_BIASED_NEG = True
POP_NEG_RATIO = 0.3

# ═══════════════════════════════════════════════════════════════════════════
# CF HYPERPARAMETER GRID SEARCH (tuned on validation set)
# ═══════════════════════════════════════════════════════════════════════════
# Grids for CF models that previously used fixed hyperparameters.
# Each grid is a list of config dicts; the best config is selected by
# validation nDCG@10, consistent with how b_cf and EASE^R lambda are tuned.
BIASED_MF_CFG_GRID = [
    dict(dim=16, epochs=100, lr=1e-3, l2=1e-3, batch_size=256),    # original
    dict(dim=16, epochs=100, lr=1e-3, l2=1e-2, batch_size=256),    # stronger reg
    dict(dim=16, epochs=100, lr=5e-3, l2=1e-3, batch_size=256),    # higher lr
    dict(dim=16, epochs=100, lr=5e-3, l2=1e-2, batch_size=256),    # higher lr + stronger reg
    dict(dim=32, epochs=100, lr=1e-3, l2=1e-3, batch_size=256),    # larger dim
    dict(dim=32, epochs=100, lr=1e-3, l2=1e-2, batch_size=256),    # larger dim + stronger reg
]

# ── BiasedMF-BPR ──
# Same architecture as BiasedMF (embedding + bias) but with BPR loss
# (Rendle et al., 2009) instead of MSE. Designed for implicit/binary feedback
# where the rating distribution is bimodal (most ratings are 1 or 5,
# with rating=3 at only 0.9%). BPR optimizes ranking (positive > negative)
# rather than predicting exact rating values, making it more robust when
# intermediate ratings are virtually absent.
BIASED_MF_BPR_CFG = dict(
    dim=16,
    epochs=100,
    lr=1e-3,
    l2=1e-3,
    batch_size=256,
)

BIASED_MF_BPR_CFG_GRID = [
    dict(dim=16, epochs=100, lr=1e-3, l2=1e-3, batch_size=256),    # original
    dict(dim=16, epochs=100, lr=1e-3, l2=1e-2, batch_size=256),    # stronger reg
    dict(dim=16, epochs=100, lr=5e-3, l2=1e-3, batch_size=256),    # higher lr
    dict(dim=16, epochs=100, lr=5e-3, l2=1e-2, batch_size=256),    # higher lr + stronger reg
    dict(dim=32, epochs=100, lr=1e-3, l2=1e-3, batch_size=256),    # larger dim
    dict(dim=32, epochs=100, lr=1e-3, l2=1e-2, batch_size=256),    # larger dim + stronger reg
]

KNN_CFG_GRID = [
    dict(k_neighbors=5, shrink=10),
    dict(k_neighbors=5, shrink=50),
    dict(k_neighbors=10, shrink=10),
    dict(k_neighbors=10, shrink=50),     # original
    dict(k_neighbors=10, shrink=100),
    dict(k_neighbors=20, shrink=50),
    dict(k_neighbors=20, shrink=100),
]

SIMPLEX_CFG_GRID = [
    dict(dim=16, epochs=100, lr=1e-3, l2=1e-3, neg_ratio=20, pos_margin=0.5, neg_margin=0.3, w_neg=0.3),    # ~20% of neg pool
    dict(dim=16, epochs=100, lr=1e-3, l2=1e-3, neg_ratio=40, pos_margin=0.5, neg_margin=0.3, w_neg=0.3),    # ~40% of neg pool
    dict(dim=16, epochs=100, lr=1e-3, l2=1e-3, neg_ratio=60, pos_margin=0.5, neg_margin=0.3, w_neg=0.3),    # ~60% of neg pool
    dict(dim=16, epochs=100, lr=1e-3, l2=1e-3, neg_ratio=80, pos_margin=0.5, neg_margin=0.3, w_neg=0.3),    # ~80% of neg pool
    dict(dim=16, epochs=100, lr=1e-3, l2=1e-2, neg_ratio=40, pos_margin=0.5, neg_margin=0.3, w_neg=0.3),    # stronger reg
    dict(dim=16, epochs=100, lr=1e-3, l2=1e-3, neg_ratio=40, pos_margin=0.3, neg_margin=0.1, w_neg=0.3),    # tighter margins
    dict(dim=32, epochs=100, lr=1e-3, l2=1e-3, neg_ratio=40, pos_margin=0.5, neg_margin=0.3, w_neg=0.3),    # larger dim
]

# ═══════════════════════════════════════════════════════════════════════════
# SECTION 2.3.4 — Hybrid Fusion Parameters
# ═══════════════════════════════════════════════════════════════════════════
ALPHA_RANGE_HYBRID = [0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]
K_RRF_GRID = [10, 30, 60, 100, 200]
NEGATIVE_PENALTY_ALPHA = 1.0

# ═══════════════════════════════════════════════════════════════════════════
# KEYWORD LEAKAGE FILTER
# ═══════════════════════════════════════════════════════════════════════════
# When True, removes the exact target item name from selected keywords
# before scoring. This prevents the CBF query and keyword boost from
# "cheating" by using the target item's own name. Affects ~1% of cases.
# Analysis: 50/2574 interactions (1.9%) have item name in keywords_list,
# and 76/7632 simulated test queries (1.0%) have item name in selected_kws.
FILTER_TARGET_NAME_FROM_KW = True

# ═══════════════════════════════════════════════════════════════════════════
# DEVICE — CPU mode for AMD Radeon 890M (Windows)
# PyTorch CUDA requires NVIDIA GPU; ROCm (AMD) is Linux-only.
# For this dataset (114 items), CPU is sufficient.
# ═══════════════════════════════════════════════════════════════════════════
DEVICE = "cpu"

# ═══════════════════════════════════════════════════════════════════════════
# PATHS — Local Windows paths
# ═══════════════════════════════════════════════════════════════════════════
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(SCRIPT_DIR, "input")
OUTPUT_DIR = os.path.join(SCRIPT_DIR, "output")
os.makedirs(OUTPUT_DIR, exist_ok=True)

USER_FILE = os.path.join(DATA_DIR, "user_log_with_keywords_only_list.csv")
ITEM_FILE = os.path.join(DATA_DIR, "all_item_130868.csv")
MAPPING_FILE = os.path.join(DATA_DIR, "mapped_words_to_items95_default.csv")
CONSENSUS_FILE = os.path.join(DATA_DIR, "consensus_classification.csv")


def mc_store(mc):
    """String representation of max_cands for display."""
    return mc if mc is not None else "all"


# ═══════════════════════════════════════════════════════════════════════════
# MODEL REGISTRY — Used for paper tables and result labeling
# ═══════════════════════════════════════════════════════════════════════════
MODEL_REGISTRY = {
    'CBF-multilingual-e5-large-instruct': {'family': 'CBF', 'name': 'multilingual-e5-large-instruct'},
    'CBF-bge-m3': {'family': 'CBF', 'name': 'bge-m3'},
    'CBF-SCT-KD-model-phayathaibert': {'family': 'CBF', 'name': 'SCT-KD-model-phayathaibert'},
    'CBF-wangchanberta-base-att-spm-uncased': {'family': 'CBF', 'name': 'wangchanberta-base-att-spm-uncased'},
    'CF-EASE_R': {'family': 'CF', 'name': 'EASE_R'},
    'CF-BiasedMF': {'family': 'CF', 'name': 'BiasedMF'},
    'CF-BiasedMF-BPR': {'family': 'CF', 'name': 'BiasedMF-BPR'},
    'CF-ItemKNN': {'family': 'CF', 'name': 'ItemKNN'},
    'CF-SimpleX': {'family': 'CF', 'name': 'SimpleX'},
    'POP-Global': {'family': 'POP', 'name': 'GlobalMostPopular'},
    'POP-Context': {'family': 'POP', 'name': 'ContextMostPopular'},
}


# ═══════════════════════════════════════════════════════════════════════════
# UTILITY FUNCTIONS — Shared across all modules
# ═══════════════════════════════════════════════════════════════════════════

def set_seed(seed: int):
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)


def clean_text(x) -> str:
    if pd.isna(x):
        return ""
    return re.sub(r"\s+", " ", str(x)).strip()


def normalize_context(s) -> str:
    """Normalize context string for fuzzy matching."""
    if pd.isna(s):
        return ""
    s = str(s).strip()
    s = re.sub(r"\([^)]*\)", " ", s)
    s = re.sub(r"（[^）]*）", " ", s)
    s = re.sub(r"\[[^\]]*\]", " ", s)
    s = re.sub(r"\{[^}]*\}", " ", s)
    s = re.sub(r"[,/;:|•·\-–—_]+", " ", s)
    s = s.strip(" ,.;:()[]{}\"'‘’“”")
    s = re.sub(r"\s+", " ", s).strip()
    return s


def stable_int_seed(*parts) -> int:
    """Deterministic seed from multiple parts (reproducible splits)."""
    raw = "||".join([str(p) for p in parts])
    h = hashlib.md5(raw.encode("utf-8")).hexdigest()
    return int(h[:8], 16)


def parse_keywords_list(x):
    """Parse keywords_list column (string or list)."""
    if isinstance(x, list):
        return [clean_text(w) for w in x if clean_text(w)]
    if pd.isna(x):
        return []
    s = str(x).strip()
    if not s:
        return []
    try:
        v = ast.literal_eval(s)
        if isinstance(v, list):
            return [clean_text(w) for w in v if clean_text(w)]
    except Exception:
        pass
    parts = [clean_text(p) for p in s.split(",")]
    return [p for p in parts if p]


def pick_keywords_from_log(log_kw_list, seed_int: int, kmin=QK_MIN, kmax=QK_MAX):
    """Deterministic keyword sampling for consistent candidate sets."""
    if not log_kw_list:
        return []
    words = [w for w in log_kw_list if clean_text(w)]
    if not words:
        return []
    rng = np.random.default_rng(seed_int)
    take = int(rng.integers(kmin, kmax + 1))
    take = min(take, len(words))
    idx = rng.choice(len(words), size=take, replace=False)
    return [words[i] for i in idx]


def normalize_rating(raw_r):
    """Map raw rating to [RATING_FLOOR, 1.0] using fixed scale (no leakage).

    With RATING_FLOOR=0.01 (changed from 0.2):
      rating 1 → 0.01  (was 0.20, nearly neutral — now clearly negative)
      rating 2 → 0.26
      rating 3 → 0.50
      rating 4 → 0.76
      rating 5 → 1.00
    This ensures disliked items (rating 1-2) have low normalized values,
    making negative_penalty and CF training more effective at demoting them.
    """
    rmin, rmax = RATING_SCALE_MIN, RATING_SCALE_MAX
    rrange = max(rmax - rmin, 1e-6)
    return RATING_FLOOR + (1.0 - RATING_FLOOR) * (raw_r - rmin) / rrange


def apply_negative_penalty(scores, cands_list, neg_item2rating, alpha=NEGATIVE_PENALTY_ALPHA):
    """Demote candidates the user previously disliked (split-aware).

    Applies a multiplicative penalty based on the raw rating:
    scores[j] *= (raw_r / RATING_SCALE_MAX) ** alpha

    This is a POST-fusion penalty applied after blending CBF and CF scores.
    Note: RATING_FLOOR only affects normalize_rating() (CF training signal),
    NOT this penalty. The penalty factor is (raw_r / 5.0) ** alpha:

    With alpha=1.0:
      rating 1 → 0.20  (preserves 20% of score)
      rating 2 → 0.40  (preserves 40%)
      rating 3 → 0.60  (preserves 60%)

    For stronger demotion, increase alpha (e.g., alpha=2.0 gives rating 1 → 0.04).
    """
    if alpha == 0 or not neg_item2rating:
        return scores
    scores = np.asarray(scores, dtype=np.float64).copy()
    for j, it in enumerate(cands_list):
        raw_r = neg_item2rating.get(it)
        if raw_r is not None:
            scores[j] *= (raw_r / RATING_SCALE_MAX) ** alpha
    return scores


def calculate_metrics(scores, gt_idx: int, k=K):
    """Calculate HR@K, MRR@K, nDCG@K using pessimistic (worst-rank) tie-breaking.

    Pessimistic tie-breaking assigns the worst rank among tied scores (better + equal),
    which is the standard convention in recommender systems evaluation. This avoids
    inflating metrics compared to average or optimistic tie-breaking.
    """
    if isinstance(scores, np.ndarray):
        scores = torch.from_numpy(scores).float()
    gt = scores[gt_idx]
    better = (scores > gt).sum().item()
    equal = torch.isclose(scores, gt, rtol=1e-5, atol=1e-8).sum().item()
    rank = better + equal  # pessimistic: worst rank among ties
    hr = 1.0 if rank <= k else 0.0
    mrr = 1.0 / rank if rank <= k else 0.0
    ndcg = 1.0 / np.log2(rank + 1) if rank <= k else 0.0
    return hr, mrr, ndcg


def minmax_norm(x):
    x = np.asarray(x, dtype=np.float32)
    mn, mx = float(np.min(x)), float(np.max(x))
    if mx - mn < 1e-12:
        return np.zeros_like(x, dtype=np.float32)
    return ((x - mn) / (mx - mn)).astype(np.float32)


def rank_norm(x):
    """Percentile-rank normalization — robust for hybrid blending."""
    from scipy import stats as sp_stats
    x = np.asarray(x, dtype=np.float64)
    n = len(x)
    if n <= 1:
        return np.zeros_like(x, dtype=np.float32)
    ranks = sp_stats.rankdata(x, method='average')
    return ((ranks - 1) / (n - 1)).astype(np.float32)


def get_user_bin(profile_len, cold_threshold=None, heavy_threshold=None):
    if cold_threshold is None or heavy_threshold is None:
        return "mid"
    if profile_len <= cold_threshold:
        return "cold"
    elif profile_len >= heavy_threshold:
        return "heavy"
    return "mid"


def save_config(output_dir):
    """Save experiment config for reproducibility."""
    cfg = {
        "SEEDS": SEEDS, "K": K, "POSITIVE_THRESHOLD": POSITIVE_THRESHOLD,
        "MAX_CANDS_LIST": MAX_CANDS_LIST,
        "ENABLE_CONTEXT_FILTERING": ENABLE_CONTEXT_FILTERING,
        "CONTEXT_PREFILTER_CF_TRAINING": CONTEXT_PREFILTER_CF_TRAINING,
        "RATING_SCALE_MIN": RATING_SCALE_MIN, "RATING_SCALE_MAX": RATING_SCALE_MAX,
        "RATING_FLOOR": RATING_FLOOR, "NEGATIVE_PENALTY_ALPHA": NEGATIVE_PENALTY_ALPHA,
        "EMBEDDING_MODELS": EMBEDDING_MODELS, "CF_MODELS_TO_TEST": CF_MODELS_TO_TEST,
        "B_RANGE_CF": B_RANGE_CF, "B_RANGE_CBF": B_RANGE_CBF,
        "BIASED_MF_CFG": BIASED_MF_CFG, "BIASED_MF_BPR_CFG": BIASED_MF_BPR_CFG,
        "EASE_R_CFG": EASE_R_CFG,
        "KNN_CFG": KNN_CFG, "SIMPLEX_CFG": SIMPLEX_CFG,
        "ALPHA_RANGE_HYBRID": ALPHA_RANGE_HYBRID,
        "ENABLE_FUZZY_CTX": ENABLE_FUZZY_CTX, "FUZZY_CUTOFF": FUZZY_CUTOFF,
        "MIN_CANDS": MIN_CANDS, "CAP_CTX_POOL": CAP_CTX_POOL,
        "QK_MIN": QK_MIN, "QK_MAX": QK_MAX,
        "DEVICE": DEVICE,
    }
    path = os.path.join(output_dir, "experiment_config.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=2, ensure_ascii=False)
    return path