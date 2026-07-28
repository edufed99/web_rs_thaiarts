# -*- coding: utf-8 -*-
"""
data_loader.py — Data Loading and Preparation
================================================
Phase 0 of the recommendation pipeline.
Loads item catalog, user interactions, keyword mappings, and builds
train/val/test splits for reproducible evaluation.

Thesis mapping: Section 2.2 Semantic Artifact Layer outputs feed into
this module (consensus classification, keyword-to-item mappings).
"""

import os
import numpy as np
import pandas as pd
from collections import defaultdict, Counter
from difflib import get_close_matches

from config import (
    clean_text, normalize_context, normalize_rating, parse_keywords_list,
    pick_keywords_from_log, stable_int_seed, set_seed,
    POSITIVE_THRESHOLD, QK_MIN, QK_MAX,
    ENABLE_FUZZY_CTX, FUZZY_CUTOFF,
    USER_FILE, ITEM_FILE, MAPPING_FILE, CONSENSUS_FILE, OUTPUT_DIR, SEEDS,
)


def load_items(item_file=ITEM_FILE):
    """Load and aggregate item catalog (1,022 items → deduplicated by name).

    Returns: item_meta dict {item_name: {desc, sub_set, main_set}}
    """
    df_items_raw = pd.read_csv(item_file)
    df_items_raw.columns = df_items_raw.columns.str.strip()

    name_col = "item_name" if "item_name" in df_items_raw.columns else "ชื่อชุดการแสดง"
    sub_col = "sub_ctx" if "sub_ctx" in df_items_raw.columns else "บริบทย่อย"
    main_col = "main_ctx" if "main_ctx" in df_items_raw.columns else "บริบทหลัก"
    desc_col = "desc" if "desc" in df_items_raw.columns else "คำอธิบายชุดการแสดง"

    df_items = df_items_raw.rename(columns={
        name_col: "item_name", sub_col: "sub_ctx",
        main_col: "main_ctx", desc_col: "desc"
    })

    for c in ["item_name", "sub_ctx", "main_ctx", "desc"]:
        if c not in df_items.columns:
            df_items[c] = ""
        df_items[c] = df_items[c].apply(clean_text)

    df_items["sub_norm"] = df_items["sub_ctx"].apply(normalize_context)
    df_items["main_norm"] = df_items["main_ctx"].apply(normalize_context)

    agg = df_items.groupby("item_name").agg(
        desc=("desc", "first"),
        sub_set=("sub_norm", lambda x: sorted(set(v for v in x if v))),
        main_set=("main_norm", lambda x: sorted(set(v for v in x if v))),
    ).reset_index()

    item_meta = {}
    for _, r in agg.iterrows():
        item_meta[r["item_name"]] = {
            "desc": r["desc"],
            "sub_set": r["sub_set"],
            "main_set": r["main_set"],
        }

    print(f"   ✓ Loaded {len(item_meta)} items")
    return item_meta


def load_mapping(mapping_file=MAPPING_FILE):
    """Load keyword-to-item mapping from Section 2.2.4 output."""
    mapping_dict = {}
    if not os.path.exists(mapping_file):
        print(f"   ⚠️ Mapping file not found: {mapping_file}")
        return mapping_dict

    df_map = pd.read_csv(mapping_file)
    df_map.columns = df_map.columns.str.strip()
    if "item_name" not in df_map.columns and "ชื่อชุดการแสดง" in df_map.columns:
        df_map = df_map.rename(columns={"ชื่อชุดการแสดง": "item_name"})

    if "item_name" in df_map.columns and "words" in df_map.columns:
        df_map["item_name"] = df_map["item_name"].apply(clean_text)
        for _, r in df_map.iterrows():
            it = clean_text(r["item_name"])
            ws = str(r["words"]).split(",") if pd.notna(r["words"]) else []
            mapping_dict[it] = set(clean_text(w) for w in ws if clean_text(w))

    print(f"   ✓ Loaded {len(mapping_dict)} item-keyword mappings")
    return mapping_dict


def load_consensus(consensus_file=CONSENSUS_FILE):
    """Load consensus classification from Section 2.2.3 (hierarchical labels)."""
    if not os.path.exists(consensus_file):
        print(f"   ⚠️ Consensus file not found: {consensus_file}")
        return {}

    df = pd.read_csv(consensus_file)
    word_taxonomy = {}
    for _, r in df.iterrows():
        word = clean_text(r.get("word", ""))
        label = str(r.get("consensus_label", ""))
        agreement = float(r.get("agreement", 0))
        if word and label:
            parts = label.split("||")
            word_taxonomy[word] = {
                "lvl1": parts[0] if len(parts) > 0 else "",
                "lvl2": parts[1] if len(parts) > 1 else "",
                "lvl3": parts[2] if len(parts) > 2 else "",
                "agreement": agreement,
            }
    print(f"   ✓ Loaded {len(word_taxonomy)} word taxonomy entries")
    return word_taxonomy


def load_user_log(user_file=USER_FILE, item_meta=None):
    """Load user interaction log with keywords.

    Returns: (user_all, user_pos, df_users)
      - user_all: dict {user: [(item, ctx, kwl, row_idx, rating), ...]}
      - user_pos: dict {user: [(item, ctx, kwl, row_idx, rating), ...]} (rating >= threshold)
      - df_users: raw DataFrame
    """
    df_users_raw = pd.read_csv(user_file)
    df_users_raw.columns = df_users_raw.columns.str.strip()

    ucol = "user" if "user" in df_users_raw.columns else "user_id"
    icol = "item_name" if "item_name" in df_users_raw.columns else "performance_arts_name"
    rcol = "rating" if "rating" in df_users_raw.columns else "Rating"
    ccol = "log_ctx" if "log_ctx" in df_users_raw.columns else "context"
    kwcol = "keywords_list" if "keywords_list" in df_users_raw.columns else None

    df_users = df_users_raw.rename(columns={
        ucol: "user", icol: "item_name", rcol: "rating", ccol: "log_ctx"
    })
    if kwcol:
        df_users.rename(columns={kwcol: "keywords_list"}, inplace=True)
    if "keywords_list" not in df_users.columns:
        df_users["keywords_list"] = ""

    df_users["user"] = df_users["user"].apply(clean_text)
    df_users["item_name"] = df_users["item_name"].apply(clean_text)
    df_users["rating"] = pd.to_numeric(df_users["rating"], errors="coerce").fillna(0.0)
    df_users["log_ctx"] = df_users["log_ctx"].apply(normalize_context)
    df_users["keywords_list"] = df_users["keywords_list"].apply(parse_keywords_list)

    if item_meta:
        valid_items = set(item_meta.keys())
        df_users = df_users[df_users["item_name"].isin(valid_items)].copy()

    # All interactions
    user_all = {}
    for u, grp in df_users.groupby("user"):
        seq = list(zip(
            grp["item_name"].tolist(), grp["log_ctx"].tolist(),
            grp["keywords_list"].tolist(), grp.index.values.tolist(),
            grp["rating"].tolist()
        ))
        user_all[u] = seq

    # Positive interactions only (rating >= threshold)
    liked = df_users[df_users["rating"] >= POSITIVE_THRESHOLD].copy()
    user_pos = {}
    for u, grp in liked.groupby("user"):
        if len(grp) < 3:
            continue
        seq = list(zip(
            grp["item_name"].tolist(), grp["log_ctx"].tolist(),
            grp["keywords_list"].tolist(), grp.index.values.tolist(),
            grp["rating"].tolist()
        ))
        user_pos[u] = seq

    n_neg = sum(
        1 for u, seq in user_all.items()
        for _, _, _, _, r in seq if 0 < r < POSITIVE_THRESHOLD
    )
    print(f"   ✓ Loaded {len(df_users)} interactions ({len(liked)} positive)")
    print(f"   ✓ {len(user_pos)} users with ≥3 positive interactions")
    print(f"   ✓ Negative interactions: {n_neg}")

    return user_all, user_pos, df_users


def build_context_index(item_meta):
    """Build fuzzy context matching index for Section 2.3.1 eligibility gate."""
    sub_index = {}
    for it, meta in item_meta.items():
        for s in meta["sub_set"]:
            sub_index.setdefault(s, []).append(it)
    sub_keys = list(sub_index.keys())

    def get_context_pool(log_ctx_raw: str):
        """Match user's context to item pool (exact or fuzzy)."""
        q = normalize_context(log_ctx_raw)
        if not q:
            return [], "", 0
        if q in sub_index:
            return sub_index[q].copy(), q, 0
        if ENABLE_FUZZY_CTX and sub_keys:
            m = get_close_matches(q, sub_keys, n=1, cutoff=FUZZY_CUTOFF)
            if m:
                return sub_index[m[0]].copy(), m[0], 1
        return [], q, 0

    return get_context_pool, sub_index


def build_splits_for_seed(user_pos, user_all, seed):
    """Create TRAIN/VAL/TEST splits (random leave-2-out per user)."""
    user_data = []
    for u, seq_pos in user_pos.items():
        if len(seq_pos) < 3:
            continue

        rng = np.random.default_rng(stable_int_seed(seed, u, "SPLIT"))
        idxs = np.arange(len(seq_pos))
        pick = rng.choice(idxs, size=2, replace=False)
        test_idx, val_idx = int(pick[0]), int(pick[1])

        test_it, test_ctx, test_kwl, test_row, test_r = seq_pos[test_idx]
        val_it, val_ctx, val_kwl, val_row, val_r = seq_pos[val_idx]

        train_pos = [seq_pos[i] for i in range(len(seq_pos)) if i not in (test_idx, val_idx)]
        train_items = [it for it, _, _, _, _ in train_pos]

        if len(train_items) < 1:
            continue

        # train_item2rating (positive train, mean-aggregated)
        _rat_agg = defaultdict(list)
        for it, _, _, _, rat in train_pos:
            _rat_agg[it].append(float(rat))
        train_item2rating = {it: float(np.mean(rs)) for it, rs in _rat_agg.items()}

        # train_neg_item2rating (negative interactions)
        _neg_agg = defaultdict(list)
        for it, ctx, kwl, row, r in user_all.get(u, []):
            r = float(r)
            if 0 < r < POSITIVE_THRESHOLD:
                _neg_agg[it].append(r)
        train_neg_item2rating = {it: float(np.mean(rs)) for it, rs in _neg_agg.items()}
        train_neg_item2rating.pop(val_it, None)
        train_neg_item2rating.pop(test_it, None)

        user_data.append({
            "user": u,
            "train_items": train_items,
            "train_item2rating": train_item2rating,
            "train_neg_item2rating": train_neg_item2rating,
            "val_item": val_it, "val_ctx": val_ctx, "val_kwl": val_kwl,
            "test_item": test_it, "test_ctx": test_ctx, "test_kwl": test_kwl,
        })

    return user_data


def build_all_splits(user_pos, user_all, seeds=SEEDS):
    """Pre-build splits for all seeds."""
    all_splits = {}
    for seed in seeds:
        all_splits[seed] = build_splits_for_seed(user_pos, user_all, seed)
        print(f"   ✓ Seed {seed}: {len(all_splits[seed])} users with valid splits")
    return all_splits


def compute_sparsity_bins(user_pos):
    """Compute user sparsity bin thresholds from data quartiles."""
    profile_lengths = [len(v) for v in user_pos.values()]
    q25, q50, q75 = np.percentile(profile_lengths, [25, 50, 75])
    cold_threshold = int(np.floor(q25))
    heavy_threshold = int(np.ceil(q75))

    n_cold = sum(1 for x in profile_lengths if x <= cold_threshold)
    n_mid = sum(1 for x in profile_lengths if cold_threshold < x < heavy_threshold)
    n_heavy = sum(1 for x in profile_lengths if x >= heavy_threshold)

    print(f"   User sparsity bins (quartile-derived):")
    print(f"     cold (≤{cold_threshold}): {n_cold} users")
    print(f"     mid ({cold_threshold}–{heavy_threshold}): {n_mid} users")
    print(f"     heavy (≥{heavy_threshold}): {n_heavy} users")

    return cold_threshold, heavy_threshold


def build_index_mappings(user_pos, item_meta):
    """Build user2idx / item2idx / idx2user / idx2item mappings."""
    user2idx = {u: i for i, u in enumerate(sorted(user_pos.keys()))}
    item2idx = {it: i for i, it in enumerate(sorted(item_meta.keys()))}
    idx2user = {i: u for u, i in user2idx.items()}
    idx2item = {i: it for it, i in item2idx.items()}
    return user2idx, item2idx, idx2user, idx2item


def prepare_all():
    """Master data preparation function. Returns all data structures."""
    print("=" * 60)
    print("PHASE 0: Data Preparation")
    print("=" * 60)

    item_meta = load_items()
    mapping_dict = load_mapping()
    word_taxonomy = load_consensus()
    user_all, user_pos, df_users = load_user_log(item_meta=item_meta)
    get_context_pool, sub_index = build_context_index(item_meta)
    all_splits = build_all_splits(user_pos, user_all)
    cold_threshold, heavy_threshold = compute_sparsity_bins(user_pos)
    user2idx, item2idx, idx2user, idx2item = build_index_mappings(user_pos, item_meta)

    print("\n✅ PHASE 0 Complete")

    return {
        "item_meta": item_meta,
        "mapping_dict": mapping_dict,
        "word_taxonomy": word_taxonomy,
        "user_all": user_all,
        "user_pos": user_pos,
        "df_users": df_users,
        "get_context_pool": get_context_pool,
        "sub_index": sub_index,
        "all_splits": all_splits,
        "cold_threshold": cold_threshold,
        "heavy_threshold": heavy_threshold,
        "user2idx": user2idx,
        "item2idx": item2idx,
        "idx2user": idx2user,
        "idx2item": idx2item,
    }