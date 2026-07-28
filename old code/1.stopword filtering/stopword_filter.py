# -*- coding: utf-8 -*-
# ==============================================================================
# Unified Stopword Filter — Gemini / GPT / Qwen / DeepSeek (Ollama Cloud Models)
#
# รวม 4 โมเดลไว้ไฟล์เดียว เลือกรันผ่าน --model {gemini,gpt,qwen,deepseek,all}
# - ใช้ Ollama API (OpenAI Compatible)
# - ชื่อโมเดลและพารามิเตอร์ตรงกันทุกโมเดล (fair comparison)
# - รองรับ batch, retry, runlog, sub-batching, reasoning stripping (DeepSeek)
# ==============================================================================

import os
import re
import sys
import time
import json
import hashlib
import random
import argparse
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
import pandas as pd
from datetime import datetime, timezone
from dotenv import load_dotenv

# ------------------------------------------------------------------------------
# LOAD .env
# ------------------------------------------------------------------------------
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(SCRIPT_DIR, ".env"), override=True)
OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions"

# ------------------------------------------------------------------------------
# MODEL PROFILES (OpenRouter — same as taxonomy_unified_v4)
# ------------------------------------------------------------------------------
MODEL_CONFIGS = {
    "gemini":   {"model_id": "google/gemini-3-flash-preview", "label": "Gemini 3 Flash Preview", "key_env": "OPENROUTER_API_KEY_GEMINI", "reasoning": False},
    "gpt":      {"model_id": "openai/gpt-4o-mini",          "label": "GPT-4o-mini",      "key_env": "OPENROUTER_API_KEY_GPT", "reasoning": False},
    "qwen":     {"model_id": "qwen/qwen-2.5-72b-instruct",  "label": "Qwen 2.5 72B",    "key_env": "OPENROUTER_API_KEY_QWEN", "reasoning": True},
    "deepseek": {"model_id": "deepseek/deepseek-chat",      "label": "DeepSeek V3",      "key_env": "OPENROUTER_API_KEY_DEEPSEEK", "reasoning": True},
}

def get_api_key(model_key: str) -> str:
    """Return per-model key from MODEL_CONFIGS, fallback to OPENROUTER_API_KEY."""
    config = MODEL_CONFIGS.get(model_key, {})
    key_env = config.get("key_env", "")
    if key_env:
        key = os.getenv(key_env, "").strip()
        if key:
            return key
    return os.getenv("OPENROUTER_API_KEY", "").strip()

# ------------------------------------------------------------------------------
# EXPERIMENT CONFIG (พารามิเตอร์เดียวกันทุกโมเดล เพื่อ fair comparison)
# ------------------------------------------------------------------------------
TEMPERATURE     = 0.1
MAX_TOKENS      = 8192
CHUNK_SIZE      = 30
CHUNK_SIZE_RETRY = 15
REQUEST_TIMEOUT = 600
MAX_RETRIES     = 5
BACKOFF_BASE    = 2.0
BACKOFF_JITTER  = (0.5, 1.5)
BACKOFF_INITIAL = 3.0

# ------------------------------------------------------------------------------
# INPUT / OUTPUT
# ------------------------------------------------------------------------------
INPUT_DIR  = os.path.join(SCRIPT_DIR, "input")
RESULT_DIR = os.path.join(SCRIPT_DIR, "result")
EVAL_DIR   = os.path.join(SCRIPT_DIR, "result_eval")

INPUT_CSV_FILE = os.path.join(INPUT_DIR, "cluster_results.csv")
EXPERT_STOPWORDS_FILE = os.path.join(INPUT_DIR, "stopword_by_expert.csv")
EXPERT_NONSTOPWORDS_FILE = os.path.join(INPUT_DIR, "nonstopword_by_expert.csv")

# ------------------------------------------------------------------------------
# PROMPT TEMPLATE
# ------------------------------------------------------------------------------
PROMPT_TEMPLATE = """
# MISSION BRIEFING

คุณจะรับบทเป็น **ผู้เชี่ยวชาญด้านภาษาศาสตร์เชิงคำนวณ (Computational Linguist)** ที่มีความแม่นยำสูง
**ห้ามอธิบายขั้นตอนการให้เหตุผลหรือ Reasoning ใด ๆ** ให้ตอบเฉพาะผลลัพธ์ในรูปแบบที่กำหนดเท่านั้น

**PRIMARY OBJECTIVE (เป้าหมายหลัก):**
วิเคราะห์ข้อมูลคำศัพท์ที่ได้จากการแบ่งกลุ่ม (Clustering) และจำแนกคำที่มีคุณค่าเชิงความหมายต่ำเกินไปสำหรับการใช้ต่อในงาน downstream ออกมาอย่างระมัดระวัง

เป้าหมายของขั้นตอนนี้คือการลดคำรบกวนเชิงความหมายในข้อมูลนาฏศิลป์และศิลปวัฒนธรรมไทย โดยยังต้องรักษาคำที่อาจมีคุณค่าเชิงความหมายสำหรับกระบวนการ downstream ไว้ให้มากที่สุด

ขั้นตอนนี้ไม่ใช่การจัดหมวดเชิงลึก และไม่ต้องตัดสินว่าคำอยู่ในหมวดใด เพียงให้พิจารณาว่าคำใดมี semantic value ต่ำเกินไปสำหรับการใช้ต่อในงาน downstream

**CONTEXT (บริบทของข้อมูล):**
ข้อมูลทั้งหมดในส่วน `Full Dataset for Analysis` มาจากคลังข้อมูลเกี่ยวกับ **"ศิลปวัฒนธรรม นาฏศิลป์ และการแสดงของไทย"**

คุณต้องปฏิบัติตามเกณฑ์, ตัวอย่าง, และรูปแบบผลลัพธ์ที่กำหนดให้อย่างเคร่งครัด
**ห้ามเพิ่มหมวดใหม่, ห้ามเปลี่ยนชื่อหมวด, และห้ามตอบภาษาอื่นนอกจากภาษาไทย**

---

# SECTION 1: CRITERIA FOR JUDGEMENT (เกณฑ์การตัดสินใจ)

คุณต้องใช้เกณฑ์ 4 ข้อต่อไปนี้เป็นหลักในการตัดสินใจ โดย **คำหนึ่งต้องถูกจัดให้อยู่เพียงหมวดเดียว**
และใช้ลำดับความสำคัญดังนี้:
1) คำที่มีความหมายกว้าง (Umbrella Term)
2) คำเชิงนามธรรม หรือ คำเชิงประเมินค่า (Abstract/Evaluative Term)
3) คำเฉพาะโดเมนที่พบบ่อยเกินไป (Domain-Specific Overuse)
4) คำซ้ำซ้อน หรือ คำพ้องความหมาย (Redundant/Synonym)

**นิยามเกณฑ์:**
1. **คำที่มีความหมายกว้าง (Umbrella Term / Low Semantic Weight):**
   - คำทั่วไปที่ใช้เป็นหมวดหมู่, ไม่ชี้เฉพาะเจาะจง, ใช้ได้หลายบริบท
   - ตัวอย่าง: `ลักษณะ`, `บุคคล`, `สถานที่`, `กิจกรรม`, `รูปแบบ`, `ประเทศ`

2. **คำเชิงนามธรรม หรือ คำเชิงประเมินค่า (Abstract or Evaluative Term):**
   - แสดงแนวคิด ความรู้สึก ความเชื่อ หรือความคิดเห็น/คุณค่า
   - ตัวอย่าง: `ความสุข`, `ความเชื่อ`, `ความสำคัญ`, `งดงาม`, `สวยงาม`, `ยอดเยี่ยม`

3. **คำเฉพาะโดเมนที่พบบ่อยเกินไป (Domain-Specific Overuse):**
   - คำเทคนิคในโดเมนนี้ที่พบถี่มากจนไม่ช่วยจำแนก
   - ตัวอย่าง: `ศิลปะ`, `วัฒนธรรม`, `การแสดง`, `ประเพณี`, `นาฏศิลป์`

4. **คำซ้ำซ้อน หรือ คำพ้องความหมาย (Redundant or Synonym):**
   - ความหมายซ้ำ/ใกล้เคียงจนเก็บไว้เพียงคำเดียวได้
   - ตัวอย่าง: `สวยงาม` และ `งดงาม`; `พิธี` และ `พิธีกรรม`

**ข้อควรระวังเพิ่มเติมสำหรับบริบทนาฏศิลป์ไทย:**
- อย่าลบคำเฉพาะโดเมนที่ยังสามารถช่วยแยกอัตลักษณ์การแสดง ตัวละคร เครื่องดนตรี ท่ารำ พิธี หรือบริบทวัฒนธรรมไทยได้
- ให้ลบเฉพาะคำที่กว้างเกินไป นามธรรมเกินไป พบทั่วไปในโดเมนจนไม่ช่วยจำแนก หรือซ้ำซ้อนเชิงความหมายอย่างชัดเจน
- หากไม่แน่ใจว่าคำหนึ่งยังอาจมีคุณค่าต่อการจัดหมวด downstream หรือไม่ ให้เอนเอียงไปทางเก็บคำไว้

---

# SECTION 2: EXAMPLE OF EXECUTION (ตัวอย่างการทำงาน)

**Input ตัวอย่าง (CSV):**
word,cluster_label
ประเทศ,2
สนุกสนาน,2
การแสดง,1
งดงาม,2

**Output ที่คาดหวัง:**
# ผลการวิเคราะห์ Stopword
## Cluster 1 (จำนวน 1 คำ)
1. คำที่มีความหมายกว้าง (Umbrella Terms):
-
2. คำเชิงนามธรรม หรือ คำเชิงประเมินค่า (Abstract or Evaluative Terms):
-
3. คำเฉพาะโดเมนที่พบบ่อยเกินไป (Domain-Specific Overuse):
* `การแสดง`: คำพื้นฐานในโดเมน ทำให้จำแนกต่ำ
4. คำซ้ำซ้อน หรือ คำพ้องความหมาย (Redundant or Synonym):
-

## Cluster 2 (จำนวน 3 คำ)
1. คำที่มีความหมายกว้าง (Umbrella Terms):
* `ประเทศ`: นามทั่วไป ใช้เป็นหมวดหมู่
2. คำเชิงนามธรรม หรือ คำเชิงประเมินค่า (Abstract or Evaluative Terms):
* `สนุกสนาน`: แสดงความรู้สึก/คุณค่า
* `งดงาม`: แสดงคุณค่า/ความคิดเห็น
3. คำเฉพาะโดเมนที่พบบ่อยเกินไป (Domain-Specific Overuse):
-
4. คำซ้ำซ้อน หรือ คำพ้องความหมาย (Redundant or Synonym):
-

---

# SECTION 3: FULL DATASET FOR ANALYSIS (ข้อมูลทั้งหมดสำหรับวิเคราะห์)

```csv
{csv_data}
```

# SECTION 4: OUTPUT REQUIREMENTS (รูปแบบผลลัพธ์ที่ต้องการ)

วิเคราะห์ทีละ Cluster (เรียงจากใหญ่ไปเล็กถ้าเป็นไปได้)
สำหรับแต่ละ Cluster ให้แยกหัวข้อ 4 ประเภทตามเกณฑ์ด้านบน

จัดรูปแบบให้เป็นหัวข้อและ bullet ดังนี้:

# ผลการวิเคราะห์ Stopword
## Cluster [หมายเลข] (จำนวน [X] คำ)
1. คำที่มีความหมายกว้าง (Umbrella Terms):
* `คำ`: เหตุผลย่อ หรือ "-" ถ้าไม่มี
2. คำเชิงนามธรรม หรือ คำเชิงประเมินค่า (Abstract or Evaluative Terms):
* `คำ`: เหตุผลย่อ หรือ "-" ถ้าไม่มี
3. คำเฉพาะโดเมนที่พบบ่อยเกินไป (Domain-Specific Overuse):
* `คำ`: เหตุผลย่อ หรือ "-" ถ้าไม่มี
4. คำซ้ำซ้อน หรือ คำพ้องความหมาย (Redundant or Synonym):
* `คำ`: เหตุผลย่อ หรือ "-" ถ้าไม่มี

**ข้อห้าม:**
- ห้ามเพิ่มหมวดใหม่
- ห้ามเปลี่ยนเลขลำดับหัวข้อ
- ห้ามใช้ภาษาที่ไม่ใช่ภาษาไทย
- ห้ามเพิ่มข้อมูลที่ไม่มีใน CSV
"""

# ------------------------------------------------------------------------------
# TIME HELPERS
# ------------------------------------------------------------------------------
def now_utc_iso_z() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

# ------------------------------------------------------------------------------
# HTTP SESSION (connection pooling)
# ------------------------------------------------------------------------------
_SESSION = None

def get_session():
    global _SESSION
    if _SESSION is None:
        _SESSION = requests.Session()
        adapter = HTTPAdapter(
            pool_connections=10,
            pool_maxsize=10,
            max_retries=Retry(total=0, backoff_factor=0),
        )
        _SESSION.mount("https://", adapter)
        _SESSION.mount("http://", adapter)
    return _SESSION

# ------------------------------------------------------------------------------
# DeepSeek reasoning stripper
# ------------------------------------------------------------------------------
RE_THINK_BLOCK = re.compile(r"<think>.*?</think>", re.DOTALL | re.IGNORECASE)
RE_REASONING_HDR = re.compile(
    r"^\s*(?:Reasoning|Thought|Thinking|Chain of Thought)\s*:.*?$",
    re.IGNORECASE | re.MULTILINE,
)

def strip_reasoning(text: str) -> str:
    if not text:
        return text
    text = RE_THINK_BLOCK.sub("", text)
    text = RE_REASONING_HDR.sub("", text)
    text = re.sub(r"^```[a-zA-Z0-9]*\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    return text.strip()

# ------------------------------------------------------------------------------
# RUNLOG / METADATA HELPERS
# ------------------------------------------------------------------------------
def dataset_signature(df: pd.DataFrame) -> str:
    concat = "\n".join(
        f"{w}|{c}"
        for w, c in zip(df["word"].astype(str), df["cluster_label"].astype(str))
    )
    return hashlib.md5(concat.encode("utf-8")).hexdigest()

def _runlog_path(model_key: str) -> str:
    return os.path.join(RESULT_DIR, f"stopwords_runlog_{model_key}.csv")

def _runmeta_path(model_key: str) -> str:
    return os.path.join(RESULT_DIR, f"stopwords_runmeta_{model_key}.json")

def _partial_path(model_key: str) -> str:
    return os.path.join(RESULT_DIR, f"stopwords_analysis_{model_key}.partial.csv")

def _stopwords_path(model_key: str) -> str:
    return os.path.join(RESULT_DIR, f"stopwords_analysis_{model_key}.csv")

def _nonstopwords_path(model_key: str) -> str:
    return os.path.join(RESULT_DIR, f"non_stopwords_{model_key}.csv")

RUNLOG_DTYPES = {
    "batch_id": "int64",
    "start_idx": "int64",
    "end_idx": "int64",
    "size": "int64",
    "status": "string",
    "attempts": "Int64",
    "last_error": "string",
    "updated_at": "string",
}

def init_runmeta(sig: str, chunk_size: int, model_id: str, model_key: str):
    meta = {
        "dataset_signature": sig,
        "chunk_size": chunk_size,
        "model": model_id,
        "created_at": now_utc_iso_z(),
    }
    path = _runmeta_path(model_key)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)

def load_runmeta(model_key: str):
    path = _runmeta_path(model_key)
    if not os.path.exists(path):
        return None
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)

def init_runlog(batches, model_key: str):
    df = pd.DataFrame(batches, columns=["batch_id", "start_idx", "end_idx", "size"])
    df["status"] = "pending"
    df["attempts"] = 0
    df["last_error"] = ""
    df["updated_at"] = now_utc_iso_z()
    df = df.astype(RUNLOG_DTYPES)
    df.to_csv(_runlog_path(model_key), index=False, encoding="utf-8-sig")

def load_runlog(model_key: str):
    path = _runlog_path(model_key)
    if not os.path.exists(path):
        return None
    return pd.read_csv(path, dtype=RUNLOG_DTYPES)

def update_runlog(batch_id: int, status: str, attempts: int, last_error: str, model_key: str):
    df = load_runlog(model_key)
    if df is None:
        return
    try:
        df = df.astype(RUNLOG_DTYPES)
    except Exception:
        pass
    mask = df["batch_id"] == batch_id
    df.loc[mask, "status"] = str(status)
    df.loc[mask, "attempts"] = int(attempts)
    df.loc[mask, "last_error"] = "" if last_error is None else str(last_error)
    df.loc[mask, "updated_at"] = now_utc_iso_z()
    df.to_csv(_runlog_path(model_key), index=False, encoding="utf-8-sig")

# ------------------------------------------------------------------------------
# API CALL WITH RETRIES (Updated for Ollama)
# ------------------------------------------------------------------------------
def call_api(prompt_content: str, model_key: str):
    session = get_session()
    config = MODEL_CONFIGS.get(model_key, {})
    model_id = config.get("model_id", model_key)
    api_key = get_api_key(model_key)
    is_reasoning = config.get("reasoning", False)

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    messages = []
    if is_reasoning:
        messages.append({
            "role": "system",
            "content": (
                "You are a helpful assistant. Respond ONLY in Thai. "
                "Do NOT include reasoning, thoughts, or chain-of-thought. "
                "Output must follow the required format."
            ),
        })
    messages.append({"role": "user", "content": prompt_content})

    payload = {
        "model": model_id,
        "messages": messages,
        "temperature": TEMPERATURE,
        "max_tokens": MAX_TOKENS,
    }

    delay = BACKOFF_INITIAL
    last_err = None

    for attempt in range(1, MAX_RETRIES + 1):
        try:
            print(f"   🔄 ส่ง request (attempt {attempt}/{MAX_RETRIES})...", end="", flush=True)
            resp = session.post(OPENROUTER_API_URL, headers=headers, json=payload, timeout=REQUEST_TIMEOUT)
            resp.raise_for_status()
            data = resp.json()
            content = data["choices"][0]["message"]["content"]
            if is_reasoning:
                content = strip_reasoning(content)
            print(" ✅ สำเร็จ")
            return content, None
        except requests.exceptions.Timeout as e:
            last_err = str(e)
            wait_time = delay + random.uniform(*BACKOFF_JITTER)
            print(f" ❌ หมดเวลา")
            print(f"   ⚠️  Attempt {attempt}/{MAX_RETRIES}: Timeout — รอ {wait_time:.1f}s")
            time.sleep(wait_time)
            delay *= BACKOFF_BASE
        except requests.exceptions.ConnectionError as e:
            last_err = str(e)
            wait_time = delay + random.uniform(*BACKOFF_JITTER)
            print(f" ❌ เชื่อมต่อล้มเหลว")
            print(f"   ⚠️  Attempt {attempt}/{MAX_RETRIES}: Connection error — รอ {wait_time:.1f}s")
            time.sleep(wait_time)
            delay *= BACKOFF_BASE
        except Exception as e:
            last_err = str(e)
            wait_time = delay + random.uniform(*BACKOFF_JITTER)
            print(f" ❌ ข้อผิดพลาด")
            print(f"   ⚠️  Attempt {attempt}/{MAX_RETRIES}: {last_err}")
            time.sleep(wait_time)
            delay *= BACKOFF_BASE

    return None, last_err or "Unknown error"

# ------------------------------------------------------------------------------
# PARSE LLM OUTPUT → DataFrame
# ------------------------------------------------------------------------------
def parse_analysis_to_dataframe(analysis_text: str, original_df: pd.DataFrame) -> pd.DataFrame:
    stopwords_data = []
    current_cluster = None
    current_type = None

    word_to_cluster = pd.Series(
        original_df["cluster_label"].values,
        index=original_df["word"].astype(str),
    ).to_dict()

    cluster_re = re.compile(r"(?:##\s*)?cluster\s*(\d+)", re.IGNORECASE)
    type_re = re.compile(r"^\s*\d+\.\s*(.+)", re.IGNORECASE)
    item_re = re.compile(r"^[\*\-\u2022]\s*`?([^`:\n]+?)`?\s*:\s*(.+)$", re.IGNORECASE)

    for raw in analysis_text.splitlines():
        line = raw.strip()
        if not line:
            continue

        m_cluster = cluster_re.search(line)
        if m_cluster:
            try:
                current_cluster = int(m_cluster.group(1))
            except ValueError:
                current_cluster = None
            current_type = None
            continue

        m_type = type_re.search(line)
        if m_type:
            current_type = m_type.group(1).strip().rstrip(":")
            continue

        m_item = item_re.search(line)
        if m_item and current_cluster is not None and current_type:
            word = m_item.group(1).strip()
            reason = m_item.group(2).strip()
            cluster_label = word_to_cluster.get(word, current_cluster)
            stopwords_data.append({
                "word": word,
                "cluster_label": cluster_label,
                "stopword_type": current_type,
                "reason": reason,
            })

    return pd.DataFrame(stopwords_data)

# ------------------------------------------------------------------------------
# BATCH HELPERS
# ------------------------------------------------------------------------------
def make_batches(df: pd.DataFrame, chunk_size: int):
    batches = []
    batch_id = 1
    for start in range(0, len(df), chunk_size):
        end = min(start + chunk_size, len(df))
        batches.append((batch_id, start, end, end - start))
        batch_id += 1
    return batches

def safe_save_partial(df: pd.DataFrame, model_key: str):
    if not df.empty:
        path = _partial_path(model_key)
        df.to_csv(path, index=False, encoding="utf-8-sig")
        print(f"🧾 บันทึกชั่วคราว → {path} ({len(df)} แถว)")

# ------------------------------------------------------------------------------
# PROCESS ONE SPAN (ปกติ หรือ sub-batch)
# ------------------------------------------------------------------------------
def process_span(span_df, original_df, model_key, sub_chunk_size=None, batch_id=None):
    if sub_chunk_size is None:
        csv_data = span_df.to_csv(index=False)
        prompt = PROMPT_TEMPLATE.format(csv_data=csv_data)
        content, err = call_api(prompt, model_key)
        if content is not None and batch_id is not None:
            save_raw_response(model_key, batch_id, content)
        if err:
            return pd.DataFrame(), err
        parsed = parse_analysis_to_dataframe(content, original_df)
        if parsed.empty:
            return pd.DataFrame(), "Parsed empty result from LLM output"
        return parsed, None

    merged = pd.DataFrame()
    last_err = None
    for sub_start in range(0, len(span_df), sub_chunk_size):
        sub_end = min(sub_start + sub_chunk_size, len(span_df))
        sub_df = span_df.iloc[sub_start:sub_end]
        csv_sub = sub_df.to_csv(index=False)
        prompt = PROMPT_TEMPLATE.format(csv_data=csv_sub)
        content, err = call_api(prompt, model_key)
        if content is not None and batch_id is not None:
            save_raw_response(model_key, batch_id, content)
        if err:
            last_err = err
            print(f"   ❌ Sub-batch {sub_start}-{sub_end} failed: {err}")
            continue

        parsed = parse_analysis_to_dataframe(content, original_df)
        if parsed.empty:
            last_err = "Parsed empty result from sub-batch output"
            print(f"   ⚠️ Sub-batch {sub_start}-{sub_end} parse empty")
            continue

        merged = pd.concat([merged, parsed], ignore_index=True)
    return merged, last_err

# ------------------------------------------------------------------------------
# FINALIZE OUTPUTS
# ------------------------------------------------------------------------------
def finalize_outputs(original_df, all_stopwords_df, model_key):
    if all_stopwords_df.empty:
        print("ℹ️ ไม่มี stopwords ที่ตรวจพบ")
        return

    stop_path = _stopwords_path(model_key)
    non_path = _nonstopwords_path(model_key)

    all_stopwords_df.to_csv(stop_path, index=False, encoding="utf-8-sig")
    print(f"💾 บันทึก stopwords → {stop_path}")

    stop_set = set(all_stopwords_df["word"].astype(str))
    non_stopwords_df = original_df[~original_df["word"].astype(str).isin(stop_set)]
    non_stopwords_df.to_csv(non_path, index=False, encoding="utf-8-sig")
    print(f"💾 บันทึก non-stopwords → {non_path}")
    print(
        f"📊 สรุป: เดิม {len(original_df)} | "
        f"stopwords {len(all_stopwords_df)} | "
        f"เหลือ {len(non_stopwords_df)}"
    )

# ------------------------------------------------------------------------------
# RUN ALL BATCHES
# ------------------------------------------------------------------------------
def run_all(model_key: str):
    config = MODEL_CONFIGS[model_key]
    model_id = config["model_id"]
    label = config["label"]

    print(f"🚀 เริ่ม Stopword Filter — {label} ({model_id})")
    print(f"   พารามิเตอร์: temp={TEMPERATURE}, max_tokens={MAX_TOKENS}, chunk={CHUNK_SIZE}")

    if not os.path.exists(INPUT_CSV_FILE):
        print(f"❌ ไม่พบไฟล์: {INPUT_CSV_FILE}")
        return

    original_df = pd.read_csv(INPUT_CSV_FILE)
    filtered_df = original_df.copy().reset_index(drop=True)
    print(f"📖 โหลดข้อมูล {len(original_df)} แถว (ไม่มีการ pre-filter ด้วย seed)")

    sig = dataset_signature(filtered_df)
    init_runmeta(sig, CHUNK_SIZE, model_id, model_key)

    batches = make_batches(filtered_df, CHUNK_SIZE)
    init_runlog(batches, model_key)

    all_stopwords_df = pd.DataFrame()

    for batch_id, start_idx, end_idx, size in batches:
        span_df = original_df.iloc[start_idx:end_idx]
        print(f"\n📦 Batch {batch_id}: index {start_idx}-{end_idx} ({size} คำ)")

        df, err = process_span(span_df, original_df, model_key, batch_id=batch_id)
        attempts = 1

        if df.empty and err:
            print("   🔁 Falling back to sub-batching...")
            df, err = process_span(
                span_df, original_df, model_key,
                sub_chunk_size=max(8, min(CHUNK_SIZE_RETRY, size)),
                batch_id=batch_id,
            )
            attempts += 1

        if df.empty and err:
            update_runlog(batch_id, "failed", attempts, err, model_key)
            print(f"   ❌ Batch {batch_id} failed: {err}")
            continue

        all_stopwords_df = pd.concat([all_stopwords_df, df], ignore_index=True)
        all_stopwords_df.drop_duplicates(
            subset=["word", "cluster_label", "stopword_type"], inplace=True
        )
        update_runlog(batch_id, "success", attempts, "", model_key)
        print(f"   ✅ Batch {batch_id} → {len(df)} รายการ (สะสม {len(all_stopwords_df)})")
        safe_save_partial(all_stopwords_df, model_key)

    finalize_outputs(original_df, all_stopwords_df, model_key)

# ------------------------------------------------------------------------------
# RETRY FAILED BATCHES ONLY
# ------------------------------------------------------------------------------
def retry_failed(model_key: str):
    config = MODEL_CONFIGS[model_key]
    model_id = config["model_id"]
    label = config["label"]

    print(f"🔁 โหมด retry-failed — {label} ({model_id})")

    if not os.path.exists(INPUT_CSV_FILE):
        print(f"❌ ไม่พบไฟล์: {INPUT_CSV_FILE}")
        return

    meta = load_runmeta(model_key)
    if meta is None:
        print("❌ ไม่พบ runmeta — ต้องรันโหมดปกติก่อน")
        return

    original_df = pd.read_csv(INPUT_CSV_FILE)

    if dataset_signature(original_df) != meta.get("dataset_signature"):
        print("❌ ข้อมูลปัจจุบันไม่ตรงกับรอบก่อน (signature mismatch)")
        return

    log = load_runlog(model_key)
    if log is None:
        print("❌ ไม่พบ runlog — ต้องรันโหมดปกติก่อน")
        return

    pending = log[log["status"] != "success"]
    if pending.empty:
        print("ℹ️ ไม่มี batch ที่ล้มเหลว")
        return

    print(f"📋 พบ {len(pending)} batch ที่ต้องรันซ้ำ")

    all_stopwords_df = pd.DataFrame()
    partial_path = _partial_path(model_key)
    if os.path.exists(partial_path):
        try:
            all_stopwords_df = pd.read_csv(partial_path)
        except Exception:
            all_stopwords_df = pd.DataFrame()

    for _, row in pending.iterrows():
        batch_id = int(row["batch_id"])
        start_idx = int(row["start_idx"])
        end_idx = int(row["end_idx"])
        size = int(row["size"])
        attempts = int(row.get("attempts", 0))

        span_df = original_df.iloc[start_idx:end_idx]
        print(f"\n🔁 Retrying Batch {batch_id}: index {start_idx}-{end_idx} ({size} คำ)")

        df, err = process_span(
            span_df, original_df, model_key,
            sub_chunk_size=max(8, min(CHUNK_SIZE_RETRY, size)),
            batch_id=batch_id,
        )
        attempts += 1

        if df.empty and err:
            update_runlog(batch_id, "failed", attempts, err, model_key)
            print(f"   ❌ Still failing: {err}")
            continue

        all_stopwords_df = pd.concat([all_stopwords_df, df], ignore_index=True)
        all_stopwords_df.drop_duplicates(
            subset=["word", "cluster_label", "stopword_type"], inplace=True
        )
        update_runlog(batch_id, "success", attempts, "", model_key)
        print(f"   ✅ Batch {batch_id} success (retry) → {len(df)} รายการ (สะสม {len(all_stopwords_df)})")
        safe_save_partial(all_stopwords_df, model_key)

    finalize_outputs(original_df, all_stopwords_df, model_key)

# ------------------------------------------------------------------------------
# EVALUATION HELPERS
# ------------------------------------------------------------------------------
def _eval_summary_path(name: str) -> str:
    return os.path.join(EVAL_DIR, f"evaluation_summary_{name}.csv")

def _eval_error_path(name: str) -> str:
    return os.path.join(EVAL_DIR, f"evaluation_errors_{name}.csv")

def _raw_response_dir(model_key: str) -> str:
    path = os.path.join(RESULT_DIR, f"raw_responses_{model_key}")
    os.makedirs(path, exist_ok=True)
    return path

def save_raw_response(model_key: str, batch_id: int, content: str):
    out_dir = _raw_response_dir(model_key)
    path = os.path.join(out_dir, f"batch_{batch_id:04d}.txt")
    with open(path, "w", encoding="utf-8") as f:
        f.write(content or "")

def load_expert_sets():
    if not os.path.exists(EXPERT_STOPWORDS_FILE):
        raise FileNotFoundError(f"ไม่พบไฟล์ expert stopwords: {EXPERT_STOPWORDS_FILE}")
    if not os.path.exists(EXPERT_NONSTOPWORDS_FILE):
        raise FileNotFoundError(f"ไม่พบไฟล์ expert nonstopwords: {EXPERT_NONSTOPWORDS_FILE}")

    stop_df = pd.read_csv(EXPERT_STOPWORDS_FILE)
    non_df = pd.read_csv(EXPERT_NONSTOPWORDS_FILE)

    stop_set = set(stop_df["word"].astype(str).str.strip())
    non_set = set(non_df["word"].astype(str).str.strip())

    overlap = stop_set & non_set
    if overlap:
        raise ValueError(f"พบคำซ้ำระหว่าง expert stopword และ nonstopword: {sorted(list(overlap))[:20]}")

    return stop_df, non_df, stop_set, non_set

def evaluate_against_expert(pred_stopwords_df: pd.DataFrame, original_df: pd.DataFrame,
                            expert_stop_set: set, expert_non_set: set, method_name: str):
    pred_stop_set = set(pred_stopwords_df["word"].astype(str).str.strip())
    all_words = set(original_df["word"].astype(str).str.strip())
    pred_non_set = all_words - pred_stop_set

    tp = len(pred_stop_set & expert_stop_set)
    fp = len(pred_stop_set - expert_stop_set)
    fn = len(expert_stop_set - pred_stop_set)
    tn = len(pred_non_set & expert_non_set)

    precision = tp / (tp + fp) if (tp + fp) else 0.0
    recall = tp / (tp + fn) if (tp + fn) else 0.0
    f1 = 2 * precision * recall / (precision + recall) if (precision + recall) else 0.0
    accuracy = (tp + tn) / len(all_words) if all_words else 0.0
    jaccard = tp / len(pred_stop_set | expert_stop_set) if (pred_stop_set | expert_stop_set) else 0.0
    nonstopword_preservation = tn / len(expert_non_set) if expert_non_set else 0.0

    return {
        "method": method_name,
        "tp": tp,
        "fp": fp,
        "fn": fn,
        "tn": tn,
        "precision": precision,
        "recall": recall,
        "f1": f1,
        "accuracy": accuracy,
        "jaccard": jaccard,
        "nonstopword_preservation": nonstopword_preservation,
        "pred_stopwords": len(pred_stop_set),
        "expert_stopwords": len(expert_stop_set),
    }

def build_error_report(pred_stopwords_df: pd.DataFrame, original_df: pd.DataFrame,
                       expert_stop_set: set, method_name: str) -> pd.DataFrame:
    pred_stop_set = set(pred_stopwords_df["word"].astype(str).str.strip())
    all_words = set(original_df["word"].astype(str).str.strip())

    rows = []
    for word in sorted(all_words):
        pred = word in pred_stop_set
        gold = word in expert_stop_set

        if pred and gold:
            label = "TP"
        elif pred and not gold:
            label = "FP"
        elif (not pred) and gold:
            label = "FN"
        else:
            label = "TN"

        if label != "TN":
            rows.append({
                "word": word,
                "method": method_name,
                "error_type": label
            })

    return pd.DataFrame(rows)

# ------------------------------------------------------------------------------
# BASELINES
# ------------------------------------------------------------------------------
LOW_INFO_TERMS = {
    "ลักษณะ", "รูปแบบ", "กิจกรรม", "สถานที่", "บุคคล", "ประเทศ",
    "ความเชื่อ", "ความสำคัญ", "ความสุข",
    "ศิลปะ", "วัฒนธรรม", "การแสดง", "ประเพณี", "นาฏศิลป์"
}

EVALUATIVE_TERMS = {
    "งดงาม", "สวยงาม", "ยอดเยี่ยม", "ดีงาม", "ไพเราะ", "อ่อนช้อย"
}

def run_semantic_rule_baseline(original_df: pd.DataFrame):
    df = original_df.copy()
    words = df["word"].astype(str).str.strip()

    mask = (
        words.isin(LOW_INFO_TERMS)
        | words.isin(EVALUATIVE_TERMS)
        | words.str.startswith("ความ")
    )

    baseline_df = df[mask].copy()
    baseline_df["stopword_type"] = "semantic_rule"
    baseline_df["reason"] = "Matched handcrafted semantic rule baseline"
    return baseline_df[["word", "cluster_label", "stopword_type", "reason"]]

def run_lexical_semantic_baseline(original_df: pd.DataFrame):
    df = original_df.copy()
    words = df["word"].astype(str).str.strip()

    mask = (
        words.str.startswith("ความ")
        | words.str.endswith("ภาพ")
        | words.isin({"งดงาม", "สวยงาม", "อ่อนช้อย", "ไพเราะ"})
    )

    baseline_df = df[mask].copy()
    baseline_df["stopword_type"] = "lexical_semantic_rule"
    baseline_df["reason"] = "Matched lexical-semantic pattern baseline"
    return baseline_df[["word", "cluster_label", "stopword_type", "reason"]]

def run_combined_nonllm_baseline(original_df: pd.DataFrame):
    a = run_semantic_rule_baseline(original_df)
    b = run_lexical_semantic_baseline(original_df)

    merged = pd.concat([a, b], ignore_index=True)
    merged = merged.drop_duplicates(subset=["word", "cluster_label"]).copy()
    merged["stopword_type"] = "combined_nonllm"
    merged["reason"] = "Union of semantic_rule and lexical_semantic_rule"
    return merged[["word", "cluster_label", "stopword_type", "reason"]]

# ------------------------------------------------------------------------------
# EVALUATION RUNNERS
# ------------------------------------------------------------------------------
def save_evaluation_outputs(summary_rows, error_frames, name: str):
    os.makedirs(EVAL_DIR, exist_ok=True)

    summary_df = pd.DataFrame(summary_rows)
    summary_df.to_csv(_eval_summary_path(name), index=False, encoding="utf-8-sig")

    if error_frames:
        errors_df = pd.concat(error_frames, ignore_index=True)
        errors_df.to_csv(_eval_error_path(name), index=False, encoding="utf-8-sig")

    print(f"📈 บันทึก evaluation summary → {_eval_summary_path(name)}")
    print(f"📈 บันทึก evaluation errors  → {_eval_error_path(name)}")

def evaluate_existing_outputs(model_keys):
    os.makedirs(EVAL_DIR, exist_ok=True)

    original_df = pd.read_csv(INPUT_CSV_FILE)
    _, _, expert_stop_set, expert_non_set = load_expert_sets()

    summary_rows = []
    error_frames = []

    for model_key in model_keys:
        stop_path = _stopwords_path(model_key)
        if not os.path.exists(stop_path):
            print(f"⚠️ ไม่พบไฟล์ผลลัพธ์ของ {model_key}: {stop_path}")
            continue

        pred_df = pd.read_csv(stop_path)
        summary_rows.append(
            evaluate_against_expert(pred_df, original_df, expert_stop_set, expert_non_set, model_key)
        )
        error_frames.append(
            build_error_report(pred_df, original_df, expert_stop_set, model_key)
        )

    save_evaluation_outputs(summary_rows, error_frames, "llm_models")

def evaluate_baselines():
    os.makedirs(EVAL_DIR, exist_ok=True)

    original_df = pd.read_csv(INPUT_CSV_FILE)
    _, _, expert_stop_set, expert_non_set = load_expert_sets()

    methods = {
        "semantic_rule": run_semantic_rule_baseline(original_df),
        "lexical_semantic_rule": run_lexical_semantic_baseline(original_df),
        "combined_nonllm": run_combined_nonllm_baseline(original_df),
    }

    summary_rows = []
    error_frames = []

    for name, pred_df in methods.items():
        summary_rows.append(
            evaluate_against_expert(pred_df, original_df, expert_stop_set, expert_non_set, name)
        )
        error_frames.append(
            build_error_report(pred_df, original_df, expert_stop_set, name)
        )

    save_evaluation_outputs(summary_rows, error_frames, "baselines")

# ------------------------------------------------------------------------------
# ENTRY POINT
# ------------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(
        description="Unified Stopword Filter — Gemini / GPT / Qwen / DeepSeek"
    )
    parser.add_argument(
        "--model",
        choices=["gemini", "gpt", "qwen", "deepseek", "all"],
        default="all",
        help="โมเดลที่ต้องการรัน (default: all)",
    )
    parser.add_argument(
        "--retry-failed",
        action="store_true",
        help="รันซ้ำเฉพาะ batch ที่ล้มเหลว",
    )
    parser.add_argument(
        "--baseline-only",
        action="store_true",
        help="รันเฉพาะ non-LLM semantic baselines และประเมินกับ expert",
    )
    parser.add_argument(
        "--evaluate-existing",
        action="store_true",
        help="ประเมินไฟล์ผลลัพธ์ LLM ที่มีอยู่แล้วกับ expert โดยไม่ยิง API ใหม่",
    )
    args = parser.parse_args()

    os.makedirs(RESULT_DIR, exist_ok=True)
    os.makedirs(EVAL_DIR, exist_ok=True)

    models = list(MODEL_CONFIGS.keys()) if args.model == "all" else [args.model]

    if args.baseline_only:
        print("\n" + "=" * 70)
        evaluate_baselines()
        print("=" * 70)
        return

    if args.evaluate_existing:
        print("\n" + "=" * 70)
        evaluate_existing_outputs(models)
        print("=" * 70)
        return

    action = retry_failed if args.retry_failed else run_all

    for model_key in models:
        print("\n" + "=" * 70)
        action(model_key)
        print("=" * 70)

if __name__ == "__main__":
    main()
