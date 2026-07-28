# -*- coding: utf-8 -*-
"""
hybrid.py — Section 2.3.4 Hybrid Fusion + XAI
=================================================
Implements 4 hybrid fusion methods and XAI explanation routing:

  1. Weighted Sum: CBF * alpha + CF * (1-alpha)
  2. Weighted Product: CBF^alpha * CF^(1-alpha) [minmax-normalized]
  3. Reciprocal Rank Fusion (RRF): 1/(K_RRF + rank_CBF) + 1/(K_RRF + rank_CF)
  4. Reliability-Gated: sigmoid-gated alpha based on confidence gap [tuned on val]

Score calibration: per-user z-score normalization before blending (WeightedSum, Gate).
WeightedProduct uses minmax normalization to avoid destroying negative z-scores.
Negative penalty: applied consistently AFTER fusion in all methods.

References:
  - RRF: Cormack et al. (2009)
  - Z-score calibration: Haldar et al. (2018)
  - SimpleX/MF-CCL: Mao et al. (2021)
"""

import os
import numpy as np
import pandas as pd
import torch
from scipy import stats as sp_stats

from config import (
    set_seed, calculate_metrics, minmax_norm, rank_norm, apply_negative_penalty,
    mc_store, SEEDS, K, ALPHA_RANGE_HYBRID, B_RANGE_CBF, B_RANGE_CF,
    K_RRF_GRID, DEVICE, OUTPUT_DIR,
    NEGATIVE_PENALTY_ALPHA, RATING_SCALE_MAX,
    FILTER_TARGET_NAME_FROM_KW,
)


def _filter_target_from_kws(selected_kws, target_item):
    """Remove the target item name from selected keywords to prevent keyword leakage."""
    from config import clean_text
    if not FILTER_TARGET_NAME_FROM_KW or not target_item:
        return selected_kws
    target = clean_text(target_item)
    if not target:
        return selected_kws
    return [kw for kw in selected_kws if kw != target]


# ═══════════════════════════════════════════════════════════════════════════
# HYBRID FUSION METHODS
# ═══════════════════════════════════════════════════════════════════════════

def hybrid_weighted_sum(cbf_scores, cf_scores, alpha):
    """Weighted sum: CBF * alpha + CF * (1-alpha). Requires z-score input."""
    return alpha * cbf_scores + (1 - alpha) * cf_scores


def hybrid_weighted_product(cbf_scores, cf_scores, alpha):
    """Weighted product: CBF^alpha * CF^(1-alpha). Requires minmax-normalized input.

    Uses minmax normalization instead of z-score because z-score produces
    negative values which would be clipped to ~0, destroying ~50% of the
    information. Minmax maps scores to [0, 1] where product is well-defined.

    The clip below guards against floating-point noise near zero (1e-8) but
    does NOT substitute for proper minmax normalization. Callers MUST pass
    minmax-normalized scores in [0, 1]; passing raw or z-scored scores will
    produce incorrect results.
    """
    cbf_scores = np.asarray(cbf_scores, dtype=np.float64)
    cf_scores = np.asarray(cf_scores, dtype=np.float64)
    # Guard: verify input is approximately in [0, 1] (minmax-normalized)
    if cbf_scores.min() < -0.1 or cbf_scores.max() > 1.1 or cf_scores.min() < -0.1 or cf_scores.max() > 1.1:
        raise ValueError(
            f"hybrid_weighted_product requires minmax-normalized input in [0, 1], "
            f"but got cbf range [{cbf_scores.min():.3f}, {cbf_scores.max():.3f}] "
            f"and cf range [{cf_scores.min():.3f}, {cf_scores.max():.3f}]. "
            f"Use calibrate_scores_minmax() before calling this function."
        )
    cbf_pos = np.clip(cbf_scores, 1e-8, None)
    cf_pos = np.clip(cf_scores, 1e-8, None)
    return np.power(cbf_pos, alpha) * np.power(cf_pos, 1 - alpha)


def hybrid_rrf(cbf_scores, cf_scores, k_rrf=60):
    """Reciprocal Rank Fusion (Cormack et al., 2009). Operates on raw scores."""
    cbf_rank = sp_stats.rankdata(-cbf_scores, method="average")
    cf_rank = sp_stats.rankdata(-cf_scores, method="average")
    return 1.0 / (k_rrf + cbf_rank) + 1.0 / (k_rrf + cf_rank)


def hybrid_reliability_gate(cbf_z, cf_z, alpha_high=0.7, alpha_low=0.3, temperature=1.0):
    """Sigmoid-gated alpha based on confidence gap.

    Instead of a hard binary switch (gap > 0 → alpha=0.7 else 0.3),
    uses a smooth sigmoid so that small gap differences don't flip alpha.
    The temperature parameter controls sharpness (lower = sharper gate).

    Parameters
    ----------
    alpha_high : float
        Alpha when CBF is more confident (default 0.7)
    alpha_low : float
        Alpha when CF is more confident (default 0.3)
    temperature : float
        Sigmoid sharpness. 1.0 = smooth, 0.1 = nearly binary
    """
    gap = compute_confidence_gap(cbf_z) - compute_confidence_gap(cf_z)
    gate = 1.0 / (1.0 + np.exp(-gap / max(temperature, 1e-8)))
    alpha = alpha_low + (alpha_high - alpha_low) * gate
    return alpha


def calibrate_scores_zscore(cbf_scores, cf_scores):
    """Per-user z-score normalization before blending (Haldar et al., 2018)."""
    def zscore(x):
        x = np.asarray(x, dtype=np.float64)
        mu = np.mean(x)
        std = np.std(x)
        if std < 1e-12:
            return np.zeros_like(x, dtype=np.float32)
        return ((x - mu) / std).astype(np.float32)

    return zscore(cbf_scores), zscore(cf_scores)


def calibrate_scores_minmax(cbf_scores, cf_scores):
    """Per-user minmax normalization for WeightedProduct (maps to [0, 1])."""
    cbf_mm = minmax_norm(np.asarray(cbf_scores, dtype=np.float64))
    cf_mm = minmax_norm(np.asarray(cf_scores, dtype=np.float64))
    return cbf_mm.astype(np.float32), cf_mm.astype(np.float32)


def compute_confidence_gap(scores):
    """Confidence signal from dominance gap (top1 - top2)."""
    if len(scores) < 2:
        return 0.0
    sorted_s = np.sort(scores)[::-1]
    return float(sorted_s[0] - sorted_s[1])


# ═══════════════════════════════════════════════════════════════════════════
# XAI EXPLANATION ROUTING
# ═══════════════════════════════════════════════════════════════════════════

def route_explanation_type(hit, cbf_norm, cf_norm, thresholds):
    """Classify explanation type into 5 categories."""
    CBF_HIGH = float(thresholds.get("CBF_HIGH", 0.70))
    CF_HIGH = float(thresholds.get("CF_HIGH", 0.70))
    GAP_DOM = float(thresholds.get("GAP_DOM", 0.15))

    if (cbf_norm >= CBF_HIGH) and (cf_norm >= CF_HIGH):
        return "Balanced"
    if (cf_norm >= CF_HIGH) and ((cf_norm - cbf_norm) >= GAP_DOM):
        return "CF-dominant"
    if (hit > 0) and (cbf_norm >= cf_norm):
        return "Keyword-driven"
    if (hit == 0) and (cbf_norm >= CBF_HIGH):
        return "Semantic-only"
    return "Context-only"


def thai_reason_from_hybrid(ctx, hit, kw_n, kw_show, cbf_norm, cf_norm, thresholds):
    """Generate Thai explanation text based on routing result."""
    ctx = str(ctx).strip() if ctx is not None else ""
    hit = int(hit) if hit is not None else 0
    kw_n = int(kw_n) if kw_n is not None else 0
    if kw_show is None:
        kw_txt = ""
    elif isinstance(kw_show, (list, tuple)):
        kw_txt = " , ".join([str(x).strip() for x in kw_show if str(x).strip()])
    else:
        kw_txt = str(kw_show).strip()

    ex_type = route_explanation_type(hit, cbf_norm, cf_norm, thresholds)
    if ex_type == "Balanced":
        return f"แนะนำภายในบริบท {ctx} และได้คะแนนสูงทั้งจากเนื้อหาและพฤติกรรม จึงเป็นตัวเลือกอันดับต้น ๆ"
    if ex_type == "CF-dominant":
        return f"แนะนำภายในบริบท {ctx} และคล้ายกับสิ่งที่คุณเคยชอบในอดีต จึงถูกจัดอันดับสูง"
    if ex_type == "Keyword-driven":
        if kw_txt:
            return f"แนะนำภายในบริบท {ctx} และตรงกับคำสำคัญ {kw_txt} ({hit}/{max(1, kw_n)})"
        return f"แนะนำภายในบริบท {ctx} และตรงกับคำสำคัญที่เลือก ({hit}/{max(1, kw_n)})"
    if ex_type == "Semantic-only":
        return f"แนะนำภายในบริบท {ctx} แม้คำสำคัญไม่ตรงตัว แต่เนื้อหาโดยรวมใกล้เคียงกับสิ่งที่คุณเลือก"
    return f"แนะนำภายในบริบท {ctx}"


def compute_xai_routing_thresholds(cbf_scores, cf_scores, q_high=0.70, q_gap=0.80, eps=1e-12):
    """Auto-calibrate XAI routing thresholds from CBF and CF scores."""
    if len(cbf_scores) == 0 or len(cf_scores) == 0:
        return {"CBF_HIGH": 0.70, "CF_HIGH": 0.70, "GAP_DOM": 0.15}
    cbf = np.asarray(cbf_scores, dtype=float)
    cf = np.asarray(cf_scores, dtype=float)
    cbf_high = float(np.clip(np.quantile(cbf, q_high), 0.50, 0.95))
    cf_high = float(np.clip(np.quantile(cf, q_high), 0.50, 0.95))
    diff = cf - cbf
    pos_diff = diff[diff > eps]
    gap_dom = float(np.clip(np.quantile(pos_diff, q_gap), 0.05, 0.50)) if len(pos_diff) > 0 else 0.15
    return {"CBF_HIGH": cbf_high, "CF_HIGH": cf_high, "GAP_DOM": gap_dom}


# ═══════════════════════════════════════════════════════════════════════════
# HYBRID EVALUATION (with score caching for efficiency)
# ═══════════════════════════════════════════════════════════════════════════

def _precompute_user_scores(user_split, seed, max_cands, phase, gate, mapping_dict,
                            item_emb_cache, item2idx, user2idx, backend, best_b_cbf,
                            best_cf_type, global_model, global_extra):
    """Precompute CBF and CF scores for all users once per (seed, max_cands).

    Batch-encodes all query texts in a single forward pass for efficiency,
    then computes CF scores per user. This eliminates ~30x redundant
    recomputation AND speeds up CBF encoding by ~10-50x vs per-user calls.

    Returns a list of dicts, one per user, with precomputed raw scores.
    Users where the target is not in candidates get None entries.
    """
    from cbf import encode_texts, get_candidate_embeddings
    from cf import score_candidates_cf

    # Phase 1: Collect metadata and filter feasible users
    user_meta = []
    for u_data in user_split:
        target = u_data[f"{phase}_item"]
        pf = gate.get_candidates(u_data, phase, seed, max_cands)
        cands = pf["cands"]

        if target not in cands:
            user_meta.append(None)
            continue

        cands_subset = [it for it in cands if it in item_emb_cache and it in item2idx]
        if target not in cands_subset:
            user_meta.append(None)
            continue

        u = user2idx.get(u_data["user"])
        if u is None:
            user_meta.append(None)
            continue

        filtered_kws = _filter_target_from_kws(pf["selected_kws"], target)
        kw_part = " ".join(filtered_kws) if filtered_kws else ""
        ctx_part = pf["log_ctx"] if pf["log_ctx"] else ""
        q_text = f"{kw_part} {ctx_part}".strip() if kw_part and ctx_part else (kw_part or ctx_part)

        user_meta.append({
            "u": u, "user": u_data["user"], "target": target,
            "cands_subset": cands_subset,
            "gt_idx": cands_subset.index(target),
            "neg_dict": u_data.get("train_neg_item2rating", {}),
            "pf": pf, "q_text": q_text, "filtered_kws": filtered_kws,
        })

    # Phase 2: Batch-encode all query texts in one forward pass
    feasible_indices = [i for i, m in enumerate(user_meta) if m is not None]
    query_texts = [user_meta[i]["q_text"] for i in feasible_indices]

    if query_texts:
        all_q_embs = encode_texts(backend, query_texts, is_query=True)
    else:
        all_q_embs = None

    # Phase 3: Compute CBF and CF scores per feasible user
    cached = []
    q_emb_idx = 0
    for i, m in enumerate(user_meta):
        if m is None:
            cached.append(None)
            continue

        cands_subset = m["cands_subset"]
        u = m["u"]
        pf = m["pf"]

        q_emb = all_q_embs[q_emb_idx]
        q_emb_idx += 1

        c_embs = get_candidate_embeddings(item_emb_cache, cands_subset, q_emb.device)
        cbf_raw = torch.mv(c_embs, q_emb).cpu().numpy()

        if best_b_cbf > 0 and (m.get("filtered_kws") or pf["selected_kws"]):
            kset = set(m.get("filtered_kws", pf["selected_kws"]))
            for j, it in enumerate(cands_subset):
                if not kset.isdisjoint(mapping_dict.get(it, set())):
                    cbf_raw[j] += best_b_cbf

        cand_idxs = [item2idx[it] for it in cands_subset]
        cf_raw = score_candidates_cf(best_cf_type, global_model, u, cand_idxs, global_extra, DEVICE)

        cached.append({
            "user": m["user"],
            "target": m["target"],
            "cands_subset": cands_subset,
            "gt_idx": m["gt_idx"],
            "neg_dict": m["neg_dict"],
            "cbf_raw": cbf_raw,
            "cf_raw": cf_raw,
            "pf": pf,
            "filtered_kws": m.get("filtered_kws", pf["selected_kws"]),
        })

    return cached


def run_hybrid_model(best_cbf_model_name, best_cf_type, all_splits, user2idx, item2idx,
                    gate, mapping_dict, item_emb_cache, backend, item_meta,
                    max_cands_list=None, best_cf_configs=None, per_user=None):
    """Run hybrid fusion with all 4 methods.

    Score caching: CBF/CF scores are computed once per (seed, max_cands, phase)
    and reused across all tuning and evaluation loops, eliminating ~30x
    redundant computation.

    Negative penalty: applied consistently AFTER fusion for all methods
    in both validation and test phases.
    """
    from cbf import get_candidate_embeddings, encode_texts
    from cf import get_or_train_cf_model, score_candidates_cf, _cf_model_cache

    from config import MAX_CANDS_LIST, CF_MODELS_TO_TEST
    if max_cands_list is None:
        max_cands_list = MAX_CANDS_LIST

    hybrid_results = []

    for seed_idx, seed in enumerate(SEEDS):
        set_seed(seed)
        user_split = all_splits[seed]

        for max_cands in max_cands_list:
            mc_key = mc_store(max_cands)

            # Look up CF config for this (seed, MAX_CANDS) pair, fallback to seed-only
            cf_kwargs = {}
            cfg_key = (seed, mc_key)
            cfg = None
            if best_cf_configs:
                if cfg_key in best_cf_configs:
                    cfg = best_cf_configs[cfg_key]
                elif seed in best_cf_configs:
                    cfg = best_cf_configs[seed]
            if cfg is not None:
                if best_cf_type == "EASE_R" and "ease_r_l2" in cfg:
                    cf_kwargs["ease_r_l2"] = cfg["ease_r_l2"]
                elif "best_cfg" in cfg:
                    cf_kwargs["model_config"] = cfg["best_cfg"]
                elif isinstance(cfg, dict) and not ("ease_r_l2" in cfg):
                    cf_kwargs["model_config"] = cfg
            global_model, global_extra = get_or_train_cf_model(
                best_cf_type, seed, user_split, user2idx, item2idx, DEVICE, **cf_kwargs
            )

            # ── Tune b_cbf on VAL ──
            best_b_cbf, best_val_cbf = 0.0, 0.0
            val_cache_no_boost = _precompute_user_scores(
                user_split, seed, max_cands, "val", gate, mapping_dict,
                item_emb_cache, item2idx, user2idx, backend, 0.0,
                best_cf_type, global_model, global_extra,
            )

            for b_cbf in B_RANGE_CBF:
                val_scores = []
                for entry in val_cache_no_boost:
                    if entry is None:
                        val_scores.append(0.0)
                        continue
                    score = entry["cbf_raw"].copy()
                    if b_cbf > 0 and (entry.get("filtered_kws") or entry["pf"]["selected_kws"]):
                        kset = set(entry.get("filtered_kws", entry["pf"]["selected_kws"]))
                        for j, it in enumerate(entry["cands_subset"]):
                            if not kset.isdisjoint(mapping_dict.get(it, set())):
                                score[j] += b_cbf
                    _, _, ndcg = calculate_metrics(score, entry["gt_idx"])
                    val_scores.append(ndcg)
                avg = np.mean(val_scores) if val_scores else 0.0
                if avg > best_val_cbf:
                    best_val_cbf = avg
                    best_b_cbf = b_cbf

            print(f"   Seed {seed} MAX_CANDS={max_cands}: best_b_cbf={best_b_cbf:.2f} (val nDCG={best_val_cbf:.4f})")

            # ── Precompute scores with best_b_cbf applied ──
            val_cache = _precompute_user_scores(
                user_split, seed, max_cands, "val", gate, mapping_dict,
                item_emb_cache, item2idx, user2idx, backend, best_b_cbf,
                best_cf_type, global_model, global_extra,
            )

            # ── Tune alpha on VAL for WeightedSum and WeightedProduct ──
            best_alpha_ws, best_alpha_wp, best_alpha_rg = 0.5, 0.5, 0.5
            best_val_hybrid = {}

            for alpha in ALPHA_RANGE_HYBRID:
                for method_name, method_fn in [
                    ("WeightedSum", lambda c, f, a=alpha: hybrid_weighted_sum(c, f, a)),
                    ("WeightedProduct", lambda c, f, a=alpha: hybrid_weighted_product(c, f, a)),
                ]:
                    val_ndcgs = []
                    for entry in val_cache:
                        if entry is None:
                            continue
                        cbf_raw = entry["cbf_raw"]
                        cf_raw = entry["cf_raw"]

                        if method_name == "WeightedSum":
                            cbf_z, cf_z = calibrate_scores_zscore(cbf_raw, cf_raw)
                            fused = method_fn(cbf_z, cf_z)
                        else:  # WeightedProduct: use minmax to avoid destroying negative values
                            cbf_mm, cf_mm = calibrate_scores_minmax(cbf_raw, cf_raw)
                            fused = method_fn(cbf_mm, cf_mm)

                        fused = apply_negative_penalty(fused, entry["cands_subset"], entry["neg_dict"])
                        _, _, ndcg = calculate_metrics(fused, entry["gt_idx"])
                        val_ndcgs.append(ndcg)

                    avg_ndcg = np.mean(val_ndcgs) if val_ndcgs else 0.0
                    key = f"{method_name}_{alpha:.1f}"
                    if key not in best_val_hybrid or avg_ndcg > best_val_hybrid[key]:
                        best_val_hybrid[key] = avg_ndcg

            # Select best alpha per method
            best_alpha_ws = max(
                [(float(k.split("_")[1]), v) for k, v in best_val_hybrid.items() if k.startswith("WeightedSum_")],
                key=lambda x: x[1]
            )[0] if any(k.startswith("WeightedSum_") for k in best_val_hybrid) else 0.5

            best_alpha_wp = max(
                [(float(k.split("_")[1]), v) for k, v in best_val_hybrid.items() if k.startswith("WeightedProduct_")],
                key=lambda x: x[1]
            )[0] if any(k.startswith("WeightedProduct_") for k in best_val_hybrid) else 0.5

            # ── Tune ReliabilityGate alpha on VAL ──
            # Search over (alpha_high, alpha_low) pairs with sigmoid temperature
            best_rg_score, best_rg_params = 0.0, (0.7, 0.3, 1.0)
            for alpha_high in [0.6, 0.7, 0.8, 0.9]:
                for alpha_low in [0.1, 0.2, 0.3, 0.4]:
                    if alpha_high <= alpha_low:
                        continue
                    for temperature in [0.1, 0.5, 1.0]:
                        val_ndcgs = []
                        for entry in val_cache:
                            if entry is None:
                                continue
                            cbf_z, cf_z = calibrate_scores_zscore(entry["cbf_raw"], entry["cf_raw"])
                            alpha_gate = hybrid_reliability_gate(cbf_z, cf_z, alpha_high, alpha_low, temperature)
                            fused = hybrid_weighted_sum(cbf_z, cf_z, alpha_gate)
                            fused = apply_negative_penalty(fused, entry["cands_subset"], entry["neg_dict"])
                            _, _, ndcg = calculate_metrics(fused, entry["gt_idx"])
                            val_ndcgs.append(ndcg)
                        avg = np.mean(val_ndcgs) if val_ndcgs else 0.0
                        if avg > best_rg_score:
                            best_rg_score = avg
                            best_rg_params = (alpha_high, alpha_low, temperature)

            # ── Tune RRF k ──
            best_k_rrf, best_val_rrf = 60, 0.0
            for k_rrf in K_RRF_GRID:
                val_ndcgs = []
                for entry in val_cache:
                    if entry is None:
                        continue
                    fused = hybrid_rrf(entry["cbf_raw"], entry["cf_raw"], k_rrf=k_rrf)
                    fused = apply_negative_penalty(fused, entry["cands_subset"], entry["neg_dict"])
                    _, _, ndcg = calculate_metrics(fused, entry["gt_idx"])
                    val_ndcgs.append(ndcg)
                avg = np.mean(val_ndcgs) if val_ndcgs else 0.0
                if avg > best_val_rrf:
                    best_val_rrf = avg
                    best_k_rrf = k_rrf

            # ── TEST evaluation: precompute once ──
            test_cache = _precompute_user_scores(
                user_split, seed, max_cands, "test", gate, mapping_dict,
                item_emb_cache, item2idx, user2idx, backend, best_b_cbf,
                best_cf_type, global_model, global_extra,
            )

            for method_name, alpha, k_rrf_m in [
                ("Hybrid-WeightedSum", best_alpha_ws, None),
                ("Hybrid-WeightedProduct", best_alpha_wp, None),
                ("Hybrid-RRF", None, best_k_rrf),
                ("Hybrid-ReliabilityGate", None, None),
            ]:
                test_metrics = {"ndcg": 0, "hr": 0, "mrr": 0, "total": 0, "feasible": 0}
                for entry in test_cache:
                    test_metrics["total"] += 1
                    if entry is None:
                        continue
                    test_metrics["feasible"] += 1

                    cbf_raw = entry["cbf_raw"]
                    cf_raw = entry["cf_raw"]
                    neg_dict = entry["neg_dict"]

                    if method_name == "Hybrid-WeightedSum":
                        cbf_z, cf_z = calibrate_scores_zscore(cbf_raw, cf_raw)
                        fused = hybrid_weighted_sum(cbf_z, cf_z, alpha)
                        fused = apply_negative_penalty(fused, entry["cands_subset"], neg_dict)
                    elif method_name == "Hybrid-WeightedProduct":
                        cbf_mm, cf_mm = calibrate_scores_minmax(cbf_raw, cf_raw)
                        fused = hybrid_weighted_product(cbf_mm, cf_mm, alpha)
                        fused = apply_negative_penalty(fused, entry["cands_subset"], neg_dict)
                    elif method_name == "Hybrid-RRF":
                        fused = hybrid_rrf(cbf_raw, cf_raw, k_rrf=k_rrf_m)
                        fused = apply_negative_penalty(fused, entry["cands_subset"], neg_dict)
                    else:  # ReliabilityGate: use tuned params
                        cbf_z, cf_z = calibrate_scores_zscore(cbf_raw, cf_raw)
                        alpha_high, alpha_low, temperature = best_rg_params
                        alpha_gate = hybrid_reliability_gate(cbf_z, cf_z, alpha_high, alpha_low, temperature)
                        fused = hybrid_weighted_sum(cbf_z, cf_z, alpha_gate)
                        fused = apply_negative_penalty(fused, entry["cands_subset"], neg_dict)

                    hr, mrr, ndcg = calculate_metrics(fused, entry["gt_idx"])
                    test_metrics["ndcg"] += ndcg
                    test_metrics["hr"] += hr
                    test_metrics["mrr"] += mrr

                    # Collect per-user data for significance tests & user-bin analysis
                    if per_user is not None:
                        fused_arr = np.asarray(fused, dtype=float)
                        gt_score = float(fused_arr[entry["gt_idx"]])
                        rank = int((fused_arr > gt_score).sum() + np.isclose(fused_arr, gt_score, rtol=1e-5, atol=1e-8).sum())
                        per_user.append({
                            "seed": seed,
                            "MAX_CANDS": mc_store(max_cands),
                            "user": entry["user"],
                            "model": method_name,
                            "target": entry["target"],
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

                hybrid_results.append({
                    "Model": method_name, "Seed": seed, "MAX_CANDS": max_cands,
                    "best_alpha": alpha if alpha is not None else (best_k_rrf if k_rrf_m else None),
                    "best_k_rrf": k_rrf_m,
                    "best_b_cbf": best_b_cbf,
                    "coverage_rate": cov,
                    "feasible_nDCG@10": ndcg_f, "feasible_HR@10": hr_f, "feasible_MRR@10": mrr_f,
                    "feasible_cases": test_metrics["feasible"], "total_cases": test_metrics["total"],
                })

        # Free memory between seeds — release candidate cache and trigger GC
        gate.clear_cache()
        import gc
        gc.collect()

    return hybrid_results


# ═══════════════════════════════════════════════════════════════════════════
# EVALUATION TABLES
# ═══════════════════════════════════════════════════════════════════════════

def format_metric(mean_val, std_val, decimals=4):
    """Format as mean±std."""
    return f"{mean_val:.{decimals}f}±{std_val:.{decimals}f}"


def generate_paper_tables(all_results, output_dir):
    """Generate paper-ready tables from all results."""
    os.makedirs(output_dir, exist_ok=True)
    df = pd.DataFrame(all_results)

    # Create display label: "all eligible" for NaN, integer string otherwise
    df["MAX_CANDS_LABEL"] = df["MAX_CANDS"].apply(
        lambda x: "all eligible" if pd.isna(x) else str(int(x))
    )

    # Overall results
    summary = df.groupby(["Model", "MAX_CANDS_LABEL"], dropna=False).agg(
        nDCG_mean=("feasible_nDCG@10", "mean"),
        nDCG_std=("feasible_nDCG@10", "std"),
        HR_mean=("feasible_HR@10", "mean"),
        HR_std=("feasible_HR@10", "std"),
        MRR_mean=("feasible_MRR@10", "mean"),
        MRR_std=("feasible_MRR@10", "std"),
        coverage_mean=("coverage_rate", "mean"),
        feasible_mean=("feasible_cases", "mean"),
    ).reset_index()

    summary["nDCG@10"] = summary.apply(lambda r: format_metric(r["nDCG_mean"], r["nDCG_std"]), axis=1)
    summary["HR@10"] = summary.apply(lambda r: format_metric(r["HR_mean"], r["HR_std"]), axis=1)
    summary["MRR@10"] = summary.apply(lambda r: format_metric(r["MRR_mean"], r["MRR_std"]), axis=1)

    summary.to_csv(os.path.join(output_dir, "results_overall.csv"), index=False, encoding="utf-8-sig")
    print(f"Saved results_overall.csv ({len(summary)} rows)")

    return summary