# -*- coding: utf-8 -*-
"""
eligibility_gate.py — Section 2.3.1 Context-Valid Candidate Construction
===========================================================================
Constructs the eligible candidate set for recommendation by:
  1. Context matching (exact or fuzzy) against item metadata
  2. Keyword-hit prioritization within the context pool
  3. Adaptive minimum candidate guarantee

This module implements the Eligibility Gate described in Section 2.3.1
of the thesis. Every downstream model (CBF, CF, Hybrid) MUST use
get_prefiltered_candidates() to ensure identical candidate sets for
fair comparison.

Reference: Adomavicius & Tuzhilin (2011) — context-aware pre-filtering
"""

import numpy as np
from config import (
    clean_text, pick_keywords_from_log, stable_int_seed, apply_negative_penalty,
    MIN_CANDS, CAP_CTX_POOL, QK_MIN, QK_MAX,
)


def build_candidates(pool_ctx, selected_kws, mapping_dict,
                     min_cands=MIN_CANDS, max_cands=None, cap_ctx_pool=CAP_CTX_POOL):
    """Section 2.3.1 — Build candidate set from context pool + keyword prioritization.

    Algorithm:
      1. Pool = items whose sub_context matches the query context
      2. Sort pool: keyword-hit items first, then remaining items
      3. Cap at max_cands; fill up to adaptive_min if needed

    Parameters
    ----------
    pool_ctx : list[str]
        Items in the matched context pool
    selected_kws : list[str]
        Keywords sampled from user's log for this context
    mapping_dict : dict
        {item_name: set(keywords)} from Section 2.2.4
    min_cands : int
        Minimum candidate pool size
    max_cands : int or None
        Maximum candidate pool size (None = unconstrained)
    cap_ctx_pool : int or None
        Cap on context pool before candidate building

    Returns
    -------
    cands, ctx_sz_raw, ctx_sz, kw_hit_sz, used_sz, kw_n, neg_used
    """
    if not pool_ctx:
        return [], 0, 0, 0, 0, 0, 0

    pool_ctx = list(pool_ctx)
    pool_ctx.sort()

    ctx_sz_raw = len(pool_ctx)

    if cap_ctx_pool and len(pool_ctx) > cap_ctx_pool:
        pool_ctx = pool_ctx[:cap_ctx_pool]
    ctx_sz = len(pool_ctx)

    kws = [clean_text(k) for k in (selected_kws or []) if clean_text(k)]
    kw_n = len(kws)

    if kw_n == 0:
        prioritized = pool_ctx
        kw_hit_sz = 0
    else:
        kset = set(kws)
        hit, miss = [], []
        for it in pool_ctx:
            it_kws = mapping_dict.get(it, set())
            (hit if not kset.isdisjoint(it_kws) else miss).append(it)
        prioritized = hit + miss
        kw_hit_sz = len(hit)

    # Adaptive min: never force more candidates than context pool size
    adaptive_min = min(min_cands, ctx_sz)
    if max_cands is not None:
        adaptive_min = min(adaptive_min, max_cands)

    cands = prioritized
    if max_cands is not None and len(cands) > max_cands:
        cands = cands[:max_cands]

    if len(cands) < adaptive_min:
        cset = set(cands)
        remain = [it for it in pool_ctx if it not in cset]
        need = adaptive_min - len(cands)
        if remain and need > 0:
            cands.extend(remain[:min(need, len(remain))])

    used_sz = len(cands)
    neg_used = max(0, used_sz - min(kw_hit_sz, used_sz))
    return cands, ctx_sz_raw, ctx_sz, kw_hit_sz, used_sz, kw_n, neg_used


class EligibilityGate:
    """Section 2.3.1 — Eligibility-Gated Candidate Construction.

    Wraps context matching + keyword selection + candidate building
    into a single cached interface. Guarantees identical candidate
    sets across all models (CBF, CF, Hybrid) for fair comparison.
    """

    def __init__(self, item_meta, mapping_dict, get_context_pool,
                 enable_context_filtering=True):
        self.item_meta = item_meta
        self.mapping_dict = mapping_dict
        self.get_context_pool = get_context_pool
        self.enable_context_filtering = enable_context_filtering
        self._cache = {}

    def get_candidates(self, u_data, phase, seed, max_cands, fuzzy_cutoff=None):
        """Get pre-filtered candidates for a (user, phase, seed, max_cands) tuple.

        This is the single entry point that ALL models MUST call
        to guarantee identical candidate sets for fair comparison.

        Parameters
        ----------
        u_data : dict
            User split data with train/val/test items
        phase : str
            "val" or "test"
        seed : int
            Random seed
        max_cands : int or None
            Maximum candidates
        fuzzy_cutoff : float, optional
            Override fuzzy cutoff for this call

        Returns
        -------
        dict with keys:
            cands, selected_kws, log_ctx, matched_ctx,
            ctx_sz_raw, ctx_sz, kw_hit_sz, used_sz, kw_n, neg_used
        """
        cache_key = (u_data["user"], phase, seed, max_cands, fuzzy_cutoff)
        if cache_key in self._cache:
            return self._cache[cache_key]

        log_ctx = u_data[f"{phase}_ctx"]
        log_kwl = u_data[f"{phase}_kwl"]

        # Step 1 — Context pre-filtering
        if self.enable_context_filtering:
            pool_ctx, matched_ctx, fuzzy_flag = self.get_context_pool(log_ctx)
        else:
            pool_ctx = sorted(self.item_meta.keys())
            matched_ctx = ""
            fuzzy_flag = 0

        # Step 2 — Deterministic keyword selection
        kw_seed = stable_int_seed(seed, u_data["user"], log_ctx, max_cands, phase, "KW")
        selected_kws = pick_keywords_from_log(log_kwl, kw_seed)

        # Step 3 — Build candidates
        cands, ctx_sz_raw, ctx_sz, kw_hit_sz, used_sz, kw_n, neg_used = build_candidates(
            pool_ctx, selected_kws, self.mapping_dict, max_cands=max_cands
        )

        result = {
            "cands": cands,
            "selected_kws": selected_kws,
            "log_ctx": log_ctx,
            "log_kwl": log_kwl,
            "matched_ctx": matched_ctx,
            "ctx_sz_raw": ctx_sz_raw,
            "ctx_sz": ctx_sz,
            "kw_hit_sz": kw_hit_sz,
            "used_sz": used_sz,
            "kw_n": kw_n,
            "neg_used": neg_used,
        }
        self._cache[cache_key] = result
        return result

    def clear_cache(self):
        n = len(self._cache)
        self._cache = {}
        if n > 0:
            print(f"   Cleared {n} cached candidate sets")

    def filter_splits_by_context(self, user_splits, context):
        """Strict CF-training pre-filtering: only items matching the context."""
        from config import normalize_context
        norm_ctx = normalize_context(context)
        filtered = []
        for u_data in user_splits:
            ctx_items = [
                it for it in u_data["train_items"]
                if norm_ctx in self.item_meta.get(it, {}).get("sub_set", [])
            ]
            if ctx_items:
                u_copy = dict(u_data)
                u_copy["train_items"] = ctx_items
                orig_rat = u_data.get("train_item2rating", {})
                u_copy["train_item2rating"] = {
                    it: orig_rat[it] for it in set(ctx_items) if it in orig_rat
                }
                u_copy["train_neg_item2rating"] = u_data.get("train_neg_item2rating", {})
                filtered.append(u_copy)
        return filtered


def compute_cross_context_stats(all_splits, seeds, max_cands_list, item_meta, gate):
    """Measure cross-context contamination from MIN_CANDS fill."""
    from config import mc_store
    rows = []
    for seed in seeds:
        for max_cands in max_cands_list:
            for u_data in all_splits[seed]:
                pf = gate.get_candidates(u_data, "test", seed, max_cands)
                cands = pf["cands"]
                matched_ctx = pf["matched_ctx"]
                if not matched_ctx or not cands:
                    continue
                in_ctx = sum(
                    1 for it in cands
                    if matched_ctx in item_meta.get(it, {}).get("sub_set", [])
                )
                out_ctx = len(cands) - in_ctx
                rows.append({
                    "seed": seed, "MAX_CANDS": mc_store(max_cands),
                    "user": u_data["user"], "matched_ctx": matched_ctx,
                    "total_cands": len(cands), "in_context": in_ctx,
                    "out_context": out_ctx,
                    "contamination_rate": out_ctx / len(cands) if cands else 0,
                })
    if not rows:
        return None
    return rows