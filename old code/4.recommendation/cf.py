# -*- coding: utf-8 -*-
"""
cf.py — Section 2.3.3 Collaborative Filtering
=============================================
Implements 5 CF models + 2 popularity baselines:

  - EASE^R (Steck, 2019) — closed-form linear autoencoder
  - BiasedMF (Koren et al., 2009) — biased matrix factorization, dim=16
  - BiasedMF-BPR — same architecture as BiasedMF with BPR loss (Rendle et al., 2009)
  - ItemKNN — k-nearest neighbor item similarity
  - SimpleX (Mao et al., 2021) — MF with Cosine Contrastive Loss (CCL)
  - POP-Global — global most popular baseline
  - POP-Context — context-specific most popular baseline

BiasedMF-BPR is an ablation variant showing the effect of loss function
on bimodal rating data: when rating=3 accounts for only 0.9% of interactions,
MSE loss struggles to predict absent intermediate values, while BPR loss
optimizes the ranking objective P(positive > negative) directly.

All models use the eligibility gate (Section 2.3.1) for candidate
construction and keyword-boost tuning on the validation set.

References:
  - Rendle et al. (2009) — BPR: Bayesian Personalized Ranking
  - Rendle et al. (2021) — simple baselines suffice for small datasets
  - Mao et al. (2021) — SimpleX: loss function matters more than architecture
"""

import gc
import hashlib
import json as _json
import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from collections import defaultdict, Counter

from config import (
    set_seed, normalize_rating, apply_negative_penalty, calculate_metrics,
    clean_text, normalize_context, stable_int_seed, mc_store,
    SEEDS, K, RATING_FLOOR, RATING_SCALE_MIN, RATING_SCALE_MAX,
    B_RANGE_CF, DEVICE,
    POSITIVE_THRESHOLD, NEGATIVE_PENALTY_ALPHA,
    BIASED_MF_CFG, BIASED_MF_BPR_CFG, EASE_R_CFG, KNN_CFG, SIMPLEX_CFG,
    BIASED_MF_CFG_GRID, BIASED_MF_BPR_CFG_GRID, KNN_CFG_GRID, SIMPLEX_CFG_GRID,
    USE_HARD_NEGATIVES, HARD_NEG_RATIO, HARD_NEG_PER_POS,
    USE_POPULARITY_BIASED_NEG, POP_NEG_RATIO,
    CONTEXT_PREFILTER_CF_TRAINING,
    FILTER_TARGET_NAME_FROM_KW,
)


# ═══════════════════════════════════════════════════════════════════════════
# HARD-NEGATIVE SAMPLING
# ═══════════════════════════════════════════════════════════════════════════

_item_pop_counts = None


def sample_hard_negatives_for_user(neg_item2rating, all_item_indices,
                                   pos_item_indices_set, n_neg,
                                   hard_ratio=HARD_NEG_RATIO, pop_counts=None,
                                   item2idx=None):
    """Sample hard + popularity-biased + random negatives for a user."""
    hard_pool = []
    for it_name, raw_r in neg_item2rating.items():
        idx = item2idx.get(it_name) if item2idx is not None else None
        if idx is not None and idx not in pos_item_indices_set:
            hard_pool.append((idx, normalize_rating(raw_r)))

    n_hard_want = min(int(n_neg * hard_ratio), len(hard_pool))
    if n_hard_want > 0:
        chosen_idx = np.random.choice(len(hard_pool), size=n_hard_want, replace=False)
        hard_samples = [hard_pool[i] for i in chosen_idx]
    else:
        hard_samples = []

    hard_idx_set = {s[0] for s in hard_samples}
    n_remaining = n_neg - len(hard_samples)

    pop_samples = []
    if USE_POPULARITY_BIASED_NEG and pop_counts is not None and n_remaining > 0:
        n_pop_want = int(n_remaining * POP_NEG_RATIO)
        if n_pop_want > 0:
            excluded = pos_item_indices_set | hard_idx_set
            pop_pool = [(idx, cnt) for idx, cnt in pop_counts.items() if idx not in excluded]
            if pop_pool:
                pop_pool.sort(key=lambda x: -x[1])
                pop_indices = np.array([p[0] for p in pop_pool])
                pop_weights = np.array([p[1] for p in pop_pool], dtype=float)
                pop_weights /= pop_weights.sum()
                n_pop_draw = min(n_pop_want, len(pop_indices))
                chosen_pop = np.random.choice(len(pop_indices), size=n_pop_draw, replace=False, p=pop_weights)
                pop_samples = [(int(pop_indices[i]), RATING_FLOOR) for i in chosen_pop]

    pop_idx_set = {s[0] for s in pop_samples}
    n_random = n_remaining - len(pop_samples)
    if n_random > 0:
        random_pool = [idx for idx in all_item_indices
                       if idx not in pos_item_indices_set and idx not in hard_idx_set
                       and idx not in pop_idx_set]
        if len(random_pool) > n_random:
            chosen = np.random.choice(random_pool, size=n_random, replace=False)
        else:
            chosen = random_pool
        random_samples = [(idx, RATING_FLOOR) for idx in chosen]
    else:
        random_samples = []

    return hard_samples + pop_samples + random_samples


def build_training_pairs_with_hard_negatives(splits_to_use, user2idx, item2idx,
                                             neg_per_pos=HARD_NEG_PER_POS,
                                             hard_ratio=HARD_NEG_RATIO):
    """Build CF training data with hard + random negatives."""
    global _item_pop_counts
    all_item_indices = np.arange(len(item2idx))
    pairs = []

    if USE_POPULARITY_BIASED_NEG and _item_pop_counts is None:
        _item_pop_counts = {}
        for u_data in splits_to_use:
            for it in u_data.get("train_items", []):
                idx = item2idx.get(it)
                if idx is not None:
                    _item_pop_counts[idx] = _item_pop_counts.get(idx, 0) + 1

    for u_data in splits_to_use:
        user = u_data["user"]
        if user not in user2idx:
            continue
        u_idx = user2idx[user]
        item2rat = u_data.get("train_item2rating", {})
        neg_dict = u_data.get("train_neg_item2rating", {})

        pos_indices = set()
        pos_pairs = []
        for it, raw_r in item2rat.items():
            idx = item2idx.get(it)
            if idx is None:
                continue
            r_norm = normalize_rating(raw_r)
            pos_pairs.append((u_idx, idx, r_norm))
            pos_indices.add(idx)

        pairs.extend(pos_pairs)
        n_neg_total = len(pos_pairs) * neg_per_pos
        if n_neg_total == 0:
            continue

        neg_samples = sample_hard_negatives_for_user(
            neg_dict, all_item_indices, pos_indices,
            n_neg=n_neg_total, hard_ratio=hard_ratio,
            pop_counts=_item_pop_counts, item2idx=item2idx,
        )
        for neg_idx, neg_r in neg_samples:
            pairs.append((u_idx, int(neg_idx), float(neg_r)))

    return pairs


# ═══════════════════════════════════════════════════════════════════════════
# CF MODEL TRAINING
# ═══════════════════════════════════════════════════════════════════════════

def train_biased_mf(train_pairs, n_users, n_items, config, device):
    """Biased Matrix Factorization (Koren et al., 2009).

    Training notes for small datasets (~2574 pairs, 156 users):
    - batch_size=256 ensures ~10 gradient updates per epoch (vs 1 update with batch_size=4096)
    - epochs=100 provides sufficient training iterations
    - l2=1e-3 prevents overfitting on sparse data (was 1e-4, too weak)
    - lr=1e-3 is appropriate for the increased update frequency
    """
    from torch.utils.data import DataLoader, TensorDataset

    pairs_array = np.array(train_pairs)
    users = torch.LongTensor(pairs_array[:, 0])
    items = torch.LongTensor(pairs_array[:, 1])
    ratings = torch.FloatTensor(pairs_array[:, 2])
    mu = float(ratings.mean())

    dataset = TensorDataset(users, items, ratings)
    loader = DataLoader(dataset, batch_size=config["batch_size"], shuffle=True)

    U = nn.Embedding(n_users, config["dim"]).to(device)
    V = nn.Embedding(n_items, config["dim"]).to(device)
    b_u = nn.Embedding(n_users, 1).to(device)
    b_i = nn.Embedding(n_items, 1).to(device)
    nn.init.normal_(U.weight, 0, 0.01)
    nn.init.normal_(V.weight, 0, 0.01)
    nn.init.zeros_(b_u.weight)
    nn.init.zeros_(b_i.weight)

    optimizer = torch.optim.Adam(
        list(U.parameters()) + list(V.parameters()) + list(b_u.parameters()) + list(b_i.parameters()),
        lr=config["lr"],
    )

    for epoch in range(config["epochs"]):
        for u, i, r in loader:
            u, i, r = u.to(device), i.to(device), r.to(device).unsqueeze(1)
            pred = mu + b_u(u) + b_i(i) + torch.sum(U(u) * V(i), dim=1, keepdim=True)
            loss = F.mse_loss(pred, r)
            loss += config["l2"] * (torch.sum(U(u)**2) + torch.sum(V(i)**2) + torch.sum(b_u(u)**2) + torch.sum(b_i(i)**2)) / u.shape[0]
            optimizer.zero_grad()
            loss.backward()
            optimizer.step()

    return {"U": U.weight.detach(), "V": V.weight.detach(), "b_u": b_u.weight.detach(), "b_i": b_i.weight.detach(), "mu": mu}


def train_biased_mf_bpr(train_pairs, n_users, n_items, config, device):
    """BiasedMF with BPR loss (Rendle et al., 2009).

    Same architecture as BiasedMF (embedding + bias) but replaces MSE loss
    with Bayesian Personalized Ranking (BPR) loss. BPR optimizes the ranking
    objective P(positive > negative) rather than predicting exact ratings.

    This is appropriate for our dataset where rating=3 accounts for only 0.9%
    of interactions — the distribution is effectively bimodal (like/dislike).
    BPR treats each interaction as a positive signal and samples negatives,
    avoiding the MSE pitfall of trying to predict absent intermediate values.

    References:
      - Rendle et al. (2009) — BPR: Bayesian Personalized Ranking
    """
    from torch.utils.data import DataLoader, TensorDataset

    # Separate positive and negative pairs
    pos_pairs = [(u, i, r) for u, i, r in train_pairs if r > 0.5]
    neg_pairs = [(u, i, r) for u, i, r in train_pairs if r <= 0.5]

    if not pos_pairs:
        return None

    # Build user → positive items mapping for BPR sampling
    user_pos_items = defaultdict(list)
    for u, i, r in pos_pairs:
        user_pos_items[u].append(i)

    all_neg_items_per_user = defaultdict(list)
    for u, i, r in neg_pairs:
        all_neg_items_per_user[u].append(i)

    # All items for uniform negative sampling fallback
    all_items = list(range(n_items))

    n_active_users = len(user_pos_items)

    U = nn.Embedding(n_users, config["dim"]).to(device)
    V = nn.Embedding(n_items, config["dim"]).to(device)
    b_u = nn.Embedding(n_users, 1).to(device)
    b_i = nn.Embedding(n_items, 1).to(device)
    nn.init.normal_(U.weight, 0, 0.01)
    nn.init.normal_(V.weight, 0, 0.01)
    nn.init.zeros_(b_u.weight)
    nn.init.zeros_(b_i.weight)

    optimizer = torch.optim.Adam(
        list(U.parameters()) + list(V.parameters()) + list(b_u.parameters()) + list(b_i.parameters()),
        lr=config["lr"],
    )

    user_list = list(user_pos_items.keys())
    rng = np.random.default_rng(42)

    for epoch in range(config["epochs"]):
        epoch_loss = 0.0
        n_pairs = 0
        rng.shuffle(user_list)

        for u_idx in user_list:
            pos_items = user_pos_items[u_idx]
            neg_pool = all_neg_items_per_user.get(u_idx, all_items)

            for pos_idx in pos_items:
                # Sample one negative for each positive (BPR pairwise)
                if neg_pool:
                    neg_idx = int(rng.choice(neg_pool))
                else:
                    neg_idx = int(rng.choice(all_items))

                u_t = torch.LongTensor([u_idx]).to(device)
                i_pos = torch.LongTensor([pos_idx]).to(device)
                i_neg = torch.LongTensor([neg_idx]).to(device)

                # Score: mu + b_u + b_i + dot(U, V)
                pos_score = b_i(i_pos).squeeze() + b_u(u_t).squeeze() + torch.dot(U(u_t).squeeze(), V(i_pos).squeeze())
                neg_score = b_i(i_neg).squeeze() + b_u(u_t).squeeze() + torch.dot(U(u_t).squeeze(), V(i_neg).squeeze())

                # BPR loss: -log(sigmoid(pos - neg))
                loss = -torch.log(torch.sigmoid(pos_score - neg_score) + 1e-10)

                # L2 regularization
                loss = loss + config["l2"] * (
                    torch.sum(U(u_t) ** 2) + torch.sum(V(i_pos) ** 2) + torch.sum(V(i_neg) ** 2)
                )

                optimizer.zero_grad()
                loss.backward()
                optimizer.step()

                epoch_loss += loss.item()
                n_pairs += 1

        if n_pairs > 0 and (epoch + 1) % 20 == 0:
            avg_loss = epoch_loss / n_pairs
            print(f"        BiasedMF-BPR epoch {epoch+1}/{config['epochs']}: loss={avg_loss:.4f}")

    return {"U": U.weight.detach(), "V": V.weight.detach(), "b_u": b_u.weight.detach(), "b_i": b_i.weight.detach(), "mu": 0.0}


def train_ease_r(train_pairs, n_users, n_items, l2_reg, seed=42):
    """EASE^R (Steck, 2019) — closed-form linear autoencoder.

    Parameters
    ----------
    l2_reg : float
        L2 regularization parameter. Tuned on validation set (not training
        reconstruction error) to prevent overfitting.
    """
    set_seed(seed)
    X = np.zeros((n_users, n_items), dtype=np.float32)
    for u_idx, i_idx, r in train_pairs:
        X[u_idx, i_idx] = r

    G = X.T @ X
    try:
        G_inv = np.linalg.inv(G + l2_reg * np.eye(n_items, dtype=np.float32))
    except np.linalg.LinAlgError:
        G_inv = np.linalg.pinv(G + l2_reg * np.eye(n_items, dtype=np.float32))
    B = np.eye(n_items, dtype=np.float32) - G.dot(G_inv)
    np.fill_diagonal(B, 0)
    return {"B": B, "l2_reg": l2_reg, "n_users": n_users, "n_items": n_items}


def build_item_user_ratings(user_splits, user2idx, item2idx):
    """Build item-user similarity structures for ItemKNN.

    Note on sparse data: with 85.5% sparsity, most item pairs share 0–3 users.
    k_neighbors=10 (not 20) focuses on the strongest signals, and shrink=50
    (not 100) avoids over-suppressing already-small similarity values.
    """
    item_users = defaultdict(set)
    user_items = defaultdict(set)
    user_item_rating = {}

    for u_data in user_splits:
        user = u_data["user"]
        if user not in user2idx:
            continue
        u_idx = user2idx[user]
        item2rat = u_data.get("train_item2rating", {})

        for item in u_data["train_items"]:
            if item not in item2idx:
                continue
            i_idx = item2idx[item]
            item_users[i_idx].add(u_idx)
            user_items[u_idx].add(i_idx)
            user_item_rating[(u_idx, i_idx)] = normalize_rating(item2rat.get(item, RATING_SCALE_MIN))

    item_norm = {i: np.sqrt(len(u)) + 1e-8 for i, u in item_users.items()}
    return item_users, item_norm, user_items, user_item_rating


def train_simplex(user_splits, user2idx, item2idx, config, device, seed):
    """SimpleX (Mao et al., CIKM 2021) — MF with Cosine Contrastive Loss (CCL).

    Key insight: the loss function matters more than model architecture.
    SimpleX uses cosine similarity + margin-based contrastive loss instead of
    BPR/MSE, and outperforms LightGCN on sparse datasets with far fewer parameters.
    No graph convolution needed — just embeddings + CCL.

    L2 regularization is applied to embeddings to prevent overfitting on small data,
    following the same pattern as BiasedMF (Koren et al., 2009).

    Parameters
    ----------
    config : dict with keys dim, epochs, lr, l2, neg_ratio, pos_margin, neg_margin, w_neg
    """
    set_seed(seed)
    _rng = np.random.default_rng(seed)

    n_users = len(user2idx)
    n_items = len(item2idx)
    dim = config["dim"]
    l2_reg = config.get("l2", 1e-3)
    neg_ratio = config.get("neg_ratio", 200)
    pos_margin = config.get("pos_margin", 0.5)
    neg_margin = config.get("neg_margin", 0.3)
    w_neg = config.get("w_neg", 0.3)

    # Build user-item interaction data
    user_items_local = defaultdict(set)
    user_item_rating_local = {}
    user_hard_neg_local = defaultdict(list)

    for u_data in user_splits:
        user = u_data["user"]
        if user not in user2idx:
            continue
        u_idx = user2idx[user]
        item2rat = u_data.get("train_item2rating", {})
        for item in u_data["train_items"]:
            if item not in item2idx:
                continue
            i_idx = item2idx[item]
            user_items_local[u_idx].add(i_idx)
            user_item_rating_local[(u_idx, i_idx)] = normalize_rating(item2rat.get(item, RATING_SCALE_MIN))

        if USE_HARD_NEGATIVES:
            for neg_it, neg_raw_r in u_data.get("train_neg_item2rating", {}).items():
                neg_idx = item2idx.get(neg_it)
                if neg_idx is not None and neg_idx not in user_items_local[u_idx]:
                    user_hard_neg_local[u_idx].append(neg_idx)

    # Initialize embeddings (no biases — pure cosine contrastive)
    U = nn.Embedding(n_users, dim).to(device)
    V = nn.Embedding(n_items, dim).to(device)
    nn.init.normal_(U.weight, 0, 0.01)
    nn.init.normal_(V.weight, 0, 0.01)
    optimizer = torch.optim.Adam(list(U.parameters()) + list(V.parameters()), lr=config["lr"])

    user_indices = list(user_items_local.keys())
    n_active_users = len(user_indices)

    for epoch in range(config["epochs"]):
        _rng.shuffle(user_indices)
        epoch_loss = 0.0
        epoch_pos_loss = 0.0
        epoch_neg_loss = 0.0
        n_pairs = 0

        for u_idx in user_indices:
            pos_items = list(user_items_local.get(u_idx, []))
            if not pos_items:
                continue

            # L2-normalize embeddings for cosine similarity
            u_emb = F.normalize(U.weight, dim=1)
            i_emb = F.normalize(V.weight, dim=1)

            # Sample one positive
            pos_item = int(_rng.choice(pos_items))

            # Sample negatives: hard + popularity-biased + random
            # Mao et al. (2021) recommend neg_ratio=400+, but 200 is appropriate
            # for our small dataset (156 users, 1022 items, ~2574 interactions).
            neg_items = []
            hard_negs = user_hard_neg_local.get(u_idx, [])

            for _ in range(neg_ratio):
                if USE_HARD_NEGATIVES and hard_negs and _rng.random() < HARD_NEG_RATIO:
                    neg_items.append(int(_rng.choice(hard_negs)))
                elif USE_POPULARITY_BIASED_NEG and _item_pop_counts is not None and _rng.random() < POP_NEG_RATIO:
                    neg_items.append(int(_rng.choice(len(item2idx))))
                else:
                    neg_items.append(int(_rng.integers(0, n_items)))

            # Compute scores
            u_vec = u_emb[u_idx]  # (dim,)
            pos_score = torch.dot(u_vec, i_emb[pos_item])  # cosine similarity

            neg_vecs = i_emb[neg_items]  # (n_neg, dim)
            neg_scores = torch.mv(neg_vecs, u_vec)  # (n_neg,)

            # CCL loss (Mao et al., 2021):
            #   pos_loss: margin-based — push positive cosine above pos_margin
            #   neg_loss: margin-based — push negative cosine below neg_margin
            # With L2 regularization on embeddings to prevent overfitting on small data.
            pos_loss = torch.clamp(pos_margin - pos_score, min=0)
            neg_loss = torch.clamp(neg_scores - neg_margin, min=0).mean()

            r_w = user_item_rating_local.get((u_idx, pos_item), 0.5)
            loss = r_w * pos_loss + w_neg * neg_loss

            # L2 regularization — critical for small datasets to prevent overfitting.
            # Without this, 1022-item embeddings overfit the ~2574 training interactions.
            loss = loss + l2_reg * (torch.sum(U.weight[u_idx] ** 2) + torch.sum(V.weight[pos_item] ** 2) + torch.sum(V.weight[neg_items] ** 2)) / (1 + neg_ratio)

            optimizer.zero_grad()
            loss.backward()
            optimizer.step()

            epoch_loss += loss.item()
            epoch_pos_loss += pos_loss.item()
            epoch_neg_loss += neg_loss.item()
            n_pairs += 1

        if n_pairs > 0 and (epoch + 1) % 20 == 0:
            avg_loss = epoch_loss / n_pairs
            avg_pos = epoch_pos_loss / n_pairs
            avg_neg = epoch_neg_loss / n_pairs
            print(f"        SimpleX epoch {epoch+1}/{config['epochs']}: loss={avg_loss:.4f} (pos={avg_pos:.4f}, neg={avg_neg:.4f})")

    U.eval()
    V.eval()
    # Return normalized embeddings for scoring
    final_U = F.normalize(U.weight, dim=1).detach()
    final_V = F.normalize(V.weight, dim=1).detach()
    return U, {"U": final_U, "V": final_V}


# ═══════════════════════════════════════════════════════════════════════════
# SCORING
# ═══════════════════════════════════════════════════════════════════════════

@torch.no_grad()
def score_candidates_cf(cf_type, model_obj, user_idx, item_idxs, extra_info, device):
    """Score candidate items using a trained CF model."""
    item_idxs = np.array(list(item_idxs)) if isinstance(item_idxs, (set, list)) else item_idxs

    if cf_type in ("BiasedMF", "BiasedMF-BPR"):
        u_emb = model_obj["U"][user_idx]
        i_embs = model_obj["V"][item_idxs]
        scores = (model_obj["mu"] + model_obj["b_u"][user_idx].squeeze() + model_obj["b_i"][item_idxs].squeeze() + torch.mv(i_embs, u_emb)).cpu().numpy()

    elif cf_type == "EASE_R":
        B = model_obj["B"]
        # Use pre-built user row index for O(1) lookup instead of O(n) scan.
        # The "user_row_index" is built once during training and stored in extra_info.
        if "user_row_index" in extra_info:
            u_data = extra_info["user_row_index"].get(int(user_idx))
            X_row = np.zeros(model_obj["n_items"], dtype=np.float32)
            if u_data is not None:
                for it, raw_r in u_data.get("train_item2rating", {}).items():
                    i_idx = extra_info.get("item2idx", {}).get(it)
                    if i_idx is not None:
                        X_row[i_idx] = normalize_rating(raw_r)
        else:
            # Fallback: linear scan (slow, kept for backward compatibility)
            X_row = np.zeros(model_obj["n_items"], dtype=np.float32)
            for u_data in extra_info.get("user_splits", []):
                if extra_info.get("user2idx", {}).get(u_data["user"]) == user_idx:
                    for it, raw_r in u_data.get("train_item2rating", {}).items():
                        i_idx = extra_info.get("item2idx", {}).get(it)
                        if i_idx is not None:
                            X_row[i_idx] = normalize_rating(raw_r)
                    break
        scores = (X_row @ B)[item_idxs]

    elif cf_type == "ItemKNN":
        item_users = extra_info["item_users"]
        item_norm = extra_info["item_norm"]
        user_items = extra_info["user_items"]
        user_item_rating = extra_info.get("user_item_rating", {})
        k_neighbors = extra_info["k_neighbors"]
        shrink = extra_info["shrink"]
        user_history = user_items.get(user_idx, set())

        scores = []
        for cand_idx in item_idxs:
            cand_users = item_users.get(cand_idx, set())
            if not cand_users:
                scores.append(0)
                continue
            sims = []
            for hist_idx in user_history:
                hist_users = item_users.get(hist_idx, set())
                shared = len(cand_users & hist_users)
                if shared == 0:
                    continue
                sim = shared / ((item_norm.get(cand_idx, 1e-8) * item_norm.get(hist_idx, 1e-8)) + shrink)
                r_weight = user_item_rating.get((user_idx, hist_idx), 0.5)
                sims.append(sim * r_weight)
            if sims:
                sims.sort(reverse=True)
                top_k = sims[:k_neighbors]
                scores.append(sum(top_k) / len(top_k))
            else:
                scores.append(0)
        scores = np.array(scores)

    elif cf_type == "SimpleX":
        u_emb = model_obj["U"][user_idx]
        i_embs = model_obj["V"][item_idxs]
        scores = torch.mv(i_embs, u_emb).cpu().numpy()

    else:
        scores = np.zeros(len(item_idxs))

    return scores


# ═══════════════════════════════════════════════════════════════════════════
# MODEL CACHE
# ═══════════════════════════════════════════════════════════════════════════

_cf_model_cache = {}


def _model_config_hash(cf_type):
    cfg_map = {"BiasedMF": BIASED_MF_CFG, "BiasedMF-BPR": BIASED_MF_BPR_CFG, "EASE_R": EASE_R_CFG, "ItemKNN": KNN_CFG, "SimpleX": SIMPLEX_CFG}
    return hashlib.md5(_json.dumps(cfg_map.get(cf_type, {}), sort_keys=True).encode()).hexdigest()[:8]


def get_or_train_cf_model(cf_type, seed, user_splits, user2idx, item2idx, device, context=None, item_meta=None, gate=None, ease_r_l2=None, model_config=None):
    """Train and cache CF model per (cf_type, seed, config_hash).

    For EASE^R, l2_reg is tuned on validation set via run_cf_model().
    The ease_r_l2 parameter allows passing a specific lambda value.
    The model_config parameter allows passing a specific config dict for
    BiasedMF/ItemKNN/SimpleX (used during grid search).
    """
    # Include model_config and ease_r_l2 in cache key for separate caching
    cfg_hash = _model_config_hash(cf_type)
    config_key = ""
    if cf_type == "EASE_R" and ease_r_l2 is not None:
        config_key = f"_l2_{ease_r_l2}"
    elif model_config is not None:
        config_key = "_" + hashlib.md5(_json.dumps(model_config, sort_keys=True).encode()).hexdigest()[:8]
    cache_key = (cf_type, seed, cfg_hash, normalize_context(context) if context else None, config_key)

    if cache_key in _cf_model_cache:
        return _cf_model_cache[cache_key]

    set_seed(seed)

    if CONTEXT_PREFILTER_CF_TRAINING and context and gate and item_meta:
        ctx_splits = gate.filter_splits_by_context(user_splits, context)
        total_pairs = sum(len(u["train_items"]) for u in ctx_splits) if ctx_splits else 0
        splits_to_use = ctx_splits if total_pairs >= 10 else user_splits
    else:
        splits_to_use = user_splits

    if USE_HARD_NEGATIVES and cf_type in ("BiasedMF",):
        train_pairs = build_training_pairs_with_hard_negatives(splits_to_use, user2idx, item2idx)
    else:
        train_pairs = []
        for u_data in splits_to_use:
            u = u_data["user"]
            if u not in user2idx:
                continue
            u_idx = user2idx[u]
            for it, raw_r in u_data.get("train_item2rating", {}).items():
                if it in item2idx:
                    train_pairs.append((u_idx, item2idx[it], normalize_rating(raw_r)))

    if not train_pairs:
        return None, {}

    model_obj, extra_info = None, {}
    if cf_type == "BiasedMF":
        cfg = model_config if model_config is not None else BIASED_MF_CFG
        print(f"      Training BiasedMF (seed={seed}, dim={cfg['dim']}, lr={cfg['lr']}, l2={cfg['l2']})...")
        model_obj = train_biased_mf(train_pairs, len(user2idx), len(item2idx), cfg, device)
    elif cf_type == "BiasedMF-BPR":
        cfg = model_config if model_config is not None else BIASED_MF_BPR_CFG
        print(f"      Training BiasedMF-BPR (seed={seed}, dim={cfg['dim']}, lr={cfg['lr']}, l2={cfg['l2']})...")
        model_obj = train_biased_mf_bpr(train_pairs, len(user2idx), len(item2idx), cfg, device)
        if model_obj is None:
            _cf_model_cache[cache_key] = (None, {})
            return None, {}
    elif cf_type == "EASE_R":
        l2_reg = ease_r_l2 if ease_r_l2 is not None else EASE_R_CFG["l2_reg_grid"][0]
        print(f"      Training EASE^R (seed={seed}, l2={l2_reg})...")
        model_obj = train_ease_r(train_pairs, len(user2idx), len(item2idx), l2_reg, seed=seed)
        # Build user_row_index for O(1) lookup during scoring (vs O(n) linear scan)
        user_row_index = {}
        for u_data in splits_to_use:
            u_idx = user2idx.get(u_data["user"])
            if u_idx is not None:
                user_row_index[int(u_idx)] = u_data
        extra_info = {"user_splits": splits_to_use, "user2idx": user2idx, "item2idx": item2idx,
                      "user_row_index": user_row_index}
    elif cf_type == "ItemKNN":
        cfg = model_config if model_config is not None else KNN_CFG
        print(f"      Building ItemKNN (seed={seed}, k={cfg['k_neighbors']}, shrink={cfg['shrink']})...")
        item_users, item_norm, user_items, user_item_rating = build_item_user_ratings(splits_to_use, user2idx, item2idx)
        extra_info = {"item_users": item_users, "item_norm": item_norm, "user_items": user_items, "user_item_rating": user_item_rating, "k_neighbors": cfg["k_neighbors"], "shrink": cfg["shrink"]}
    elif cf_type == "SimpleX":
        cfg = model_config if model_config is not None else SIMPLEX_CFG
        print(f"      Training SimpleX (seed={seed}, dim={cfg['dim']}, neg_ratio={cfg['neg_ratio']}, l2={cfg['l2']})...")
        simplex_module, simplex_weights = train_simplex(splits_to_use, user2idx, item2idx, cfg, device, seed)
        model_obj = simplex_weights  # dict with "U" and "V" (L2-normalized embeddings)
        extra_info = {}

    _cf_model_cache[cache_key] = (model_obj, extra_info)
    return model_obj, extra_info


# ═══════════════════════════════════════════════════════════════════════════
# CF EVALUATION
# ═══════════════════════════════════════════════════════════════════════════

def _filter_target_from_kws(selected_kws, target_item):
    """Remove the target item name from selected keywords to prevent keyword leakage."""
    if not FILTER_TARGET_NAME_FROM_KW or not target_item:
        return selected_kws
    target = clean_text(target_item)
    if not target:
        return selected_kws
    return [kw for kw in selected_kws if kw != target]


def _eval_cf_on_val(cf_type, model_obj, extra_info, user_split, user2idx, item2idx,
                     gate, seed, max_cands):
    """Evaluate a CF model on validation set (b=0, no keyword boost).

    Used for hyperparameter grid search — selects best config by val nDCG@10.
    """
    val_scores = []
    for u_data in user_split:
        u = user2idx.get(u_data["user"])
        if u is None or u_data["val_item"] not in item2idx:
            val_scores.append(0.0)
            continue
        pf = gate.get_candidates(u_data, "val", seed, max_cands)
        cands = pf["cands"]
        if u_data["val_item"] not in cands:
            val_scores.append(0.0)
            continue
        cands_subset = [it for it in cands if it in item2idx]
        if u_data["val_item"] not in cands_subset:
            val_scores.append(0.0)
            continue
        cand_idxs = [item2idx[it] for it in cands_subset]
        cf_scores = score_candidates_cf(cf_type, model_obj, u, cand_idxs, extra_info, DEVICE)
        cf_scores = apply_negative_penalty(cf_scores, cands_subset, u_data.get("train_neg_item2rating", {}))
        _, _, ndcg = calculate_metrics(cf_scores, cands_subset.index(u_data["val_item"]))
        val_scores.append(ndcg)
    return np.mean(val_scores) if val_scores else 0.0


def run_cf_model(cf_type, all_splits, user2idx, item2idx, gate, mapping_dict, max_cands=200, per_user=None):
    """Run a CF model on all seeds with keyword boost tuning on VAL.

    For EASE^R, the L2 regularization parameter (lambda) is tuned on the
    validation set instead of training reconstruction error, consistent
    with how b_cf is tuned. This prevents overfitting to training data.

    Joint optimization: config and b_cf are tuned together — for each config
    in the grid, the best b is found on the validation set, then the best
    (config, b) pair is selected. This avoids the suboptimality of selecting
    config at b=0 and then tuning b separately (validation contamination gap).
    """
    results = []
    for seed in SEEDS:
        set_seed(seed)
        user_split = all_splits[seed]

        # ── Joint hyperparameter grid search: (config, b) on validation ──
        best_config = None
        best_l2_reg = None
        best_b = 0.0
        best_val_joint = -1.0

        if cf_type == "EASE_R":
            cfg_grid = [{"l2_reg": lam} for lam in EASE_R_CFG["l2_reg_grid"]]
        elif cf_type == "BiasedMF":
            cfg_grid = BIASED_MF_CFG_GRID
        elif cf_type == "BiasedMF-BPR":
            cfg_grid = BIASED_MF_BPR_CFG_GRID
        elif cf_type == "ItemKNN":
            cfg_grid = KNN_CFG_GRID
        elif cf_type == "SimpleX":
            cfg_grid = SIMPLEX_CFG_GRID
        else:
            cfg_grid = [None]

        print(f"   {cf_type} joint grid search on validation (seed={seed}, {len(cfg_grid)} configs × {len(B_RANGE_CF)} b values)...")
        for cfg in cfg_grid:
            if cf_type == "EASE_R":
                model_obj_cfg, extra_info_cfg = get_or_train_cf_model(
                    cf_type, seed, user_split, user2idx, item2idx, DEVICE,
                    ease_r_l2=cfg["l2_reg"],
                )
            else:
                model_obj_cfg, extra_info_cfg = get_or_train_cf_model(
                    cf_type, seed, user_split, user2idx, item2idx, DEVICE,
                    model_config=cfg,
                )
            if model_obj_cfg is None and not extra_info_cfg:
                continue

            # Tune b jointly with this config
            for b in B_RANGE_CF:
                val_scores = []
                for u_data in user_split:
                    u = user2idx.get(u_data["user"])
                    if u is None or u_data["val_item"] not in item2idx:
                        val_scores.append(0.0)
                        continue

                    pf = gate.get_candidates(u_data, "val", seed, max_cands)
                    cands = pf["cands"]
                    if u_data["val_item"] not in cands:
                        val_scores.append(0.0)
                        continue
                    cands_subset = [it for it in cands if it in item2idx]
                    if u_data["val_item"] not in cands_subset:
                        val_scores.append(0.0)
                        continue

                    if CONTEXT_PREFILTER_CF_TRAINING:
                        cf_ctx = pf["matched_ctx"] or pf["log_ctx"]
                        cf_kwargs = dict(context=cf_ctx)
                        if cf_type == "EASE_R":
                            cf_kwargs["ease_r_l2"] = cfg["l2_reg"]
                        elif cfg is not None:
                            cf_kwargs["model_config"] = cfg
                        model_obj, extra_info = get_or_train_cf_model(cf_type, seed, user_split, user2idx, item2idx, DEVICE, **cf_kwargs)
                        if model_obj is None and not extra_info:
                            val_scores.append(0.0)
                            continue
                    else:
                        model_obj, extra_info = model_obj_cfg, extra_info_cfg

                    cand_idxs = [item2idx[it] for it in cands_subset]
                    cf_scores = score_candidates_cf(cf_type, model_obj, u, cand_idxs, extra_info, DEVICE)

                    # Keyword boost with leakage filter
                    filtered_kws = _filter_target_from_kws(pf["selected_kws"], u_data["val_item"])
                    if b > 0:
                        kset = set(filtered_kws)
                        for j, it in enumerate(cands_subset):
                            if not kset.isdisjoint(mapping_dict.get(it, set())):
                                cf_scores[j] += b
                    cf_scores = apply_negative_penalty(cf_scores, cands_subset, u_data.get("train_neg_item2rating", {}))
                    _, _, ndcg = calculate_metrics(cf_scores, cands_subset.index(u_data["val_item"]))
                    val_scores.append(ndcg)

                avg_val = np.mean(val_scores) if val_scores else 0.0
                if avg_val > best_val_joint:
                    best_val_joint = avg_val
                    best_b = b
                    if cf_type == "EASE_R":
                        best_l2_reg = cfg["l2_reg"]
                    else:
                        best_config = cfg

        # Log best (config, b) pair
        if cf_type == "EASE_R":
            print(f"   {cf_type} best λ={best_l2_reg}, b={best_b:.2f} (val nDCG={best_val_joint:.4f})")
        elif best_config is not None:
            cfg_desc = ", ".join(f"{k}={v}" for k, v in best_config.items())
            print(f"   {cf_type} best config: {cfg_desc}, b={best_b:.2f} (val nDCG={best_val_joint:.4f})")

        best_val_ndcg = best_val_joint

        # Train final model with best config
        if not CONTEXT_PREFILTER_CF_TRAINING:
            if cf_type == "EASE_R":
                global_model, global_extra = get_or_train_cf_model(
                    cf_type, seed, user_split, user2idx, item2idx, DEVICE,
                    ease_r_l2=best_l2_reg,
                )
            else:
                global_model, global_extra = get_or_train_cf_model(
                    cf_type, seed, user_split, user2idx, item2idx, DEVICE,
                    model_config=best_config,
                )

        # TEST phase
        test_metrics = {"ndcg": 0, "hr": 0, "mrr": 0, "total": 0, "feasible": 0}
        for u_data in user_split:
            u = user2idx.get(u_data["user"])
            if u is None or u_data["test_item"] not in item2idx:
                test_metrics["total"] += 1
                continue

            pf_test = gate.get_candidates(u_data, "test", seed, max_cands)
            cands = pf_test["cands"]
            test_metrics["total"] += 1
            if u_data["test_item"] not in cands:
                continue
            test_metrics["feasible"] += 1
            cands_subset = [it for it in cands if it in item2idx]
            if u_data["test_item"] not in cands_subset:
                continue

            if CONTEXT_PREFILTER_CF_TRAINING:
                cf_ctx = pf_test["matched_ctx"] or pf_test["log_ctx"]
                cf_kwargs = dict(context=cf_ctx)
                if cf_type == "EASE_R":
                    cf_kwargs["ease_r_l2"] = best_l2_reg
                elif best_config is not None:
                    cf_kwargs["model_config"] = best_config
                model_obj, extra_info = get_or_train_cf_model(cf_type, seed, user_split, user2idx, item2idx, DEVICE, **cf_kwargs)
                if model_obj is None and not extra_info:
                    continue
            else:
                model_obj, extra_info = global_model, global_extra

            cand_idxs = [item2idx[it] for it in cands_subset]
            cf_scores = score_candidates_cf(cf_type, model_obj, u, cand_idxs, extra_info, DEVICE)

            # Keyword boost with leakage filter
            filtered_kws = _filter_target_from_kws(pf_test["selected_kws"], u_data["test_item"])
            if best_b > 0:
                kset = set(filtered_kws)
                for j, it in enumerate(cands_subset):
                    if not kset.isdisjoint(mapping_dict.get(it, set())):
                        cf_scores[j] += best_b
            cf_scores = apply_negative_penalty(cf_scores, cands_subset, u_data.get("train_neg_item2rating", {}))
            hr, mrr, ndcg = calculate_metrics(cf_scores, cands_subset.index(u_data["test_item"]))
            test_metrics["ndcg"] += ndcg
            test_metrics["hr"] += hr
            test_metrics["mrr"] += mrr

            # Collect per-user data for significance tests & user-bin analysis
            if per_user is not None:
                gt_idx = cands_subset.index(u_data["test_item"])
                gt_score = float(cf_scores[gt_idx])
                rank = int((cf_scores > gt_score).sum() + np.isclose(cf_scores, gt_score, rtol=1e-5, atol=1e-8).sum())
                per_user.append({
                    "seed": seed,
                    "MAX_CANDS": mc_store(max_cands),
                    "user": u_data["user"],
                    "model": f"CF-{cf_type}",
                    "target": u_data["test_item"],
                    "rank": rank,
                    "HR@10": float(rank <= K),
                    "MRR@10": 1.0 / rank if rank <= K else 0.0,
                    "nDCG@10": 1.0 / np.log2(rank + 1) if rank <= K else 0.0,
                    "feasible": 1,
                })

        cov = test_metrics["feasible"] / test_metrics["total"] if test_metrics["total"] > 0 else 0
        ndcg_f = test_metrics["ndcg"] / test_metrics["feasible"] if test_metrics["feasible"] > 0 else 0
        hr_f = test_metrics["hr"] / test_metrics["feasible"] if test_metrics["feasible"] > 0 else 0
        mrr_f = test_metrics["mrr"] / test_metrics["feasible"] if test_metrics["feasible"] > 0 else 0

        result = {
            "Model": f"CF-{cf_type}", "Seed": seed, "MAX_CANDS": max_cands,
            "best_b": best_b, "best_val_nDCG@10": best_val_ndcg,
            "selection_metric": "validation_nDCG@10", "coverage_rate": cov,
            "feasible_nDCG@10": ndcg_f, "feasible_HR@10": hr_f, "feasible_MRR@10": mrr_f,
            "feasible_cases": test_metrics["feasible"], "total_cases": test_metrics["total"],
        }
        if cf_type == "EASE_R":
            result["best_l2_reg"] = best_l2_reg
        elif best_config is not None:
            result["best_cfg"] = best_config
        results.append(result)
        gc.collect()

    return results


# ═══════════════════════════════════════════════════════════════════════════
# POP BASELINES
# ═══════════════════════════════════════════════════════════════════════════

def run_pop_global(all_splits, item_meta, mapping_dict, gate, seeds=SEEDS, max_cands_list=None, per_user=None):
    """POP-Global: rank by global train interaction count."""
    from config import MAX_CANDS_LIST, get_user_bin
    if max_cands_list is None:
        max_cands_list = MAX_CANDS_LIST

    results = []
    for seed in seeds:
        set_seed(seed)
        user_split = all_splits[seed]
        pop_global = Counter()
        for u_data in user_split:
            for it in u_data.get("train_items", []):
                pop_global[it] += 1

        for max_cands in max_cands_list:
            test_metrics = {"ndcg": 0, "hr": 0, "mrr": 0, "total": 0, "feasible": 0}
            for u_data in user_split:
                target = u_data["test_item"]
                test_metrics["total"] += 1
                pf = gate.get_candidates(u_data, "test", seed, max_cands)
                cands = pf["cands"]
                if target not in cands:
                    continue
                test_metrics["feasible"] += 1
                pop_scores = np.array([pop_global.get(it, 0) for it in cands], dtype=np.float64)
                pop_scores = apply_negative_penalty(pop_scores, cands, u_data.get("train_neg_item2rating", {}))
                hr, mrr, ndcg = calculate_metrics(pop_scores, cands.index(target))
                test_metrics["ndcg"] += ndcg
                test_metrics["hr"] += hr
                test_metrics["mrr"] += mrr

                # Collect per-user data
                if per_user is not None:
                    gt_idx = cands.index(target)
                    gt_score = float(pop_scores[gt_idx])
                    rank = int((pop_scores > gt_score).sum() + np.isclose(pop_scores, gt_score, rtol=1e-5, atol=1e-8).sum())
                    per_user.append({
                        "seed": seed,
                        "MAX_CANDS": mc_store(max_cands),
                        "user": u_data["user"],
                        "model": "POP-Global",
                        "target": target,
                        "rank": rank,
                        "HR@10": float(rank <= K),
                        "MRR@10": 1.0 / rank if rank <= K else 0.0,
                        "nDCG@10": 1.0 / np.log2(rank + 1) if rank <= K else 0.0,
                        "feasible": 1,
                    })

            cov = test_metrics["feasible"] / test_metrics["total"] if test_metrics["total"] > 0 else 0
            results.append({
                "Model": "POP-Global", "Seed": seed, "MAX_CANDS": max_cands,
                "coverage_rate": cov,
                "feasible_nDCG@10": test_metrics["ndcg"] / max(test_metrics["feasible"], 1),
                "feasible_HR@10": test_metrics["hr"] / max(test_metrics["feasible"], 1),
                "feasible_MRR@10": test_metrics["mrr"] / max(test_metrics["feasible"], 1),
                "feasible_cases": test_metrics["feasible"], "total_cases": test_metrics["total"],
            })
    return results


def run_pop_context(all_splits, item_meta, mapping_dict, gate, seeds=SEEDS, max_cands_list=None, per_user=None):
    """POP-Context: rank by popularity within the matched context."""
    from config import MAX_CANDS_LIST
    if max_cands_list is None:
        max_cands_list = MAX_CANDS_LIST

    results = []
    for seed in seeds:
        set_seed(seed)
        user_split = all_splits[seed]
        pop_by_ctx = defaultdict(Counter)
        for u_data in user_split:
            for it in u_data.get("train_items", []):
                for s in item_meta.get(it, {}).get("sub_set", []):
                    pop_by_ctx[s][it] += 1

        for max_cands in max_cands_list:
            test_metrics = {"ndcg": 0, "hr": 0, "mrr": 0, "total": 0, "feasible": 0}
            for u_data in user_split:
                target = u_data["test_item"]
                test_metrics["total"] += 1
                pf = gate.get_candidates(u_data, "test", seed, max_cands)
                cands = pf["cands"]
                matched_ctx = pf["matched_ctx"]
                if target not in cands:
                    continue
                test_metrics["feasible"] += 1

                ctx_pop = pop_by_ctx.get(matched_ctx, Counter()) if matched_ctx else Counter()
                pop_scores = np.array([ctx_pop.get(it, 0) for it in cands], dtype=np.float64)
                pop_scores = apply_negative_penalty(pop_scores, cands, u_data.get("train_neg_item2rating", {}))
                hr, mrr, ndcg = calculate_metrics(pop_scores, cands.index(target))
                test_metrics["ndcg"] += ndcg
                test_metrics["hr"] += hr
                test_metrics["mrr"] += mrr

                # Collect per-user data
                if per_user is not None:
                    gt_idx = cands.index(target)
                    gt_score = float(pop_scores[gt_idx])
                    rank = int((pop_scores > gt_score).sum() + np.isclose(pop_scores, gt_score, rtol=1e-5, atol=1e-8).sum())
                    per_user.append({
                        "seed": seed,
                        "MAX_CANDS": mc_store(max_cands),
                        "user": u_data["user"],
                        "model": "POP-Context",
                        "target": target,
                        "rank": rank,
                        "HR@10": float(rank <= K),
                        "MRR@10": 1.0 / rank if rank <= K else 0.0,
                        "nDCG@10": 1.0 / np.log2(rank + 1) if rank <= K else 0.0,
                        "feasible": 1,
                    })

            cov = test_metrics["feasible"] / test_metrics["total"] if test_metrics["total"] > 0 else 0
            results.append({
                "Model": "POP-Context", "Seed": seed, "MAX_CANDS": max_cands,
                "coverage_rate": cov,
                "feasible_nDCG@10": test_metrics["ndcg"] / max(test_metrics["feasible"], 1),
                "feasible_HR@10": test_metrics["hr"] / max(test_metrics["feasible"], 1),
                "feasible_MRR@10": test_metrics["mrr"] / max(test_metrics["feasible"], 1),
                "feasible_cases": test_metrics["feasible"], "total_cases": test_metrics["total"],
            })
    return results


def run_all_cf(all_splits, user2idx, item2idx, gate, mapping_dict, item_meta, max_cands_list=None, per_user=None):
    """Run all CF models + POP baselines."""
    from config import MAX_CANDS_LIST, CF_MODELS_TO_TEST
    if max_cands_list is None:
        max_cands_list = MAX_CANDS_LIST

    cf_results = []
    for cf_type in CF_MODELS_TO_TEST:
        print(f"\n  CF Model: {cf_type}")
        for max_cands in max_cands_list:
            print(f"   MAX_CANDS={max_cands}")
            model_results = run_cf_model(cf_type, all_splits, user2idx, item2idx, gate, mapping_dict, max_cands=max_cands, per_user=per_user)
            cf_results.extend(model_results)

    pop_results_global = run_pop_global(all_splits, item_meta, mapping_dict, gate, max_cands_list=max_cands_list, per_user=per_user)
    pop_results_context = run_pop_context(all_splits, item_meta, mapping_dict, gate, max_cands_list=max_cands_list, per_user=per_user)
    pop_results = pop_results_global + pop_results_context

    print(f"\n✅ CF Complete: {len(cf_results)} CF + {len(pop_results)} POP results")
    return cf_results, pop_results