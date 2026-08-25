"""
train_or_generate_artifacts.py — Offline pipeline that converts the source CSVs
in web_appRS/source_data_2569/.../input/ into the static artifact files that
the FastAPI backend loads at startup.

This pipeline is the ONLY place where CSV files are read. The backend never
reads CSVs at serving time — it only reads the artifacts this script writes.

Usage:
    python pipelines/train_or_generate_artifacts.py \\
        --source-root "web_appRS/source_data_2569/code for paper/4.recommendation/input" \\
        --output-dir artifacts

Outputs (split into two subdirs under --output-dir):
    artifacts/models/                         (ML model artifacts)
        item_embeddings.npz                   float32 matrix, one row per active item
        item_embedding_ids.json               parallel array of item ids
        cf_user_item.json                     positive-history: {user_key: [item_ids]}
        cf_item_users.json                    inverse index: {item_id: [user_keys]}
        cf_user_item_rating.json              rating weights: {[user_key, item_id]: weight}

    artifacts/outputs/                        (processed data + metadata)
        catalog.parquet                       Item + Context + Keyword + TaxonomyNode
        metadata.json                         build timestamp, counts, schema version
        best_model_config.json                optional best serving config selected from experiment outputs
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import re
import sys
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).parent.resolve()))
from select_best_experiment_config import select_best_experiment_config

SCHEMA_VERSION = "1.0.0"
POSITIVE_THRESHOLD = 4  # mirror of recommender/settings.RECOMMENDER_POSITIVE_THRESHOLD
RATING_MIN = 1
RATING_MAX = 5
RATING_FLOOR = 0.01     # mirror of REcommender/RECOMMENDER_RATING_FLOOR
EMBEDDING_DIM = 4       # synthetic dim (real E5-large-instruct uses 1024)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Generate recommender artifacts.")
    p.add_argument(
        "--source-root",
        required=True,
        help="Path to the input directory containing all_item_*.csv, mapped_words_*.csv, etc.",
    )
    p.add_argument(
        "--output-dir",
        required=True,
        help="Directory to write artifact files into. Created if missing.",
    )
    p.add_argument(
        "--item-csv",
        default="all_item_130868.csv",
        help="Filename of the item catalog CSV inside --source-root.",
    )
    p.add_argument(
        "--keyword-link-csv",
        default="mapped_words_to_items95_default.csv",
        help="Filename of the keyword-to-item mapping CSV inside --source-root.",
    )
    p.add_argument(
        "--taxonomy-csv",
        default="consensus_classification.csv",
        help="Filename of the taxonomy CSV inside --source-root.",
    )
    p.add_argument(
        "--user-log-csv",
        default="user_log_with_keywords_only_list.csv",
        help="Filename of the legacy user rating log CSV inside --source-root.",
    )
    p.add_argument(
        "--seed",
        type=int,
        default=42,
        help="Random seed for synthetic embeddings.",
    )
    p.add_argument(
        "--synthetic-embeddings",
        action="store_true",
        help=(
            "If set, generate deterministic synthetic embeddings instead of loading "
            "intfloat/multilingual-e5-large-instruct. Useful for tests and offline demos "
            "where the 2.5 GB model is unavailable. Production should omit this flag."
        ),
    )
    p.add_argument(
        "--experiment-output-dir",
        default=None,
        help=(
            "Optional path to old code/4.recommendation/output. When provided, "
            "the pipeline writes outputs/best_model_config.json and embeds the "
            "selected serving config into outputs/metadata.json."
        ),
    )
    return p.parse_args()


# ---------------------------------------------------------------------------
# Catalog ingestion
# ---------------------------------------------------------------------------

def clean_text(value) -> str:
    if value is None or (isinstance(value, float) and np.isnan(value)):
        return ""
    text = str(value).replace("﻿", "").replace("\xa0", " ")
    return re.sub(r"\s+", " ", text).strip()


def parse_positive_int(value) -> Optional[int]:
    text = clean_text(value).replace(",", "")
    if not text:
        return None
    match = re.search(r"\d+", text)
    return int(match.group()) if match else None


def normalize_item_name(value: str) -> str:
    text = clean_text(value)
    # Apply the same legacy replacements as thai_arts_webapp/catalog/utils.py
    # so item ids stay consistent with the legacy DB where possible.
    replacements = {
        "ตอน  จองถนน": "ตอน จองถนน",
        "ตอน  นารายณ์ปราบนนทก": "ตอน นารายณ์ปราบนนทก",
        "ตอน  ศึกแสงอาทิตย์": "ตอน ศึกแสงอาทิตย์",
        "ตอน  หนุมานชาญสมร": "ตอน หนุมานชาญสมร",
        "ระบำพรมมาสตร์": "ระบำพรหมาสตร์",
    }
    for old, new in replacements.items():
        text = text.replace(old, new)
    return clean_text(text)


def load_catalog(source_root: Path, item_csv: str) -> Tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """
    Returns three DataFrames: items, contexts, item_context_links.
    """
    path = source_root / item_csv
    df = pd.read_csv(path)

    items: Dict[int, dict] = {}
    contexts: Dict[str, dict] = {}
    links: List[Tuple[int, str]] = []
    context_id_counter = 1
    context_key_to_id: Dict[str, int] = {}

    for _, row in df.iterrows():
        name = normalize_item_name(row.get("ชื่อชุดการแสดง"))
        if not name:
            continue
        item_id = stable_id("item", name)
        items[item_id] = {
            "item_id": item_id,
            "name": name,
            "description": clean_text(row.get("คำอธิบายชุดการแสดง")),
            "category_group": clean_text(row.get("ประเภทชุดการแสดง")),
            "performance_type": clean_text(row.get("ประเภทการแสดง")),
            "performers_count": parse_positive_int(row.get("จำนวนผู้แสดง")),
            "duration_minutes": parse_positive_int(row.get("ระยะเวลาการแสดง (นาที)")),
            "price_text": clean_text(row.get(" ราคาต่อชุด ")),
            "is_active": True,
        }

        context_name = clean_text(row.get("บริบทย่อย"))
        context_group = clean_text(row.get("บริบทหลัก"))
        if not context_name:
            continue
        key = f"{context_group}::{context_name}"
        if key not in context_key_to_id:
            context_key_to_id[key] = context_id_counter
            contexts[context_name] = {
                "context_id": context_id_counter,
                "name": context_name,
                "group": context_group,
                "description": "",
            }
            context_id_counter += 1
        links.append((item_id, context_key_to_id[key]))

    items_df = pd.DataFrame(list(items.values()))
    contexts_df = pd.DataFrame(list(contexts.values()))
    links_df = pd.DataFrame(links, columns=["item_id", "context_id"])
    return items_df, contexts_df, links_df


def load_keyword_links(source_root: Path, csv_name: str) -> pd.DataFrame:
    """
    Reads mapped_words_to_items*.csv. Columns vary; we only need keyword name + item name.
    Falls back to an empty DataFrame if the file is missing.
    """
    path = source_root / csv_name
    if not path.exists():
        return pd.DataFrame(columns=["item_id", "keyword_name"])
    df = pd.read_csv(path)
    item_col = next((c for c in df.columns if "ชุด" in c or "item" in c.lower()), df.columns[0])
    word_col = next(
        (
            c
            for c in df.columns
            if (
                c.lower() in {"word", "words", "keyword", "keywords", "keyword_name"}
                or "คำ" in c
                or "keyword" in c.lower()
                or "word" in c.lower()
            )
        ),
        df.columns[-1],
    )
    rows = []
    for _, row in df.iterrows():
        item_name = normalize_item_name(row.get(item_col))
        words = [clean_text(part) for part in str(row.get(word_col) or "").split(",")]
        if not item_name:
            continue
        for word in words:
            if not word:
                continue
            rows.append({"item_id": stable_id("item", item_name), "keyword_name": word})
    return pd.DataFrame(rows)


def load_taxonomy(source_root: Path, csv_name: str) -> pd.DataFrame:
    """
    Reads consensus_classification.csv. Returns a flat keyword → taxonomy_path table.
    """
    path = source_root / csv_name
    if not path.exists():
        return pd.DataFrame(columns=["keyword_name", "taxonomy_path"])
    df = pd.read_csv(path)
    word_col = next((c for c in df.columns if "คำ" in c or "keyword" in c.lower()), df.columns[0])
    cat_col = next(
        (
            c
            for c in df.columns
            if (
                "หมวด" in c
                or "category" in c.lower()
                or "taxonomy" in c.lower()
                or "classification" in c.lower()
                or "label" in c.lower()
            )
        ),
        None,
    )
    rows = []
    for _, row in df.iterrows():
        word = clean_text(row.get(word_col))
        cat = clean_text(row.get(cat_col)).replace("||", " > ") if cat_col else ""
        if not word:
            continue
        rows.append({"keyword_name": word, "taxonomy_path": cat})
    return pd.DataFrame(rows)


def load_user_logs(source_root: Path, csv_name: str) -> pd.DataFrame:
    """
    Reads user_log_with_keywords_only_list.csv and returns user → (item, rating) records.
    Columns expected: user, item, rating (best-effort auto-detect).
    """
    path = source_root / csv_name
    if not path.exists():
        return pd.DataFrame(columns=["user_key", "item_id", "rating"])
    df = pd.read_csv(path)
    user_col = next((c for c in df.columns if "user" in c.lower() or "ผู้" in c), df.columns[0])
    item_col = next((c for c in df.columns if "ชุด" in c or "item" in c.lower()), df.columns[1])
    rating_col = next((c for c in df.columns if "rating" in c.lower() or "คะแนน" in c), None)
    rows = []
    for _, row in df.iterrows():
        user = clean_text(row.get(user_col))
        item_name = normalize_item_name(row.get(item_col))
        rating = parse_positive_int(row.get(rating_col)) if rating_col else None
        if not user or not item_name or rating is None:
            continue
        rows.append({
            "user_key": f"user:{user}",
            "item_id": stable_id("item", item_name),
            "rating": rating,
        })
    return pd.DataFrame(rows)


# ---------------------------------------------------------------------------
# Stable ids
# ---------------------------------------------------------------------------

def stable_id(kind: str, name: str) -> int:
    h = hashlib.sha256(f"{kind}::{name}".encode("utf-8")).hexdigest()
    # Take first 7 hex digits (28 bits) → fits in positive int32
    return int(h[:7], 16)


# ---------------------------------------------------------------------------
# Embeddings
# ---------------------------------------------------------------------------

def build_item_text(item: dict) -> str:
    """Build the paper-faithful item passage: name + description only.

    Contexts belong to the eligibility gate and mapped keywords provide the
    explicit CBF boost.  Keeping both out of the dense item representation
    prevents those signals from being counted a second time by cosine
    similarity.
    """
    parts = [item["name"], item.get("description", "")]
    return " ".join(p for p in parts if p).strip()


def compute_embeddings(
    items_df: pd.DataFrame,
    item_keywords: Dict[int, List[str]],
    item_contexts: Dict[int, List[str]],
    synthetic: bool,
    seed: int,
) -> Tuple[np.ndarray, List[int]]:
    """
    Returns (matrix float32 [N, D], list of item ids in the same order).
    """
    if synthetic:
        rng = np.random.default_rng(seed)
        # Deterministic synthetic embeddings: derived from item id so the same
        # item always gets the same vector across runs.
        ids = items_df["item_id"].tolist()
        mat = np.zeros((len(ids), EMBEDDING_DIM), dtype=np.float32)
        for i, iid in enumerate(ids):
            local = np.random.default_rng(iid)
            mat[i] = local.standard_normal(EMBEDDING_DIM).astype(np.float32)
        # L2-normalize
        norms = np.linalg.norm(mat, axis=1, keepdims=True)
        norms[norms == 0] = 1.0
        mat = mat / norms
        return mat, ids

    # Real E5 path (used in production if --synthetic-embeddings is omitted).
    try:
        from sentence_transformers import SentenceTransformer  # type: ignore
    except ImportError as exc:  # pragma: no cover
        raise RuntimeError(
            "sentence-transformers is required for real embeddings. "
            "Install it or pass --synthetic-embeddings for offline runs."
        ) from exc

    model = SentenceTransformer(
        "intfloat/multilingual-e5-large-instruct",
        device="cpu",
        trust_remote_code=True,
    )
    if hasattr(model, "max_seq_length"):
        model.max_seq_length = min(model.max_seq_length, 512)

    ids = items_df["item_id"].tolist()
    texts = []
    for _, item in items_df.iterrows():
        # E5 instruct format does not require a prefix for passages.
        texts.append(build_item_text(item.to_dict()))

    vectors = model.encode(
        texts,
        normalize_embeddings=True,
        convert_to_numpy=True,
        show_progress_bar=False,
    ).astype(np.float32)
    return vectors, ids


# ---------------------------------------------------------------------------
# CF index
# ---------------------------------------------------------------------------

def normalize_rating(raw: int) -> float:
    rng = RATING_MAX - RATING_MIN
    return RATING_FLOOR + (1.0 - RATING_FLOOR) * (raw - RATING_MIN) / rng


def build_cf_index(
    user_logs: pd.DataFrame,
) -> Tuple[Dict[str, List[int]], Dict[int, List[str]], Dict[Tuple[str, int], float]]:
    """
    Returns (positive_by_user, item_users, rating_weight).
    `positive_by_user`: user_key -> [item_id, ...]
    `item_users`:       item_id  -> [user_key, ...]
    `rating_weight`:    (user_key, item_id) -> normalized weight in [RATING_FLOOR, 1]
    Only ratings >= POSITIVE_THRESHOLD are kept (matches legacy _build_positive_histories).
    """
    positive_by_user: Dict[str, List[int]] = {}
    item_users: Dict[int, List[str]] = {}
    rating_weight: Dict[Tuple[str, int], float] = {}
    if user_logs.empty:
        return positive_by_user, item_users, rating_weight

    for _, row in user_logs.iterrows():
        user_key = row["user_key"]
        item_id = int(row["item_id"])
        rating = int(row["rating"])
        if rating < POSITIVE_THRESHOLD:
            continue
        positive_by_user.setdefault(user_key, []).append(item_id)
        item_users.setdefault(item_id, []).append(user_key)
        rating_weight[(user_key, item_id)] = normalize_rating(rating)
    return positive_by_user, item_users, rating_weight


# ---------------------------------------------------------------------------
# Driver
# ---------------------------------------------------------------------------

def main() -> int:
    args = parse_args()
    source_root = Path(args.source_root).expanduser().resolve()
    output_root = Path(args.output_dir).expanduser().resolve()
    models_dir = output_root / "models"
    outputs_dir = output_root / "outputs"
    models_dir.mkdir(parents=True, exist_ok=True)
    outputs_dir.mkdir(parents=True, exist_ok=True)

    if not source_root.exists():
        print(f"ERROR: source root not found: {source_root}", file=sys.stderr)
        return 2

    print(f"[1/6] Loading catalog from {source_root}")
    items_df, contexts_df, links_df = load_catalog(source_root, args.item_csv)
    print(f"      items={len(items_df)}  contexts={len(contexts_df)}  links={len(links_df)}")

    print(f"[2/6] Loading keyword links")
    kw_links = load_keyword_links(source_root, args.keyword_link_csv)
    item_keywords: Dict[int, List[str]] = {}
    for _, row in kw_links.iterrows():
        item_keywords.setdefault(int(row["item_id"]), []).append(str(row["keyword_name"]))

    print(f"[3/6] Loading taxonomy")
    tax = load_taxonomy(source_root, args.taxonomy_csv)
    keyword_taxonomy: Dict[str, str] = {
        str(r["keyword_name"]): str(r["taxonomy_path"]) for _, r in tax.iterrows()
    }
    region_path = next(
        (
            keyword_taxonomy.get(name, "")
            for name in ("ภาคเหนือ", "ภาคกลาง", "ภาคอีสาน", "สี่ภาค")
            if keyword_taxonomy.get(name)
        ),
        "",
    )
    if region_path:
        keyword_taxonomy.setdefault("ภาคใต้", region_path)
        keyword_taxonomy.setdefault("ล่องใต้", region_path)

    royal_person_path = keyword_taxonomy.get("พระบรมราชชนนีพับปีหลวง", "")
    if royal_person_path:
        keyword_taxonomy.setdefault("พระบรมราชชนนีพันปีหลวง", royal_person_path)

    print(f"[4/6] Loading user logs")
    user_logs = load_user_logs(source_root, args.user_log_csv)
    positive_by_user, item_users, rating_weight = build_cf_index(user_logs)
    print(f"      positive_users={len(positive_by_user)}  unique_items={len(item_users)}")

    # Build item → context name list from links
    ctx_id_to_name = dict(zip(contexts_df["context_id"].astype(int), contexts_df["name"]))
    item_contexts: Dict[int, List[str]] = {}
    for _, row in links_df.iterrows():
        item_contexts.setdefault(int(row["item_id"]), []).append(
            ctx_id_to_name[int(row["context_id"])]
        )

    # Merge keyword list + taxonomy into items table as nested columns
    items_df = items_df.copy()
    items_df["keyword_names"] = items_df["item_id"].apply(
        lambda iid: item_keywords.get(int(iid), [])
    )
    items_df["context_names"] = items_df["item_id"].apply(
        lambda iid: item_contexts.get(int(iid), [])
    )
    items_df["taxonomy_paths"] = items_df["keyword_names"].apply(
        lambda names: [keyword_taxonomy.get(n, "") for n in names]
    )

    print(f"[5/6] Computing embeddings (synthetic={args.synthetic_embeddings})")
    vectors, ids_in_order = compute_embeddings(
        items_df, item_keywords, item_contexts,
        synthetic=args.synthetic_embeddings,
        seed=args.seed,
    )
    # Reorder items_df to match embedding order
    items_df = items_df.set_index("item_id").loc[ids_in_order].reset_index()

    print(f"[6/6] Writing artifacts")
    print(f"      models  -> {models_dir}")
    print(f"      outputs -> {outputs_dir}")

    # --- artifacts/models/  (ML model artifacts) ---
    np.savez_compressed(models_dir / "item_embeddings.npz", vectors=vectors)
    (models_dir / "item_embedding_ids.json").write_text(
        json.dumps(ids_in_order, ensure_ascii=False), encoding="utf-8"
    )
    (models_dir / "cf_user_item.json").write_text(
        json.dumps(positive_by_user, ensure_ascii=False), encoding="utf-8"
    )
    (models_dir / "cf_item_users.json").write_text(
        json.dumps({str(k): v for k, v in item_users.items()}, ensure_ascii=False),
        encoding="utf-8",
    )
    (models_dir / "cf_user_item_rating.json").write_text(
        json.dumps(
            {f"{u}::{i}": w for (u, i), w in rating_weight.items()},
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    # --- artifacts/outputs/  (processed data + metadata) ---
    items_df.to_parquet(outputs_dir / "catalog.parquet", index=False)
    best_model_config = None
    if args.experiment_output_dir:
        experiment_output_dir = Path(args.experiment_output_dir).expanduser().resolve()
        print(f"      selecting best model config from {experiment_output_dir}")
        best_model_config = select_best_experiment_config(experiment_output_dir)
        (outputs_dir / "best_model_config.json").write_text(
            json.dumps(best_model_config, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )

    metadata = {
        "schema_version": SCHEMA_VERSION,
        "build_timestamp": dt.datetime.now(dt.timezone.utc).isoformat(),
        "source_root": str(source_root),
        "item_count": int(len(items_df)),
        "context_count": int(len(contexts_df)),
        "keyword_link_count": int(len(kw_links)),
        "positive_user_count": int(len(positive_by_user)),
        "unique_item_user_edges": int(len(item_users)),
        "embedding_dim": int(vectors.shape[1]),
        "embedding_text_fields": ["name", "description"],
        "synthetic_embeddings": bool(args.synthetic_embeddings),
        "config_hash": hashlib.sha256(
            json.dumps(
                {
                    "POSITIVE_THRESHOLD": POSITIVE_THRESHOLD,
                    "RATING_FLOOR": RATING_FLOOR,
                    "EMBEDDING_DIM": EMBEDDING_DIM,
                    "EMBEDDING_TEXT_FIELDS": ["name", "description"],
                    "seed": args.seed,
                },
                sort_keys=True,
            ).encode("utf-8")
        ).hexdigest()[:12],
        "artifact_layout": {
            "models_dir": "artifacts/models/",
            "outputs_dir": "artifacts/outputs/",
        },
    }
    if best_model_config:
        metadata["best_model_config_path"] = "artifacts/outputs/best_model_config.json"
        metadata["best_model_config"] = best_model_config
    (outputs_dir / "metadata.json").write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    print("Done.")
    print(json.dumps(metadata, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
