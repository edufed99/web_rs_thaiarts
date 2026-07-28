# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

`web_rs_thaiarts` is a Thai-arts recommendation system research codebase. It builds a recommendation pipeline over Thai cultural-heritage items, combining content-based filtering (CBF), collaborative filtering (CF), and a hybrid fusion layer with an eligibility gate. Source data is enriched through three preprocessing stages (stopword filtering, hierarchical taxonomy labeling, keyword-to-item mapping) before reaching the recommendation engine.

The codebase is **research code from a thesis** — not a production service. Scripts are designed to be run end-to-end on prepared inputs to produce paper-ready evaluation tables.

## Repository layout

The repo is currently organized as a single `old code/` folder containing four numbered pipeline stages. Each stage is a self-contained Python project with its own `requirements.txt`, `input/` data, `result/` (or `output/`) outputs, and (where applicable) reference files.

```
old code/
├── 1.stopword filtering/        # Stage 1: LLM-based Thai stopword extraction
│   ├── stopword_filter.py       #   Single entry — supports gemini / gpt / qwen / deepseek / all
│   ├── input/   result/   result_eval/
│   └── requirements.txt         #   pandas, requests, python-dotenv, urllib3
│
├── 2.hierachical labeling/      # Stage 2: LLM taxonomy induction
│   ├── taxonomy.py              #   Hierarchical taxonomy builder using pythainlp
│   ├── input/   result/   ref_fle/
│   └── requirements.txt         #   pandas, requests, python-dotenv, pythainlp, numpy
│
├── 3.keyword mapping to item/   # Stage 3: Embedding-based keyword → item mapping
│   ├── keywordmapping.py        #   Uses torch + sentence-transformers style embeddings
│   ├── input/   result/   ref_file/
│   └── requirements.txt         #   numpy, pandas, torch, scipy, tqdm
│
├── 4.recommendation/            # Stage 4: The recommendation engine itself
│   ├── run_pipeline.py          #   ★ Master entry — orchestrates Phases 0–4
│   ├── cbf.py  cf.py  hybrid.py #   Per-family models (Section 2.3.2–2.3.4)
│   ├── data_loader.py  eligibility_gate.py  config.py
│   ├── input/   output/
│   ├── .venv_iaes/              #   Python venv — gitignored, not for commit
│   └── requirements.txt         #   pandas, matplotlib, pythainlp, torch, rapidfuzz,
│                               #   sentence-transformers, python-dotenv, regex
│
├── ref_rs/                      # Reference papers on recommender systems (PDFs excluded)
├── cbf.txt  cf.txt  hybrid.txt  # Per-family literature notes
├── config.txt  taxonomy.txt     # Cross-stage config / taxonomy notes
├── eligibility_gate.txt  keywordmapping.txt  stopword_filter.txt
└── desktop.ini                  # Windows folder metadata — gitignored
```

## Pipeline flow

```
[raw Thai text corpus]
        │
        ▼
Stage 1 — stopword filtering  (stopword_filter.py, LLM calls)
        │  produces: non_stopwords_*.csv
        ▼
Stage 2 — hierarchical labeling  (taxonomy.py, pythainlp + LLM)
        │  produces: taxonomy tree
        ▼
Stage 3 — keyword → item mapping  (keywordmapping.py, torch embeddings)
        │  produces: keyword/item associations
        ▼
Stage 4 — recommendation  (run_pipeline.py)
        │  Phase 0: load + eligibility gate
        │  Phase 1A: CBF  (cbf.py)
        │  Phase 1B: CF   (cf.py — BiasedMF, EASE^R, SimpleX, etc.)
        │  Phase 1C: Hybrid fusion (hybrid.py)
        │  Phase 1D: XAI explanation routing
        │  Phase 2–4: aggregation, paper tables, significance tests
        ▼
[output/ — HR@K, nDCG@K, MRR@K tables]
```

Stage 4's `config.py` is the canonical reference for hyperparameters (rating scale, thresholds, seeds, fuzzy cutoff grid, K, batch size) and is heavily commented with references to specific thesis sections.

## Common commands

All commands assume the working directory is `old code/<stage>/` for stage scripts, or `old code/4.recommendation/` for the recommendation pipeline.

### Stage 1 — stopword filtering
```bash
cd "old code/1.stopword filtering"
pip install -r requirements.txt
# requires .env with LLM provider keys
python stopword_filter.py --model all          # run all four LLMs
python stopword_filter.py --model gemini       # single model
python stopword_filter.py --model deepseek     # DeepSeek reasoning model
```

### Stage 2 — hierarchical labeling
```bash
cd "old code/2.hierachical labeling"
pip install -r requirements.txt
python taxonomy.py
```

### Stage 3 — keyword mapping
```bash
cd "old code/3.keyword mapping to item"
pip install -r requirements.txt
python keywordmapping.py
```

### Stage 4 — recommendation pipeline (main entry)
```bash
cd "old code/4.recommendation"
python -m venv .venv_iaes && source .venv_iaes/bin/activate   # Linux/macOS
# or:  python -m venv .venv_iaes && .venv_iaes\Scripts\activate  # Windows
pip install -r requirements.txt

python run_pipeline.py                        # full pipeline, all phases
python run_pipeline.py --phase cbf            # content-based only
python run_pipeline.py --phase cf             # collaborative only
python run_pipeline.py --phase hybrid         # hybrid fusion only
python run_pipeline.py --seeds 42 123         # override default seeds [42, 123, 999, 2024, 555]
python run_pipeline.py --max-cands 40 80      # override candidate pool sizes
python run_pipeline.py --cbf-models bge-m3    # run a specific CBF model
```

There is **no `Makefile`, `package.json`, lint config, or test runner** in this repo. `run_pipeline.py`'s own argparse flags are the only CLI surface; verification of correctness happens by inspecting the `output/` tables against thesis-reported numbers.

## Configuration that matters

- **LLM provider keys** (Stage 1, possibly Stage 2) live in each stage's `.env` file — never commit these. `.gitignore` excludes `.env` and `.env.*.local`.
- **Stage 4 hyperparameters** (`SEEDS`, `K`, `BATCH_SIZE`, `RATING_FLOOR`, `POSITIVE_THRESHOLD`, `FUZZY_CUTOFF_*`, `ENABLE_*`) all live in `old code/4.recommendation/config.py` with comments citing the thesis section each constant belongs to. Edit there, not in the model scripts.
- **Thesis section cross-references** are embedded in module docstrings throughout `old code/4.recommendation/` (Section 2.3.1–2.3.4). When changing recommendation behavior, update both code and the cited section comments.

## What is excluded from the repo

`.gitignore` blocks: `node_modules/`, `.next/`, `*.pdf`, `.venv/`, `__pycache__/`, `desktop.ini`, `.env*`, and the specific path `old code/4.recommendation/.venv_iaes/`. PDFs in `ref_rs/` were intentionally removed from history — the folders themselves remain as empty directories. Do not recommit PDFs or venv contents.

## Conventions

- Python 3, UTF-8, thesis-style module docstrings (`# -*- coding: utf-8 -*-` + a long header referencing the thesis section). Match this style when adding new modules.
- Each numbered stage is **independently runnable**; do not introduce cross-stage imports. The handoff is through CSV files in `input/` and `result/`.
- Stage 4 uses multi-seed evaluation (see `SEEDS` in `config.py`) for variance reduction — do not change the seed list without rerunning the full evaluation.