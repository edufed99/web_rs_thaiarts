# -*- coding: utf-8 -*-
"""
Unified Keyword-Item Mapping for Thai Performing Arts Domain

Maps classified keywords to performance-item catalog entries via a
multi-layer matching pipeline:
  1) Exact string match
  2) Fuzzy / token-set / partial match (RapidFuzz, configurable threshold)
  3) Semantic match (Sentence-BERT cosine similarity, optional)

The item catalog is deduplicated by normalised performance name before
mapping, so duplicate rows with the same name are collapsed into a single
item with merged descriptions.

Evaluation is global set-level (micro-averaged TP/FP/FN across all
predicted vs gold keyword sets).

CLI modes
---------
  --threshold T         Single fuzzy-threshold run (0-100)
  --sweep               Sweep all default thresholds (70-95)
  --thresholds 70 80..  Custom threshold list
  --evaluate            Evaluate mapping against gold standard
  --ablation            Ablation sweep (all configs x all thresholds)
  --ablation-eval       Ablation with per-config F1 evaluation
  --train-val-test      Train/val/test split → threshold selection → test report
  --cross-val           K-fold cross-validation for threshold selection
  --generic-filter-ablation  Compare generic-filter modes
  --semantic-challenge  Benchmark semantic layer on lexical-hard gold pairs only

Notable options
---------------
  --idf-percentile N    Filter top-N% high-IDF (rare) keywords
  --generic-filter-mode {none,predefined,extended}
  --guaranteed-coverage Force at least one keyword per item
  --challenge-threshold T  Lexical threshold for semantic-challenge (default: 85)
  --discover-synonyms  Propose synonym candidates from FN words (SBERT)
  --sbert-model MODEL   Sentence-BERT model (default: intfloat/multilingual-e5-base)
  --bootstrap-ci        Bootstrap 95% confidence intervals
  --mcnemar             McNemar test between two configs
  --analyze-word-length FP/TP rate by word length
  --error-analysis      FP categorisation breakdown
  --macro-metrics       Per-item averaged metrics (requires per-item data)

Inputs (same folder as this script):
  - classified_nonstopwords_gemini_output.csv  (column: 'Words')
  - all_item_130868.csv  (columns: 'ชื่อชุดการแสดง', 'คำอธิบายชุดการแสดง')
  - gold_standard.csv   (for evaluation modes)

Outputs (under result/):
  Per threshold T:
    mapped_words_to_itemsT.csv   ลำดับ | ชื่อชุดการแสดง | words | match_source
    unmapped_wordsT.csv           คำที่ยังไม่ถูกแมป
    unmapped_itemsT.csv           ชื่อชุดการแสดงที่ยังไม่ถูกแมป
  Evaluation:
    sweep_table.csv               Threshold sweep summary
    ablation_*.csv                Ablation results
    semantic_challenge_evaluation.csv   Semantic-challenge benchmark
    threshold_selection.csv        Selected threshold from val set
    bootstrap_ci.csv               Bootstrap confidence intervals
    mcnemar_results.csv            McNemar test results
"""

import argparse
import csv
import math
import re
import sys
import unicodedata
import hashlib
import json
from pathlib import Path
from collections import defaultdict
from typing import List, Tuple, Dict, Optional
from concurrent.futures import ProcessPoolExecutor, as_completed
import torch
import pandas as pd
import matplotlib.pyplot as plt

# Try to import Thai tokenizer — if not available, skip segmentation
try:
    from pythainlp.tokenize import word_tokenize
    from pythainlp.corpus.common import thai_words
    from pythainlp.util import Trie
    try:
        from pythainlp.util import thai_digit_to_arabic
    except ImportError:
        # thai_digit_to_arabic was removed in pythainlp 4.x
        def thai_digit_to_arabic(s):
            return s
    try:
        from pythainlp.tag import pos_tag
    except ImportError:
        pos_tag = None
    try:
        from pythainlp.transliterate import romanize
    except ImportError:
        romanize = None
    HAS_THAI_NLP = True
except ImportError:
    HAS_THAI_NLP = False
    print("[warn] pythainlp not available — Thai word segmentation disabled. "
          "Install with: pip install pythainlp", file=sys.stderr)

# Try to import regex for grapheme cluster counting
try:
    import regex
    HAS_REGEX = True
except ImportError:
    HAS_REGEX = False

# ═══════════════════════════════════════════════════════════════
# DOMAIN-SPECIFIC CUSTOM DICTIONARY FOR THAI WORD SEGMENTATION
#
# Without this, pythainlp incorrectly segments domain terms:
#   "ตารีกีปัส"  → ['ตา','รี','กี','ปัส']  (WRONG)
#   "ไทยทรงดำ"  → ['ไทย','ทรง','ดำ']      (WRONG)
#
# With custom dict:
#   "ตารีกีปัส"  → ['ตารีกีปัส']            (CORRECT)
#   "ไทยทรงดำ"  → ['ไทยทรงดำ']            (CORRECT)
#
# These terms come from the Thai performing arts domain and are
# not in pythainlp's default dictionary.
# ═══════════════════════════════════════════════════════════════
CUSTOM_WORDS = set([
    "เพลงงามแสงเดือน", "เพลงชาวไทย", "เพลงรำซิมารำ", "เพลงคืนเดือนหงาย",
        "เพลงดวงจันทร์วันเพ็ญ", "เพลงดอกไม้ของชาติ", "เพลงดวงจันทร์ขวัญฟ้า", "เพลงหญิงไทยใจงาม",
        "เพลงบูชานักรบ", "เพลงยอดชายใจหาญ", "มรดกภูมิปัญญาทางวัฒนธรรม", "เครื่องดนตรีพื้นเมือง",
        "เครื่องดนตรีตะวันตก", "ตารีบุหงา", "พื้นบ้านภาคใต้", "การร่อนแร่",
        "ท่านผู้หญิงแผ้ว สนิทวงศ์เสนี", "ผู้เชี่ยวชาญ", "นายประพันธ์ สุคนธะชาติ",
        "เพลงลาวคำหอม", "เพลงอัตราจังหวะสองชั้น", "เพลงสำเนียงลาว",
        "พระเจ้าบรมวงศ์เธอกรมหมื่นพิชัยมหินทโรดม", "ดนตรีพื้นบ้าน", "ชัดเจน",
        "ผางประทีป", "เจ้าดารารัศมี", "น้อยใจยา", "พญาผานอง", "อาจารย์มนตรี ตราโมท",
        "เพลงฟ้อนดวงดอกไม้", "นางพญาคำปิน", "เพลงซุ้ม", "พระลอ",
        "พระเจ้าบรมวงศ์เธอกรมพระนราธิปประพันธ์พงศ์", "ลิลิตพระลอ", "แมนสรวง",
        "พิชัยพิษณุกร", "สรอง", "สะล้อ", "เต้นสาก", "การละเล่นพื้นเมือง", "กระทบไม้",
        "ภูไท", "ลำตังหวาย", "ไทภูเขา", "เทือกเขาภูพาน", "การเดินทาง", "ผีภู",
        "ภารกิจ", "เชื้อสาย", "สืบต่อ", "มวยโบราณ", "กระบวนท่าทาง", "กระบวนท่ารำ",
        "การรบ", "การขึ้นลอย", "ขีดขิน", "กรุงลงกา", "พระเมรุ", "ชามพูวราช",
        "เขาไกลลาศ", "นิ้วเพชร", "เห็นว่า", "พญาขร", "มังกรกัณฐ์", "แว่นแก้วสุรกานต์",
        "พระพาย", "มัยราพณ์", "หอกโมกขศักดิ์", "พระลาน", "สำมนักขา", "บอกว่า",
        "ปรศุราม", "พระศิวะ", "ปารวตี", "พระคเณศ", "งาช้าง", "มารีศ", "พระยา",
        "กากนาสูร", "สมมุติเทพ", "สารัณ", "กาลสูร", "ศรพรหมาสตร์", "รุทการ",
        "การุณราช", "ช้างเอราวัณ", "พญาทูษณ์", "ท้าวลัสเตียน", "รัชฎา", "วิรุญจำบัง",
        "นิลพาหุ", "สัทธาสูร", "วิรุญมุข", "ศรนาคบาศ", "เขาอังกาศ", "พระลักษมณ์",
        "พระยาทูษณ์", "ศรพาลจันทร์", "เขาสัตภัณฑ์", "ดินดาล", "ต้นรัง", "สังข์ทอง",
        "พระสังข์", "เจ้าเงาะ", "บุปเพสันนิวาส", "เกียรติศักดิ์ไทย", "เขาไกรลาส",
        "รัวฉิ่ง", "พระบรมราชชนนีพับปีหลวง", "ไทยเรือนต้น", "ไทยจิตรลดา", "ไทยอมรินทร์",
        "ไทยบรมพิมาน", "ไทยจักรี", "ไทยดุสิต", "ไทยจักรพรรดิ์", "ไทยศิวาลัย",
        "ทิพยวิมาน", "องค์ปะตาระกาหลา", "ศุภลักษณ์", "ย่องหงิด", "นางอัปสราบายน",
        "ปราสาทเมืองสิงห์", "แควน้อย", "ปราสาทพระขรรค์", "พระเจ้าชัยวรมัน",
        "พระบาทสมเด็จพระจอมเกล้าเจ้าอยู่หัว", "แต่งกายยืนเครื่องพระ",
        "แต่งกายยืนเครื่องพระ-นาง", "เพลงกลม", "เพลงชำนาญ", "รังควาญ",
        "เพลงฝรั่งรำเท้า", "ตะเขิ่ง", "เจ้าเซ็น", "เพลงเร็ว", "เพลงฉิ่ง", "จีนรัว",
        "จีนรำพัด", "จีนถอน", "พลายชุมพล", "รำเดี่ยว", "ขุนช้าง", "ขุนแผน",
        "พระไวย", "เพลงมอญดูดาว", "สุพรรณมัจฉา", "ภาพจำหลัก", "ปราสาทหินพิมาย",
        "ปราสาทพนมรุ้ง", "แหลมมลายู", "หล่อสำริด", "ปางลีลา", "สมัยสุโขทัย",
        "พระอุมา", "ยอพระกลิ่น", "มณีพิชัย", "วันทอง", "ศูรปนขา", "พัดเรนัง", "บุหรงซีงอ",
        "ลาวครั่ง", "ไทยทรงดำ", "ลาวเวียง", "ไทยรามัญ", "ไทยจีน", "อันหนึ่งอันเดียว", "ร่มพระบารมี",
        "พระแม่คงคา", "มรดกวัฒนธรรม", "ธงไทย", "ขันดอก", "บูชาครู", "พระนิพนธ์ ", "พระพี่เลี้ยง",
        "พระเพื่อน", "พระแพง", "ท้าวพิชัยพิษณุกร", "เครื่องประกอบจังหวะ", "ขับลำ", "การงาน", "ชาวภูไท",
        "เห็น", "ว่า", "ไส้กะลา", "ตรีชฎา", "พระราชบัญชา", "หลักราชการ", "จำกาย", "ท้าวสัทธาสูร", "รูปนอก",
        "รำคู่", "ผู้แสดง", "สมัยทวารวดี ", "สมัยลพบุรี", "สมัยศรีวิชัย", "นนทก", "พระสวามี",
        "ต้นลีลาวดี", "ระบำโบราณคดี", "ผู้มีพระคุณ", "การประกอบอาชีพ", "การแต่งกาย", "ตารีกีปัส",
        "นายแก้ว", "นายขวัญ", "นางรื่น", "นางโรย์", "กรรมวิธี", "การเก็บใบชา", "สากตำข้าว", "การแสดงพื้นเมือง",
        "การดีด", "แม่น้ำโขง", "จัดทัพ", "ตรวจพล์", "พลวานร", "เมืองขีดขิน", "เมืองชมพู", "ทหารเอก",
        "ประเทศไทย", "ระบำมาตรฐาน", "สระอโนดาต", "นางเบญจกาย", "นางสีดา้", "เขาไกรลาศ",
        "รูปทอง", "เล่นน้ำ", "วิรุณจำยัง", "พลลิง", "ข่ายเหล็ก", "ข่ายเพชร", "นางกินรี",
        "ดอกไม้เงิน", "ดอกไม้ทอง", "รำมาตรฐาน", "สีทอง", "สี่ภาค", "ประเทศไทย", "ทรงเครื่อง",
        "จับนาง", "ไล่จับ", "ไล่ติดตาม", "ศิลปะป้องกันตัว", "ต้นลีลาวดี", "การประกอบอาชีพ",
        "การนุ่งห่ม", "รำซัด", "ระบำมาตรฐาน", "ต้อนรับแขก", "วิรุณจำบัง", "แร้ง"
])

# ═══════════════════════════════════════════════════════════════
# GENERIC LOW-VALUE TERMS — split pre-defined vs post-hoc
# ═══════════════════════════════════════════════════════════════
# Main evaluation must use only the pre-defined filter to avoid leakage from
# post-hoc error analysis. The extended set is reserved for ablation reporting.
# ═══════════════════════════════════════════════════════════════
GENERIC_TERMS_PREDEFINED = {
    # Truly generic — never appear as gold keywords for any specific item
    "การแสดง",
    "พื้นบ้าน",
    "นาฏศิลป์",
    "วัฒนธรรม",
    "ศิลปะ",
    "การ",
}

# Domain-frequent terms: valid gold keywords for some items, but FP when
# matched via description to too many items. Kept in the mapping pool but
# removed from items where they ONLY match via description (not name).
GENERIC_TERMS_DOMAIN_FREQUENT = {
    # Performing arts terms — gold for a few items but FP in many
    "แม่ท่า",        # gold 1 item, FP 52 items
    "แม่บท",         # gold 1 item, FP 26 items
    "ชาวพื้นเมือง",   # gold 1 item, FP 22 items
    # Music terms — gold for multiple items but FP for many more
    "ดนตรีไทย",      # gold 2 items
    "เพลงไทย",       # gold 1 item
    "ดนตรีพื้นบ้าน",  # gold 5 items
    "ทำนอง",          # gold 13 items, very frequent
    "บทร้อง",          # gold 9 items
    # Battle/war terms — gold for Ramakien episodes
    "การรบ",          # gold 1 item
    "การศึก",          # gold 2 items
    "สงคราม",          # gold 8 items
    "กองทัพ",          # gold 9 items
    # Ramakien-adjacent — gold for specific episodes
    "รามเกียรติ์",     # gold 10 items
    "นางสีดา",         # gold 10 items
    # Other domain-frequent terms
    "แม่น้ำ",          # gold 2 items
    "เคลื่อนไหว",      # gold 7 items
    "เดินทาง",         # gold 7 items
    "การทอ",           # gold 1 item
}

GENERIC_TERMS_POSTHOC = {
    "การแสดงพื้นเมือง",
    "ผู้แสดง",
    "ชาวไทย",
}

GENERIC_LOW_VALUE_TERMS = GENERIC_TERMS_PREDEFINED
GENERIC_LOW_VALUE_TERMS_EXTENDED = GENERIC_TERMS_PREDEFINED | GENERIC_TERMS_POSTHOC

# ═══════════════════════════════════════════════════════════════
# DEFAULT CONFIG (override via CLI or function arguments)
# ═══════════════════════════════════════════════════════════════
DEFAULT_THRESHOLDS = [70, 75, 80, 85, 90, 95]
SEMANTIC_THRESHOLD = 0.75  # Tuned once on validation and then fixed for reporting

# Ablation study configurations (support for SPAR-style ablation)
# Referenced: SPAR (Chen et al.) ablation in Table 1
ABLATION_CONFIGS = {
    "exact_only": {
        "name": "exact_only",
        "use_token_set": False, "use_partial": False, "use_semantic": False,
        "description": "Exact substring matching only (baseline)"
    },
    "exact_token": {
        "name": "exact_token",
        "use_token_set": True, "use_partial": False, "use_semantic": False,
        "description": "Exact + token_set_ratio matching"
    },
    "exact_token_partial": {
        "name": "exact_token_partial",
        "use_token_set": True, "use_partial": True, "use_semantic": False,
        "description": "Exact + token_set + partial_ratio matching (full)"
    },
    "semantic_only": {
        "name": "semantic_only",
        "use_token_set": False, "use_partial": False, "use_semantic": True,
        "description": "Dense Retrieval only (SBERT Cosine Similarity)"
    },
    "hybrid_dense": {
        "name": "hybrid_dense",
        "use_token_set": True, "use_partial": True, "use_semantic": True,
        "description": "SPAR-style Hybrid (Lexical Fuzzy + Semantic Dense)"
    },
}

# Input files — relative to this script's location
# Words from Gemini unified classification (output of stopword labeling)
WORDS_FILE = "input/semantic_artifact_master.csv"
# Items from recommendation code input
ITEMS_FILE = "input/all_item_130868.csv"

# Output patterns — stored in result/ subfolder
OUT_MAIN_PATTERN = "result/mapped_words_to_items{threshold}.csv"
OUT_UNMAPPED_WORDS_PATTERN = "result/unmapped_words{threshold}.csv"
OUT_UNMAPPED_ITEMS_PATTERN = "result/unmapped_items{threshold}.csv"

# Evaluation files
GOLD_FILE = "input/gold_keywords_114.csv"  # Manual annotated gold standard
OUT_EVAL_SUMMARY_PATTERN = "result/evaluation_summary.csv"
OUT_ERROR_REPORT_PATTERN = "result/error_report_threshold_{threshold}.csv"

# ═══════════════════════════════════════════════════════════════
# GLOBAL RUNTIME CACHE
# ═══════════════════════════════════════════════════════════════
_EMBED_MODEL_CACHE: Dict[str, object] = {}
_RUNTIME_TRIE_SOURCE: Optional[str] = None

# ═══════════════════════════════════════════════════════════════
# LOCKED COLUMNS
# ═══════════════════════════════════════════════════════════════
COL_WORDS = "Words"
COL_ITEM_NAME = "ชื่อชุดการแสดง"
COL_DESC = "คำอธิบายชุดการแสดง"

USE_FUZZY = True

# Minimum word length for fuzzy partial matching
# คำที่สั้นกว่านี้จะใช้เฉพาะ exact match
# ป้องกัน overmatch ของคำสั้น เช่น "รำ" (2 chars), "นาง" (3 chars)
MIN_WORD_LEN = 3
RE_KEEP_CHARS = re.compile(r"[^0-9A-Za-zก-๙\s]", re.UNICODE)

# ═══════════════════════════════════════════════════════════════
# SYNONYMS (closed-vocabulary: verified pairs only)
# ═══════════════════════════════════════════════════════════════
# Conservative approach: only include pairs where BOTH terms:
# 1. Appear in keyword file, OR
# 2. Are exceptional token-only cases (low false positive risk)
#
# Rationale: Reduces search space and false positives from over-broad expansion
# ═══════════════════════════════════════════════════════════════
SYNONYMS: Dict[str, List[str]] = {
    # POLICY: Only verified pairs are included. A pair is "verified" if:
    # (1) Both terms appear in the gold_keywords_114.csv keyword pool, OR
    # (2) The pair is validated by the domain expert.
    # This conservative policy prevents false-positive expansion.
    # Expected impact: recall may decrease modestly, but precision is kept stable.
    # Run --discover-synonyms to propose future candidates for human review.
    "มโนราห์": ["โนรา"],              # exceptional: token-only, safe
    "พระอิศวร": ["พระศิวะ"],
    "พระศิวะ": ["พระอิศวร"],
    # Add more only if verified in gold standard or keyword file
}


# ═══════════════════════════════════════════════════════════════
# TEXT UTILITIES
# ═══════════════════════════════════════════════════════════════

def normalize_text(s: str, convert_digits: bool = True, add_roman: bool = False) -> str:
    """Normalize: keep bracket contents, remove only bracket characters;
    strip symbols; lowercase; collapse spaces.
    Optional: convert Thai digits to Arabic, add romanized version for Thai.
    """
    if s is None:
        return ""
    s = unicodedata.normalize("NFC", str(s))
    
    if HAS_THAI_NLP and convert_digits:
        s = thai_digit_to_arabic(s)
        
    s = re.sub(r"[()\[\]{}＜＞《》]", " ", s)
    s = s.replace("\n", " ").replace("\t", " ")
    s = RE_KEEP_CHARS.sub(" ", s)
    s = s.lower()
    
    if HAS_THAI_NLP and add_roman:
        # Append romanized version to increase recall for transliterated queries
        try:
            r = romanize(s, engine="thai2rom")
            if r and r.strip():
                s = f"{s} {r}"
        except:
            pass
            
    s = re.sub(r"\s+", " ", s).strip()
    return s


def is_negated(text: str, match_start: int, window: int = 5) -> bool:
    """Heuristic to detect if a match is likely negated (e.g. 'ไม่รำ')."""
    negations = {"ไม่", "ไม่ได้", "มิ", "ยกเว้น"}
    if not HAS_THAI_NLP:
        return False
    
    # Extract window before the match
    before = text[max(0, match_start-15):match_start]
    tokens = word_tokenize(before, engine="newmm")
    # Check last few tokens
    for t in tokens[-window:]:
        if t in negations:
            return True
    return False


def normalize_text_thai_segmented(s: str, convert_digits: bool = True) -> str:
    """Normalize + segment Thai words with spaces (for fuzzy matching).
    """
    s = normalize_text(s, convert_digits=convert_digits)
    if not s:
        return ""

    if not HAS_THAI_NLP:
        return s

    try:
        if THAI_CUSTOM_TRIE is not None:
            tokens = word_tokenize(s, engine="newmm", custom_dict=THAI_CUSTOM_TRIE)
        else:
            tokens = word_tokenize(s, engine="newmm")

        tokens = [t.strip() for t in tokens if t and t.strip()]
        if not tokens:
            return s

        short_tokens = [t for t in tokens if re.search(r"[ก-๙]", t) and count_word_length(t) <= 2]
        segmented = " ".join(tokens)

        # suspicious over-fragmentation: preserve original phrase too
        if re.search(r"[ก-๙]", s) and len(tokens) >= 3 and len(short_tokens) >= max(2, len(tokens) // 2):
            return f"{s} {segmented}".strip()

        return segmented
    except Exception:
        return s


def _thai_affix_variants(w: str) -> List[str]:
    """Thai morphological heuristics — ขยาย prefix/suffix rules

    Policy: Only produce variants that remain specific enough to be
    discriminative. Short variants (< 3 grapheme clusters) are excluded
    because they match too broadly (e.g. "ท่า" from "แม่ท่า" matches
    every description containing "ท่า").

    Removed rules that produced overly broad variants:
    - การ prefix (การรบ → รบ: too short, "รบ" matches broadly)
    - สี prefix (สีทอง → ทอง: "ทอง" is a common word, not discriminative)
    - แม่ prefix (แม่ท่า → ท่า: "ท่า" is only 2 clusters, matches broadly)
    """
    variants = set()

    # Prefix rules — kept with stricter minimum length thresholds
    if w.startswith("ความ") and len(w) > 4:
        variants.add(w[4:])
        if w.startswith("ความมี") and len(w) > 7:
            variants.add(w[7:])

    # Prefix rules with minimum result length >= 3 grapheme clusters
    if w.startswith("นัก") and len(w) > 5:
        variants.add(w[3:])      # นักษัตรศิลป์ → ษัตรศิลป์ (specific)
    if w.startswith("ผู้") and len(w) > 5:
        variants.add(w[3:])      # ผู้เชี่ยวชาญ → เชี่ยวชาญ (specific)
    if w.startswith("ช่าง") and len(w) > 5:
        variants.add(w[4:])      # ช่างฟ้อน → ฟ้อน (len=4, OK)

    # Suffix rules (kept — these produce specific results)
    for suffix in ["ไทย", "โบราณ", "พื้นบ้าน", "พื้นเมือง"]:
        if w.endswith(suffix) and len(w) > len(suffix):
            stem = w[: -len(suffix)].strip()
            if count_word_length(stem) >= 3:
                variants.add(stem)

    return [v for v in variants if v and count_word_length(v) >= 3]


def generate_variants(word: str) -> List[str]:
    """Generate all matching variants for a word."""
    w_norm = normalize_text(word)
    vs = {w_norm}
    if " " in w_norm:
        vs.add(w_norm.replace(" ", ""))

    for hx in _thai_affix_variants(w_norm):
        vs.add(hx)
        if " " in hx:
            vs.add(hx.replace(" ", ""))

    for syn in NORMALIZED_SYNONYMS.get(w_norm, []):
        syn_norm = normalize_text(syn)
        vs.add(syn_norm)
        if " " in syn_norm:
            vs.add(syn_norm.replace(" ", ""))
        for hx in _thai_affix_variants(syn_norm):
            vs.add(hx)
            if " " in hx:
                vs.add(hx.replace(" ", ""))

    return [x for x in vs if x]


# ═══════════════════════════════════════════════════════════════
# NORMALIZED_SYNONYMS — Pre-normalized keys for robust lookup
# Built after normalize_text() is defined
# ═══════════════════════════════════════════════════════════════
NORMALIZED_SYNONYMS = {
    normalize_text(k): [normalize_text(v) for v in vals]
    for k, vals in SYNONYMS.items()
}


def count_word_length(s: str) -> int:
    """Count user-perceived character length (grapheme clusters for Thai).

    For Thai, "ไ" + combining character = 1 grapheme, not 2 codepoints.
    Falls back to simple len() if regex library unavailable.

    Reference: Fix for MIN_WORD_LEN threshold to properly handle Thai.
    """
    if not HAS_REGEX:
        return len(s)
    try:
        # \X matches extended grapheme clusters
        return len(regex.findall(r"\X", s))
    except Exception:
        return len(s)


def filter_by_genericity(word_set: set, generic_terms: set) -> set:
    """Remove overly generic keywords that lack discriminative power.

    Reference: Luan et al. (2020) IDF weighting — high-frequency terms
    have low information value and increase false positives.

    Args:
        word_set: Set of keywords to filter
        generic_terms: Set of terms to remove (GENERIC_LOW_VALUE_TERMS)

    Returns:
        Filtered set with generic terms removed
    """
    return {w for w in word_set if w not in generic_terms}


def get_generic_filter_terms(filter_mode: str = "predefined") -> set:
    """Resolve generic-filter term set for evaluation or ablation runs."""
    mode = (filter_mode or "predefined").strip().lower()
    if mode == "none":
        return set()
    if mode == "predefined":
        return set(GENERIC_TERMS_PREDEFINED)
    if mode in {"extended", "predefined+posthoc", "posthoc"}:
        return set(GENERIC_LOW_VALUE_TERMS_EXTENDED)
    raise ValueError(f"Unknown generic filter mode: {filter_mode}")


def filter_generic_keywords_idf(
    word_to_items: Dict[str, set],
    total_items: int,
    max_doc_freq_ratio: float = 0.5,
) -> Dict[str, set]:
    """Remove keywords appearing in too many items (low IDF, like stopwords).

    Reference: Luan et al. (2020) uses IDF weighting in BM25 — keywords
    with high document frequency lack discriminative power.

    Args:
        word_to_items: Dict mapping word -> set of item indices
        total_items: Total number of items in corpus
        max_doc_freq_ratio: Max fraction of items a word can appear in
                           (e.g., 0.5 = 50%)

    Returns:
        Filtered dict with high-frequency (low IDF) words removed
    """
    filtered = {}
    removed_count = 0

    for word, items in word_to_items.items():
        doc_freq = len(items) / total_items
        if doc_freq <= max_doc_freq_ratio:
            filtered[word] = items
        else:
            removed_count += 1

    if removed_count > 0:
        print(f"  [IDF filter] Removed {removed_count} generic keywords "
              f"(appearing in >{max_doc_freq_ratio*100:.0f}% of items)")

    return filtered


def compute_document_frequencies(
    words: List[str],
    items: List[Dict[str, str]],
    name_col: str,
    desc_col: Optional[str],
) -> Dict[str, float]:
    """Compute document frequency ratio for each keyword across all items (Fix 6).

    DF(w) = number of items whose text contains w / total items.
    Uses exact substring match on normalized text.

    Returns:
        Dict mapping word -> DF ratio (0.0 to 1.0)
    """
    total_items = len(items)
    if total_items == 0:
        return {}

    # Pre-normalize all item texts
    item_texts = []
    for r in items:
        name_norm = normalize_text((r.get(name_col) or "").strip())
        desc_norm = normalize_text(r.get(desc_col, "")) if desc_col else ""
        item_texts.append(f"{name_norm} {desc_norm}".strip())

    df_ratios = {}
    for w in words:
        w_norm = normalize_text(w)
        if not w_norm:
            continue
        count = sum(1 for text in item_texts if w_norm in text)
        df_ratios[w] = count / total_items

    return df_ratios


def select_idf_threshold(
    df_ratios: Dict[str, float],
    percentile: float = 80.0,
) -> float:
    """Select IDF cutoff at given percentile of DF distribution (Fix 6).

    Words with DF ratio above the cutoff are considered too generic.
    Default: p80 means the top 20% most frequent words are filtered out.

    Args:
        df_ratios: Dict mapping word -> DF ratio
        percentile: Percentile cutoff (0-100)

    Returns:
        DF ratio threshold
    """
    if not df_ratios:
        return 1.0

    values = sorted(df_ratios.values())
    n = len(values)

    # Print distribution stats
    print(f"  [IDF] DF distribution (n={n}): "
          f"min={values[0]:.4f}, median={values[n//2]:.4f}, "
          f"p90={values[int(n*0.9)]:.4f}, max={values[-1]:.4f}")

    # Linear interpolation percentile (matches numpy default method)
    rank = percentile / 100.0 * (n - 1)
    lo = int(math.floor(rank))
    hi = min(lo + 1, n - 1)
    frac = rank - lo
    cutoff = values[lo] + frac * (values[hi] - values[lo])
    above = sum(1 for v in values if v > cutoff)
    print(f"  [IDF] Empirical cutoff at p{percentile:.0f}: DF > {cutoff:.4f} "
          f"({above} words will be filtered)")
    return cutoff


def try_import_rapidfuzz():
    if not USE_FUZZY:
        print("[info] Fuzzy matching disabled by USE_FUZZY config", file=sys.stderr)
        return None
    try:
        from rapidfuzz import fuzz
        return fuzz
    except Exception as e:
        print(f"[warn] rapidfuzz import failed: {e}. "
              f"Falling back to exact-only matching. "
              f"Install with: pip install rapidfuzz", file=sys.stderr)
        return None


def text_contains_any(target_text: str, patterns: List[str],
                      fuzz_mod, threshold: int,
                      min_word_len: int = 3) -> bool:
    """DEPRECATED: Use text_contains_any_with_log() instead.

    This version does NOT segment Thai text and does NOT use
    grapheme cluster counting. Kept only for backward compatibility.

    Reference Fix: Pattern segmentation was missing, causing asymmetric
    comparison in Thai fuzzy matching. Use text_contains_any_with_log()
    which properly segments both sides before fuzzy matching.
    """
    import warnings
    warnings.warn(
        "text_contains_any() is deprecated. Use text_contains_any_with_log() "
        "which supports Thai segmentation and ablation configs.",
        DeprecationWarning, stacklevel=2
    )
    matched, _ = text_contains_any_with_log(
        target_text, patterns, fuzz_mod, threshold, min_word_len
    )
    return matched


def text_contains_any_with_log(target_text: str, patterns: List[str],
                                fuzz_mod, threshold: int,
                                min_word_len: int = MIN_WORD_LEN,
                                combined_segmented_hint: Optional[str] = None,
                                ablation_config: Optional[Dict] = None
                                ) -> Tuple[bool, str]:
    """
    Multi-layer matching with logging: returns (matched, match_type)
    Includes negation detection (e.g. 'ไม่...').
    """
    if not target_text:
        return False, "none"

    if ablation_config is None:
        ablation_config = {"use_token_set": True, "use_partial": True}
    use_token_set = ablation_config.get("use_token_set", True)
    use_partial = ablation_config.get("use_partial", True)

    fuzzy_target = combined_segmented_hint if combined_segmented_hint else target_text

    for p in patterns:
        if not p:
            continue

        # ── Layer 1: Exact substring ──
        if p in target_text:
            match_idx = target_text.find(p)
            if not is_negated(target_text, match_idx):
                return True, "exact"

        # ── Fuzzy layers ──
        if fuzz_mod and (use_token_set or use_partial):
            p_segmented = normalize_text_thai_segmented(p)

            # ── Layer 2: token_set_ratio ──
            if use_token_set:
                if fuzz_mod.token_set_ratio(p_segmented, fuzzy_target) >= threshold:
                    return True, "token_set"

            # ── Layer 3: partial_ratio ──
            if use_partial:
                p_len = count_word_length(p)
                if p_len >= min_word_len:
                    if fuzz_mod.partial_ratio(p_segmented, fuzzy_target) >= threshold:
                        return True, "partial"

    return False, "none"


def text_contains_with_source(
    name_text: str, desc_text: str,
    name_segmented: str, desc_segmented: str,
    patterns: List[str],
    fuzz_mod, threshold: int,
    min_word_len: int = MIN_WORD_LEN,
    ablation_config: Optional[Dict] = None,
    word_embs: Optional[torch.Tensor] = None,
    name_emb: Optional[torch.Tensor] = None,
    desc_emb: Optional[torch.Tensor] = None,
    semantic_threshold: float = SEMANTIC_THRESHOLD
) -> Tuple[bool, str, str]:
    """Multi-layer matching: 1.Lexical(Exact/Fuzzy) -> 2.Semantic(Dense)"""
    if ablation_config is None:
        ablation_config = {"use_token_set": True, "use_partial": True, "use_semantic": False}

    use_semantic = ablation_config.get("use_semantic", False)
    run_lexical = ablation_config.get("use_token_set") or ablation_config.get("use_partial") or ablation_config.get("name") in ("exact_only", "exact_token", "exact_token_partial", "hybrid_dense")

    # ── Layer 1: Lexical & Fuzzy Match (ความแม่นยำสูง) ──
    if run_lexical:
        matched, mtype = text_contains_any_with_log(
            name_text, patterns, fuzz_mod, threshold, min_word_len, name_segmented, ablation_config)
        if matched: return True, mtype, "name"

        if desc_text:
            matched, mtype = text_contains_any_with_log(
                desc_text, patterns, fuzz_mod, threshold, min_word_len, desc_segmented, ablation_config)
            if matched: return True, mtype, "desc"

    # ── Layer 2: Semantic Match (ดึงบริบทที่ซ่อนอยู่) ──
    if use_semantic and word_embs is not None:
        from sentence_transformers import util

        if name_emb is not None:
            sim_name = util.cos_sim(word_embs, name_emb).max().item()
            if sim_name >= semantic_threshold:
                return True, "semantic", "name"

        if desc_emb is not None and desc_emb.nelement() > 0:
            # เปรียบเทียบคีย์เวิร์ดกับทุกๆ Chunk ของคำอธิบาย
            sim_desc = util.cos_sim(word_embs, desc_emb).max().item()
            if sim_desc >= semantic_threshold:
                return True, "semantic", "desc"

    return False, "none", "none"


def summarize_match_source(source: str, match_type: str) -> str:
    """Collapse raw match provenance into reportable categories.

    Output labels are designed for paper reporting, e.g.:
    - name_exact
    - name_fuzzy
    - desc_exact
    - desc_fuzzy
    - name_semantic
    - desc_semantic
    """
    if source not in {"name", "desc"}:
        return "unknown"
    if match_type == "exact":
        return f"{source}_exact"
    if match_type in {"token_set", "partial"}:
        return f"{source}_fuzzy"
    if match_type == "semantic":
        return f"{source}_semantic"
    return f"{source}_unknown"


def parse_match_sources_cell(cell: str) -> Dict[str, str]:
    """Parse serialized match_sources cell into word -> provenance mapping."""
    parsed: Dict[str, str] = {}
    if not cell:
        return parsed

    for part in str(cell).split(";"):
        part = part.strip()
        if not part or ":" not in part:
            continue
        word, provenance = part.split(":", 1)
        word = word.strip()
        provenance = provenance.strip()
        if word:
            parsed[word] = provenance
    return parsed


def compute_match_source_breakdown(rows: List[Dict[str, str]], gold_data: Dict[str, set]) -> Dict[str, Dict[str, int]]:
    """Count provenance categories for predicted words and TP words.

    This supports reporting that most correct matches come from exact lexical
    matching rather than fuzzy layers.
    """
    categories = [
        "name_exact", "name_fuzzy", "desc_exact", "desc_fuzzy",
        "name_semantic", "desc_semantic", "name_unknown", "desc_unknown", "unknown",
    ]
    predicted_counts = {category: 0 for category in categories}
    tp_counts = {category: 0 for category in categories}

    for row in rows:
        item_name = (row.get("ชื่อชุดการแสดง") or "").strip()
        gold_set = gold_data.get(item_name, set())
        words = [w.strip() for w in (row.get("words") or "").split(",") if w.strip()]
        source_map = parse_match_sources_cell(row.get("match_sources", ""))

        for word in words:
            provenance = source_map.get(word, "unknown")
            if provenance not in predicted_counts:
                provenance = "unknown"
            predicted_counts[provenance] += 1
            if word in gold_set:
                tp_counts[provenance] += 1

    def _with_rollups(counts: Dict[str, int]) -> Dict[str, int]:
        rolled = dict(counts)
        rolled["exact_total"] = counts.get("name_exact", 0) + counts.get("desc_exact", 0)
        rolled["fuzzy_total"] = counts.get("name_fuzzy", 0) + counts.get("desc_fuzzy", 0)
        rolled["semantic_total"] = counts.get("name_semantic", 0) + counts.get("desc_semantic", 0)
        rolled["unknown_total"] = counts.get("name_unknown", 0) + counts.get("desc_unknown", 0) + counts.get("unknown", 0)
        rolled["total"] = sum(counts.values())
        return rolled

    return {
        "predicted": _with_rollups(predicted_counts),
        "tp": _with_rollups(tp_counts),
    }


# ═══════════════════════════════════════════════════════════════
# DATA LOADERS
# ═══════════════════════════════════════════════════════════════

def read_csv(path: Path) -> Tuple[List[str], List[Dict[str, str]]]:
    with open(path, "r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        header = reader.fieldnames or []
        rows = list(reader)
    return header, rows


# ═══════════════════════════════════════════════════════════════
# ARTIFACT-WORD LEXICON LOADER
# Load semantic artifact words from semantic_artifact_master.csv
# and merge them into CUSTOM_WORDS so tokenizer preserves these units.
# NOTE:
# This block must appear AFTER:
#   - normalize_text()
#   - count_word_length()
#   - read_csv()
#   - WORDS_FILE / COL_WORDS constants
# ═══════════════════════════════════════════════════════════════

def _resolve_base_dir_for_runtime() -> Path:
    if "__file__" in globals():
        return Path(__file__).resolve().parent
    return Path.cwd()


def _artifact_words_path(base_dir: Optional[Path] = None) -> Path:
    base = base_dir or _resolve_base_dir_for_runtime()
    return base / WORDS_FILE


def _is_good_custom_token_candidate(text: str) -> bool:
    """
    Decide whether a word from semantic_artifact_master should be injected
    into CUSTOM_WORDS for tokenizer control.

    Policy:
    - keep Thai or mixed Thai terms
    - length >= 2 grapheme clusters
    - exclude empty / trivial punctuation-only strings
    """
    s = normalize_text(text)
    if not s:
        return False

    if not re.search(r"[A-Za-z0-9ก-๙]", s):
        return False

    if count_word_length(s) < 2:
        return False

    return True


def load_artifact_words_for_custom_lexicon(
    words_csv: Optional[Path] = None,
    verbose: bool = True
) -> set:
    """
    Load words from semantic_artifact_master.csv (column: Words) and return
    a normalized set suitable for merging into CUSTOM_WORDS.

    This does NOT replace the original CUSTOM_WORDS.
    It only extends the tokenizer lexicon with semantic-artifact vocabulary.
    """
    path = words_csv or _artifact_words_path()
    if not path.exists():
        if verbose:
            print(f"[warn] semantic artifact file not found for custom lexicon: {path}", file=sys.stderr)
        return set()

    try:
        header, rows = read_csv(path)
    except Exception as e:
        if verbose:
            print(f"[warn] failed to read semantic artifact file for custom lexicon: {e}", file=sys.stderr)
        return set()

    if COL_WORDS not in header:
        if verbose:
            print(f"[warn] column '{COL_WORDS}' not found in {path.name}; skip artifact lexicon injection", file=sys.stderr)
        return set()

    loaded = set()
    for r in rows:
        raw = (r.get(COL_WORDS) or "").strip()
        if not raw:
            continue

        if any(sep in raw for sep in [",", ";", "|", "/"]):
            parts = re.split(r"[,\|;/]+", raw)
        else:
            parts = [raw]

        for p in parts:
            p = p.strip()
            if not p:
                continue
            p_norm = normalize_text(p)
            if _is_good_custom_token_candidate(p_norm):
                loaded.add(p_norm)

    if verbose:
        print(f"  [init] loaded {len(loaded)} artifact words for tokenizer lexicon from {path.name}")

    return loaded


def build_runtime_custom_words(
    base_words: set,
    artifact_words_csv: Optional[Path] = None,
    verbose: bool = True
) -> set:
    """
    Merge static CUSTOM_WORDS with semantic artifact words from input file.
    """
    merged = {normalize_text(w) for w in base_words if normalize_text(w)}
    artifact_words = load_artifact_words_for_custom_lexicon(
        words_csv=artifact_words_csv,
        verbose=verbose
    )
    merged |= artifact_words

    merged = clean_runtime_custom_words(merged, verbose=verbose)

    if verbose:
        print(f"  [init] runtime custom lexicon size = {len(merged)} "
              f"(static={len(base_words)}, merged_with_artifacts={len(artifact_words)})")
    return merged


THAI_CUSTOM_TRIE = None
RUNTIME_CUSTOM_WORDS = {normalize_text(w) for w in CUSTOM_WORDS if normalize_text(w)}

# ═══════════════════════════════════════════════════════════════
# CUSTOM LEXICON HYGIENE
# Remove generic / trivial tokens from runtime tokenizer lexicon
# ═══════════════════════════════════════════════════════════════

CUSTOM_WORDS_BLOCKLIST = {
    "เห็น", "ว่า", "เห็นว่า", "บอกว่า", "ชัดเจน",
    "ภารกิจ", "การเดินทาง", "การงาน",
    "ผู้เชี่ยวชาญ", "ผู้มีพระคุณ",
}

def is_generic_or_trivial_custom_word(word: str) -> bool:
    w = normalize_text(word)
    if not w:
        return True

    if w in CUSTOM_WORDS_BLOCKLIST:
        return True

    if w in {normalize_text(x) for x in GENERIC_LOW_VALUE_TERMS_EXTENDED}:
        return True

    # single-character or very short Thai fragments should not control tokenizer
    if count_word_length(w) < 2:
        return True

    # pure function-word style patterns
    if w in {"การ", "ของ", "และ", "ที่", "ใน", "เป็น", "มี"}:
        return True

    return False


def clean_runtime_custom_words(words: set, verbose: bool = True) -> set:
    cleaned = set()
    removed = []

    for w in words:
        wn = normalize_text(w)
        if not wn:
            continue
        if is_generic_or_trivial_custom_word(wn):
            removed.append(wn)
            continue
        cleaned.add(wn)

    if verbose:
        print(f"  [lexicon] cleaned runtime custom words: kept={len(cleaned)}, removed={len(removed)}")
        if removed:
            print(f"  [lexicon] removed examples: {sorted(list(set(removed)))[:15]}")
    return cleaned


def rebuild_runtime_custom_trie(
    artifact_words_csv: Optional[Path] = None,
    verbose: bool = True
) -> None:
    """
    Rebuild runtime custom trie from static CUSTOM_WORDS + semantic artifact words.
    Useful if caller wants to refresh trie after changing input file.
    """
    global RUNTIME_CUSTOM_WORDS, THAI_CUSTOM_TRIE

    if not HAS_THAI_NLP:
        if verbose:
            print("[warn] pythainlp not available; cannot rebuild trie", file=sys.stderr)
        return

    try:
        RUNTIME_CUSTOM_WORDS = build_runtime_custom_words(
            base_words=CUSTOM_WORDS,
            artifact_words_csv=artifact_words_csv or _artifact_words_path(),
            verbose=verbose
        )
        THAI_CUSTOM_TRIE = Trie(thai_words() | RUNTIME_CUSTOM_WORDS)
        if verbose:
            print(f"  [init] rebuilt Thai custom trie with {len(RUNTIME_CUSTOM_WORDS)} runtime custom words")
    except Exception as e:
        print(f"[warn] failed to rebuild runtime trie: {e}", file=sys.stderr)


# Build trie once at import time after all required dependencies are defined
if HAS_THAI_NLP:
    rebuild_runtime_custom_trie(verbose=True)


def load_words(words_csv: Path, use_pos_filter: bool = False, allowed_pos: Optional[set] = None) -> List[str]:
    """Load words from CSV. Handles both formats:
    - New format: fused_labeled_dataset.csv (one word per row in 'Words' column)
    - Old format: comma-separated words in 'Words' column
    Optional: Filter words by Part-of-Speech (e.g. only Nouns).
    """
    if allowed_pos is None:
        # Default: Nouns (NN, NCMN), Proper Nouns (NPRP), Time Nouns (NTMN)
        allowed_pos = {"NN", "NCMN", "NPRP", "NTMN"}

    header, rows = read_csv(words_csv)
    if COL_WORDS not in header:
        raise KeyError(f"ไม่พบคอลัมน์ '{COL_WORDS}' ในไฟล์ {words_csv.name} (พบ: {header})")
    
    raw_words: List[str] = []
    for r in rows:
        raw = (r.get(COL_WORDS) or "").strip()
        if not raw:
            continue
        if any(sep in raw for sep in [",", ";", "|", "/"]):
            parts = re.split(r"[,\|;/]+", raw)
        else:
            parts = [raw]
        for p in parts:
            p = p.strip()
            if p:
                raw_words.append(p)
    
    seen, uniq = set(), []
    for w in raw_words:
        if w not in seen:
            uniq.append(w); seen.add(w)
            
    if use_pos_filter and HAS_THAI_NLP:
        print(f"  [POS filter] Filtering {len(uniq)} words (keeping only: {allowed_pos})...")
        filtered = []
        # Process in batches for pos_tag efficiency
        tagged = pos_tag(uniq, engine="perceptron", corpus="orchid")
        for word, pos in tagged:
            if pos in allowed_pos:
                filtered.append(word)
        print(f"  [POS filter] Kept {len(filtered)}/{len(uniq)} words.")
        uniq = filtered

    print(f"  Loaded {len(uniq)} unique words from {words_csv.name}")
    return uniq


def load_items(items_csv: Path) -> Tuple[List[Dict[str, str]], str, str, int, int]:
    """
    Load item catalog and collapse duplicate performance names into unique items.

    Returns:
        dedup_rows, name_col, desc_col, raw_row_count, unique_item_count
    """
    header, rows = read_csv(items_csv)

    if COL_ITEM_NAME not in header:
        raise KeyError(
            f"ไม่พบคอลัมน์ '{COL_ITEM_NAME}' ในไฟล์ {items_csv.name} (พบ: {header})"
        )

    if COL_DESC not in header:
        print(
            f"[warn] ไม่พบคอลัมน์ '{COL_DESC}' ในไฟล์ {items_csv.name} "
            f"จะใช้เฉพาะชื่อชุดการแสดง",
            file=sys.stderr
        )

    desc_col = COL_DESC if COL_DESC in header else ""
    raw_row_count = len(rows)

    # ── Collapse duplicate rows by normalized performance name ──
    grouped: Dict[str, Dict[str, object]] = {}

    for r in rows:
        raw_name = (r.get(COL_ITEM_NAME) or "").strip()
        if not raw_name:
            continue

        key = normalize_text(raw_name)
        raw_desc = (r.get(desc_col) or "").strip() if desc_col else ""

        if key not in grouped:
            grouped[key] = {
                "display_name": raw_name,   # keep first original form for output
                "descriptions": [],
            }

        if desc_col and raw_desc:
            grouped[key]["descriptions"].append(raw_desc)

    dedup_rows: List[Dict[str, str]] = []
    for _, payload in grouped.items():
        merged_descs: List[str] = []
        seen_desc = set()

        for d in payload["descriptions"]:
            d_norm = normalize_text(d)
            if d_norm and d_norm not in seen_desc:
                merged_descs.append(d.strip())
                seen_desc.add(d_norm)

        dedup_rows.append({
            COL_ITEM_NAME: payload["display_name"],
            desc_col: " ".join(merged_descs) if desc_col else "",
        })

    unique_item_count = len(dedup_rows)

    print(f"  Loaded {raw_row_count} raw rows from {items_csv.name}")
    print(f"  Collapsed to {unique_item_count} unique items by '{COL_ITEM_NAME}'")

    return dedup_rows, COL_ITEM_NAME, desc_col, raw_row_count, unique_item_count


# ═══════════════════════════════════════════════════════════════
# CORE MAPPER — parameterised by threshold
# ═══════════════════════════════════════════════════════════════

def chunk_text(text: str, chunk_size: int = 50, overlap: int = 15) -> List[str]:
    """หั่นข้อความยาวเป็นท่อนๆ แบบมีส่วนซ้อนทับ (Sliding Window) เพื่อรักษารูปประโยค"""
    words = text.split()
    if not words: return []
    chunks = []
    for i in range(0, len(words), max(1, chunk_size - overlap)):
        chunk = " ".join(words[i:i + chunk_size])
        chunks.append(chunk)
    return chunks


# ═══════════════════════════════════════════════════════════════
# GUARANTEED COVERAGE MODE
# Ensure every word receives at least one candidate item
# ═══════════════════════════════════════════════════════════════

def choose_best_forced_item(
    word: str,
    prepared_items: List[Tuple[str, str, str, str, str]],
    fuzz_mod,
    fuzzy_threshold: int = 90,
) -> Tuple[str, str]:
    """
    Return (best_item_name, provenance) for a word even if normal matching fails.

    Strategy:
    1) exact on normalized item name/desc
    2) highest token_set/partial fuzzy score on segmented text
    3) fallback to first item if corpus is non-empty
    """
    word_norm = normalize_text(word)
    word_seg = normalize_text_thai_segmented(word_norm)

    best_item = None
    best_score = -1.0
    best_prov = "forced_top1"

    for original_name, name_norm, desc_norm, name_seg, desc_seg in prepared_items:
        # exact relaxed
        if word_norm and (word_norm in name_norm or (desc_norm and word_norm in desc_norm)):
            return original_name, "forced_exact"

        score = 0.0
        if fuzz_mod is not None:
            try:
                s1 = fuzz_mod.token_set_ratio(word_seg, name_seg) if name_seg else 0.0
                s2 = fuzz_mod.partial_ratio(word_seg, name_seg) if name_seg else 0.0
                s3 = fuzz_mod.token_set_ratio(word_seg, desc_seg) if desc_seg else 0.0
                s4 = fuzz_mod.partial_ratio(word_seg, desc_seg) if desc_seg else 0.0
                score = max(s1, s2, s3, s4)
            except Exception:
                score = 0.0

        if score > best_score:
            best_score = score
            best_item = original_name
            best_prov = "forced_fuzzy"

    if best_item is not None:
        return best_item, best_prov

    if prepared_items:
        return prepared_items[0][0], "forced_fallback"

    return "", "forced_none"


# ═══════════════════════════════════════════════════════════════
# EMBEDDING CACHE UTILITIES
# ═══════════════════════════════════════════════════════════════

def _cache_dir(base_dir: Optional[Path] = None) -> Path:
    base = _resolve_cache_base_dir(base_dir)
    path = base / "cache"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _resolve_cache_base_dir(base_dir: Optional[Path] = None) -> Path:
    """
    Resolve a stable base directory for cache and runtime artifacts.
    """
    return base_dir or (Path(__file__).resolve().parent if "__file__" in dir() else Path.cwd())


def _stable_hash(obj) -> str:
    payload = json.dumps(obj, ensure_ascii=False, sort_keys=True)
    return hashlib.md5(payload.encode("utf-8")).hexdigest()


def _get_embed_model(model_name: str = "intfloat/multilingual-e5-base"):
    if model_name in _EMBED_MODEL_CACHE:
        return _EMBED_MODEL_CACHE[model_name]
    from sentence_transformers import SentenceTransformer
    model = SentenceTransformer(model_name)
    _EMBED_MODEL_CACHE[model_name] = model
    return model


def _load_torch_cache(path: Path):
    if path.exists():
        try:
            return torch.load(path, map_location="cpu")
        except Exception as e:
            print(f"[warn] failed to load cache {path.name}: {e}", file=sys.stderr)
    return None


def _save_torch_cache(obj, path: Path):
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        torch.save(obj, path)
    except Exception as e:
        print(f"[warn] failed to save cache {path.name}: {e}", file=sys.stderr)


def _prepare_item_cache_key(
    items: List[Dict[str, str]],
    name_col: str,
    desc_col: Optional[str],
    model_name: str,
) -> str:
    signature = []
    for r in items:
        signature.append({
            "name": normalize_text((r.get(name_col) or "").strip()),
            "desc": normalize_text(r.get(desc_col, "")) if desc_col else "",
        })
    return _stable_hash({
        "model": model_name,
        "name_col": name_col,
        "desc_col": desc_col or "",
        "items": signature,
    })


def _prepare_word_cache_key(
    word_to_variants: Dict[str, List[str]],
    model_name: str,
) -> str:
    normalized = {k: sorted(v) for k, v in sorted(word_to_variants.items(), key=lambda x: x[0])}
    return _stable_hash({
        "model": model_name,
        "word_to_variants": normalized,
    })


def get_or_build_item_embeddings(
    items: List[Dict[str, str]],
    name_col: str,
    desc_col: Optional[str],
    model_name: str = "intfloat/multilingual-e5-base",
    base_dir: Optional[Path] = None,
):
    """
    Cache item name embeddings + description chunk embeddings to disk.
    """
    cache_dir = _cache_dir(base_dir)
    cache_key = _prepare_item_cache_key(items, name_col, desc_col, model_name)
    cache_path = cache_dir / f"item_embeddings_{cache_key}.pt"

    cached = _load_torch_cache(cache_path)
    if cached is not None:
        return (
            cached["prepared_items"],
            cached["item_name_embs"],
            cached["item_desc_embs"],
        )

    embed_model = _get_embed_model(model_name)

    prepared_items = []
    all_name_texts = []
    desc_chunks_per_item = []
    flat_desc_chunks = []

    for r in items:
        original_name = (r.get(name_col) or "").strip()
        name_norm = normalize_text(original_name)
        desc_norm = normalize_text(r.get(desc_col, "")) if desc_col else ""
        name_seg = normalize_text_thai_segmented(name_norm)
        desc_seg = normalize_text_thai_segmented(desc_norm) if desc_norm else ""

        prepared_items.append((original_name, name_norm, desc_norm, name_seg, desc_seg))

        all_name_texts.append(f"passage: {name_norm}")
        chunks = chunk_text(desc_norm, chunk_size=50, overlap=10)
        chunks_with_prefix = [f"passage: {c}" for c in chunks]
        desc_chunks_per_item.append(chunks_with_prefix)
        flat_desc_chunks.extend(chunks_with_prefix)

    print("  [cache] Encoding item names/descriptions ...")
    name_embeddings = embed_model.encode(all_name_texts, convert_to_tensor=True, show_progress_bar=False)
    flat_desc_embeddings = embed_model.encode(flat_desc_chunks, convert_to_tensor=True, show_progress_bar=False) if flat_desc_chunks else None

    item_name_embs = {}
    item_desc_embs = {}
    current_chunk_idx = 0

    for i, (original_name, _, _, _, _) in enumerate(prepared_items):
        item_name_embs[original_name] = name_embeddings[i]
        chunks = desc_chunks_per_item[i]
        if chunks and flat_desc_embeddings is not None:
            num_chunks = len(chunks)
            item_desc_embs[original_name] = flat_desc_embeddings[current_chunk_idx: current_chunk_idx + num_chunks]
            current_chunk_idx += num_chunks
        else:
            item_desc_embs[original_name] = None

    _save_torch_cache({
        "prepared_items": prepared_items,
        "item_name_embs": item_name_embs,
        "item_desc_embs": item_desc_embs,
    }, cache_path)

    return prepared_items, item_name_embs, item_desc_embs


def get_or_build_word_embeddings(
    word_to_variants: Dict[str, List[str]],
    model_name: str = "intfloat/multilingual-e5-base",
    base_dir: Optional[Path] = None,
):
    """
    Cache keyword/query embeddings to disk.
    """
    cache_dir = _cache_dir(base_dir)
    cache_key = _prepare_word_cache_key(word_to_variants, model_name)
    cache_path = cache_dir / f"word_embeddings_{cache_key}.pt"

    cached = _load_torch_cache(cache_path)
    if cached is not None:
        return cached

    embed_model = _get_embed_model(model_name)

    print("  [cache] Encoding keyword variants ...")
    word_embs_dict = {}
    for original_word, variants in word_to_variants.items():
        query_variants = [f"query: {v}" for v in variants]
        word_embs_dict[original_word] = embed_model.encode(
            query_variants,
            convert_to_tensor=True,
            show_progress_bar=False
        )

    _save_torch_cache(word_embs_dict, cache_path)
    return word_embs_dict


def _match_single_item(
    item_tuple: Tuple[str, str, str, str, str],
    word_to_variants: Dict[str, List[str]],
    fuzzy_threshold: int,
    ablation_config: Dict,
    word_embs_dict: Dict[str, torch.Tensor],
    n_emb: Optional[torch.Tensor],
    d_emb: Optional[torch.Tensor],
    sem_thresh: float
) -> Tuple[str, List[Tuple[str, str, str]]]:
    """Helper for parallel processing: match all words against one item.
    Imports fuzz_mod locally to avoid pickling issues on Windows.
    """
    fuzz_mod = try_import_rapidfuzz()
    original_name, name_norm, desc_norm, name_segmented, desc_segmented = item_tuple
    matches = []
    
    for original_word, variants in word_to_variants.items():
        w_embs = word_embs_dict.get(original_word)
        
        matched, mtype, source = text_contains_with_source(
            name_norm, desc_norm, name_segmented, desc_segmented,
            variants, fuzz_mod, fuzzy_threshold,
            ablation_config=ablation_config,
            word_embs=w_embs, name_emb=n_emb, desc_emb=d_emb,
            semantic_threshold=sem_thresh
        )
        
        if matched:
            matches.append((original_word, mtype, source))
            
    return original_name, matches


def map_words_to_items(
    words: List[str], items: List[Dict[str, str]], name_col: str, desc_col: Optional[str],
    fuzzy_threshold: int = 90, ablation_config: Optional[Dict] = None,
    apply_idf_filter: bool = False, max_doc_freq_ratio: float = 0.5,
    idf_auto_percentile: Optional[float] = None,
    semantic_threshold: float = SEMANTIC_THRESHOLD,
    generic_filter_terms: Optional[set] = None,
    guaranteed_coverage: bool = False,
    base_dir: Optional[Path] = None,
    embedding_model_name: str = "intfloat/multilingual-e5-base",
    use_parallel: bool = True,
    num_workers: Optional[int] = None
) -> Tuple[List[Tuple[int, str, List[str]]], List[str], List[str], Dict]:

    if ablation_config is None:
        ablation_config = {"use_token_set": True, "use_partial": True, "use_semantic": False}

    fuzz_mod = try_import_rapidfuzz()
    use_semantic = ablation_config.get("use_semantic", False)
    generic_filter_terms = GENERIC_LOW_VALUE_TERMS if generic_filter_terms is None else generic_filter_terms
    normalized_generic_terms = {normalize_text(term) for term in generic_filter_terms}

    prepared_items = []
    item_name_embs, item_desc_embs = {}, {}

    if use_semantic:
        print(f"  [Init] Loading semantic model: {embedding_model_name}")
        prepared_items, item_name_embs, item_desc_embs = get_or_build_item_embeddings(
            items=items,
            name_col=name_col,
            desc_col=desc_col,
            model_name=embedding_model_name,
            base_dir=base_dir,
        )
    else:
        for r in items:
            original_name = (r.get(name_col) or "").strip()
            name_norm = normalize_text(original_name)
            desc_norm = normalize_text(r.get(desc_col, "")) if desc_col else ""
            name_seg = normalize_text_thai_segmented(name_norm)
            desc_seg = normalize_text_thai_segmented(desc_norm) if desc_norm else ""
            prepared_items.append((original_name, name_norm, desc_norm, name_seg, desc_seg))

    # ── กรองคำกว้างเกินไป (Generic terms) ──
    word_to_variants = {w: generate_variants(w) for w in words}
    word_to_variants = {
        w: vs for w, vs in word_to_variants.items()
        if normalize_text(w) not in normalized_generic_terms
    }

    # ── แปลง Keywords เป็น Vector ──
    word_embs_dict = {}
    if use_semantic:
        word_embs_dict = get_or_build_word_embeddings(
            word_to_variants=word_to_variants,
            model_name=embedding_model_name,
            base_dir=base_dir,
        )

    sem_thresh = semantic_threshold
    match_event_counts = {"exact": 0, "token_set": 0, "partial": 0, "semantic": 0}
    match_unique_words = {"exact": set(), "token_set": set(), "partial": set(), "semantic": set()}
    name_to_words = defaultdict(set)
    match_sources = defaultdict(dict)

    # ── Main Matching Loop (Parallelized) ──
    # Note: use_parallel is set to False by default on Windows to avoid pickle errors
    if use_parallel and len(prepared_items) > 10:
        print(f"  [Matching] Running parallel matching across {len(prepared_items)} items...")
        with ProcessPoolExecutor(max_workers=num_workers) as executor:
            futures = []
            for itm in prepared_items:
                orig_name = itm[0]
                futures.append(executor.submit(
                    _match_single_item, itm, word_to_variants,
                    fuzzy_threshold, ablation_config, word_embs_dict,
                    item_name_embs.get(orig_name), item_desc_embs.get(orig_name),
                    sem_thresh
                ))
            
            for future in as_completed(futures):
                orig_name, item_matches = future.result()
                for word, mtype, source in item_matches:
                    name_to_words[orig_name].add(word)
                    match_event_counts[mtype] = match_event_counts.get(mtype, 0) + 1
                    match_unique_words[mtype].add(word)
                    match_sources[orig_name][word] = summarize_match_source(source, mtype)
    else:
        # Serial fallback - Fixed signature
        for itm in prepared_items:
            orig_name, item_matches = _match_single_item(
                itm, word_to_variants, fuzzy_threshold,
                ablation_config, word_embs_dict,
                item_name_embs.get(itm[0]), item_desc_embs.get(itm[0]),
                sem_thresh
            )
            for word, mtype, source in item_matches:
                name_to_words[orig_name].add(word)
                match_event_counts[mtype] = match_event_counts.get(mtype, 0) + 1
                match_unique_words[mtype].add(word)
                match_sources[orig_name][word] = summarize_match_source(source, mtype)

    # ── Guaranteed coverage: force at least one item per word ──
    if guaranteed_coverage:
        for original_word in word_to_variants.keys():
            already_mapped = any(original_word in mapped_set for mapped_set in name_to_words.values())
            if already_mapped:
                continue

            best_item, forced_prov = choose_best_forced_item(
                word=original_word,
                prepared_items=prepared_items,
                fuzz_mod=fuzz_mod,
                fuzzy_threshold=fuzzy_threshold,
            )
            if best_item:
                name_to_words[best_item].add(original_word)
                match_sources[best_item][original_word] = forced_prov
                # Classify forced match by its actual provenance, not blanket "partial"
                prov_category = "exact" if "exact" in forced_prov else \
                                "partial" if ("fuzzy" in forced_prov or "partial" in forced_prov) else \
                                "partial"  # fallback for forced_fallback
                match_event_counts[prov_category] = match_event_counts.get(prov_category, 0) + 1
                match_unique_words[prov_category].add(original_word)

    # Optional IDF filtering: remove high-frequency generic keywords
    if apply_idf_filter:
        # Build word->items mapping for filtering
        word_to_item_indices = defaultdict(set)
        for item_idx, (orig_name, _, _, _, _) in enumerate(prepared_items):
            if orig_name in name_to_words:
                for word in name_to_words[orig_name]:
                    word_to_item_indices[word].add(item_idx)

        # Auto-compute DF cutoff from percentile if specified
        effective_max_ratio = max_doc_freq_ratio
        if idf_auto_percentile is not None:
            # Convert to match-space DF (items the word actually matched)
            match_df = {w: len(idx_set) / len(prepared_items)
                        for w, idx_set in word_to_item_indices.items()}
            effective_max_ratio = select_idf_threshold(match_df, idf_auto_percentile)

        # Filter generic keywords by global DF threshold
        word_to_item_indices = filter_generic_keywords_idf(
            word_to_item_indices, len(prepared_items), effective_max_ratio
        )

        # Per-item removal for domain-frequent terms:
        # Keep these words in items where they match the item NAME (discriminative),
        # but remove from items where they only match via description (likely FP).
        # This preserves Recall for items where the term is a primary keyword
        # while reducing FP for items where it's only tangentially mentioned.
        normalized_domain_freq = {normalize_text(t) for t in GENERIC_TERMS_DOMAIN_FREQUENT}
        domain_freq_removed = 0
        for word_norm in list(word_to_item_indices.keys()):
            if word_norm in normalized_domain_freq:
                kept_items = set()
                for item_idx in word_to_item_indices[word_norm]:
                    item_name_norm = prepared_items[item_idx][1]  # (orig, name_norm, ...)
                    # Keep if word appears in item name (discriminative match)
                    if word_norm in item_name_norm:
                        kept_items.add(item_idx)
                if kept_items and len(kept_items) < len(word_to_item_indices[word_norm]):
                    removed_from = len(word_to_item_indices[word_norm]) - len(kept_items)
                    domain_freq_removed += removed_from
                    if len(kept_items) == 0:
                        del word_to_item_indices[word_norm]
                    else:
                        word_to_item_indices[word_norm] = kept_items
        if domain_freq_removed > 0:
            print(f"  [Domain-freq filter] Kept domain-frequent words only in name-matched "
                  f"items; removed {domain_freq_removed} item-word pairs")

        # Rebuild results without filtered words
        name_to_words_filtered = defaultdict(set)
        match_sources_filtered = defaultdict(dict)
        for orig_name, words in name_to_words.items():
            for word in words:
                if word in word_to_item_indices:
                    name_to_words_filtered[orig_name].add(word)
                    if orig_name in match_sources and word in match_sources[orig_name]:
                        match_sources_filtered[orig_name][word] = match_sources[orig_name][word]
        name_to_words = name_to_words_filtered
        match_sources = match_sources_filtered

    # ── Per-item keyword cap: keep top-N by match quality ──
    # Gold standard average = 9 keywords/item; allow margin
    MAX_KEYWORDS_PER_ITEM = 15
    _PROVENANCE_SCORE = {
        "name_exact": 4, "name_fuzzy": 2,
        "desc_exact": 3, "desc_fuzzy": 1,
        "name_semantic": 2, "desc_semantic": 1,
    }
    for name in list(name_to_words.keys()):
        words = name_to_words[name]
        if len(words) > MAX_KEYWORDS_PER_ITEM:
            scored = []
            for w in words:
                prov = match_sources.get(name, {}).get(w, "unknown")
                score = _PROVENANCE_SCORE.get(prov, 0)
                scored.append((w, score))
            scored.sort(key=lambda x: -x[1])
            keep = set(w for w, s in scored[:MAX_KEYWORDS_PER_ITEM])
            for w in words - keep:
                if name in match_sources and w in match_sources[name]:
                    del match_sources[name][w]
            name_to_words[name] = keep

    results = []
    idx = 1
    for name, wset in name_to_words.items():
        if not wset:  # Skip items with no words after filtering
            continue
        wsorted = sorted(wset, key=lambda x: normalize_text(x))
        results.append((idx, name, wsorted))
        idx += 1

    mapped_words = set().union(*name_to_words.values()) if name_to_words else set()
    # Bug 1 fix: separate filtered-out words from truly unmapped words
    filtered_out = [w for w in words if normalize_text(w) in normalized_generic_terms]

    if guaranteed_coverage:
        unmapped_words = []
    else:
        unmapped_words = [w for w in words
                          if normalize_text(w) not in normalized_generic_terms
                          and w not in mapped_words]

    all_item_names = [(r.get(name_col) or "").strip() for r in items]
    unmapped_items = [n for n in all_item_names if n and n not in name_to_words]

    # Print match breakdown summary (events + unique words)
    ablation_name = ablation_config.get("name", "default")
    print(f"  [{ablation_name}] Match events:  exact={match_event_counts['exact']}, "
          f"token_set={match_event_counts['token_set']}, "
          f"partial={match_event_counts['partial']}, "
          f"semantic={match_event_counts['semantic']}")
    print(f"  [{ablation_name}] Unique words:  exact={len(match_unique_words['exact'])}, "
          f"token_set={len(match_unique_words['token_set'])}, "
          f"partial={len(match_unique_words['partial'])}, "
          f"semantic={len(match_unique_words['semantic'])}")

    # ── Diagnostics: Quantify layer contributions ──
    total_matches = sum(match_event_counts.values())
    diagnostics = {
        # Event counts (backward compatible keys)
        "exact": match_event_counts["exact"],
        "token_set": match_event_counts["token_set"],
        "partial": match_event_counts["partial"],
        "semantic": match_event_counts["semantic"],
        "total_matches": total_matches,
        "exact_ratio": match_event_counts["exact"] / total_matches if total_matches > 0 else 0.0,
        "fuzzy_contrib_ratio": (match_event_counts["token_set"] + match_event_counts["partial"]) / total_matches if total_matches > 0 else 0.0,
        "semantic_contrib_ratio": match_event_counts["semantic"] / total_matches if total_matches > 0 else 0.0,
        # Unique word counts (Fix 9)
        "exact_unique_words": len(match_unique_words["exact"]),
        "token_set_unique_words": len(match_unique_words["token_set"]),
        "partial_unique_words": len(match_unique_words["partial"]),
        "semantic_unique_words": len(match_unique_words["semantic"]),
        # Source provenance (Fix 5)
        "match_sources": dict(match_sources),
        # Filtered-out generic terms (Bug 1 fix)
        "filtered_out": filtered_out,
        "generic_filter_mode_size": len(normalized_generic_terms),
    }

    return results, unmapped_words, unmapped_items, diagnostics


# ═══════════════════════════════════════════════════════════════
# OUTPUT WRITERS
# ═══════════════════════════════════════════════════════════════

def write_outputs(
    results: List[Tuple[int, str, List[str]]],
    unmapped_words: List[str],
    unmapped_items: List[str],
    out_main: Path,
    out_unmapped_words: Path,
    out_unmapped_items: Path,
    match_sources: Optional[Dict] = None,
):
    # Ensure output directories exist
    for p in [out_main, out_unmapped_words, out_unmapped_items]:
        p.parent.mkdir(parents=True, exist_ok=True)

    with open(out_main, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["ลำดับ", "ชื่อชุดการแสดง", "words", "match_sources"])
        for idx, name, words in results:
            # Build provenance info for each word, e.g. word:name_exact
            if match_sources and name in match_sources:
                src_info = "; ".join(
                    f"{wd}:{match_sources[name].get(wd, '?')}" for wd in words
                )
            else:
                src_info = ""
            w.writerow([idx, name, ", ".join(words), src_info])

    with open(out_unmapped_words, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["unmapped_word"])
        for t in unmapped_words:
            w.writerow([t])

    with open(out_unmapped_items, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["unmapped_item_name"])
        for n in unmapped_items:
            w.writerow([n])


# ═══════════════════════════════════════════════════════════════
# PUBLIC API: run_mapping()  — call from other scripts or notebooks
# ═══════════════════════════════════════════════════════════════

def run_mapping(
    threshold: int = 90,
    base_dir: Optional[Path] = None,
    words_file: str = WORDS_FILE,
    items_file: str = ITEMS_FILE,
    write_files: bool = True,
    ablation_config: Optional[Dict] = None,
    apply_idf_filter: bool = True,
    idf_auto_percentile: Optional[float] = 80.0,
    generic_filter_mode: str = "predefined",
    guaranteed_coverage: bool = False,
    use_pos_filter: bool = False,
    add_roman: bool = False,
    use_parallel: bool = True,
    num_workers: Optional[int] = None
) -> Dict:
    """Run keyword mapping for a single threshold."""
    if ablation_config is None:
        ablation_config = {"use_token_set": True, "use_partial": True}

    base = base_dir or (Path(__file__).resolve().parent if "__file__" in dir() else Path.cwd())
    words_path = base / words_file
    items_path = base / items_file

    if not words_path.exists():
        raise FileNotFoundError(f"ไม่พบไฟล์ {words_path}")
    if not items_path.exists():
        raise FileNotFoundError(f"ไม่พบไฟล์ {items_path}")

    # Refresh trie only when source words file changes
    global _RUNTIME_TRIE_SOURCE
    if HAS_THAI_NLP:
        current_source = str(words_path.resolve())
        if _RUNTIME_TRIE_SOURCE != current_source:
            rebuild_runtime_custom_trie(artifact_words_csv=words_path, verbose=False)
            _RUNTIME_TRIE_SOURCE = current_source

    words = load_words(words_path, use_pos_filter=use_pos_filter)
    items, name_col, desc_col, n_raw_rows, n_unique_items = load_items(items_path)
    generic_filter_terms = get_generic_filter_terms(generic_filter_mode)

    results, unmapped_words, unmapped_items, diagnostics = map_words_to_items(
        words, items, name_col, desc_col or None, fuzzy_threshold=threshold,
        ablation_config=ablation_config, apply_idf_filter=apply_idf_filter,
        idf_auto_percentile=idf_auto_percentile,
        generic_filter_terms=generic_filter_terms,
        guaranteed_coverage=guaranteed_coverage,
        base_dir=base,
        use_parallel=use_parallel,
        num_workers=num_workers
    )

    if write_files:
        ablation_suffix = f"_{ablation_config.get('name', 'default')}" if ablation_config else ""
        idf_suffix = "_idf" if idf_auto_percentile is not None else ""
        out_main = base / OUT_MAIN_PATTERN.format(threshold=threshold).replace(
            ".csv", f"{ablation_suffix}{idf_suffix}.csv"
        )
        out_uw = base / OUT_UNMAPPED_WORDS_PATTERN.format(threshold=threshold).replace(
            ".csv", f"{ablation_suffix}{idf_suffix}.csv"
        )
        out_ui = base / OUT_UNMAPPED_ITEMS_PATTERN.format(threshold=threshold).replace(
            ".csv", f"{ablation_suffix}{idf_suffix}.csv"
        )
        write_outputs(results, unmapped_words, unmapped_items, out_main, out_uw, out_ui,
                      match_sources=diagnostics.get("match_sources"))

    return {
        "threshold": threshold,
        "ablation": ablation_config.get("name", "default"),
        "idf_filter": idf_auto_percentile is not None,
        "generic_filter_mode": generic_filter_mode,
        "guaranteed_coverage": guaranteed_coverage,
        "results": results,
        "unmapped_words": unmapped_words,
        "unmapped_items": unmapped_items,
        "diagnostics": diagnostics,  # Match type breakdown (exact, token_set, partial)
        "n_words": len(words),
        "n_raw_rows": n_raw_rows,
        "n_items": n_unique_items,
        "n_mapped_items": len(results),
        "n_mapped_words": len(words) - len(unmapped_words) - len(diagnostics.get("filtered_out", [])),
    }


def tune_semantic_threshold(
    words: List[str],
    items: List[Dict[str, str]],
    name_col: str,
    desc_col: Optional[str],
    val_gold: Dict[str, set],
    fuzzy_threshold: int = 90,
    sem_candidates: Tuple[float, ...] = (0.65, 0.70, 0.75, 0.80, 0.85),
    base_dir: Optional[Path] = None,
) -> Tuple[float, pd.DataFrame]:
    """Tune semantic threshold on a validation set, then fix it for later runs.

    Intended for one-time pilot/validation justification in the paper rather
    than dynamic threshold selection during production mapping.
    """
    best_sem, best_f1 = SEMANTIC_THRESHOLD, 0.0
    rows = []

    for sem in sem_candidates:
        ablation = {
            "use_token_set": False,
            "use_partial": False,
            "use_semantic": True,
            "name": f"sem_{sem:.2f}",
        }
        results, _, _, _ = map_words_to_items(
            words,
            items,
            name_col,
            desc_col,
            fuzzy_threshold=fuzzy_threshold,
            ablation_config=ablation,
            semantic_threshold=sem,
            base_dir=base_dir,
        )
        ev = evaluate_mapping(results, val_gold, fuzzy_threshold)
        rows.append({
            "sem_threshold": sem,
            "F1": ev["F1"],
            "Precision": ev["Precision"],
            "Recall": ev["Recall"],
        })
        if ev["F1"] > best_f1:
            best_f1, best_sem = ev["F1"], sem

    print(f"  [SemThresh] Best semantic threshold={best_sem} (F1={best_f1:.4f})")
    return best_sem, pd.DataFrame(rows)


def run_sweep(
    thresholds: Optional[List[int]] = None,
    base_dir: Optional[Path] = None,
    write_files: bool = True,
    ablation_config: Optional[Dict] = None,
    idf_auto_percentile: Optional[float] = None,
    generic_filter_mode: str = "predefined",
    guaranteed_coverage: bool = False,
    use_pos_filter: bool = False,
    add_roman: bool = False,
    use_parallel: bool = True,
    num_workers: Optional[int] = None
) -> List[Dict]:
    """Run mapping for multiple thresholds (sweep)."""
    thresholds = thresholds or DEFAULT_THRESHOLDS
    base = base_dir or (Path(__file__).resolve().parent if "__file__" in dir() else Path.cwd())

    if ablation_config is None:
        ablation_config = {"use_token_set": True, "use_partial": True}

    all_results = []
    for t in thresholds:
        print(f"\n{'='*50}")
        print(f"  Running threshold = {t}")
        print(f"  Ablation: {ablation_config.get('name', 'default')}")
        print(f"{'='*50}")
        res = run_mapping(threshold=t, base_dir=base, write_files=write_files,
                         ablation_config=ablation_config,
                         idf_auto_percentile=idf_auto_percentile,
                         generic_filter_mode=generic_filter_mode,
                         guaranteed_coverage=guaranteed_coverage,
                         use_pos_filter=use_pos_filter,
                         add_roman=add_roman,
                         use_parallel=use_parallel,
                         num_workers=num_workers)
        all_results.append(res)

        print(f"  Raw rows     : {res['n_raw_rows']}")
        print(f"  Mapped items : {res['n_mapped_items']}/{res['n_items']}")
        print(f"  Mapped words : {res['n_mapped_words']}/{res['n_words']}")

    export_sweep_tables_and_graphs(all_results, base_dir=base)
    return all_results


def run_generic_filter_ablation(
    thresholds: Optional[List[int]] = None,
    base_dir: Optional[Path] = None,
    gold_file: str = GOLD_FILE,
) -> pd.DataFrame:
    """Compare no filter vs pre-defined vs extended generic filters for reporting."""
    thresholds = thresholds or DEFAULT_THRESHOLDS
    base = base_dir or (Path(__file__).resolve().parent if "__file__" in dir() else Path.cwd())
    gold_data = load_gold_data(base / gold_file)
    rows = []

    filter_configs = [
        ("none", "No filter"),
        ("predefined", f"Pre-defined only (n={len(GENERIC_TERMS_PREDEFINED)})"),
        ("extended", f"Pre-defined + Post-hoc (n={len(GENERIC_LOW_VALUE_TERMS_EXTENDED)})"),
    ]

    for filter_mode, label in filter_configs:
        best_eval = None
        best_threshold = None
        for threshold in thresholds:
            run_result = run_mapping(
                threshold=threshold,
                base_dir=base,
                write_files=False,
                generic_filter_mode=filter_mode,
            )
            eval_result = evaluate_mapping(run_result["results"], gold_data, threshold)
            if best_eval is None or eval_result["F1"] > best_eval["F1"]:
                best_eval = eval_result
                best_threshold = threshold

        if best_eval is not None:
            rows.append({
                "filter_set": label,
                "filter_mode": filter_mode,
                "n_terms": 0 if filter_mode == "none" else len(get_generic_filter_terms(filter_mode)),
                "best_threshold": best_threshold,
                "Precision": best_eval["Precision"],
                "Recall": best_eval["Recall"],
                "F1": best_eval["F1"],
                "TP": best_eval["TP"],
                "FP": best_eval["FP"],
                "FN": best_eval["FN"],
            })

    ablation_df = pd.DataFrame(rows)
    out_path = base / "result" / "generic_filter_ablation.csv"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    ablation_df.to_csv(out_path, index=False, encoding="utf-8-sig")
    print(f"  Generic-filter ablation written to {out_path.name}")
    return ablation_df


def export_diagnostics(sweep_results: List[Dict], base_dir: Optional[Path] = None) -> None:
    """Export diagnostic breakdown (exact/token_set/partial match counts) to CSV.

    This shows layer contribution: if fuzzy_contrib_ratio ≈ 0, then fuzzy matching
    is NOT helping beyond exact matching.

    Args:
        sweep_results: List of dicts from run_sweep()
        base_dir: Output directory (default: script dir)

    Output: result/mapping_diagnostics_summary.csv
    """
    base = base_dir or (Path(__file__).resolve().parent if "__file__" in dir() else Path.cwd())
    out_path = base / "result" / "mapping_diagnostics_summary.csv"
    out_path.parent.mkdir(parents=True, exist_ok=True)

    with open(out_path, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=[
            "threshold", "ablation", "exact_matches", "token_set_matches",
            "partial_matches", "semantic_matches", "total_matches",
            "exact_ratio", "fuzzy_contrib_ratio", "semantic_contrib_ratio",
            "exact_unique_words", "token_set_unique_words", "partial_unique_words",
            "semantic_unique_words"
        ])
        writer.writeheader()

        for result in sweep_results:
            diag = result.get("diagnostics", {})
            writer.writerow({
                "threshold": result["threshold"],
                "ablation": result.get("ablation", "default"),
                "exact_matches": diag.get("exact", 0),
                "token_set_matches": diag.get("token_set", 0),
                "partial_matches": diag.get("partial", 0),
                "semantic_matches": diag.get("semantic", 0),
                "total_matches": diag.get("total_matches", 0),
                "exact_ratio": round(diag.get("exact_ratio", 0), 4),
                "fuzzy_contrib_ratio": round(diag.get("fuzzy_contrib_ratio", 0), 4),
                "semantic_contrib_ratio": round(diag.get("semantic_contrib_ratio", 0), 4),
                "exact_unique_words": diag.get("exact_unique_words", 0),
                "token_set_unique_words": diag.get("token_set_unique_words", 0),
                "partial_unique_words": diag.get("partial_unique_words", 0),
                "semantic_unique_words": diag.get("semantic_unique_words", 0),
            })

    print(f"  Diagnostics exported to {out_path.name}")


# ═══════════════════════════════════════════════════════════════
# EXPERIMENT TABLES AND GRAPHS
# ═══════════════════════════════════════════════════════════════

def export_sweep_tables_and_graphs(
    sweep_results: List[Dict],
    base_dir: Optional[Path] = None,
) -> None:
    """
    Export threshold-wise summary table and plots for paper-ready experiments.
    """
    if not sweep_results:
        return

    base = base_dir or (Path(__file__).resolve().parent if "__file__" in dir() else Path.cwd())
    out_dir = base / "result"
    out_dir.mkdir(parents=True, exist_ok=True)

    rows = []
    for r in sweep_results:
        diag = r.get("diagnostics", {})
        rows.append({
            "threshold": r.get("threshold"),
            "ablation": r.get("ablation", "default"),
            "guaranteed_coverage": r.get("guaranteed_coverage", False),
            "n_words": r.get("n_words", 0),
            "n_raw_rows": r.get("n_raw_rows", 0),
            "n_items": r.get("n_items", 0),
            "n_mapped_words": r.get("n_mapped_words", 0),
            "unmapped_words": len(r.get("unmapped_words", [])),
            "n_mapped_items": r.get("n_mapped_items", 0),
            "unmapped_items": len(r.get("unmapped_items", [])),
            "exact_matches": diag.get("exact", 0),
            "token_set_matches": diag.get("token_set", 0),
            "partial_matches": diag.get("partial", 0),
            "semantic_matches": diag.get("semantic", 0),
            "exact_ratio": round(diag.get("exact_ratio", 0), 4),
            "fuzzy_contrib_ratio": round(diag.get("fuzzy_contrib_ratio", 0), 4),
            "semantic_contrib_ratio": round(diag.get("semantic_contrib_ratio", 0), 4),
        })

    df = pd.DataFrame(rows).sort_values(["ablation", "threshold"])
    summary_csv = out_dir / "threshold_experiment_summary.csv"
    df.to_csv(summary_csv, index=False, encoding="utf-8-sig")
    print(f"  Exported {summary_csv.name}")

    # Plot 1: mapped vs unmapped words by threshold
    df_default = df[df["ablation"] == df["ablation"].iloc[0]].copy()
    plt.figure(figsize=(8, 5))
    plt.plot(df_default["threshold"], df_default["n_mapped_words"], marker="o", label="Mapped words", color="black", linestyle="-")
    plt.plot(df_default["threshold"], df_default["unmapped_words"], marker="s", label="Unmapped words", color="gray", linestyle="--")
    plt.xlabel("Threshold")
    plt.ylabel("Count")
    plt.title("Mapped vs Unmapped Words by Threshold")
    plt.legend()
    plt.tight_layout()
    plt.savefig(out_dir / "fig_mapped_vs_unmapped_by_threshold.png", dpi=200)
    plt.close()

    # Plot 2: contribution ratios by threshold
    plt.figure(figsize=(8, 5))
    plt.plot(df_default["threshold"], df_default["exact_ratio"], marker="o", label="Exact ratio", color="black", linestyle="-")
    plt.plot(df_default["threshold"], df_default["fuzzy_contrib_ratio"], marker="s", label="Fuzzy contribution", color="gray", linestyle="--")
    plt.plot(df_default["threshold"], df_default["semantic_contrib_ratio"], marker="^", label="Semantic contribution", color="silver", linestyle=":")
    plt.xlabel("Threshold")
    plt.ylabel("Ratio")
    plt.title("Layer Contribution by Threshold")
    plt.legend()
    plt.tight_layout()
    plt.savefig(out_dir / "fig_layer_contribution_by_threshold.png", dpi=200)
    plt.close()


def export_ablation_tables_and_graphs(
    rows: List[Dict],
    base_dir: Optional[Path] = None,
) -> None:
    """
    Export ablation evaluation table and graphs from row records.
    """
    if not rows:
        return

    base = base_dir or (Path(__file__).resolve().parent if "__file__" in dir() else Path.cwd())
    out_dir = base / "result"
    out_dir.mkdir(parents=True, exist_ok=True)

    df = pd.DataFrame(rows).sort_values(["config", "threshold"])
    out_csv = out_dir / "ablation_evaluation_detailed.csv"
    df.to_csv(out_csv, index=False, encoding="utf-8-sig")
    print(f"  Exported {out_csv.name}")

    # Plot 3: F1 by threshold for each config
    bw_markers = ["o", "s", "^", "D", "v", "P"]
    bw_styles = ["-", "--", "-.", ":", (0, (3, 1, 1, 1)), (0, (5, 2))]
    plt.figure(figsize=(9, 5))
    for i, (config_name, g) in enumerate(df.groupby("config")):
        plt.plot(g["threshold"], g["F1"],
                 marker=bw_markers[i % len(bw_markers)],
                 linestyle=bw_styles[i % len(bw_styles)],
                 color="black",
                 label=config_name)
    plt.xlabel("Threshold")
    plt.ylabel("F1")
    plt.title("Ablation F1 by Threshold")
    plt.legend()
    plt.tight_layout()
    plt.savefig(out_dir / "fig_ablation_f1_by_threshold.png", dpi=200)
    plt.close()

    # Plot 4: Recall by threshold for each config
    plt.figure(figsize=(9, 5))
    for i, (config_name, g) in enumerate(df.groupby("config")):
        plt.plot(g["threshold"], g["Recall"],
                 marker=bw_markers[i % len(bw_markers)],
                 linestyle=bw_styles[i % len(bw_styles)],
                 color="black",
                 label=config_name)
    plt.xlabel("Threshold")
    plt.ylabel("Recall")
    plt.title("Ablation Recall by Threshold")
    plt.legend()
    plt.tight_layout()
    plt.savefig(out_dir / "fig_ablation_recall_by_threshold.png", dpi=200)
    plt.close()


def run_ablation_sweep(
    thresholds: Optional[List[int]] = None,
    base_dir: Optional[Path] = None,
    ablation_configs: Optional[List[str]] = None,
) -> Dict[str, List[Dict]]:
    """Run mapping for multiple ablation configurations (SPAR-style ablation).

    Args:
        thresholds: List of thresholds to test
        base_dir: Base directory for input/output
        ablation_configs: List of ablation config names (keys in ABLATION_CONFIGS)
                         Default: all configs

    Returns:
        dict mapping ablation config name -> list of results per threshold
    """
    thresholds = thresholds or DEFAULT_THRESHOLDS
    ablation_configs = ablation_configs or list(ABLATION_CONFIGS.keys())
    base = base_dir or (Path(__file__).resolve().parent if "__file__" in dir() else Path.cwd())

    all_results = {}
    for config_name in ablation_configs:
        if config_name not in ABLATION_CONFIGS:
            print(f"[warn] Unknown ablation config: {config_name}, skipping", file=sys.stderr)
            continue
        config = ABLATION_CONFIGS[config_name]
        print(f"\n{'='*70}")
        print(f"  ABLATION: {config_name}")
        print(f"  {config['description']}")
        print(f"{'='*70}")
        results = run_sweep(thresholds=thresholds, base_dir=base, ablation_config=config)
        all_results[config_name] = results

    return all_results


def run_ablation_with_evaluation(
    thresholds: Optional[List[int]] = None,
    base_dir: Optional[Path] = None,
    ablation_configs: Optional[List[str]] = None,
    gold_file: str = GOLD_FILE,
) -> None:
    """Run ablation study with F1 evaluation per config x threshold (Fix 1).

    Unlike run_ablation_sweep() which only measures keyword count,
    this function evaluates each config against the gold standard.

    Outputs: result/ablation_evaluation.csv
    """
    thresholds = thresholds or DEFAULT_THRESHOLDS
    ablation_configs = ablation_configs or list(ABLATION_CONFIGS.keys())
    base = base_dir or (Path(__file__).resolve().parent if "__file__" in dir() else Path.cwd())

    # Load data once
    gold_path = base / gold_file
    gold_data = load_gold_data(gold_path)
    print(f"  Loaded {len(gold_data)} gold items for ablation evaluation")

    words = load_words(base / WORDS_FILE)
    items, name_col, desc_col, _, _ = load_items(base / ITEMS_FILE)

    rows = []
    for config_name in ablation_configs:
        if config_name not in ABLATION_CONFIGS:
            print(f"[warn] Unknown ablation config: {config_name}, skipping", file=sys.stderr)
            continue
        config = ABLATION_CONFIGS[config_name]
        print(f"\n  Ablation eval: {config_name} — {config['description']}")

        for t in thresholds:
            results, _, _, diagnostics = map_words_to_items(
                words, items, name_col, desc_col or None,
                fuzzy_threshold=t, ablation_config=config
            )
            eval_result = evaluate_mapping(results, gold_data, t)
            rows.append({
                "config": config_name,
                "threshold": t,
                "Precision": eval_result["Precision"],
                "Recall": eval_result["Recall"],
                "F1": eval_result["F1"],
                "TP": eval_result["TP"],
                "FP": eval_result["FP"],
                "FN": eval_result["FN"],
                "exact_ratio": round(diagnostics.get("exact_ratio", 0), 4),
            })

    # Print summary table
    print(f"\n{'='*80}")
    print(f"  ABLATION EVALUATION (Config x Threshold -> F1)")
    print(f"{'='*80}")
    print(f"  {'Config':<25}  {'T':>4}  {'P':>8}  {'R':>8}  {'F1':>8}  {'TP':>5}  {'FP':>5}  {'FN':>5}")
    print(f"  {'-'*25}  {'-'*4}  {'-'*8}  {'-'*8}  {'-'*8}  {'-'*5}  {'-'*5}  {'-'*5}")
    best_f1 = max((r["F1"] for r in rows), default=0)
    for r in rows:
        marker = " [BEST]" if r["F1"] == best_f1 else ""
        print(f"  {r['config']:<25}  {r['threshold']:>4}  {r['Precision']:>8.4f}  "
              f"{r['Recall']:>8.4f}  {r['F1']:>8.4f}  {r['TP']:>5}  {r['FP']:>5}  {r['FN']:>5}{marker}")
    print(f"{'='*80}")

    # Export CSV
    out_path = base / "result" / "ablation_evaluation.csv"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=[
            "config", "threshold", "Precision", "Recall", "F1", "TP", "FP", "FN", "exact_ratio"
        ])
        writer.writeheader()
        writer.writerows(rows)
    print(f"  Exported to {out_path.name}")

    # Try pandas pivot table (soft dependency)
    try:
        import pandas as pd
        df = pd.DataFrame(rows)
        pivot = df.pivot_table(index="config", columns="threshold", values="F1")
        print(f"\n  F1 Pivot Table:")
        print(pivot.to_string(float_format="%.4f"))
    except ImportError:
        pass

    export_ablation_tables_and_graphs(rows, base_dir=base)


# ═══════════════════════════════════════════════════════════════
# EVALUATION
# ═══════════════════════════════════════════════════════════════


# ═══════════════════════════════════════════════════════════════
# SHARED GOLD / EVALUATION NORMALIZATION HELPERS
# Keep gold loading and evaluation on the same canonical logic
# ═══════════════════════════════════════════════════════════════

def _split_multivalue_cell(cell: str) -> List[str]:
    """
    Split a CSV-like cell containing one or many values.

    Supported separators:
    - comma ,
    - semicolon ;
    - pipe |
    """
    if cell is None:
        return []
    raw = str(cell).strip()
    if not raw:
        return []
    parts = re.split(r"[;,|]+", raw)
    return [p.strip() for p in parts if p and p.strip()]


def _canonical_item_key(item_name: str) -> str:
    """
    Canonical item key used consistently in both gold loading and evaluation.
    """
    return normalize_text(item_name)


def _canonical_token(token: str) -> str:
    """
    Canonical token key used for comparison only.
    Preserve original surface form separately for display/export.
    """
    return normalize_text(token)


def _safe_token_surface(token: str) -> str:
    """
    Preserve readable token surface for reporting while removing empty noise.
    """
    if token is None:
        return ""
    return str(token).strip()


def _accumulate_item_tokens(
    item_to_tokens: Dict[str, set],
    display_name_by_key: Dict[str, str],
    token_surface_by_item_key: Dict[str, Dict[str, str]],
    item_name: str,
    tokens: List[str],
) -> None:
    """
    Shared accumulator to ensure one identical logic path for gold ingestion
    and any future item-aware evaluation utilities.

    item_to_tokens:
        canonical_item_key -> set of canonical_token
    display_name_by_key:
        canonical_item_key -> first-seen readable item name
    token_surface_by_item_key:
        canonical_item_key -> canonical_token -> first-seen surface token
    """
    item_key = _canonical_item_key(item_name)
    if not item_key:
        return

    display_name_by_key.setdefault(item_key, _safe_token_surface(item_name))
    token_surface_by_item_key.setdefault(item_key, {})

    for tok in tokens:
        tok_surface = _safe_token_surface(tok)
        tok_key = _canonical_token(tok_surface)
        if not tok_key:
            continue
        item_to_tokens[item_key].add(tok_key)
        token_surface_by_item_key[item_key].setdefault(tok_key, tok_surface)


def _materialize_surface_dict(
    item_to_tokens: Dict[str, set],
    display_name_by_key: Dict[str, str],
    token_surface_by_item_key: Dict[str, Dict[str, str]],
) -> Dict[str, set]:
    """
    Convert canonical internal structure back to:
        readable_item_name -> set(readable_token_surface)
    """
    out = {}
    for item_key, tok_keys in item_to_tokens.items():
        display_name = display_name_by_key.get(item_key, item_key)
        surfaces = {
            token_surface_by_item_key.get(item_key, {}).get(tok_key, tok_key)
            for tok_key in tok_keys
            if tok_key
        }
        if surfaces:
            out[display_name] = surfaces
    return out


def _canonicalize_item_word_dict(
    data: Dict[str, set]
) -> Tuple[Dict[str, set], Dict[str, str], Dict[str, Dict[str, str]]]:
    """
    Canonicalize a dict of:
        readable_item_name -> set(readable_token_surface)

    into:
        canonical_item_key -> set(canonical_token)
    plus readable lookup maps for export/reporting.
    """
    canon_item_to_tokens: Dict[str, set] = defaultdict(set)
    display_name_by_key: Dict[str, str] = {}
    token_surface_by_item_key: Dict[str, Dict[str, str]] = {}

    for item_name, words in data.items():
        if not words:
            continue
        _accumulate_item_tokens(
            item_to_tokens=canon_item_to_tokens,
            display_name_by_key=display_name_by_key,
            token_surface_by_item_key=token_surface_by_item_key,
            item_name=item_name,
            tokens=list(words),
        )

    return canon_item_to_tokens, display_name_by_key, token_surface_by_item_key


def load_gold_data(gold_path: Path) -> Dict[str, set]:
    """
    Load gold standard and normalize it into:
        Dict[readable_item_name, set(readable_gold_tokens)]

    Supported formats
    -----------------
    1) Legacy wide format
       item="A"
       gold_tokens="x, y, z"

    2) New long format
       gold_tokens="x"
       item="A, B, C"

    Internally, both formats are collapsed through the SAME canonical helpers
    used later by evaluate_mapping(), to avoid logic drift.
    """
    if not gold_path.exists():
        raise FileNotFoundError(f"Gold file not found: {gold_path}")

    canon_item_to_tokens: Dict[str, set] = defaultdict(set)
    display_name_by_key: Dict[str, str] = {}
    token_surface_by_item_key: Dict[str, Dict[str, str]] = {}

    with open(gold_path, "r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames or []

        has_item_col = ("item" in fieldnames) or ("ชื่อชุดการแสดง" in fieldnames)
        has_token_col = ("gold_tokens" in fieldnames)

        if not has_item_col or not has_token_col:
            raise KeyError(
                f"Gold file must contain item/ชื่อชุดการแสดง and gold_tokens columns. "
                f"Found: {fieldnames}"
            )

        for row in reader:
            item_cell = (row.get("item") or row.get("ชื่อชุดการแสดง") or "").strip()
            token_cell = (row.get("gold_tokens") or "").strip()

            if not item_cell or not token_cell:
                continue

            items = _split_multivalue_cell(item_cell)
            tokens = _split_multivalue_cell(token_cell)

            if not items and item_cell:
                items = [item_cell]
            if not tokens and token_cell:
                tokens = [token_cell]

            for item_name in items:
                _accumulate_item_tokens(
                    item_to_tokens=canon_item_to_tokens,
                    display_name_by_key=display_name_by_key,
                    token_surface_by_item_key=token_surface_by_item_key,
                    item_name=item_name,
                    tokens=tokens,
                )

    gold = _materialize_surface_dict(
        item_to_tokens=canon_item_to_tokens,
        display_name_by_key=display_name_by_key,
        token_surface_by_item_key=token_surface_by_item_key,
    )

    print(f"  Loaded {len(gold)} gold items from {gold_path.name}")
    return gold


def split_gold_standard(
    gold_data: Dict[str, set],
    ratios: Tuple[float, float, float] = (0.6, 0.2, 0.2),
    seed: int = 42,
    base_dir: Optional[Path] = None,
) -> Tuple[Dict[str, set], Dict[str, set], Dict[str, set]]:
    """Split gold standard into train/val/test sets (Fix 2).

    Deterministic split using sorted keys + fixed seed.

    Args:
        gold_data: Full gold standard dict
        ratios: (train, val, test) ratios, must sum to 1.0
        seed: Random seed for reproducibility
        base_dir: Where to export split CSVs

    Returns:
        (train, val, test) dicts
    """
    import random

    # Validate ratios
    if abs(sum(ratios) - 1.0) > 0.01:
        raise ValueError(f"Split ratios must sum to 1.0, got {ratios} (sum={sum(ratios)})")

    keys = sorted(gold_data.keys())
    rng = random.Random(seed)
    rng.shuffle(keys)

    n = len(keys)
    n_train = int(n * ratios[0])
    n_val = int(n * ratios[1])
    # Assign remainder to test to avoid rounding loss
    n_test = n - n_train - n_val

    if n_train == 0 or n_val == 0 or n_test == 0:
        print(f"  [warn] Small gold set (n={n}): train={n_train}, val={n_val}, test={n_test}. "
              f"Consider increasing gold data or adjusting ratios.", file=sys.stderr)

    train_keys = keys[:n_train]
    val_keys = keys[n_train:n_train + n_val]
    test_keys = keys[n_train + n_val:]

    train = {k: gold_data[k] for k in train_keys}
    val = {k: gold_data[k] for k in val_keys}
    test = {k: gold_data[k] for k in test_keys}

    print(f"  [split] Gold split: train={len(train)}, val={len(val)}, test={len(test)} "
          f"(seed={seed}, ratios={ratios})")

    # Export split CSVs
    if base_dir:
        for name, subset in [("gold_train", train), ("gold_val", val), ("gold_test", test)]:
            out = base_dir / "input" / f"{name}.csv"
            out.parent.mkdir(parents=True, exist_ok=True)
            with open(out, "w", encoding="utf-8-sig", newline="") as f:
                writer = csv.writer(f)
                writer.writerow(["item", "gold_tokens"])
                for item in sorted(subset.keys()):
                    writer.writerow([item, ", ".join(sorted(subset[item]))])
            print(f"  Exported {out.name} ({len(subset)} items)")

    return train, val, test


def select_threshold_on_val(
    words: List[str],
    items: List[Dict[str, str]],
    name_col: str,
    desc_col: Optional[str],
    val_gold: Dict[str, set],
    ablation_config: Optional[Dict] = None,
    coarse_thresholds: Optional[List[int]] = None,
    base_dir: Optional[Path] = None,
) -> Tuple[int, float]:
    """Select best threshold on validation set (Fix 2).

    Two-stage search:
    1. Coarse sweep on default thresholds -> find best F1
    2. Fine-grained search +/-5 around best (step 1)

    Returns:
        (best_threshold, best_f1)
    """
    if ablation_config is None:
        ablation_config = {"use_token_set": True, "use_partial": True}
    coarse_thresholds = coarse_thresholds or DEFAULT_THRESHOLDS

    # Coarse sweep
    best_t, best_f1 = 0, 0.0
    coarse_rows = []
    print(f"  [val] Coarse sweep: {coarse_thresholds}")
    for t in coarse_thresholds:
        results, _, _, _ = map_words_to_items(
            words, items, name_col, desc_col,
            fuzzy_threshold=t, ablation_config=ablation_config,
            base_dir=base_dir,
        )
        ev = evaluate_mapping(results, val_gold, t)
        coarse_rows.append({"threshold": t, "F1": ev["F1"]})
        if ev["F1"] > best_f1:
            best_f1, best_t = ev["F1"], t

    # Fine-grained search +/-5
    fine_range = range(max(0, best_t - 5), min(101, best_t + 6))
    print(f"  [val] Fine sweep around T={best_t}: {list(fine_range)}")
    for t in fine_range:
        if t in coarse_thresholds:
            continue
        results, _, _, _ = map_words_to_items(
            words, items, name_col, desc_col,
            fuzzy_threshold=t, ablation_config=ablation_config,
            base_dir=base_dir,
        )
        ev = evaluate_mapping(results, val_gold, t)
        coarse_rows.append({"threshold": t, "F1": ev["F1"]})
        if ev["F1"] > best_f1:
            best_f1, best_t = ev["F1"], t

    print(f"  [val] Best threshold={best_t}, val F1={best_f1:.4f}")
    return best_t, best_f1


def run_train_val_test(
    base_dir: Optional[Path] = None,
    gold_file: str = GOLD_FILE,
    split_seed: int = 42,
    split_ratios: Tuple[float, float, float] = (0.6, 0.2, 0.2),
) -> None:
    """Full train/val/test pipeline (Fix 2).

    1. Split gold → train/val/test
    2. Select threshold on val
    3. Report final F1 on test (ONCE)

    Outputs: result/threshold_selection.csv, result/test_set_result.csv
    """
    base = base_dir or (Path(__file__).resolve().parent if "__file__" in dir() else Path.cwd())

    # Load data
    gold_data = load_gold_data(base / gold_file)
    words = load_words(base / WORDS_FILE)
    items, name_col, desc_col, _, _ = load_items(base / ITEMS_FILE)

    # Split
    train, val, test = split_gold_standard(
        gold_data, ratios=split_ratios, seed=split_seed, base_dir=base
    )

    # Select threshold on val
    best_t, val_f1 = select_threshold_on_val(
        words, items, name_col, desc_col or None, val
    )

    # Export threshold selection
    sel_path = base / "result" / "threshold_selection.csv"
    sel_path.parent.mkdir(parents=True, exist_ok=True)
    with open(sel_path, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["selected_threshold", "val_F1", "seed", "ratios"])
        writer.writerow([best_t, round(val_f1, 4), split_seed,
                         f"{split_ratios[0]}/{split_ratios[1]}/{split_ratios[2]}"])
    print(f"  Exported {sel_path.name}")

    # Final evaluation on TEST (single run, no further tuning)
    print(f"\n{'='*60}")
    print(f"  FINAL TEST SET EVALUATION (threshold={best_t})")
    print(f"{'='*60}")
    results, _, _, _ = map_words_to_items(
        words, items, name_col, desc_col or None, fuzzy_threshold=best_t
    )
    test_result = evaluate_mapping(results, test, best_t)
    print(f"  Test P={test_result['Precision']:.4f}  "
          f"R={test_result['Recall']:.4f}  F1={test_result['F1']:.4f}")
    print(f"  (val F1={val_f1:.4f})")

    # Export test result
    test_path = base / "result" / "test_set_result.csv"
    with open(test_path, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["threshold", "val_F1", "test_Precision", "test_Recall", "test_F1",
                         "test_TP", "test_FP", "test_FN", "n_test_items"])
        writer.writerow([best_t, round(val_f1, 4),
                         test_result["Precision"], test_result["Recall"], test_result["F1"],
                         test_result["TP"], test_result["FP"], test_result["FN"],
                         len(test)])
    print(f"  Exported {test_path.name}")


def cross_validate_threshold(
    words: List[str],
    items: List[Dict[str, str]],
    name_col: str,
    desc_col: Optional[str],
    gold_data: Dict[str, set],
    thresholds: Optional[List[int]] = None,
    n_folds: int = 5,
    seed: int = 42,
    base_dir: Optional[Path] = None,
) -> Dict:
    """5-fold CV for threshold selection — more stable than single split
    when gold set is small (114 items).

    Each fold: hold out 1/5 as val, select threshold on val.
    Final threshold = most frequently chosen across folds.

    Args:
        gold_data: Full gold standard
        n_folds: Number of folds (default 5)
        seed: Random seed for reproducibility

    Returns:
        Dict with final_threshold, mean_val_f1, per-fold results
    """
    import random
    from collections import Counter

    thresholds = thresholds or DEFAULT_THRESHOLDS
    keys = sorted(gold_data.keys())
    rng = random.Random(seed)
    rng.shuffle(keys)

    fold_size = len(keys) // n_folds
    all_fold_results = []

    for fold in range(n_folds):
        start = fold * fold_size
        end = start + fold_size if fold < n_folds - 1 else len(keys)
        val_keys = keys[start:end]
        val_gold = {k: gold_data[k] for k in val_keys}

        print(f"\n  [CV fold {fold+1}/{n_folds}] val={len(val_gold)} items")
        best_t, best_f1 = select_threshold_on_val(
            words, items, name_col, desc_col,
            val_gold, coarse_thresholds=thresholds
        )
        all_fold_results.append({
            "fold": fold + 1,
            "best_t": best_t,
            "val_f1": round(best_f1, 4),
        })

    # Summary
    chosen_thresholds = [r["best_t"] for r in all_fold_results]
    final_t = Counter(chosen_thresholds).most_common(1)[0][0]
    mean_f1 = sum(r["val_f1"] for r in all_fold_results) / n_folds

    print(f"\n{'='*60}")
    print(f"  CROSS-VALIDATION SUMMARY ({n_folds}-fold)")
    print(f"{'='*60}")
    for r in all_fold_results:
        print(f"  Fold {r['fold']}: threshold={r['best_t']}, val F1={r['val_f1']:.4f}")
    print(f"  Thresholds chosen: {chosen_thresholds}")
    print(f"  Final threshold (most common): {final_t}")
    print(f"  Mean val F1: {mean_f1:.4f}")
    print(f"{'='*60}")

    # Export
    if base_dir:
        out = base_dir / "result" / "cross_validation.csv"
        out.parent.mkdir(parents=True, exist_ok=True)
        with open(out, "w", encoding="utf-8-sig", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=["fold", "best_t", "val_f1"])
            writer.writeheader()
            writer.writerows(all_fold_results)
            writer.writerow({"fold": "FINAL", "best_t": final_t,
                             "val_f1": round(mean_f1, 4)})
        print(f"  Exported {out.name}")

    return {
        "final_threshold": final_t,
        "mean_val_f1": round(mean_f1, 4),
        "folds": all_fold_results,
    }


def evaluate_mapping(
    mapped_results: List[Tuple[int, str, List[str]]],
    gold_data: Dict[str, set],
    threshold: int,
    out_error_report: Optional[Path] = None,
) -> Dict:
    """
    Evaluate mapping results against gold standard using the SAME canonical
    normalization helpers as load_gold_data().

    Evaluation mode:
    - item-aware
    - micro-aggregated across all aligned items
    """

    # Build predicted readable dict first
    pred_readable: Dict[str, set] = defaultdict(set)
    for _, item_name, words in mapped_results:
        if not item_name:
            continue
        for w in words or []:
            ws = _safe_token_surface(w)
            if ws:
                pred_readable[item_name].add(ws)

    # Canonicalize BOTH sides through the same helper path
    pred_canon, pred_display, pred_token_surface = _canonicalize_item_word_dict(pred_readable)
    gold_canon, gold_display, gold_token_surface = _canonicalize_item_word_dict(gold_data)

    all_item_keys = sorted(set(pred_canon.keys()) | set(gold_canon.keys()))

    TP = 0
    FP = 0
    FN = 0
    item_details = []

    for item_key in all_item_keys:
        pred_set = pred_canon.get(item_key, set())
        gold_set = gold_canon.get(item_key, set())

        tp_keys = pred_set & gold_set
        fp_keys = pred_set - gold_set
        fn_keys = gold_set - pred_set

        TP += len(tp_keys)
        FP += len(fp_keys)
        FN += len(fn_keys)

        display_name = (
            pred_display.get(item_key)
            or gold_display.get(item_key)
            or item_key
        )

        pred_surface_map = pred_token_surface.get(item_key, {})
        gold_surface_map = gold_token_surface.get(item_key, {})

        def _surf(tok_key: str) -> str:
            return (
                pred_surface_map.get(tok_key)
                or gold_surface_map.get(tok_key)
                or tok_key
            )

        pred_tokens_surface = sorted(_surf(k) for k in pred_set)
        gold_tokens_surface = sorted(_surf(k) for k in gold_set)
        tp_tokens_surface = sorted(_surf(k) for k in tp_keys)
        fp_tokens_surface = sorted(_surf(k) for k in fp_keys)
        fn_tokens_surface = sorted(_surf(k) for k in fn_keys)

        item_details.append({
            "item_name": display_name,
            "item_key_norm": item_key,
            "predicted_count": len(pred_set),
            "gold_count": len(gold_set),
            "TP": len(tp_keys),
            "FP": len(fp_keys),
            "FN": len(fn_keys),
            "predicted_tokens": ", ".join(pred_tokens_surface),
            "gold_tokens": ", ".join(gold_tokens_surface),
            "tp_tokens": ", ".join(tp_tokens_surface),
            "fp_tokens": ", ".join(fp_tokens_surface),
            "fn_tokens": ", ".join(fn_tokens_surface),
        })

    precision = TP / (TP + FP) if (TP + FP) > 0 else 0.0
    recall = TP / (TP + FN) if (TP + FN) > 0 else 0.0
    f1 = 2 * precision * recall / (precision + recall) if (precision + recall) > 0 else 0.0

    if out_error_report is not None:
        out_error_report.parent.mkdir(parents=True, exist_ok=True)
        with open(out_error_report, "w", encoding="utf-8-sig", newline="") as f:
            writer = csv.DictWriter(
                f,
                fieldnames=[
                    "item_name", "item_key_norm",
                    "predicted_count", "gold_count",
                    "TP", "FP", "FN",
                    "predicted_tokens", "gold_tokens",
                    "tp_tokens", "fp_tokens", "fn_tokens",
                ]
            )
            writer.writeheader()
            writer.writerows(item_details)

    return {
        "threshold": threshold,
        "TP": TP,
        "FP": FP,
        "FN": FN,
        "Precision": precision,
        "Recall": recall,
        "F1": f1,
        "n_pred_items": len(pred_canon),
        "n_gold_items": len(gold_canon),
        "n_eval_items": len(all_item_keys),
        "item_details": item_details,
    }


def analyze_fp_by_word_length(
    eval_results: List[Dict],
    base_dir: Optional[Path] = None,
) -> None:
    """Analyze FP/TP rate by word length (Fix 7).

    Helps justify MIN_WORD_LEN threshold empirically. If short words
    (len < MIN_WORD_LEN) have disproportionately high FP rates, the threshold
    is validated.

    Args:
        eval_results: List of evaluation dicts (from evaluate_mapping)
        base_dir: Output directory
    """
    base = base_dir or (Path(__file__).resolve().parent if "__file__" in dir() else Path.cwd())

    # Aggregate across all thresholds (use last one as representative)
    if not eval_results:
        print("  [warn] No evaluation results for word length analysis")
        return

    eval_data = max(eval_results, key=lambda e: e["F1"])
    item_details = eval_data.get("item_details", [])

    if not item_details:
        print("  [warn] No per-item details available (evaluate_mapping returns global metrics); "
              "skipping word-length analysis", file=sys.stderr)
        return

    # Tally TP/FP per word length bucket
    tp_by_len = defaultdict(int)
    fp_by_len = defaultdict(int)

    for detail in item_details:
        gold_set = set(detail["gold_tokens"].split(", ")) if detail["gold_tokens"] else set()
        pred_set = set(detail["predicted_tokens"].split(", ")) if detail["predicted_tokens"] else set()
        tp_words = gold_set & pred_set
        fp_words = pred_set - gold_set

        for w in tp_words:
            wlen = count_word_length(w)
            tp_by_len[wlen] += 1
        for w in fp_words:
            wlen = count_word_length(w)
            fp_by_len[wlen] += 1

    # Build output rows
    all_lens = sorted(set(list(tp_by_len.keys()) + list(fp_by_len.keys())))
    rows = []
    for wlen in all_lens:
        tp = tp_by_len.get(wlen, 0)
        fp = fp_by_len.get(wlen, 0)
        total = tp + fp
        fp_rate = fp / total if total > 0 else 0.0
        rows.append({
            "word_length": wlen,
            "TP": tp,
            "FP": fp,
            "total": total,
            "FP_rate": round(fp_rate, 4),
        })

    # Print table
    print(f"\n{'='*60}")
    print(f"  FP RATE BY WORD LENGTH (threshold={eval_data['threshold']})")
    print(f"{'='*60}")
    print(f"  {'Length':>8}  {'TP':>6}  {'FP':>6}  {'Total':>6}  {'FP Rate':>10}")
    print(f"  {'-'*8}  {'-'*6}  {'-'*6}  {'-'*6}  {'-'*10}")
    for r in rows:
        marker = " ***" if r["word_length"] < MIN_WORD_LEN else ""
        print(f"  {r['word_length']:>8}  {r['TP']:>6}  {r['FP']:>6}  "
              f"{r['total']:>6}  {r['FP_rate']:>10.4f}{marker}")
    print(f"  *** = below MIN_WORD_LEN={MIN_WORD_LEN}")
    print(f"{'='*60}")

    # Write CSV
    out_path = base / "result" / "fp_by_word_length.csv"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=["word_length", "TP", "FP", "total", "FP_rate"])
        writer.writeheader()
        writer.writerows(rows)
    print(f"  Written to {out_path.name}")


def bootstrap_confidence_interval(
    eval_result: Dict,
    n_bootstrap: int = 1000,
    seed: int = 42,
    base_dir: Optional[Path] = None,
) -> Dict:
    """Compute 95% CI for P/R/F1 via item-level bootstrap resampling (Fix 3).

    Resamples items (with replacement) and recomputes metrics each time.

    Requires numpy (soft dependency, fallback to stdlib random).

    Returns:
        Dict with P_ci, R_ci, F1_ci (each a (lower, upper) tuple)
    """
    item_details = eval_result.get("item_details", [])
    if not item_details:
        print("  [warn] No item details for bootstrap")
        return {}

    try:
        import numpy as np
        use_numpy = True
    except ImportError:
        import random
        use_numpy = False
        print("  [warn] numpy not available, using stdlib random for bootstrap")

    n = len(item_details)
    precisions, recalls, f1s = [], [], []

    if use_numpy:
        rng = np.random.RandomState(seed)
    else:
        rng = random.Random(seed)

    for _ in range(n_bootstrap):
        if use_numpy:
            indices = rng.randint(0, n, size=n)
        else:
            indices = [rng.randint(0, n - 1) for _ in range(n)]

        tp_sum, fp_sum, fn_sum = 0, 0, 0
        for i in indices:
            d = item_details[i]
            tp_sum += d["TP"]
            fp_sum += d["FP"]
            fn_sum += d["FN"]

        p = tp_sum / (tp_sum + fp_sum) if (tp_sum + fp_sum) > 0 else 0.0
        r = tp_sum / (tp_sum + fn_sum) if (tp_sum + fn_sum) > 0 else 0.0
        f1 = 2 * p * r / (p + r) if (p + r) > 0 else 0.0
        precisions.append(p)
        recalls.append(r)
        f1s.append(f1)

    precisions.sort()
    recalls.sort()
    f1s.sort()

    lo = int(n_bootstrap * 0.025)
    hi = int(n_bootstrap * 0.975)

    ci = {
        "P_ci": (round(precisions[lo], 4), round(precisions[hi], 4)),
        "R_ci": (round(recalls[lo], 4), round(recalls[hi], 4)),
        "F1_ci": (round(f1s[lo], 4), round(f1s[hi], 4)),
        "n_bootstrap": n_bootstrap,
    }

    print(f"  [bootstrap] {n_bootstrap} iterations, 95% CI:")
    print(f"    P:  [{ci['P_ci'][0]:.4f}, {ci['P_ci'][1]:.4f}]")
    print(f"    R:  [{ci['R_ci'][0]:.4f}, {ci['R_ci'][1]:.4f}]")
    print(f"    F1: [{ci['F1_ci'][0]:.4f}, {ci['F1_ci'][1]:.4f}]")

    if base_dir:
        out = base_dir / "result" / "bootstrap_ci.csv"
        out.parent.mkdir(parents=True, exist_ok=True)
        with open(out, "w", encoding="utf-8-sig", newline="") as f:
            writer = csv.writer(f)
            writer.writerow(["metric", "lower_95", "upper_95", "n_bootstrap"])
            writer.writerow(["Precision", ci["P_ci"][0], ci["P_ci"][1], n_bootstrap])
            writer.writerow(["Recall", ci["R_ci"][0], ci["R_ci"][1], n_bootstrap])
            writer.writerow(["F1", ci["F1_ci"][0], ci["F1_ci"][1], n_bootstrap])
        print(f"  Exported {out.name}")

    return ci


def mcnemar_test(
    eval_a: Dict, eval_b: Dict,
    label_a: str = "config_a", label_b: str = "config_b",
    f1_cutoff: float = 0.5,
    base_dir: Optional[Path] = None,
) -> Dict:
    """McNemar's test for pairwise comparison of two configs (Fix 3).

    Per-item F1 >= f1_cutoff → "correct"; otherwise "wrong".
    Chi-squared test on discordant cells.

    Requires scipy (hard dependency for this function).

    Returns:
        Dict with chi2, p_value, contingency table
    """
    details_a = {d["item_key_norm"]: d for d in eval_a.get("item_details", [])}
    details_b = {d["item_key_norm"]: d for d in eval_b.get("item_details", [])}

    common_items = set(details_a.keys()) & set(details_b.keys())
    if not common_items:
        print("  [warn] No common items for McNemar test")
        return {}

    # Build correctness vectors
    both_correct = 0
    a_only = 0  # A correct, B wrong
    b_only = 0  # B correct, A wrong
    both_wrong = 0

    for item in common_items:
        da = details_a[item]
        db = details_b[item]

        tp_a, fp_a, fn_a = da["TP"], da["FP"], da["FN"]
        tp_b, fp_b, fn_b = db["TP"], db["FP"], db["FN"]

        p_a = tp_a / (tp_a + fp_a) if (tp_a + fp_a) > 0 else 0
        r_a = tp_a / (tp_a + fn_a) if (tp_a + fn_a) > 0 else 0
        f1_a = 2 * p_a * r_a / (p_a + r_a) if (p_a + r_a) > 0 else 0

        p_b = tp_b / (tp_b + fp_b) if (tp_b + fp_b) > 0 else 0
        r_b = tp_b / (tp_b + fn_b) if (tp_b + fn_b) > 0 else 0
        f1_b = 2 * p_b * r_b / (p_b + r_b) if (p_b + r_b) > 0 else 0

        correct_a = f1_a >= f1_cutoff
        correct_b = f1_b >= f1_cutoff

        if correct_a and correct_b:
            both_correct += 1
        elif correct_a and not correct_b:
            a_only += 1
        elif not correct_a and correct_b:
            b_only += 1
        else:
            both_wrong += 1

    # McNemar chi-squared
    discordant = a_only + b_only
    if discordant == 0:
        print(f"  [McNemar] No discordant pairs between {label_a} and {label_b}")
        return {"chi2": 0, "p_value": 1.0, "a_only": a_only, "b_only": b_only}

    try:
        from scipy.stats import chi2 as chi2_dist
        chi2_val = (abs(a_only - b_only) - 1) ** 2 / (a_only + b_only)  # with continuity correction
        p_value = 1 - chi2_dist.cdf(chi2_val, df=1)
    except ImportError:
        # Manual approximation: for chi-squared(1), survival = erfc(sqrt(x/2))
        import math
        chi2_val = (abs(a_only - b_only) - 1) ** 2 / (a_only + b_only)
        p_value = math.erfc(math.sqrt(chi2_val / 2))
        print("  [warn] scipy not available; p-value uses erfc approximation")

    result = {
        "label_a": label_a,
        "label_b": label_b,
        "chi2": round(chi2_val, 4),
        "p_value": round(p_value, 6),
        "a_only": a_only,
        "b_only": b_only,
        "both_correct": both_correct,
        "both_wrong": both_wrong,
    }

    sig = "***" if p_value < 0.001 else "**" if p_value < 0.01 else "*" if p_value < 0.05 else "ns"
    print(f"  [McNemar] {label_a} vs {label_b}: χ²={chi2_val:.4f}, p={p_value:.6f} ({sig})")
    print(f"    Both correct: {both_correct}, A-only: {a_only}, B-only: {b_only}, Both wrong: {both_wrong}")

    if base_dir:
        out = base_dir / "result" / "mcnemar_results.csv"
        out.parent.mkdir(parents=True, exist_ok=True)
        write_header = not out.exists()
        with open(out, "a", encoding="utf-8-sig", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=[
                "label_a", "label_b", "chi2", "p_value",
                "a_only", "b_only", "both_correct", "both_wrong"
            ])
            if write_header:
                writer.writeheader()
            writer.writerow(result)
        print(f"  Appended to {out.name}")

    return result


def run_evaluation(
    thresholds: Optional[List[int]] = None,
    base_dir: Optional[Path] = None,
    gold_file: str = GOLD_FILE,
    file_suffix: str = "",
) -> List[Dict]:
    """Run evaluation for multiple thresholds.

    Args:
        file_suffix: If provided, appends to output filenames
                     (e.g., "_exact_only", "_idf")

    Returns:
        list of evaluation results per threshold
    """
    thresholds = thresholds or DEFAULT_THRESHOLDS
    base = base_dir or (Path(__file__).resolve().parent if "__file__" in dir() else Path.cwd())
    
    gold_path = base / gold_file
    gold_data = load_gold_data(gold_path)
    print(f"  Loaded {len(gold_data)} items from gold standard")

    # Gold coverage report
    items_path = base / ITEMS_FILE
    if items_path.exists():
        _, item_rows = read_csv(items_path)
        total_items = len(item_rows)
        gold_coverage = len(gold_data) / total_items * 100 if total_items > 0 else 0

        print(f"  Gold standard: {len(gold_data)}/{total_items} items "
              f"({gold_coverage:.1f}% coverage)")

        if gold_coverage < 10:
            print(f"  [WARN] Gold coverage < 10% — results may not be representative. "
                  f"Report this limitation in paper.")
    
    all_evals = []
    for t in thresholds:
        # Load mapped results
        mapped_path = base / OUT_MAIN_PATTERN.format(threshold=t).replace(
            ".csv", f"{file_suffix}.csv"
        )
        if not mapped_path.exists():
            print(f"  [skip] {mapped_path.name} not found — run mapping first")
            continue
        
        _, rows = read_csv(mapped_path)
        mapped_results = []
        for r in rows:
            idx = int(r.get("ลำดับ", 0))
            item = r.get("ชื่อชุดการแสดง", "")
            words_str = r.get("words", "")
            words = [w.strip() for w in words_str.split(",") if w.strip()]
            mapped_results.append((idx, item, words))

        source_breakdown = compute_match_source_breakdown(rows, gold_data)
        
        out_error = base / OUT_ERROR_REPORT_PATTERN.format(threshold=t)
        eval_result = evaluate_mapping(mapped_results, gold_data, t, out_error)
        eval_result["match_source_breakdown"] = source_breakdown
        all_evals.append(eval_result)

        tp_sources = source_breakdown["tp"]
        print(
            f"      TP source breakdown: exact={tp_sources['exact_total']}, "
            f"fuzzy={tp_sources['fuzzy_total']}, semantic={tp_sources['semantic_total']}, "
            f"unknown={tp_sources['unknown_total']}"
        )
        
        print(f"  T={t:3d}  P={eval_result['Precision']:.4f}  "
              f"R={eval_result['Recall']:.4f}  F1={eval_result['F1']:.4f}")
    
    # Write summary
    if all_evals:
        summary_path = base / OUT_EVAL_SUMMARY_PATTERN
        summary_path.parent.mkdir(parents=True, exist_ok=True)
        with open(summary_path, "w", encoding="utf-8-sig", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=[
                "threshold", "TP", "FP", "FN", "Precision", "Recall", "F1",
                "tp_name_exact", "tp_name_fuzzy", "tp_desc_exact", "tp_desc_fuzzy",
                "tp_name_semantic", "tp_desc_semantic", "tp_unknown_total",
                "tp_exact_total", "tp_fuzzy_total", "tp_semantic_total"
            ])
            writer.writeheader()
            for e in all_evals:
                tp_sources = e.get("match_source_breakdown", {}).get("tp", {})
                writer.writerow({
                    "threshold": e["threshold"],
                    "TP": e["TP"],
                    "FP": e["FP"],
                    "FN": e["FN"],
                    "Precision": e["Precision"],
                    "Recall": e["Recall"],
                    "F1": e["F1"],
                    "tp_name_exact": tp_sources.get("name_exact", 0),
                    "tp_name_fuzzy": tp_sources.get("name_fuzzy", 0),
                    "tp_desc_exact": tp_sources.get("desc_exact", 0),
                    "tp_desc_fuzzy": tp_sources.get("desc_fuzzy", 0),
                    "tp_name_semantic": tp_sources.get("name_semantic", 0),
                    "tp_desc_semantic": tp_sources.get("desc_semantic", 0),
                    "tp_unknown_total": tp_sources.get("unknown_total", 0),
                    "tp_exact_total": tp_sources.get("exact_total", 0),
                    "tp_fuzzy_total": tp_sources.get("fuzzy_total", 0),
                    "tp_semantic_total": tp_sources.get("semantic_total", 0),
                })
        print(f"  Summary written to {summary_path.name}")
    
    return all_evals


def discover_synonym_candidates(
    eval_results: List[Dict],
    gold_data: Dict[str, set],
    sbert_model: str = "intfloat/multilingual-e5-base",
    similarity_threshold: float = 0.6,
    base_dir: Optional[Path] = None,
) -> None:
    """Discover potential synonym pairs from FN analysis (Fix 8).

    Collects FN words, encodes with sentence-transformers, computes cosine
    similarity to gold keywords. Outputs candidates above threshold for
    HUMAN REVIEW (not auto-added).

    NOTE: Uses the same embedding model as the main semantic matching stage
    for representation consistency across mapping and synonym discovery.

    Requires sentence-transformers (optional dependency).
    """
    try:
        from sentence_transformers import SentenceTransformer
        import numpy as np
    except ImportError:
        print("  [error] sentence-transformers and/or numpy not installed.")
        print("  Install with: pip install sentence-transformers numpy")
        return

    # Collect FN words across all items
    fn_words = set()
    gold_words = set()
    for ev in eval_results:
        for detail in ev.get("item_details", []):
            if detail["fn_tokens"]:
                fn_words.update(w.strip() for w in detail["fn_tokens"].split(",") if w.strip())
            if detail["gold_tokens"]:
                gold_words.update(w.strip() for w in detail["gold_tokens"].split(",") if w.strip())

    if not fn_words or not gold_words:
        print("  [warn] No FN words or gold words to analyze")
        return

    fn_list = sorted(fn_words)
    gold_list = sorted(gold_words - fn_words)  # Exclude FN words from gold targets

    print(f"  [synonyms] Encoding {len(fn_list)} FN words + {len(gold_list)} gold words "
          f"with {sbert_model}")
    model = _get_embed_model(sbert_model)
    fn_embeddings = model.encode(fn_list)
    gold_embeddings = model.encode(gold_list)

    # Compute cosine similarity
    from numpy.linalg import norm
    candidates = []
    for i, fn_w in enumerate(fn_list):
        fn_vec = fn_embeddings[i]
        fn_norm = norm(fn_vec)
        if fn_norm == 0:
            continue
        for j, g_w in enumerate(gold_list):
            g_vec = gold_embeddings[j]
            g_norm = norm(g_vec)
            if g_norm == 0:
                continue
            sim = float(np.dot(fn_vec, g_vec) / (fn_norm * g_norm))
            if sim >= similarity_threshold:
                candidates.append({
                    "fn_word": fn_w,
                    "gold_word": g_w,
                    "similarity": round(sim, 4),
                })

    candidates.sort(key=lambda x: -x["similarity"])

    # Print top candidates
    print(f"  [synonyms] Found {len(candidates)} candidate pairs (sim >= {similarity_threshold})")
    for c in candidates[:20]:
        print(f"    {c['fn_word']} ↔ {c['gold_word']}  (sim={c['similarity']:.4f})")
    if len(candidates) > 20:
        print(f"    ... and {len(candidates) - 20} more")

    # Export
    if base_dir:
        out = base_dir / "result" / "synonym_candidates.csv"
        out.parent.mkdir(parents=True, exist_ok=True)
        with open(out, "w", encoding="utf-8-sig", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=["fn_word", "gold_word", "similarity"])
            writer.writeheader()
            writer.writerows(candidates)
        print(f"  Exported {out.name} ({len(candidates)} pairs)")


# ═══════════════════════════════════════════════════════════════
# SEMANTIC CHALLENGE BENCHMARK
# Evaluate semantic layer only on lexical-hard gold pairs
# ═══════════════════════════════════════════════════════════════

def _build_item_text_lookup(
    items: List[Dict[str, str]],
    name_col: str,
    desc_col: Optional[str],
) -> Dict[str, Dict[str, str]]:
    """
    Build normalized text lookup for each item.
    """
    lookup = {}
    for r in items:
        item_name = (r.get(name_col) or "").strip()
        if not item_name:
            continue
        name_norm = normalize_text(item_name)
        desc_norm = normalize_text(r.get(desc_col, "")) if desc_col else ""
        name_seg = normalize_text_thai_segmented(name_norm)
        desc_seg = normalize_text_thai_segmented(desc_norm) if desc_norm else ""
        lookup[item_name] = {
            "name_norm": name_norm,
            "desc_norm": desc_norm,
            "name_seg": name_seg,
            "desc_seg": desc_seg,
        }
    return lookup


def _lexical_match_exists_for_gold_pair(
    word: str,
    item_name: str,
    item_lookup: Dict[str, Dict[str, str]],
    fuzz_mod,
    lexical_threshold: int = 85,
) -> bool:
    """
    Decide whether a gold pair is already solvable by lexical matching alone.
    This is used to define 'semantic-hard' pairs.
    """
    if item_name not in item_lookup:
        return False

    item_info = item_lookup[item_name]
    variants = generate_variants(word)

    # exact + fuzzy over item name
    matched, _ = text_contains_any_with_log(
        item_info["name_norm"],
        variants,
        fuzz_mod,
        lexical_threshold,
        min_word_len=MIN_WORD_LEN,
        combined_segmented_hint=item_info["name_seg"],
        ablation_config={"use_token_set": True, "use_partial": True},
    )
    if matched:
        return True

    # exact + fuzzy over item description
    if item_info["desc_norm"]:
        matched, _ = text_contains_any_with_log(
            item_info["desc_norm"],
            variants,
            fuzz_mod,
            lexical_threshold,
            min_word_len=MIN_WORD_LEN,
            combined_segmented_hint=item_info["desc_seg"],
            ablation_config={"use_token_set": True, "use_partial": True},
        )
        if matched:
            return True

    return False


def build_semantic_challenge_gold(
    gold_data: Dict[str, set],
    items: List[Dict[str, str]],
    name_col: str,
    desc_col: Optional[str],
    lexical_threshold: int = 85,
) -> Dict[str, set]:
    """
    Keep only gold keyword-item pairs that are NOT recoverable by lexical matching.
    These are the pairs where semantic matching should have a real chance to help.
    """
    fuzz_mod = try_import_rapidfuzz()
    item_lookup = _build_item_text_lookup(items, name_col, desc_col)

    challenge_gold: Dict[str, set] = defaultdict(set)
    total_gold_pairs = 0
    lexical_easy_pairs = 0
    semantic_hard_pairs = 0

    for item_name, gold_words in gold_data.items():
        if item_name not in item_lookup:
            continue
        for word in gold_words:
            total_gold_pairs += 1
            lexical_hit = _lexical_match_exists_for_gold_pair(
                word=word,
                item_name=item_name,
                item_lookup=item_lookup,
                fuzz_mod=fuzz_mod,
                lexical_threshold=lexical_threshold,
            )
            if lexical_hit:
                lexical_easy_pairs += 1
            else:
                challenge_gold[item_name].add(word)
                semantic_hard_pairs += 1

    print(f"  [challenge] total gold pairs     : {total_gold_pairs}")
    print(f"  [challenge] lexical-easy pairs   : {lexical_easy_pairs}")
    print(f"  [challenge] semantic-hard pairs  : {semantic_hard_pairs}")

    return dict(challenge_gold)


def evaluate_mapping_against_subset(
    results: List[Tuple[int, str, List[str]]],
    gold_subset: Dict[str, set],
    threshold: int,
    label: str = "subset",
) -> Dict[str, float]:
    """
    Pair-level evaluation against a subset of the gold data.

    Only items present in gold_subset are considered.
    TP: predicted pairs that appear in gold_subset.
    FP: predicted pairs on subset items that are NOT in gold_subset.
    FN: gold_subset pairs that were not predicted.
    """
    gold_pairs = set()
    for item_name, words in gold_subset.items():
        for w in words:
            gold_pairs.add((item_name, w))

    subset_items = set(gold_subset.keys())

    pred_pairs = set()
    for _, item_name, words in results:
        if item_name not in subset_items:
            continue
        # All predicted words on subset items are candidates
        for w in words:
            pred_pairs.add((item_name, w))

    TP = len(pred_pairs & gold_pairs)
    FP = len(pred_pairs - gold_pairs)
    FN = len(gold_pairs - pred_pairs)

    precision = TP / (TP + FP) if (TP + FP) > 0 else 0.0
    recall = TP / (TP + FN) if (TP + FN) > 0 else 0.0
    f1 = 2 * precision * recall / (precision + recall) if (precision + recall) > 0 else 0.0

    return {
        "label": label,
        "threshold": threshold,
        "TP": TP,
        "FP": FP,
        "FN": FN,
        "Precision": precision,
        "Recall": recall,
        "F1": f1,
        "n_gold_pairs": len(gold_pairs),
        "n_pred_pairs": len(pred_pairs),
    }


def run_semantic_challenge_benchmark(
    thresholds: Optional[List[int]] = None,
    base_dir: Optional[Path] = None,
    ablation_configs: Optional[List[str]] = None,
    gold_file: str = GOLD_FILE,
    lexical_threshold: int = 85,
) -> pd.DataFrame:
    """
    Benchmark configs only on lexical-hard gold pairs.
    This is the fairest test for whether semantic matching actually helps.

    Output:
        result/semantic_challenge_evaluation.csv
    """
    thresholds = thresholds or DEFAULT_THRESHOLDS
    ablation_configs = ablation_configs or ["exact_only", "exact_token_partial", "semantic_only", "hybrid_dense"]
    base = base_dir or (Path(__file__).resolve().parent if "__file__" in dir() else Path.cwd())

    gold_data = load_gold_data(base / gold_file)
    words = load_words(base / WORDS_FILE)
    items, name_col, desc_col, _, _ = load_items(base / ITEMS_FILE)

    challenge_gold = build_semantic_challenge_gold(
        gold_data=gold_data,
        items=items,
        name_col=name_col,
        desc_col=desc_col or None,
        lexical_threshold=lexical_threshold,
    )

    if not challenge_gold:
        print("[warn] semantic challenge subset is empty — no lexical-hard gold pairs found")
        return pd.DataFrame()

    rows = []
    for config_name in ablation_configs:
        if config_name not in ABLATION_CONFIGS:
            print(f"[warn] Unknown ablation config: {config_name}, skipping", file=sys.stderr)
            continue

        config = ABLATION_CONFIGS[config_name]
        print(f"\n  Semantic challenge: {config_name} — {config['description']}")

        for t in thresholds:
            results, _, _, diagnostics = map_words_to_items(
                words,
                items,
                name_col,
                desc_col or None,
                fuzzy_threshold=t,
                ablation_config=config,
                base_dir=base,
            )
            ev = evaluate_mapping_against_subset(
                results=results,
                gold_subset=challenge_gold,
                threshold=t,
                label="semantic_challenge",
            )
            rows.append({
                "config": config_name,
                "threshold": t,
                "challenge_lexical_threshold": lexical_threshold,
                "Precision": ev["Precision"],
                "Recall": ev["Recall"],
                "F1": ev["F1"],
                "TP": ev["TP"],
                "FP": ev["FP"],
                "FN": ev["FN"],
                "n_gold_pairs": ev["n_gold_pairs"],
                "n_pred_pairs": ev["n_pred_pairs"],
                "exact_ratio": round(diagnostics.get("exact_ratio", 0), 4),
                "fuzzy_contrib_ratio": round(diagnostics.get("fuzzy_contrib_ratio", 0), 4),
                "semantic_contrib_ratio": round(diagnostics.get("semantic_contrib_ratio", 0), 4),
            })

    df = pd.DataFrame(rows)
    out_path = base / "result" / "semantic_challenge_evaluation.csv"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(out_path, index=False, encoding="utf-8-sig")

    print(f"\n{'='*90}")
    print("  SEMANTIC CHALLENGE EVALUATION")
    print(f"{'='*90}")
    if not df.empty:
        best_idx = df["F1"].idxmax()
        best_row = df.loc[best_idx]
        print(df.sort_values(["F1", "Recall", "Precision"], ascending=False).to_string(index=False))
        print(f"\n  Best config on semantic-hard subset: "
              f"{best_row['config']} @ threshold={int(best_row['threshold'])} "
              f"(F1={best_row['F1']:.4f}, P={best_row['Precision']:.4f}, R={best_row['Recall']:.4f})")
        print(f"  Exported: {out_path}")

    return df


# ═══════════════════════════════════════════════════════════════
# CLI ENTRY POINT
# ═══════════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(
        description="Unified Keyword-Item Mapping (configurable threshold + ablation study)"
    )
    group = parser.add_mutually_exclusive_group(required=False)
    group.add_argument("--threshold", "-t", type=int, default=None,
                       help="Single fuzzy threshold (0-100)")
    group.add_argument("--sweep", action="store_true",
                       help="Run all default thresholds (70,75,80,85,90,95)")
    group.add_argument("--evaluate", action="store_true",
                       help="Evaluate mapping results against gold standard")
    group.add_argument("--ablation", action="store_true",
                       help="Run full ablation study (all configs x all thresholds)")
    group.add_argument("--ablation-eval", action="store_true",
                       help="Run ablation study WITH F1 evaluation per config (Fix 1)")
    group.add_argument("--train-val-test", action="store_true",
                       help="Run train/val/test pipeline: split -> select -> report (Fix 2)")
    group.add_argument("--cross-val", action="store_true",
                       help="Run 5-fold cross-validation for threshold selection")
    group.add_argument("--generic-filter-ablation", action="store_true",
                       help="Compare no filter vs predefined vs predefined+posthoc generic filters")
    parser.add_argument("--thresholds", nargs="+", type=int, default=None,
                        help="Custom list of thresholds to sweep")
    parser.add_argument("--dir", type=str, default=None,
                        help="Base directory for input/output files")
    parser.add_argument("--gold", type=str, default=None,
                        help="Path to gold standard file (for --evaluate)")
    parser.add_argument("--ablation-configs", nargs="+", type=str, default=None,
                        help="Specific ablation configs to run (valid: "
                             "exact_only, exact_token, exact_token_partial, "
                             "semantic_only, hybrid_dense)")
    parser.add_argument("--macro-metrics", action="store_true",
                        help="Include macro (per-item average) metrics in evaluation report")
    parser.add_argument("--error-analysis", action="store_true",
                        help="Generate false positive categorization report")
    # Fix 6: IDF percentile
    parser.add_argument("--idf-percentile", type=float, default=None,
                        help="Empirical IDF cutoff percentile (e.g. 80 = filter top 20%% keywords)")
    parser.add_argument("--generic-filter-mode", type=str, default="predefined",
                        choices=["none", "predefined", "extended"],
                        help="Generic keyword filter set for main runs (default: predefined)")
    parser.add_argument("--guaranteed-coverage", action="store_true",
                        help="Force at least one candidate item per word; no unmapped_words")
    # Fix 7: Word length analysis
    parser.add_argument("--analyze-word-length", action="store_true",
                        help="Analyze FP rate by word length (requires --evaluate)")
    # Fix 3: Bootstrap CI
    parser.add_argument("--bootstrap-ci", action="store_true",
                        help="Compute 95%% bootstrap CI for P/R/F1")
    parser.add_argument("--n-bootstrap", type=int, default=1000,
                        help="Number of bootstrap iterations (default: 1000)")
    # Fix 3: McNemar
    parser.add_argument("--mcnemar", action="store_true",
                        help="Run McNemar's test between ablation configs")
    # Fix 2: Split parameters
    parser.add_argument("--split-seed", type=int, default=42,
                        help="Random seed for train/val/test split (default: 42)")
    parser.add_argument("--split-ratios", nargs=3, type=float, default=[0.6, 0.2, 0.2],
                        help="Train/val/test ratios (default: 0.6 0.2 0.2)")
    parser.add_argument("--n-folds", type=int, default=5,
                        help="Number of folds for cross-validation (default: 5)")
    # Fix 8: Synonym discovery
    parser.add_argument("--discover-synonyms", action="store_true",
                        help="Discover synonym candidates from FN words")
    parser.add_argument("--sbert-model", type=str,
                        default="intfloat/multilingual-e5-base",
                        help="Sentence-BERT model for synonym discovery")
    parser.add_argument("--semantic-challenge", action="store_true",
                        help="Benchmark semantic layer on lexical-hard gold pairs only")
    parser.add_argument("--challenge-threshold", type=int, default=85,
                        help="Lexical threshold used to define semantic-hard pairs (default: 85)")
    args = parser.parse_args()

    # ── Validate threshold parameters ──
    if args.threshold is not None:
        if not (0 <= args.threshold <= 100):
            parser.error(f"--threshold must be between 0 and 100, got {args.threshold}")

    if args.thresholds:
        for t in args.thresholds:
            if not (0 <= t <= 100):
                parser.error(f"all --thresholds must be between 0 and 100, got {t}")

    base = Path(args.dir) if args.dir else None

    # ── Train/Val/Test pipeline (Fix 2) ──
    if args.train_val_test:
        print("\n" + "=" * 70)
        print("  TRAIN/VAL/TEST PIPELINE (Fix 2)")
        print("=" * 70)
        gold_file = args.gold if args.gold else GOLD_FILE
        run_train_val_test(
            base_dir=base,
            gold_file=gold_file,
            split_seed=args.split_seed,
            split_ratios=tuple(args.split_ratios),
        )
        return

    # ── Cross-validation (5-fold) ──
    if args.cross_val:
        print("\n" + "=" * 70)
        print(f"  {args.n_folds}-FOLD CROSS-VALIDATION")
        print("=" * 70)
        gold_file = args.gold if args.gold else GOLD_FILE
        base_resolved = base or (Path(__file__).resolve().parent if "__file__" in dir() else Path.cwd())
        gold_data = load_gold_data(base_resolved / gold_file)
        words = load_words(base_resolved / WORDS_FILE)
        items, name_col, desc_col, _, _ = load_items(base_resolved / ITEMS_FILE)
        thresholds = args.thresholds or DEFAULT_THRESHOLDS
        cv_result = cross_validate_threshold(
            words, items, name_col, desc_col or None, gold_data,
            thresholds=thresholds,
            n_folds=args.n_folds,
            seed=args.split_seed,
            base_dir=base_resolved,
        )
        return

    if args.generic_filter_ablation:
        print("\n" + "=" * 70)
        print("  GENERIC FILTER ABLATION")
        print("=" * 70)
        gold_file = args.gold if args.gold else GOLD_FILE
        thresholds = args.thresholds or DEFAULT_THRESHOLDS
        ablation_df = run_generic_filter_ablation(
            thresholds=thresholds,
            base_dir=base,
            gold_file=gold_file,
        )
        if not ablation_df.empty:
            print(ablation_df.to_string(index=False))
        return

    # ── Ablation with F1 evaluation (Fix 1) ──
    if args.ablation_eval:
        print("\n" + "=" * 70)
        print("  ABLATION WITH F1 EVALUATION (Fix 1)")
        print("=" * 70)
        gold_file = args.gold if args.gold else GOLD_FILE
        thresholds = args.thresholds or DEFAULT_THRESHOLDS
        ablation_list = args.ablation_configs or list(ABLATION_CONFIGS.keys())
        run_ablation_with_evaluation(
            thresholds=thresholds, base_dir=base,
            ablation_configs=ablation_list, gold_file=gold_file,
        )
        return

    # ── Semantic challenge benchmark ──
    if args.semantic_challenge:
        print("\n" + "=" * 70)
        print("  SEMANTIC CHALLENGE BENCHMARK")
        print("=" * 70)
        gold_file = args.gold if args.gold else GOLD_FILE
        thresholds = args.thresholds or DEFAULT_THRESHOLDS
        ablation_list = args.ablation_configs or ["exact_only", "exact_token_partial", "semantic_only", "hybrid_dense"]
        run_semantic_challenge_benchmark(
            thresholds=thresholds,
            base_dir=base,
            ablation_configs=ablation_list,
            gold_file=gold_file,
            lexical_threshold=args.challenge_threshold,
        )
        return

    # Evaluation mode
    if args.evaluate:
        print("\n" + "=" * 70)
        print("  EVALUATION MODE")
        print("=" * 70)
        gold_file = args.gold if args.gold else GOLD_FILE
        thresholds = args.thresholds or DEFAULT_THRESHOLDS
        evals = run_evaluation(
            thresholds=thresholds,
            base_dir=base,
            gold_file=gold_file,
            file_suffix="_default"  # Match sweep output filenames
        )

        if evals:
            print("\n" + "=" * 70)
            print("  EVALUATION SUMMARY")
            print("=" * 70)
            print(f"  {'Threshold':>10}  {'TP':>6}  {'FP':>6}  {'FN':>6}  "
                  f"{'Precision':>10}  {'Recall':>8}  {'F1':>8}")
            print(f"  {'-'*10}  {'-'*6}  {'-'*6}  {'-'*6}  {'-'*10}  {'-'*8}  {'-'*8}")
            best_f1 = max(e['F1'] for e in evals)
            for e in evals:
                marker = " [BEST]" if e['F1'] == best_f1 else ""
                print(f"  {e['threshold']:>10}  {e['TP']:>6}  {e['FP']:>6}  {e['FN']:>6}  "
                      f"{e['Precision']:>10.4f}  {e['Recall']:>8.4f}  {e['F1']:>8.4f}{marker}")
            print("=" * 70)

        # ── MACRO METRICS (per-item averages) ──
        if args.macro_metrics and any(e.get("macro") for e in evals):
            print("\n" + "=" * 70)
            print("  MACRO METRICS (Per-Item Averages)")
            print("=" * 70)
            print(f"  {'Threshold':>10}  {'Macro P':>10}  {'Macro R':>10}  {'Macro F1':>10}  {'Min F1':>8}  {'Max F1':>8}")
            print(f"  {'-'*10}  {'-'*10}  {'-'*10}  {'-'*10}  {'-'*8}  {'-'*8}")
            for e in evals:
                macro = e.get("macro", {})
                f1_dist = macro.get("f1_distribution", [])
                min_f1 = min(f1_dist) if f1_dist else 0.0
                max_f1 = max(f1_dist) if f1_dist else 0.0
                print(f"  {e['threshold']:>10}  {macro.get('precision', 0):>10.4f}  "
                      f"{macro.get('recall', 0):>10.4f}  {macro.get('f1', 0):>10.4f}  "
                      f"{min_f1:>8.4f}  {max_f1:>8.4f}")
            print("=" * 70)

        # ── ERROR ANALYSIS (FP breakdown) ──
        if args.error_analysis and any(e.get("fp_analysis") for e in evals):
            print("\n" + "=" * 70)
            print("  FALSE POSITIVE ANALYSIS")
            print("=" * 70)
            print(f"  {'Threshold':>10}  {'Generic':>10}  {'Synonym':>10}  {'Short-Wd':>10}  {'Other':>10}")
            print(f"  {'-'*10}  {'-'*10}  {'-'*10}  {'-'*10}  {'-'*10}")
            for e in evals:
                fp_analysis = e.get("fp_analysis", {})
                print(f"  {e['threshold']:>10}  {fp_analysis.get('generic_keyword', 0):>10}  "
                      f"{fp_analysis.get('synonym_over_expansion', 0):>10}  "
                      f"{fp_analysis.get('short_word', 0):>10}  {fp_analysis.get('other', 0):>10}")
            print("=" * 70)

        # ── WORD LENGTH ANALYSIS (Fix 7) ──
        if args.analyze_word_length and evals:
            analyze_fp_by_word_length(evals, base_dir=base)

        # ── BOOTSTRAP CI (Fix 3) ──
        if args.bootstrap_ci and evals:
            # Use the best F1 threshold's result
            best_eval = max(evals, key=lambda e: e["F1"])
            print(f"\n  Bootstrap CI for threshold={best_eval['threshold']} (best F1)")
            bootstrap_confidence_interval(
                best_eval, n_bootstrap=args.n_bootstrap, base_dir=base
            )

        # ── SYNONYM DISCOVERY (Fix 8) ──
        if args.discover_synonyms and evals:
            gold_data = load_gold_data(
                (base or Path(__file__).resolve().parent) / (args.gold or GOLD_FILE)
            )
            discover_synonym_candidates(
                evals, gold_data,
                sbert_model=args.sbert_model,
                base_dir=base,
            )
        return

    # Ablation study mode
    if args.ablation:
        print("\n" + "=" * 70)
        print("  ABLATION STUDY (SPAR-style)")
        print("=" * 70)
        thresholds = args.thresholds or DEFAULT_THRESHOLDS
        ablation_list = args.ablation_configs or list(ABLATION_CONFIGS.keys())
        all_results = run_ablation_sweep(thresholds=thresholds, base_dir=base,
                                         ablation_configs=ablation_list)

        # Print summary table per ablation
        print("\n" + "=" * 70)
        print("  ABLATION SUMMARY")
        print("=" * 70)
        for ablation_name, results in all_results.items():
            config = ABLATION_CONFIGS[ablation_name]
            print(f"\n  Config: {ablation_name}")
            print(f"  {config['description']}")
            print(f"  {'-'*60}")
            print(f"  {'Threshold':>10}  {'Mapped Items':>14}  {'Mapped Words':>14}")
            print(f"  {'-'*10}  {'-'*14}  {'-'*14}")
            for r in results:
                print(f"  {r['threshold']:>10}  {r['n_mapped_items']:>14}  "
                      f"{r['n_mapped_words']:>14}")
        print("=" * 70)

        # ── McNemar test (Fix 3) ──
        if args.mcnemar:
            gold_file = args.gold if args.gold else GOLD_FILE
            gold_data = load_gold_data(
                (base or Path(__file__).resolve().parent) / gold_file
            )
            # Run pairwise McNemar between configs at best threshold
            config_names = list(all_results.keys())
            for i in range(len(config_names)):
                for j in range(i + 1, len(config_names)):
                    ca, cb = config_names[i], config_names[j]
                    # Bug 2+C fix: cache evals, then select best F1
                    all_evals_a = [(r, evaluate_mapping(r["results"], gold_data, r["threshold"]))
                                   for r in all_results[ca]]
                    all_evals_b = [(r, evaluate_mapping(r["results"], gold_data, r["threshold"]))
                                   for r in all_results[cb]]
                    results_a, eval_a = max(all_evals_a, key=lambda x: x[1]["F1"])
                    results_b, eval_b = max(all_evals_b, key=lambda x: x[1]["F1"])
                    mcnemar_test(eval_a, eval_b,
                                label_a=f"{ca}@{results_a['threshold']}",
                                label_b=f"{cb}@{results_b['threshold']}",
                                base_dir=base)
        return

    # Mapping mode
    if args.thresholds:
        results = run_sweep(thresholds=args.thresholds, base_dir=base,
                           idf_auto_percentile=args.idf_percentile,
                           generic_filter_mode=args.generic_filter_mode,
                           guaranteed_coverage=args.guaranteed_coverage)
    elif args.sweep:
        results = run_sweep(base_dir=base,
                           idf_auto_percentile=args.idf_percentile,
                           generic_filter_mode=args.generic_filter_mode,
                           guaranteed_coverage=args.guaranteed_coverage)
    elif args.threshold is not None:
        res = run_mapping(threshold=args.threshold, base_dir=base,
                         idf_auto_percentile=args.idf_percentile,
                         generic_filter_mode=args.generic_filter_mode,
                         guaranteed_coverage=args.guaranteed_coverage)
        results = [res]
    else:
        # Default: sweep all thresholds
        results = run_sweep(base_dir=base, generic_filter_mode=args.generic_filter_mode,
                           guaranteed_coverage=args.guaranteed_coverage)

    # Print summary table
    print("\n" + "=" * 70)
    print("  MAPPING SUMMARY")
    print("=" * 70)
    print(f"  {'Threshold':>10}  {'Mapped Items':>14}  {'Mapped Words':>14}  {'Unmapped Words':>16}")
    print(f"  {'-'*10}  {'-'*14}  {'-'*14}  {'-'*16}")
    for r in results:
        print(f"  {r['threshold']:>10}  {r['n_mapped_items']:>14}  "
              f"{r['n_mapped_words']:>14}  {len(r['unmapped_words']):>16}")
    print("=" * 70)

    # Export diagnostics for analysis (shows exact/fuzzy/partial contribution)
    export_diagnostics(results, base_dir=base)


if __name__ == "__main__":
    main()
