"""
services/eligibility.py — Port of recommender/eligibility.py.

Given a context id and a list of selected keywords, return the list of items
that are eligible for that context. Items whose keywords overlap with the
selected ones are placed first.

Context id is the stable id of the context NAME (computed by the pipeline).
We expose the context id <-> name map through ``ArtifactLoader.metadata`` so
request handlers can validate context existence without re-scanning rows.
"""
from __future__ import annotations

from typing import Dict, List, Optional

import pandas as pd

from ..model_loader import ArtifactLoader
from ._ids import stable_id


def build_context_id_map(loader: ArtifactLoader) -> Dict[int, str]:
    """Build a {context_id: context_name} map from items.context_names."""
    mapping: Dict[int, str] = {}
    for names in loader.items["context_names"]:
        for name in (names or []):
            cid = stable_id("context", name)
            mapping[cid] = name
    return mapping


def context_name_for_id(loader: ArtifactLoader, context_id: int) -> Optional[str]:
    cached = loader.metadata.get("context_id_to_name", {})
    if cached:
        return cached.get(str(context_id))
    # Build and cache
    mapping = build_context_id_map(loader)
    loader.metadata["context_id_to_name"] = {str(k): v for k, v in mapping.items()}
    return mapping.get(int(context_id))


def get_context_valid_items(
    loader: ArtifactLoader,
    context_id: int,
    selected_keyword_names: Optional[List[str]] = None,
    max_cands: Optional[int] = None,
    min_cands: int = 10,
) -> List[Dict]:
    """
    Returns a list of item-row dicts in eligibility order.
    """
    items_df = loader.items
    keyword_set = set(selected_keyword_names or [])

    ctx_name = context_name_for_id(loader, int(context_id))
    if not ctx_name:
        return []

    eligible_mask = items_df["context_names"].apply(lambda names: ctx_name in (names or []))
    pool = items_df[eligible_mask].copy()
    if pool.empty:
        return []

    pool = pool.sort_values("name", kind="stable").reset_index(drop=True)

    if keyword_set:
        def _has_hit(names):
            return bool(keyword_set.intersection(names or []))
        hit_mask = pool["keyword_names"].apply(_has_hit)
        hit = pool[hit_mask]
        miss = pool[~hit_mask]
        pool = _concat(hit, miss).reset_index(drop=True)

    if max_cands is not None and max_cands > 0:
        adaptive_min = min(min_cands, len(pool), max_cands)
        capped = pool.iloc[:max_cands]
        if len(capped) < adaptive_min:
            selected_ids = set(capped["item_id"].astype(int))
            remaining = pool[~pool["item_id"].astype(int).isin(selected_ids)]
            fill = remaining.iloc[: adaptive_min - len(capped)]
            capped = _concat(capped, fill)
        pool = capped.reset_index(drop=True)

    return [_row_to_dict(row) for _, row in pool.iterrows()]


def _concat(*dfs) -> pd.DataFrame:
    non_empty = [d for d in dfs if len(d) > 0]
    if not non_empty:
        for d in dfs:
            if hasattr(d, "columns"):
                return d.iloc[0:0].copy()
        return pd.DataFrame()
    return pd.concat(non_empty, ignore_index=True)


def _row_to_dict(row) -> Dict:
    out: Dict = {}
    for col in row.index:
        v = row[col]
        try:
            if pd.isna(v):
                v = None
        except Exception:
            pass
        out[col] = v
    return out