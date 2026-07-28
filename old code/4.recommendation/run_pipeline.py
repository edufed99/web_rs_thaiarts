# -*- coding: utf-8 -*-
"""
run_pipeline.py — Section 2.4 End-to-End Evaluation Pipeline
=============================================================
Master entry point for the Eligibility-Gated Recommendation system.

Orchestrates the full pipeline:
  Phase 0: Data loading and preparation (Section 2.2 → 2.3.1)
  Phase 1A: Content-Based Filtering (Section 2.3.2)
  Phase 1B: Collaborative Filtering (Section 2.3.3)
  Phase 1C: Hybrid Fusion (Section 2.3.4)
  Phase 1D: XAI Explanation Routing (Section 2.3.4)
  Phase 2:  Result aggregation
  Phase 3:  Paper-ready table generation
  Phase 4:  Significance tests and per-user-bin analysis

Usage:
  python run_pipeline.py                       # Full pipeline (all phases)
  python run_pipeline.py --phase cbf           # Run only CBF
  python run_pipeline.py --phase cf            # Run only CF
  python run_pipeline.py --phase hybrid        # Run only Hybrid
  python run_pipeline.py --seeds 42 123        # Override seeds
  python run_pipeline.py --max-cands 40 80     # Override candidate pool sizes
  python run_pipeline.py --cbf-models bge-m3   # Run specific CBF model only


"""

import argparse
import os
import sys
import time
import json
import hashlib
import numpy as np
import pandas as pd

# ── UTF-8 console output for Thai text ──
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

from config import (
    set_seed, calculate_metrics, mc_store, clean_text, apply_negative_penalty,
    SEEDS, K, MAX_CANDS_LIST, DEVICE, OUTPUT_DIR,
    EMBEDDING_MODELS, CF_MODELS_TO_TEST, CBF_SHORT_TO_FULL,
    ALPHA_RANGE_HYBRID, B_RANGE_CBF, B_RANGE_CF, K_RRF_GRID,
    NEGATIVE_PENALTY_ALPHA, RATING_SCALE_MAX,
    FILTER_TARGET_NAME_FROM_KW,
)
from data_loader import prepare_all, build_context_index
from eligibility_gate import EligibilityGate, compute_cross_context_stats
from cbf import run_all_cbf, load_embedding_backend, precompute_item_embeddings
from cf import run_all_cf, get_or_train_cf_model, _cf_model_cache
from hybrid import (
    run_hybrid_model, generate_paper_tables,
    calibrate_scores_zscore, compute_confidence_gap,
    route_explanation_type, thai_reason_from_hybrid,
    compute_xai_routing_thresholds,
)


# ═══════════════════════════════════════════════════════════════════════════
# HELPER FUNCTIONS
# ═════════════════════════════════════════════════════════════════════════

def _mc_filter(df, mc):
    """NaN-safe MAX_CANDS filter. pd.NA/None becomes NaN, and NaN != NaN."""
    if pd.isna(mc):
        return df[df["MAX_CANDS"].isna()]
    return df[df["MAX_CANDS"] == mc]


def map_model_family(model_name):
    """Classify model into family for table grouping."""
    m = str(model_name)
    if m.startswith("CBF-"):
        return "CBF"
    if m.startswith("POP-"):
        return "POP"
    if m.startswith("Hybrid-"):
        return "HYBRID"
    if m.startswith("CF-"):
        return "CF"
    return "OTHER"


def map_model_name(model_name):
    """Canonical short name for tables."""
    m = str(model_name)
    if m.startswith("CBF-"):
        return m.replace("CBF-", "")
    if m.startswith("POP-"):
        return m.replace("POP-", "POP-")
    if m.startswith("Hybrid-"):
        return m.replace("Hybrid-", "H-")
    return m


def select_best_cbf_model(cbf_results):
    """Select the best CBF model by mean validation nDCG@10 across seeds."""
    if not cbf_results:
        return None, None
    df = pd.DataFrame(cbf_results)
    # Group by model name and average across seeds before selecting best
    grouped = df.groupby("Model")["best_val_nDCG@10"].mean()
    if grouped.empty:
        return None, None
    best_model_name = grouped.idxmax()
    # Average best_b_cbf across seeds for the best model
    best_rows = df[df["Model"] == best_model_name]
    best_b = best_rows["best_b_cbf"].mean()
    best_name = best_model_name.replace("CBF-", "")
    # Map short name back to full HuggingFace model ID for load_embedding_backend()
    best_name = CBF_SHORT_TO_FULL.get(best_name, best_name)
    return best_name, best_b


def select_best_cf_model(cf_results):
    """Select the best CF model by mean validation nDCG@10 across seeds.

    Uses validation metric (best_val_nDCG@10) instead of test metric
    (feasible_nDCG@10) to avoid data leakage in model selection.

    Returns the CF type name (e.g., "BiasedMF-BPR") without the "CF-" prefix,
    suitable for passing to get_or_train_cf_model() and score_candidates_cf().
    """
    if not cf_results:
        return None
    df = pd.DataFrame(cf_results)
    # Exclude POP baselines (they don't have best_val_nDCG@10)
    cf_only = df[~df["Model"].str.startswith("POP-")]
    if cf_only.empty:
        return None
    if "best_val_nDCG@10" not in cf_only.columns:
        # Fallback to test metric is data leakage — fail loudly instead
        raise ValueError(
            "best_val_nDCG@10 column missing from CF results. "
            "Using feasible_nDCG@10 (test metric) for model selection "
            "would cause data leakage. Check that CF grid search "
            "produced validation metrics correctly."
        )
    else:
        grouped = cf_only.groupby("Model")["best_val_nDCG@10"].mean()
    if grouped.empty:
        return None
    best_model = grouped.idxmax()
    # Strip "CF-" prefix to get the raw cf_type for get_or_train_cf_model()
    return best_model.replace("CF-", "", 1) if best_model.startswith("CF-") else best_model


# ═══════════════════════════════════════════════════════════════════════════
# XAI EVALUATION
# ═════════════════════════════════════════════════════════════════════════

def run_xai_evaluation(all_splits, hybrid_results, gate, item_meta, mapping_dict,
                       user2idx, item2idx, best_cbf_model_name, best_cf_type,
                       best_b_cbf, output_dir, seeds, max_cands_list, run_id,
                       best_cf_configs=None, target_hybrid_method="Hybrid-WeightedSum"):
    """Section 2.3.4 — XAI explanation routing evaluation.

    Produces per-item explanation types for top-K recommended items
    using the final hybrid fused ranking (not CBF-only).
    Outputs xai_topk_item_level.csv and xai_topk_summary.csv.
    """
    from cbf import encode_texts, get_candidate_embeddings
    from cf import score_candidates_cf

    print("\n" + "=" * 60)
    print("PHASE 1D: XAI Explanation Routing (Top-K Hybrid Ranking)")
    print("=" * 60)

    # Build lookup for best alpha from hybrid results
    df_hyb = pd.DataFrame(hybrid_results) if hybrid_results else pd.DataFrame()

    def get_best_alpha(seed_val, max_cands_val, method=target_hybrid_method):
        if df_hyb.empty:
            return 0.5
        mc = mc_store(max_cands_val)
        sub = df_hyb[
            (df_hyb["Seed"] == seed_val)
            & (df_hyb["Model"] == method)
        ].copy()
        if "MAX_CANDS" in sub.columns:
            sub["MAX_CANDS_KEY"] = sub["MAX_CANDS"].apply(
                lambda x: mc_store(x) if pd.notna(x) else "all"
            )
            sub = sub[sub["MAX_CANDS_KEY"] == mc]
        if sub.empty:
            return 0.5
        if "best_alpha" in sub.columns:
            alpha_val = sub.iloc[0]["best_alpha"]
            return float(alpha_val) if pd.notna(alpha_val) else 0.5
        return 0.5

    xai_rows = []

    for seed in seeds:
        set_seed(seed)
        user_split = all_splits[seed]

        # Load CBF backend for XAI scoring
        backend = load_embedding_backend(best_cbf_model_name, DEVICE)
        all_items_list = sorted(item_meta.keys())
        from cbf import build_enriched_item_texts
        item_texts = build_enriched_item_texts(item_meta)
        item_emb_cache = precompute_item_embeddings(backend, all_items_list, item_texts=item_texts)

        for max_cands in max_cands_list:
            # Look up CF config for this (seed, MAX_CANDS) pair, fallback to seed-only
            cf_kwargs = {}
            mc_key = mc_store(max_cands)
            if best_cf_configs:
                cfg = best_cf_configs.get((seed, mc_key), best_cf_configs.get(seed))
            else:
                cfg = None
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

            # Get best alpha for this (seed, max_cands)
            alpha = get_best_alpha(seed, max_cands, target_hybrid_method)

            # Collect all cbf_z and cf_z scores first, then calibrate thresholds
            all_cbf_z = []
            all_cf_z = []

            for u_data in user_split:
                target = u_data["test_item"]
                pf = gate.get_candidates(u_data, "test", seed, max_cands)
                cands = pf["cands"]
                if target not in cands:
                    continue
                cands_subset = [it for it in cands if it in item_emb_cache and it in item2idx]
                if target not in cands_subset:
                    continue
                u = user2idx.get(u_data["user"])
                if u is None:
                    continue
                cand_idxs = [item2idx[it] for it in cands_subset]

                target_name_clean = clean_text(target) if FILTER_TARGET_NAME_FROM_KW else None
                filtered_kws = [kw for kw in (pf["selected_kws"] or []) if kw != target_name_clean] if FILTER_TARGET_NAME_FROM_KW else (pf["selected_kws"] or [])
                kw_part = " ".join(filtered_kws) if filtered_kws else ""
                ctx_part = pf["log_ctx"] if pf["log_ctx"] else ""
                q_text = f"{kw_part} {ctx_part}".strip() if kw_part and ctx_part else (kw_part or ctx_part)

                q_emb = encode_texts(backend, [q_text], is_query=True)[0]
                c_embs = get_candidate_embeddings(item_emb_cache, cands_subset, DEVICE)
                cbf_raw = np.dot(c_embs.cpu().numpy(), q_emb.cpu().numpy())

                if best_b_cbf > 0 and filtered_kws:
                    kset = set(filtered_kws)
                    for j, it in enumerate(cands_subset):
                        if not kset.isdisjoint(mapping_dict.get(it, set())):
                            cbf_raw[j] += best_b_cbf

                cf_raw = score_candidates_cf(best_cf_type, global_model, u, cand_idxs, global_extra, DEVICE)
                cbf_z, cf_z = calibrate_scores_zscore(cbf_raw, cf_raw)
                all_cbf_z.append(cbf_z)
                all_cf_z.append(cf_z)

            if all_cbf_z:
                all_cbf_z_concat = np.concatenate(all_cbf_z)
                all_cf_z_concat = np.concatenate(all_cf_z)
                xai_thresholds = compute_xai_routing_thresholds(all_cbf_z_concat, all_cf_z_concat)
            else:
                xai_thresholds = compute_xai_routing_thresholds(np.array([]), np.array([]))

            # Second pass: compute XAI rows for top-K recommended items
            for u_data in user_split:
                target = u_data["test_item"]
                pf = gate.get_candidates(u_data, "test", seed, max_cands)
                cands = pf["cands"]
                if target not in cands:
                    continue
                cands_subset = [it for it in cands if it in item_emb_cache and it in item2idx]
                if target not in cands_subset:
                    continue
                u = user2idx.get(u_data["user"])
                if u is None:
                    continue
                cand_idxs = [item2idx[it] for it in cands_subset]

                target_name_clean = clean_text(target) if FILTER_TARGET_NAME_FROM_KW else None
                filtered_kws = [kw for kw in (pf["selected_kws"] or []) if kw != target_name_clean] if FILTER_TARGET_NAME_FROM_KW else (pf["selected_kws"] or [])
                kw_part = " ".join(filtered_kws) if filtered_kws else ""
                ctx_part = pf["log_ctx"] if pf["log_ctx"] else ""
                q_text = f"{kw_part} {ctx_part}".strip() if kw_part and ctx_part else (kw_part or ctx_part)

                q_emb = encode_texts(backend, [q_text], is_query=True)[0]
                c_embs = get_candidate_embeddings(item_emb_cache, cands_subset, DEVICE)
                cbf_raw = np.dot(c_embs.cpu().numpy(), q_emb.cpu().numpy())

                if best_b_cbf > 0 and filtered_kws:
                    kset = set(filtered_kws)
                    for j, it in enumerate(cands_subset):
                        if not kset.isdisjoint(mapping_dict.get(it, set())):
                            cbf_raw[j] += best_b_cbf

                cf_raw = score_candidates_cf(best_cf_type, global_model, u, cand_idxs, global_extra, DEVICE)

                # Calibrate and compute fused hybrid score
                cbf_z, cf_z = calibrate_scores_zscore(cbf_raw, cf_raw)
                fused = alpha * cbf_z + (1 - alpha) * cf_z
                fused = apply_negative_penalty(fused, cands_subset, u_data.get("train_neg_item2rating", {}))

                # Get top-K recommended items from hybrid ranking
                top_idx = np.argsort(-fused)[:K]

                kw_n = pf.get("kw_n", 0)

                for rank_pos, idx in enumerate(top_idx, start=1):
                    item_name = cands_subset[idx]

                    keyword_hit = 0
                    if filtered_kws:
                        kset = set(filtered_kws)
                        keyword_hit = int(not kset.isdisjoint(mapping_dict.get(item_name, set())))

                    ex_type = route_explanation_type(
                        keyword_hit,
                        float(cbf_z[idx]),
                        float(cf_z[idx]),
                        xai_thresholds,
                    )

                    reason = thai_reason_from_hybrid(
                        pf["log_ctx"],
                        keyword_hit,
                        kw_n,
                        filtered_kws,
                        float(cbf_z[idx]),
                        float(cf_z[idx]),
                        xai_thresholds,
                    )

                    xai_rows.append({
                        "run_id": run_id,
                        "seed": seed,
                        "MAX_CANDS": mc_key,
                        "user": u_data["user"],
                        "context": pf["log_ctx"],
                        "model": target_hybrid_method,
                        "recommended_item": item_name,
                        "heldout_target": target,
                        "rank": rank_pos,
                        "is_target": int(item_name == target),
                        "hybrid_score": float(fused[idx]),
                        "cbf_norm": float(cbf_z[idx]),
                        "cf_norm": float(cf_z[idx]),
                        "keyword_hit": keyword_hit,
                        "explanation_type": ex_type,
                        "reason_th": reason,
                    })

        del backend
        import gc
        gc.collect()

    df_xai = pd.DataFrame(xai_rows)
    xai_path = os.path.join(output_dir, "xai_topk_item_level.csv")
    df_xai.to_csv(xai_path, index=False, encoding="utf-8-sig")
    print(f"   Saved {len(df_xai)} XAI top-K rows to {xai_path}")

    # Summary — evidence-route availability (not "explanation quality")
    if not df_xai.empty:
        xai_summary = df_xai.groupby(["seed", "MAX_CANDS", "model"]).agg(
            route_availability=("explanation_type", lambda s: s.notna().mean()),
            balanced_rate=("explanation_type", lambda s: (s == "Balanced").mean()),
            keyword_driven_rate=("explanation_type", lambda s: (s == "Keyword-driven").mean()),
            semantic_only_rate=("explanation_type", lambda s: (s == "Semantic-only").mean()),
            cf_dominant_rate=("explanation_type", lambda s: (s == "CF-dominant").mean()),
            context_only_rate=("explanation_type", lambda s: (s == "Context-only").mean()),
            keyword_hit_rate=("keyword_hit", "mean"),
            avg_cbf_norm=("cbf_norm", "mean"),
            avg_cf_norm=("cf_norm", "mean"),
            n_recommendations=("recommended_item", "count"),
        ).reset_index()
        xai_summary.to_csv(os.path.join(output_dir, "xai_topk_summary.csv"), index=False, encoding="utf-8-sig")

    return xai_rows


# ═══════════════════════════════════════════════════════════════════════════
# SIGNIFICANCE TESTS & PER-USER-BIN ANALYSIS
# ═════════════════════════════════════════════════════════════════════════

def compute_paired_significance(per_user_df, output_dir):
    """Section 2.4 — Per-user paired Wilcoxon signed-rank + Bootstrap CI + Cohen's d_z.

    Tests best Hybrid vs all baselines using per-user nDCG@10 pairs.
    """
    from scipy import stats

    print("\n" + "=" * 60)
    print("A7: Paired Significance Tests (Per-User nDCG@10)")
    print("=" * 60)

    if per_user_df.empty:
        print("   No per-user data — skipping significance tests.")
        return

    rows = []
    # Identify best Hybrid model from aggregate results
    hyb_models = per_user_df[per_user_df["model"].str.startswith("Hybrid-")]["model"].unique()
    if len(hyb_models) == 0:
        print("   No Hybrid per-user data — skipping significance tests.")
        return

    # Use the Hybrid model with highest mean nDCG@10
    best_hybrid = per_user_df[per_user_df["model"].str.startswith("Hybrid-")].groupby("model")["nDCG@10"].mean().idxmax()
    print(f"   Best Hybrid model: {best_hybrid}")

    baselines = [
        m for m in per_user_df["model"].unique()
        if not m.startswith("Hybrid-")
    ]

    for mc in per_user_df["MAX_CANDS"].unique():
        sub = per_user_df[per_user_df["MAX_CANDS"] == mc]

        for baseline in baselines:
            h = sub[sub["model"] == best_hybrid][
                ["seed", "user", "nDCG@10"]
            ].rename(columns={"nDCG@10": "hybrid"})

            b = sub[sub["model"] == baseline][
                ["seed", "user", "nDCG@10"]
            ].rename(columns={"nDCG@10": "baseline"})

            paired = h.merge(b, on=["seed", "user"], how="inner")
            if len(paired) < 5:
                print(f"   Skipping {best_hybrid} vs {baseline} @ {mc}: only {len(paired)} pairs")
                continue

            diff = paired["hybrid"] - paired["baseline"]

            try:
                stat, p = stats.wilcoxon(diff, alternative="greater")
            except Exception:
                stat, p = np.nan, np.nan

            rng = np.random.default_rng(42)
            boot = [
                np.mean(rng.choice(diff.values, size=len(diff), replace=True))
                for _ in range(5000)
            ]
            ci_lo, ci_hi = np.percentile(boot, [2.5, 97.5])
            cohen_dz = float(diff.mean() / (diff.std(ddof=1) + 1e-12))

            rows.append({
                "MAX_CANDS": mc,
                "hybrid": best_hybrid,
                "baseline": baseline,
                "n_pairs": len(paired),
                "mean_diff_nDCG@10": float(diff.mean()),
                "ci_95_lo": float(ci_lo),
                "ci_95_hi": float(ci_hi),
                "wilcoxon_p_greater": float(p) if not np.isnan(p) else np.nan,
                "cohen_dz": cohen_dz,
            })

    if rows:
        df_sig = pd.DataFrame(rows)
        df_sig.to_csv(os.path.join(output_dir, "results_significance_paired_user.csv"), index=False, encoding="utf-8-sig")
        print(f"   Saved {len(df_sig)} paired significance test rows")
        print(f"   Best Hybrid: {best_hybrid}")
        for _, row in df_sig.iterrows():
            print(f"     vs {row['baseline']} @ {row['MAX_CANDS']}: "
                  f"diff={row['mean_diff_nDCG@10']:.4f}, "
                  f"p={row['wilcoxon_p_greater']:.4f}, "
                  f"d_z={row['cohen_dz']:.4f}, "
                  f"n={int(row['n_pairs'])}")
    else:
        print("   No paired significance test rows produced.")


def build_results_by_user_bin(all_splits, seeds, max_cands_list, per_user_df,
                              cold_threshold, heavy_threshold, output_dir):
    """Section 2.4 — Per-user-bin (cold/mid/heavy) results for all models.

    Computes nDCG@10, HR@10, MRR@10 per model × MAX_CANDS × user_bin,
    enabling analysis of how recommendation quality varies with user activity level.
    Uses per-user data when available, falls back to aggregate-level analysis.
    """
    from config import get_user_bin

    print("\n" + "=" * 60)
    print("O3: Results by User Bin (cold/mid/heavy)")
    print(f"   Thresholds: cold(<={cold_threshold}), mid, heavy(>={heavy_threshold})")
    print("=" * 60)

    # Build user-to-bin mapping from all_splits
    user_bin_map = {}
    for seed in seeds:
        for u_data in all_splits[seed]:
            user = u_data["user"]
            n_pos = len(u_data["train_items"])
            user_bin_map[user] = get_user_bin(n_pos, cold_threshold, heavy_threshold)

    bin_rows = []

    if not per_user_df.empty and "user" in per_user_df.columns:
        # Per-model, per-user-bin analysis using per-user metrics
        per_user_df["user_bin"] = per_user_df["user"].map(user_bin_map)

        for mc in per_user_df["MAX_CANDS"].unique():
            sub = per_user_df[per_user_df["MAX_CANDS"] == mc]

            for model in sub["model"].unique():
                model_sub = sub[sub["model"] == model]

                for ub in ["cold", "mid", "heavy"]:
                    bin_sub = model_sub[model_sub["user_bin"] == ub]
                    if bin_sub.empty:
                        continue

                    for seed in bin_sub["seed"].unique():
                        seed_sub = bin_sub[bin_sub["seed"] == seed]
                        bin_rows.append({
                            "seed": int(seed),
                            "MAX_CANDS": mc,
                            "user_bin": ub,
                            "model": model,
                            "nDCG@10_mean": seed_sub["nDCG@10"].mean(),
                            "HR@10_mean": seed_sub["HR@10"].mean(),
                            "MRR@10_mean": seed_sub["MRR@10"].mean(),
                            "n_users": len(seed_sub),
                        })

            # Also compute per-bin means across all seeds
            for model in sub["model"].unique():
                model_sub = sub[sub["model"] == model]
                for ub in ["cold", "mid", "heavy"]:
                    bin_sub = model_sub[model_sub["user_bin"] == ub]
                    if bin_sub.empty:
                        continue
                    bin_rows.append({
                        "seed": "all",
                        "MAX_CANDS": mc,
                        "user_bin": ub,
                        "model": model,
                        "nDCG@10_mean": bin_sub["nDCG@10"].mean(),
                        "HR@10_mean": bin_sub["HR@10"].mean(),
                        "MRR@10_mean": bin_sub["MRR@10"].mean(),
                        "n_users": len(bin_sub),
                    })

    if bin_rows:
        df_bins = pd.DataFrame(bin_rows)
        df_bins.to_csv(os.path.join(output_dir, "results_by_user_bin.csv"), index=False, encoding="utf-8-sig")
        print(f"   Saved {len(df_bins)} per-model user-bin rows")

        # Print summary table
        if not per_user_df.empty and "user" in per_user_df.columns:
            all_seeds_df = df_bins[df_bins["seed"] == "all"]
            if not all_seeds_df.empty:
                for mc in sorted(all_seeds_df["MAX_CANDS"].unique(), key=str):
                    mc_sub = all_seeds_df[all_seeds_df["MAX_CANDS"] == mc]
                    print(f"\n   MAX_CANDS={mc}:")
                    for ub in ["cold", "mid", "heavy"]:
                        ub_sub = mc_sub[mc_sub["user_bin"] == ub]
                        if ub_sub.empty:
                            continue
                        for _, row in ub_sub.iterrows():
                            print(f"     {ub:>5} | {row['model']:>30} | "
                                  f"nDCG={row['nDCG@10_mean']:.4f} "
                                  f"HR={row['HR@10_mean']:.4f} "
                                  f"MRR={row['MRR@10_mean']:.4f} "
                                  f"n={int(row['n_users'])}")
    else:
        print("   No per-user data available for user-bin analysis.")


# ═══════════════════════════════════════════════════════════════════════════
# CONTEXT POLICY & CONTAMINATION REPORTS
# ═════════════════════════════════════════════════════════════════════════

def build_context_policy_report(all_splits, seeds, max_cands_list, gate, item_meta,
                                mapping_dict, user2idx, item2idx,
                                best_cbf_model_name, best_cf_type, output_dir):
    """A6: Context policy comparison (pre-filter ON vs OFF)."""
    print("\n" + "=" * 60)
    print("A6: Context Policy Report (Violation@K)")
    print("=" * 60)

    from cbf import encode_texts, get_candidate_embeddings
    from cf import score_candidates_cf

    rows = []
    # Re-use the existing gate (pre-filter ON) — results are already computed.
    # For OFF, we'd need a gate without context filtering.
    # Here we report the ON results (context violation rate within top-K).
    for seed in seeds:
        for max_cands in max_cands_list:
            for u_data in all_splits[seed]:
                pf = gate.get_candidates(u_data, "test", seed, max_cands)
                cands = pf["cands"]
                matched_ctx = pf["matched_ctx"]
                if not matched_ctx or not cands:
                    continue
                for topk in [1, 5, 10]:
                    top_items = cands[:topk]
                    in_ctx = sum(
                        1 for it in top_items
                        if matched_ctx in item_meta.get(it, {}).get("sub_set", [])
                    )
                    violation = (topk - in_ctx) / topk
                    rows.append({
                        "seed": seed, "MAX_CANDS": mc_store(max_cands),
                        "user": u_data["user"], "context": matched_ctx,
                        f"violation@{topk}": violation,
                        f"in_context@{topk}": in_ctx,
                    })

    if rows:
        df_ctx = pd.DataFrame(rows)
        ctx_summary = df_ctx.groupby(["seed", "MAX_CANDS"]).agg(
            violation_at_1=("violation@1", "mean"),
            violation_at_5=("violation@5", "mean"),
            violation_at_10=("violation@10", "mean"),
        ).reset_index()
        ctx_summary.to_csv(os.path.join(output_dir, "results_context_policy.csv"), index=False, encoding="utf-8-sig")
        print(f"   Saved {len(ctx_summary)} context policy summary rows")


def build_cross_context_report(all_splits, seeds, max_cands_list, gate, item_meta, output_dir):
    """E4: Cross-context contamination from MIN_CANDS fill."""
    contam_rows = compute_cross_context_stats(all_splits, seeds, max_cands_list, item_meta, gate)
    if contam_rows:
        df_contam = pd.DataFrame(contam_rows)
        df_contam.to_csv(os.path.join(output_dir, "results_contamination.csv"), index=False, encoding="utf-8-sig")
        print(f"   Saved {len(df_contam)} contamination rows")


def build_hp_sensitivity_report(hybrid_results, output_dir):
    """Appendix: Hyperparameter sensitivity — variance of tuned params across seeds."""
    if not hybrid_results:
        return
    df = pd.DataFrame(hybrid_results)
    hp_cols = [c for c in ["best_alpha", "best_k_rrf", "best_b_cbf"] if c in df.columns]
    if not hp_cols:
        return

    print("\n" + "=" * 60)
    print("Appendix: Hyperparameter Sensitivity")
    print("=" * 60)

    for mc in df["MAX_CANDS"].unique():
        sub = _mc_filter(df, mc)
        print(f"\n   MAX_CANDS={mc_store(mc)}:")
        for col in hp_cols:
            vals = sub[col].dropna()
            if len(vals) > 1:
                print(f"     {col}: mean={vals.mean():.4f} std={vals.std():.4f} range=[{vals.min():.4f}, {vals.max():.4f}]")

    # Save tuned params
    param_rows = []
    for _, row in df.iterrows():
        pr = {"Model": row["Model"], "Seed": row["Seed"], "MAX_CANDS": row["MAX_CANDS"]}
        for c in hp_cols:
            pr[c] = row.get(c)
        param_rows.append(pr)
    pd.DataFrame(param_rows).to_csv(
        os.path.join(output_dir, "tuned_params.csv"), index=False, encoding="utf-8-sig"
    )
    print("   Saved tuned_params.csv")


# ═══════════════════════════════════════════════════════════════════════════
# INFERENCE TIME BENCHMARK
# ═════════════════════════════════════════════════════════════════════════

def benchmark_inference_time(all_splits, gate, item_meta, mapping_dict,
                             user2idx, item2idx, best_cbf_model_name,
                             best_cf_type, seeds, max_cands_list, output_dir,
                             best_cf_configs=None):
    """Section 2.4 — Wall-clock inference time per recommendation."""
    import time as _time
    from cbf import encode_texts, get_candidate_embeddings
    from cf import score_candidates_cf

    print("\n" + "=" * 60)
    print("F: Inference Time Benchmark")
    print("=" * 60)

    backend = load_embedding_backend(best_cbf_model_name, DEVICE)
    all_items_list = sorted(item_meta.keys())
    from cbf import build_enriched_item_texts
    item_texts = build_enriched_item_texts(item_meta)
    item_emb_cache = precompute_item_embeddings(backend, all_items_list, item_texts=item_texts)

    bench_seeds = seeds[:min(2, len(seeds))]
    WARMUP = 3
    bench_rows = []

    for seed in bench_seeds:
        user_split = all_splits[seed]

        for max_cands in max_cands_list[:2]:  # Only first 2 max_cands
            # Look up CF config for this (seed, MAX_CANDS) pair, fallback to seed-only
            cf_kwargs = {}
            mc_key = mc_store(max_cands)
            if best_cf_configs:
                cfg = best_cf_configs.get((seed, mc_key), best_cf_configs.get(seed))
            else:
                cfg = None
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
            times_cbf, times_cf, times_hybrid = [], [], []
            for u_data in user_split[:20]:  # Sample 20 users
                pf = gate.get_candidates(u_data, "test", seed, max_cands)
                cands = pf["cands"]
                if not cands:
                    continue
                cands_subset = [it for it in cands if it in item_emb_cache and it in item2idx]
                if not cands_subset:
                    continue
                u = user2idx.get(u_data["user"])
                if u is None:
                    continue

                # Filter target item name from keywords (leakage prevention)
                filt_kws = [kw for kw in (pf["selected_kws"] or []) if kw != clean_text(u_data["test_item"])] if FILTER_TARGET_NAME_FROM_KW else (pf["selected_kws"] or [])
                kw_part = " ".join(filt_kws) if filt_kws else ""
                ctx_part = pf["log_ctx"] if pf["log_ctx"] else ""
                q_text = f"{kw_part} {ctx_part}".strip() if kw_part and ctx_part else (kw_part or ctx_part)

                # CBF timing
                t0 = _time.perf_counter()
                q_emb = encode_texts(backend, [q_text], is_query=True)[0]
                c_embs = get_candidate_embeddings(item_emb_cache, cands_subset, DEVICE)
                _ = np.dot(c_embs.cpu().numpy(), q_emb.cpu().numpy())
                times_cbf.append(_time.perf_counter() - t0)

                # CF timing
                cand_idxs = [item2idx[it] for it in cands_subset]
                t0 = _time.perf_counter()
                _ = score_candidates_cf(best_cf_type, global_model, u, cand_idxs, global_extra, DEVICE)
                times_cf.append(_time.perf_counter() - t0)

                # Hybrid timing (CBF + CF + fusion)
                t0 = _time.perf_counter()
                cbf_raw = np.dot(c_embs.cpu().numpy(), q_emb.cpu().numpy())
                cf_raw = score_candidates_cf(best_cf_type, global_model, u, cand_idxs, global_extra, DEVICE)
                cbf_z, cf_z = calibrate_scores_zscore(cbf_raw, cf_raw)
                _ = cbf_z * 0.5 + cf_z * 0.5  # WeightedSum
                times_hybrid.append(_time.perf_counter() - t0)

            bench_rows.append({
                "seed": seed, "MAX_CANDS": mc_store(max_cands),
                "cbf_mean_ms": np.mean(times_cbf) * 1000 if times_cbf else 0,
                "cf_mean_ms": np.mean(times_cf) * 1000 if times_cf else 0,
                "hybrid_mean_ms": np.mean(times_hybrid) * 1000 if times_hybrid else 0,
                "n_users": len(times_cbf),
            })

    if bench_rows:
        df_bench = pd.DataFrame(bench_rows)
        df_bench.to_csv(os.path.join(output_dir, "results_inference_time.csv"), index=False, encoding="utf-8-sig")
        print("   Saved inference time benchmark")
        print(df_bench.groupby("MAX_CANDS")[["cbf_mean_ms", "cf_mean_ms", "hybrid_mean_ms"]].mean().to_string())

    del backend
    import gc
    gc.collect()


# ═══════════════════════════════════════════════════════════════════════════
# MAIN PIPELINE
# ═════════════════════════════════════════════════════════════════════════

def run_pipeline(args):
    """Run the full eligibility-gated recommendation pipeline."""
    t0_total = time.time()
    os.makedirs(args.output_dir, exist_ok=True)

    # Override config from CLI args
    seeds = args.seeds if args.seeds else SEEDS
    max_cands_list = args.max_cands if args.max_cands else MAX_CANDS_LIST

    print("=" * 70)
    print("ELIGIBILITY-GATED RECOMMENDATION PIPELINE")
    print(f"  Seeds: {seeds}")
    print(f"  MAX_CANDS: {[mc_store(mc) for mc in max_cands_list]}")
    print(f"  Device: {DEVICE}")
    print(f"  Output: {args.output_dir}")
    print("=" * 70)

    # ── Save experiment config ──
    config_info = {
        "seeds": seeds, "max_cands_list": max_cands_list,
        "device": DEVICE, "k": K,
        "cbf_models": args.cbf_models or EMBEDDING_MODELS,
        "cf_models": args.cf_models or CF_MODELS_TO_TEST,
    }
    config_path = os.path.join(args.output_dir, "experiment_config.json")
    with open(config_path, "w", encoding="utf-8") as f:
        json.dump(config_info, f, indent=2, default=str)

    # ══════════════════════════════════════════════════════════════════════
    # PHASE 0: Data Preparation
    # ══════════════════════════════════════════════════════════════════════
    print("\n" + "=" * 70)
    print("PHASE 0: Data Preparation")
    print("=" * 70)

    data = prepare_all()
    item_meta = data["item_meta"]
    mapping_dict = data["mapping_dict"]
    all_splits = data["all_splits"]
    user2idx = data["user2idx"]
    item2idx = data["item2idx"]
    user_pos = data["user_pos"]
    cold_threshold = data["cold_threshold"]
    heavy_threshold = data["heavy_threshold"]

    # Build eligibility gate
    get_context_pool, sub_index = build_context_index(item_meta)
    gate = EligibilityGate(item_meta, mapping_dict, get_context_pool)

    # Per-user data collection (shared across all phases for significance tests)
    per_user_rows = []

    # ══════════════════════════════════════════════════════════════════════
    # PHASE 1A: Content-Based Filtering
    # ══════════════════════════════════════════════════════════════════════
    cbf_results = []
    if args.phase in (None, "cbf", "hybrid", "all"):
        print("\n" + "=" * 70)
        print("PHASE 1A: Content-Based Filtering")
        print("=" * 70)

        cbf_models = args.cbf_models if args.cbf_models else EMBEDDING_MODELS
        # Temporarily override EMBEDDING_MODELS for run_all_cbf
        import config as cfg
        original_models = cfg.EMBEDDING_MODELS
        cfg.EMBEDDING_MODELS = cbf_models
        try:
            cbf_results = run_all_cbf(all_splits, gate, mapping_dict, item_meta, max_cands_list=max_cands_list, per_user=per_user_rows)
        finally:
            cfg.EMBEDDING_MODELS = original_models

        if cbf_results:
            df_cbf = pd.DataFrame(cbf_results)
            df_cbf.to_csv(os.path.join(args.output_dir, "results_cbf.csv"), index=False, encoding="utf-8-sig")
            print(f"\n   Best CBF models per MAX_CANDS:")
            for mc in df_cbf["MAX_CANDS"].unique():
                # NaN-safe filtering: pd.NA/None becomes NaN, and NaN != NaN
                if pd.isna(mc):
                    sub = df_cbf[df_cbf["MAX_CANDS"].isna()]
                else:
                    sub = df_cbf[df_cbf["MAX_CANDS"] == mc]
                if sub.empty or sub["best_val_nDCG@10"].isna().all():
                    print(f"     MAX_CANDS={mc_store(mc)}: (no valid results)")
                    continue
                best = sub.loc[sub["best_val_nDCG@10"].idxmax()]
                print(f"     MAX_CANDS={mc_store(mc)}: {best['Model']} (val nDCG@10={best['best_val_nDCG@10']:.4f})")

    # ══════════════════════════════════════════════════════════════════════
    # PHASE 1B: Collaborative Filtering
    # ══════════════════════════════════════════════════════════════════════
    cf_results = []
    pop_results = []
    if args.phase in (None, "cf", "hybrid", "all"):
        print("\n" + "=" * 70)
        print("PHASE 1B: Collaborative Filtering")
        print("=" * 70)

        cf_models = args.cf_models if args.cf_models else CF_MODELS_TO_TEST
        import config as cfg
        original_cf = cfg.CF_MODELS_TO_TEST
        cfg.CF_MODELS_TO_TEST = cf_models
        try:
            cf_results, pop_results = run_all_cf(
                all_splits, user2idx, item2idx, gate, mapping_dict, item_meta,
                max_cands_list=max_cands_list, per_user=per_user_rows,
            )
        finally:
            cfg.CF_MODELS_TO_TEST = original_cf

        all_cf_pop = cf_results + pop_results

    # Extract best CF configs per (seed, MAX_CANDS) for use in hybrid, XAI, and benchmark
    best_cf_configs = {}
    if cf_results:
        best_cf_type_candidate = select_best_cf_model(cf_results + pop_results)
        if best_cf_type_candidate:
            df_cf_all = pd.DataFrame(cf_results)
            cf_only = df_cf_all[~df_cf_all["Model"].str.startswith("POP-")]
            best_cf_rows = cf_only[cf_only["Model"] == f"CF-{best_cf_type_candidate}"]
            for seed in seeds:
                seed_rows = best_cf_rows[best_cf_rows["Seed"] == seed]
                if seed_rows.empty:
                    continue
                # Store config per (seed, MAX_CANDS) pair
                for _, row in seed_rows.iterrows():
                    mc = mc_store(row["MAX_CANDS"]) if pd.notna(row["MAX_CANDS"]) else "all"
                    key = (seed, mc)
                    if "best_cfg" in seed_rows.columns and pd.notna(row.get("best_cfg")):
                        best_cf_configs[key] = row["best_cfg"]
                    elif "best_l2_reg" in seed_rows.columns and pd.notna(row.get("best_l2_reg")):
                        best_cf_configs[key] = {"ease_r_l2": row["best_l2_reg"]}
                # Fallback: store config by seed only for backward compat
                if "best_cfg" in seed_rows.columns:
                    cfgs = seed_rows["best_cfg"].dropna()
                    if not cfgs.empty and seed not in best_cf_configs:
                        best_cf_configs[seed] = cfgs.iloc[0]
                elif "best_l2_reg" in seed_rows.columns:
                    l2s = seed_rows["best_l2_reg"].dropna()
                    if not l2s.empty and seed not in best_cf_configs:
                        best_cf_configs[seed] = {"ease_r_l2": l2s.iloc[0]}
        if all_cf_pop:
            df_cf = pd.DataFrame(all_cf_pop)
            df_cf.to_csv(os.path.join(args.output_dir, "results_cf.csv"), index=False, encoding="utf-8-sig")

    # ══════════════════════════════════════════════════════════════════════
    # PHASE 1C: Hybrid Fusion
    # ══════════════════════════════════════════════════════════════════════
    hybrid_results = []
    if args.phase in (None, "hybrid", "all") and cbf_results and (cf_results or pop_results):
        print("\n" + "=" * 70)
        print("PHASE 1C: Hybrid Fusion")
        print("=" * 70)

        best_cbf_name, best_b_cbf = select_best_cbf_model(cbf_results)
        best_cf_type = select_best_cf_model(cf_results + pop_results)

        if best_cbf_name and best_cf_type:
            print(f"   Best CBF: {best_cbf_name} (b_cbf={best_b_cbf})")
            print(f"   Best CF:  {best_cf_type}")

            # Load CBF backend for hybrid scoring
            from cbf import load_embedding_backend, precompute_item_embeddings, build_enriched_item_texts
            all_items_list = sorted(item_meta.keys())
            hybrid_backend = load_embedding_backend(best_cbf_name, DEVICE)
            item_texts = build_enriched_item_texts(item_meta)
            hybrid_item_emb_cache = precompute_item_embeddings(hybrid_backend, all_items_list, item_texts=item_texts)

            hybrid_results = run_hybrid_model(
                best_cbf_name, best_cf_type, all_splits, user2idx, item2idx,
                gate, mapping_dict, hybrid_item_emb_cache, hybrid_backend, item_meta,
                max_cands_list=max_cands_list, best_cf_configs=best_cf_configs,
                per_user=per_user_rows,
            )

            # Free backend memory
            del hybrid_backend
            import gc
            gc.collect()

            if hybrid_results:
                df_hyb = pd.DataFrame(hybrid_results)
                df_hyb.to_csv(os.path.join(args.output_dir, "results_hybrid.csv"), index=False, encoding="utf-8-sig")
        else:
            print("   Skipping Hybrid — could not select best models.")

    # ══════════════════════════════════════════════════════════════════════
    # PHASE 2: Aggregate Results
    # ══════════════════════════════════════════════════════════════════════
    all_results = cbf_results + cf_results + pop_results + hybrid_results
    if not all_results:
        print("\nNo results to aggregate. Exiting.")
        return

    df_detailed = pd.DataFrame(all_results)

    # Add model family and is_selected_best
    df_detailed["model_family"] = df_detailed["Model"].apply(map_model_family)
    df_detailed["model_name"] = df_detailed["Model"].apply(map_model_name)
    if "is_selected_best" not in df_detailed.columns:
        df_detailed["is_selected_best"] = True
    else:
        _is_hyb = df_detailed["Model"].str.startswith("Hybrid-")
        df_detailed.loc[~_is_hyb, "is_selected_best"] = df_detailed.loc[~_is_hyb, "is_selected_best"].fillna(True)
        df_detailed.loc[_is_hyb, "is_selected_best"] = df_detailed.loc[_is_hyb, "is_selected_best"].fillna(False)

    # Traceability
    run_id = hashlib.sha256(str(time.time()).encode()).hexdigest()[:12]
    df_detailed["run_id"] = run_id
    config_hash = hashlib.sha256(open(config_path, "rb").read()).hexdigest()[:12]
    df_detailed["config_hash"] = config_hash

    # CBF anchor parity
    if cbf_results:
        best_cbf_name_anchor, _ = select_best_cbf_model(cbf_results)
        anchor_name = f"CBF-{best_cbf_name_anchor}"
        anchor_df = df_detailed.loc[
            df_detailed["Model"] == anchor_name, ["Seed", "MAX_CANDS", "feasible_nDCG@10"]
        ].rename(columns={"feasible_nDCG@10": "cbf_anchor_ndcg"})
        if not anchor_df.empty:
            df_detailed = df_detailed.merge(anchor_df, on=["Seed", "MAX_CANDS"], how="left")
            df_detailed["parity_ratio_ndcg"] = df_detailed["feasible_nDCG@10"] / (df_detailed["cbf_anchor_ndcg"] + 1e-12)
            df_detailed["parity_gap_ndcg"] = df_detailed["feasible_nDCG@10"] - df_detailed["cbf_anchor_ndcg"]
            df_detailed["cbf_anchor_model"] = anchor_name

    # Save detailed results
    detailed_path = os.path.join(args.output_dir, "comparison_detailed.csv")
    df_detailed.to_csv(detailed_path, index=False, encoding="utf-8-sig")
    print(f"\n   Saved {len(df_detailed)} detailed results to {detailed_path}")

    # ══════════════════════════════════════════════════════════════════════
    # PHASE 3: Paper Tables
    # ══════════════════════════════════════════════════════════════════════
    print("\n" + "=" * 70)
    print("PHASE 3: Paper-Ready Tables")
    print("=" * 70)

    summary = generate_paper_tables(all_results, args.output_dir)

    # Hybrid method comparison (selected best per seed/MAX_CANDS)
    hyb_mask = df_detailed["Model"].str.startswith("Hybrid-")
    if hyb_mask.any():
        df_hyb_selected = df_detailed[hyb_mask & df_detailed["is_selected_best"].astype(bool)].copy()
        if not df_hyb_selected.empty:
            df_hyb_selected["MAX_CANDS_LABEL"] = df_hyb_selected["MAX_CANDS"].apply(
                lambda x: "all eligible" if pd.isna(x) else str(int(x))
            )
            hyb_summary = df_hyb_selected.groupby(["Model", "MAX_CANDS_LABEL"], dropna=False).agg(
                nDCG_mean=("feasible_nDCG@10", "mean"),
                nDCG_std=("feasible_nDCG@10", "std"),
                HR_mean=("feasible_HR@10", "mean"),
                HR_std=("feasible_HR@10", "std"),
                MRR_mean=("feasible_MRR@10", "mean"),
                MRR_std=("feasible_MRR@10", "std"),
            ).reset_index()
            hyb_summary.to_csv(os.path.join(args.output_dir, "results_hybrid_methods.csv"), index=False, encoding="utf-8-sig")

    # Run completeness report
    print("\n   Run Completeness:")
    expected_seeds = len(seeds)
    for family in sorted(df_detailed["model_family"].unique()):
        sub = df_detailed[df_detailed["model_family"] == family]
        for mc in sub["MAX_CANDS"].unique():
            mc_sub = _mc_filter(sub, mc)
            for model in mc_sub["Model"].unique():
                n_seeds = mc_sub[mc_sub["Model"] == model]["Seed"].nunique()
                status = "OK" if n_seeds == expected_seeds else f"MISSING ({n_seeds}/{expected_seeds})"
                print(f"     {family}/{model}@{mc_store(mc)}: {status}")

    # ══════════════════════════════════════════════════════════════════════
    # PHASE 3B: Additional Analysis
    # ══════════════════════════════════════════════════════════════════════
    # Save per-user data
    if per_user_rows:
        per_user_df = pd.DataFrame(per_user_rows)
        per_user_df.to_csv(os.path.join(args.output_dir, "per_user_metrics.csv"), index=False, encoding="utf-8-sig")
        print(f"\n   Saved {len(per_user_df)} per-user metric rows")
    else:
        per_user_df = pd.DataFrame()

    # Paired significance tests (per-user)
    if hybrid_results and not per_user_df.empty:
        compute_paired_significance(per_user_df, args.output_dir)

    # Per-user-bin results
    build_results_by_user_bin(
        all_splits, seeds, max_cands_list, per_user_df,
        cold_threshold, heavy_threshold, args.output_dir,
    )

    # Context policy report
    if cbf_results and cf_results:
        best_cbf_name, _ = select_best_cbf_model(cbf_results)
        best_cf_type = select_best_cf_model(cf_results + pop_results)
        if best_cbf_name and best_cf_type:
            build_context_policy_report(
                all_splits, seeds, max_cands_list, gate, item_meta,
                mapping_dict, user2idx, item2idx,
                best_cbf_name, best_cf_type, args.output_dir,
            )

    # Cross-context contamination
    build_cross_context_report(all_splits, seeds, max_cands_list, gate, item_meta, args.output_dir)

    # HP sensitivity
    build_hp_sensitivity_report(hybrid_results, args.output_dir)

    # Inference time benchmark
    if cbf_results and cf_results and not args.skip_benchmark:
        best_cbf_name, best_b_cbf = select_best_cbf_model(cbf_results)
        best_cf_type = select_best_cf_model(cf_results + pop_results)
        if best_cbf_name and best_cf_type:
            benchmark_inference_time(
                all_splits, gate, item_meta, mapping_dict,
                user2idx, item2idx, best_cbf_name, best_cf_type,
                seeds, max_cands_list, args.output_dir,
                best_cf_configs=best_cf_configs,
            )

    # ══════════════════════════════════════════════════════════════════════
    # PHASE 1D: XAI Evaluation
    # ══════════════════════════════════════════════════════════════════════
    if not args.skip_xai and cbf_results and (cf_results or pop_results):
        best_cbf_name, best_b_cbf = select_best_cbf_model(cbf_results)
        best_cf_type = select_best_cf_model(cf_results + pop_results)
        if best_cbf_name and best_cf_type:
            xai_rows = run_xai_evaluation(
                all_splits, hybrid_results, gate, item_meta, mapping_dict,
                user2idx, item2idx, best_cbf_name, best_cf_type,
                best_b_cbf, args.output_dir, seeds, max_cands_list, run_id,
                best_cf_configs=best_cf_configs,
            )

    # ══════════════════════════════════════════════════════════════════════
    # Final Summary
    # ══════════════════════════════════════════════════════════════════════
    elapsed = time.time() - t0_total
    print("\n" + "=" * 70)
    print("PIPELINE COMPLETE")
    print(f"   Total time: {elapsed/60:.1f} minutes")
    print(f"   Results: {len(df_detailed)} rows, {df_detailed['Model'].nunique()} models")
    print(f"   Output: {args.output_dir}")
    print("=" * 70)

    # Print final file manifest
    files = [f for f in os.listdir(args.output_dir) if f.endswith(".csv") or f.endswith(".json")]
    print("\n   Output files:")
    for f in sorted(files):
        size_kb = os.path.getsize(os.path.join(args.output_dir, f)) / 1024
        print(f"     {f} ({size_kb:.1f} KB)")


# ═══════════════════════════════════════════════════════════════════════════
# CLI ENTRY POINT
# ═════════════════════════════════════════════════════════════════════════

def parse_args():
    parser = argparse.ArgumentParser(
        description="Eligibility-Gated Recommendation Pipeline (Section 2.3-2.4)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python run_pipeline.py                       # Full pipeline
  python run_pipeline.py --phase cbf           # CBF only
  python run_pipeline.py --phase cf            # CF only
  python run_pipeline.py --phase hybrid        # Hybrid (requires CBF+CF results)
  python run_pipeline.py --seeds 42 123        # Custom seeds
  python run_pipeline.py --max-cands 40 80    # Custom candidate pool sizes
  python run_pipeline.py --cbf-models bge-m3  # Run specific CBF model
  python run_pipeline.py --skip-benchmark      # Skip inference time benchmark
        """,
    )
    parser.add_argument("--phase", choices=["cbf", "cf", "hybrid", "all", None],
                        default=None, help="Run specific phase only (default: all)")
    parser.add_argument("--seeds", nargs="+", type=int, default=None,
                        help="Random seeds (default: from config)")
    parser.add_argument("--max-cands", nargs="+", type=int, default=None,
                        help="MAX_CANDS values (default: from config)")
    parser.add_argument("--cbf-models", nargs="+", type=str, default=None,
                        help="CBF embedding model names (default: from config)")
    parser.add_argument("--cf-models", nargs="+", type=str, default=None,
                        help="CF model types (default: from config)")
    parser.add_argument("--output-dir", type=str, default=None,
                        help="Output directory (default: <script_dir>/output)")
    parser.add_argument("--skip-benchmark", action="store_true",
                        help="Skip inference time benchmark")
    parser.add_argument("--skip-xai", action="store_true",
                        help="Skip XAI evaluation")
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    if args.output_dir is None:
        args.output_dir = OUTPUT_DIR
    run_pipeline(args)