# -*- coding: utf-8 -*-
"""
cbf.py — Section 2.3.2 Content-Based Scoring
=============================================
Content-Based Filtering using sentence embedding models.


Models tested:
    - multilingual-e5-large-instruct (Wang et al., 2022)
    - bge-m3 (Li et al., 2023)
    - SCT-KD-model-phayathaibert (kornwtp, 2024)
    - wangchanberta-base-att-spm-uncased (AIResearch, 2021)

Each model encodes item descriptions + candidate queries into embeddings,
then scores via cosine similarity with keyword-hit boost (tuned on validation).
"""

import gc
import numpy as np
import torch
import torch.nn.functional as F
from tqdm import tqdm

from config import (
    set_seed, clean_text, apply_negative_penalty, calculate_metrics,
    mc_store, SEEDS, K, BATCH_SIZE, B_RANGE_CBF, DEVICE,
    EMBEDDING_MODELS, FILTER_TARGET_NAME_FROM_KW,
)


def _filter_target_from_kws(selected_kws, target_item):
    """Remove the target item name from selected keywords to prevent keyword leakage."""
    if not FILTER_TARGET_NAME_FROM_KW or not target_item:
        return selected_kws
    target = clean_text(target_item)
    if not target:
        return selected_kws
    return [kw for kw in selected_kws if kw != target]


# ═══════════════════════════════════════════════════════════════════════════
# EMBEDDING BACKEND LOADING
# ═══════════════════════════════════════════════════════════════════════════

@torch.no_grad()
def encode_texts(backend, texts, is_query=False, batch_size=BATCH_SIZE):
    """Encode texts using the loaded embedding model."""
    m_name = backend["name"].lower()
    prefix = ""

    if "e5" in m_name and "instruct" in m_name:
        prefix = (
            "Instruct: Given a Thai performing arts query, "
            "retrieve relevant items.\nQuery: "
        ) if is_query else ""
    elif "e5" in m_name:
        prefix = "query: " if is_query else "passage: "

    texts_with_prefix = [prefix + clean_text(t) for t in texts]
    model = backend["model"]
    tokenizer = backend.get("tokenizer")

    all_vecs = []
    for i in range(0, len(texts_with_prefix), batch_size):
        batch = texts_with_prefix[i:i + batch_size]

        if hasattr(model, "encode"):
            vecs = model.encode(
                batch, convert_to_tensor=True, normalize_embeddings=True,
                show_progress_bar=False, batch_size=batch_size,
            )
            all_vecs.append(vecs)
        elif tokenizer is not None:
            enc = tokenizer(
                batch, padding=True, truncation=True,
                max_length=512, return_tensors="pt",
            ).to(backend["device"])
            out = model(**enc)
            mask = enc["attention_mask"].unsqueeze(-1).float()
            vecs = (out.last_hidden_state * mask).sum(1) / mask.sum(1).clamp(min=1e-9)
            vecs = F.normalize(vecs, dim=-1)
            all_vecs.append(vecs)
        else:
            raise RuntimeError(
                f"Cannot encode texts for model '{backend['name']}': "
                f"model has no encode() method and no tokenizer available. "
                f"This typically means SentenceTransformer failed to load "
                f"and the AutoModel fallback also failed."
            )

    return torch.cat(all_vecs, dim=0)


def load_embedding_backend(model_name: str, device: str):
    """Load embedding model (SentenceTransformer or HuggingFace AutoModel)."""
    print(f"   Loading model: {model_name.split('/')[-1]}")
    m_lower = model_name.lower()

    is_st_model = any(k in m_lower for k in [
        "paraphrase", "e5", "sct", "phayathaibert", "simcse", "congen", "gte"
    ])

    if is_st_model:
        try:
            from sentence_transformers import SentenceTransformer
            st_model = SentenceTransformer(model_name, device=device, trust_remote_code=True)
            # Limit max sequence length to prevent position_ids overflow
            # (some models like GTE have bugs with long sequences in custom code)
            if hasattr(st_model, 'max_seq_length'):
                st_model.max_seq_length = min(st_model.max_seq_length, 512)
            st_model.eval()
            return {
                "name": model_name, "model": st_model, "tokenizer": None,
                "device": device, "type": "sentence_transformer",
            }
        except Exception as e:
            print(f"      SentenceTransformer failed: {e}")

    try:
        from transformers import AutoTokenizer, AutoModel
        tokenizer = AutoTokenizer.from_pretrained(model_name, trust_remote_code=True)
        hf_model = AutoModel.from_pretrained(model_name, trust_remote_code=True)
        hf_model.eval().to(device)
        return {
            "name": model_name, "model": hf_model, "tokenizer": tokenizer,
            "device": device, "type": "automodel",
        }
    except Exception as e:
        print(f"      Failed to load {model_name}: {e}")
        return None


# ═══════════════════════════════════════════════════════════════════════════
# ITEM EMBEDDING CACHE
# ═══════════════════════════════════════════════════════════════════════════

_item_emb_cache = {}


def precompute_item_embeddings(backend, all_items_list, item_texts=None, batch_size=BATCH_SIZE):
    """Encode all items ONCE and cache. Returns dict: item_name → Tensor.

    Returns None if encoding fails (e.g., model architecture incompatibility).
    """
    model_key = backend["name"]
    short_name = model_key.split('/')[-1]
    if model_key in _item_emb_cache:
        print(f"   Using cached embeddings for {short_name}")
        return _item_emb_cache[model_key]

    print(f"   Pre-encoding {len(all_items_list)} items for {short_name}...")
    texts = [item_texts.get(it, it) if item_texts else it for it in all_items_list]
    try:
        embs = encode_texts(backend, texts, is_query=False, batch_size=batch_size)
        embs = embs.cpu()
    except Exception as e:
        print(f"   ERROR encoding items for {short_name}: {e}")
        print(f"   Skipping {short_name} due to encoding error")
        return None

    cache = {it: embs[i] for i, it in enumerate(all_items_list)}
    _item_emb_cache[model_key] = cache
    print(f"   Cached {len(cache)} item embeddings ({embs.shape[1]}D)")
    return cache


def get_candidate_embeddings(item_emb_cache, cands_subset, device):
    """Gather pre-computed embeddings for candidates."""
    return torch.stack([item_emb_cache[it] for it in cands_subset]).to(device)


def build_enriched_item_texts(item_meta):
    """Build enriched text: item_name + description for richer embeddings."""
    item_texts = {}
    for it_name, meta in item_meta.items():
        desc = meta.get("desc", "").strip()
        item_texts[it_name] = f"{it_name} {desc}" if desc else it_name
    return item_texts


# ═══════════════════════════════════════════════════════════════════════════
# CBF EVALUATION
# ═══════════════════════════════════════════════════════════════════════════

def run_cbf_model(model_name, all_items_list, item_emb_cache, backend,
                  all_splits, gate, mapping_dict, max_cands=200, per_user=None):
    """Run CBF model on all seeds with keyword boost tuning on VAL.

    Optimized: batch-encode all queries ONCE, then tune b_cbf with pure numpy.
    """
    results = []

    for seed in SEEDS:
        set_seed(seed)
        user_split = all_splits[seed]

        # ── VAL: Pre-compute base scores ──
        val_precomp = []
        val_queries = []

        for u_data in user_split:
            target = u_data["val_item"]
            pf = gate.get_candidates(u_data, "val", seed, max_cands)
            cands = pf["cands"]

            if target not in cands:
                val_precomp.append(None)
                continue

            cands_subset = [it for it in cands if it in item_emb_cache]
            if not cands_subset or target not in cands_subset:
                val_precomp.append(None)
                continue

            filtered_kws = _filter_target_from_kws(pf["selected_kws"], target)
            kw_part = " ".join(filtered_kws) if filtered_kws else ""
            ctx_part = pf["log_ctx"] if pf["log_ctx"] else ""
            query_text = f"{kw_part} {ctx_part}".strip() if kw_part and ctx_part else (kw_part or ctx_part)

            val_queries.append(query_text)
            val_precomp.append({
                "cands_subset": cands_subset,
                "gt_idx": cands_subset.index(target),
                "neg_dict": u_data.get("train_neg_item2rating", {}),
                "pf": pf,
                "filtered_kws": filtered_kws,
                "q_batch_idx": len(val_queries) - 1,
            })

        if val_queries:
            all_val_q_embs = encode_texts(backend, val_queries, is_query=True)
        else:
            all_val_q_embs = None

        # Pre-compute base semantic scores + keyword masks
        for precomp in val_precomp:
            if precomp is None:
                continue
            q_emb = all_val_q_embs[precomp["q_batch_idx"]]
            c_embs = get_candidate_embeddings(item_emb_cache, precomp["cands_subset"], q_emb.device)
            base_score = torch.mm(q_emb.unsqueeze(0), c_embs.T).squeeze(0).cpu().numpy()
            precomp["base_score"] = base_score

            kset = set(precomp.get("filtered_kws", precomp["pf"]["selected_kws"])) if (precomp.get("filtered_kws") or precomp["pf"]["selected_kws"]) else set()
            kw_mask = np.zeros(len(precomp["cands_subset"]), dtype=bool)
            if kset:
                for j, it in enumerate(precomp["cands_subset"]):
                    if not kset.isdisjoint(mapping_dict.get(it, set())):
                        kw_mask[j] = True
            precomp["kw_mask"] = kw_mask

        # Tune b_cbf on VAL
        best_val_ndcg, best_b_cbf = 0.0, 0.0
        for b_cbf in B_RANGE_CBF:
            val_scores = []
            for precomp in val_precomp:
                if precomp is None:
                    val_scores.append(0.0)
                    continue
                score = precomp["base_score"].copy()
                if b_cbf > 0 and precomp["kw_mask"].any():
                    score[precomp["kw_mask"]] += b_cbf
                score = apply_negative_penalty(score, precomp["cands_subset"], precomp["neg_dict"])
                _, _, ndcg = calculate_metrics(score, precomp["gt_idx"])
                val_scores.append(ndcg)
            avg_val = np.mean(val_scores) if val_scores else 0.0
            if avg_val > best_val_ndcg:
                best_val_ndcg = avg_val
                best_b_cbf = b_cbf

        print(f"   Seed {seed}: best_b_cbf={best_b_cbf:.2f} (val nDCG={best_val_ndcg:.4f})")

        # ── TEST: Evaluate with best b_cbf ──
        test_precomp = []
        test_queries = []

        for u_data in user_split:
            target = u_data["test_item"]
            pf = gate.get_candidates(u_data, "test", seed, max_cands)
            cands = pf["cands"]

            if target not in cands:
                test_precomp.append(None)
                continue

            cands_subset = [it for it in cands if it in item_emb_cache]
            if target not in cands_subset:
                test_precomp.append(None)
                continue

            filtered_kws = _filter_target_from_kws(pf["selected_kws"], target)
            kw_part = " ".join(filtered_kws) if filtered_kws else ""
            ctx_part = pf["log_ctx"] if pf["log_ctx"] else ""
            query_text = f"{kw_part} {ctx_part}".strip() if kw_part and ctx_part else (kw_part or ctx_part)

            test_queries.append(query_text)
            test_precomp.append({
                "user": u_data["user"],
                "target": target,
                "cands_subset": cands_subset,
                "gt_idx": cands_subset.index(target),
                "neg_dict": u_data.get("train_neg_item2rating", {}),
                "pf": pf,
                "filtered_kws": filtered_kws,
                "q_batch_idx": len(test_queries) - 1,
            })

        if test_queries:
            all_test_q_embs = encode_texts(backend, test_queries, is_query=True)
        else:
            all_test_q_embs = None

        test_metrics = {"ndcg": 0, "hr": 0, "mrr": 0, "total": 0, "feasible": 0}
        for precomp in test_precomp:
            test_metrics["total"] += 1
            if precomp is None:
                continue
            test_metrics["feasible"] += 1

            q_emb = all_test_q_embs[precomp["q_batch_idx"]]
            c_embs = get_candidate_embeddings(item_emb_cache, precomp["cands_subset"], q_emb.device)
            semantic_score = torch.mm(q_emb.unsqueeze(0), c_embs.T).squeeze(0).cpu().numpy()

            if best_b_cbf > 0 and (precomp.get("filtered_kws") or precomp["pf"]["selected_kws"]):
                kset = set(precomp.get("filtered_kws", precomp["pf"]["selected_kws"]))
                for j, it in enumerate(precomp["cands_subset"]):
                    if not kset.isdisjoint(mapping_dict.get(it, set())):
                        semantic_score[j] += best_b_cbf

            semantic_score = apply_negative_penalty(
                semantic_score, precomp["cands_subset"], precomp["neg_dict"]
            )
            hr, mrr, ndcg = calculate_metrics(semantic_score, precomp["gt_idx"])
            test_metrics["ndcg"] += ndcg
            test_metrics["hr"] += hr
            test_metrics["mrr"] += mrr

            # Collect per-user data for significance tests & user-bin analysis
            if per_user is not None:
                gt_score = float(semantic_score[precomp["gt_idx"]])
                rank = int((semantic_score > gt_score).sum() + np.isclose(semantic_score, gt_score, rtol=1e-5, atol=1e-8).sum())
                per_user.append({
                    "seed": seed,
                    "MAX_CANDS": mc_store(max_cands),
                    "user": precomp["user"],
                    "model": f"CBF-{model_name.split('/')[-1]}",
                    "target": precomp["target"],
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

        results.append({
            "Model": f"CBF-{model_name.split('/')[-1]}",
            "Seed": seed, "MAX_CANDS": max_cands,
            "best_b_cbf": best_b_cbf, "best_val_nDCG@10": best_val_ndcg,
            "selection_metric": "validation_nDCG@10",
            "coverage_rate": cov,
            "feasible_nDCG@10": ndcg_f, "feasible_HR@10": hr_f, "feasible_MRR@10": mrr_f,
            "feasible_cases": test_metrics["feasible"],
            "total_cases": test_metrics["total"],
        })

    return results


def run_all_cbf(all_splits, gate, mapping_dict, item_meta, max_cands_list=None, per_user=None):
    """Run CBF for all embedding models and MAX_CANDS values."""
    from config import MAX_CANDS_LIST
    if max_cands_list is None:
        max_cands_list = MAX_CANDS_LIST

    all_items_list = sorted(item_meta.keys())
    item_texts = build_enriched_item_texts(item_meta)
    cbf_results = []

    for model_name in EMBEDDING_MODELS:
        print(f"\n  CBF Model: {model_name.split('/')[-1]}")
        backend = load_embedding_backend(model_name, DEVICE)
        if backend is None:
            print(f"   Skipping {model_name.split('/')[-1]} (failed to load)")
            continue

        item_emb_cache = precompute_item_embeddings(backend, all_items_list, item_texts=item_texts)
        if item_emb_cache is None:
            print(f"   Skipping {model_name.split('/')[-1]} (encoding failed)")
            del backend
            gc.collect()
            continue

        for max_cands in max_cands_list:
            print(f"   MAX_CANDS={max_cands}")
            model_results = run_cbf_model(
                model_name, all_items_list, item_emb_cache, backend,
                all_splits, gate, mapping_dict, max_cands=max_cands,
                per_user=per_user,
            )
            cbf_results.extend(model_results)

        del backend
        gc.collect()

    print(f"\n✅ CBF Complete: {len(cbf_results)} results")
    return cbf_results