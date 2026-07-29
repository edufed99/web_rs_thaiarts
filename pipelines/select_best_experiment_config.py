"""
Select the serving recommender config from legacy experiment outputs.

The script reads the CSV/JSON files written by ``old code/4.recommendation``
and emits a compact manifest that the artifact pipeline can copy into
``artifacts/outputs/best_model_config.json``.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
from pathlib import Path
from typing import Any, Optional

import pandas as pd


SCHEMA_VERSION = "1.0.0"
DEFAULT_CBF_MODEL = "intfloat/multilingual-e5-large-instruct"
DEFAULT_CF_MODEL = "ItemKNN"
DEFAULT_HYBRID_METHOD = "WeightedSum"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Select best recommender config from experiment output files."
    )
    parser.add_argument(
        "--experiment-output-dir",
        required=True,
        help="Directory containing results_overall.csv, tuned_params.csv, etc.",
    )
    parser.add_argument(
        "--output-file",
        default=None,
        help="Optional JSON path to write. If omitted, prints JSON to stdout.",
    )
    return parser.parse_args()


def select_best_experiment_config(experiment_output_dir: Path) -> dict[str, Any]:
    output_dir = Path(experiment_output_dir).expanduser().resolve()
    if not output_dir.exists():
        raise FileNotFoundError(f"Experiment output dir not found: {output_dir}")

    overall = _read_required_csv(output_dir / "results_overall.csv")
    tuned = _read_optional_csv(output_dir / "tuned_params.csv")
    cbf = _read_optional_csv(output_dir / "results_cbf.csv")
    cf = _read_optional_csv(output_dir / "results_cf.csv")
    hybrid_methods = _read_optional_csv(output_dir / "results_hybrid_methods.csv")
    experiment_config = _read_optional_json(output_dir / "experiment_config.json")

    overall_best = _best_by_metric(overall, "nDCG_mean")
    method_tag = str(overall_best.get("Model") or "Hybrid-WeightedSum")
    max_cands_label = str(overall_best.get("MAX_CANDS_LABEL") or "")
    max_cands = _parse_max_cands(max_cands_label)

    hybrid_method = _hybrid_method_from_model(method_tag)
    cbf_model = _select_cbf_model(overall, cbf, max_cands_label)
    cf_model = _select_cf_model(cf, max_cands)
    top_k = int(experiment_config.get("K") or 10)

    tuned_row = _select_tuned_rows(tuned, method_tag, max_cands)
    cbf_keyword_boost = _mode_float(tuned_row.get("best_b_cbf")) or _best_cbf_boost(cbf, max_cands)
    hybrid_alpha = _mode_float(tuned_row.get("best_alpha"))
    if hybrid_alpha is None and "WeightedSum" in method_tag:
        hybrid_alpha = 0.8

    knn_cfg = experiment_config.get("KNN_CFG") or {}
    itemknn_k = int(knn_cfg.get("k_neighbors") or 10)
    itemknn_shrink = float(knn_cfg.get("shrink") or 50.0)

    selected_model = {
        "candidate_strategy": "EligibilityGate",
        "max_cands": max_cands,
        "top_k": top_k,
        "cbf_model": cbf_model,
        "cbf_keyword_boost": float(cbf_keyword_boost if cbf_keyword_boost is not None else 0.05),
        "cf_model": cf_model,
        "itemknn_k": itemknn_k,
        "itemknn_shrink": itemknn_shrink,
        "hybrid_method": hybrid_method,
        "hybrid_alpha": float(hybrid_alpha if hybrid_alpha is not None else 0.7),
        "method": f"Hybrid-{hybrid_method}" if not method_tag.startswith("Hybrid-") else method_tag,
    }

    return {
        "schema_version": SCHEMA_VERSION,
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "experiment_output_dir": str(output_dir),
        "selection_metric": "nDCG_mean",
        "selected_model": selected_model,
        "evidence": {
            "overall_best": _row_evidence(overall_best),
            "cbf_best": _row_evidence(_select_cbf_evidence(overall, cbf, max_cands_label)),
            "cf_best": _row_evidence(_select_cf_evidence(cf, max_cands)),
            "hybrid_best": _row_evidence(_select_hybrid_evidence(hybrid_methods, method_tag, max_cands_label)),
        },
        "source_files": _source_files(output_dir),
    }


def _read_required_csv(path: Path) -> pd.DataFrame:
    if not path.exists():
        raise FileNotFoundError(f"Required experiment result missing: {path}")
    return pd.read_csv(path)


def _read_optional_csv(path: Path) -> pd.DataFrame:
    return pd.read_csv(path) if path.exists() else pd.DataFrame()


def _read_optional_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    with path.open("r", encoding="utf-8") as fh:
        return json.load(fh)


def _best_by_metric(df: pd.DataFrame, metric: str) -> pd.Series:
    if df.empty:
        raise ValueError("Cannot select best row from an empty DataFrame")
    if metric not in df.columns:
        raise ValueError(f"Missing selection metric column: {metric}")
    work = df.copy()
    work[metric] = pd.to_numeric(work[metric], errors="coerce")
    work = work.dropna(subset=[metric])
    if work.empty:
        raise ValueError(f"No numeric values found for selection metric: {metric}")
    return work.sort_values(metric, ascending=False).iloc[0]


def _parse_max_cands(label: Any) -> Optional[int]:
    text = str(label or "").strip().lower()
    if not text or "all" in text or text == "nan":
        return None
    try:
        return int(float(text))
    except ValueError:
        return None


def _max_cands_matches(series: pd.Series, max_cands: Optional[int]) -> pd.Series:
    nums = pd.to_numeric(series, errors="coerce")
    if max_cands is None:
        return nums.isna()
    return nums == float(max_cands)


def _hybrid_method_from_model(model: str) -> str:
    if model.startswith("Hybrid-"):
        return model.split("Hybrid-", 1)[1]
    return DEFAULT_HYBRID_METHOD


def _select_tuned_rows(tuned: pd.DataFrame, method_tag: str, max_cands: Optional[int]) -> pd.DataFrame:
    if tuned.empty or "Model" not in tuned.columns or "MAX_CANDS" not in tuned.columns:
        return pd.DataFrame()
    rows = tuned[tuned["Model"] == method_tag]
    if rows.empty:
        return rows
    return rows[_max_cands_matches(rows["MAX_CANDS"], max_cands)]


def _mode_float(series: Any) -> Optional[float]:
    if series is None or not hasattr(series, "empty") or series.empty:
        return None
    nums = pd.to_numeric(series, errors="coerce").dropna()
    if nums.empty:
        return None
    counts = nums.value_counts()
    max_count = counts.max()
    winners = sorted(float(v) for v, c in counts.items() if c == max_count)
    return winners[-1]


def _select_cbf_model(overall: pd.DataFrame, cbf: pd.DataFrame, max_cands_label: str) -> str:
    row = _select_cbf_evidence(overall, cbf, max_cands_label)
    model = str(row.get("Model") or "")
    short = model.replace("CBF-", "", 1)
    mapping = {
        "multilingual-e5-large-instruct": "intfloat/multilingual-e5-large-instruct",
        "bge-m3": "BAAI/bge-m3",
        "SCT-KD-model-phayathaibert": "kornwtp/SCT-KD-model-phayathaibert",
        "wangchanberta-base-att-spm-uncased": "airesearch/wangchanberta-base-att-spm-uncased",
    }
    return mapping.get(short, DEFAULT_CBF_MODEL)


def _select_cbf_evidence(overall: pd.DataFrame, cbf: pd.DataFrame, max_cands_label: str) -> pd.Series:
    if not overall.empty and "Model" in overall.columns:
        rows = overall[overall["Model"].astype(str).str.startswith("CBF-")]
        if "MAX_CANDS_LABEL" in rows.columns and max_cands_label:
            rows = rows[rows["MAX_CANDS_LABEL"].astype(str) == str(max_cands_label)]
        if not rows.empty:
            return _best_by_metric(rows, "nDCG_mean")
    if not cbf.empty:
        return _best_by_metric(cbf, "best_val_nDCG@10")
    return pd.Series({"Model": f"CBF-{DEFAULT_CBF_MODEL.split('/')[-1]}"})


def _best_cbf_boost(cbf: pd.DataFrame, max_cands: Optional[int]) -> Optional[float]:
    if cbf.empty or "best_b_cbf" not in cbf.columns:
        return None
    rows = cbf
    if "MAX_CANDS" in rows.columns:
        rows = rows[_max_cands_matches(rows["MAX_CANDS"], max_cands)]
    return _mode_float(rows["best_b_cbf"]) if not rows.empty else None


def _select_cf_model(cf: pd.DataFrame, max_cands: Optional[int]) -> str:
    row = _select_cf_evidence(cf, max_cands)
    model = str(row.get("Model") or "")
    if model.startswith("CF-"):
        return model.replace("CF-", "", 1)
    return DEFAULT_CF_MODEL


def _select_cf_evidence(cf: pd.DataFrame, max_cands: Optional[int]) -> pd.Series:
    if cf.empty:
        return pd.Series({"Model": f"CF-{DEFAULT_CF_MODEL}"})
    rows = cf
    if "MAX_CANDS" in rows.columns:
        scoped = rows[_max_cands_matches(rows["MAX_CANDS"], max_cands)]
        rows = scoped if not scoped.empty else rows
    metric = "feasible_nDCG@10" if "feasible_nDCG@10" in rows.columns else "best_val_nDCG@10"
    return _best_by_metric(rows, metric)


def _select_hybrid_evidence(
    hybrid_methods: pd.DataFrame,
    method_tag: str,
    max_cands_label: str,
) -> pd.Series:
    if hybrid_methods.empty:
        return pd.Series({"Model": method_tag, "MAX_CANDS_LABEL": max_cands_label})
    rows = hybrid_methods
    if "Model" in rows.columns:
        rows = rows[rows["Model"] == method_tag]
    if "MAX_CANDS_LABEL" in rows.columns and max_cands_label:
        rows = rows[rows["MAX_CANDS_LABEL"].astype(str) == str(max_cands_label)]
    return _best_by_metric(rows, "nDCG_mean") if not rows.empty else pd.Series()


def _row_evidence(row: pd.Series) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key in ("Model", "MAX_CANDS_LABEL", "MAX_CANDS", "nDCG_mean", "HR_mean", "MRR_mean",
                "best_val_nDCG@10", "feasible_nDCG@10", "Seed"):
        if key in row and pd.notna(row[key]):
            value = row[key]
            out[key] = value.item() if hasattr(value, "item") else value
    return out


def _source_files(output_dir: Path) -> list[str]:
    names = [
        "results_overall.csv",
        "results_cbf.csv",
        "results_cf.csv",
        "results_hybrid_methods.csv",
        "tuned_params.csv",
        "experiment_config.json",
    ]
    return [str((output_dir / name).resolve()) for name in names if (output_dir / name).exists()]


def main() -> int:
    args = parse_args()
    config = select_best_experiment_config(Path(args.experiment_output_dir))
    payload = json.dumps(config, ensure_ascii=False, indent=2)
    if args.output_file:
        out = Path(args.output_file).expanduser().resolve()
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(payload + "\n", encoding="utf-8")
    else:
        print(payload)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
