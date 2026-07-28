# -*- coding: utf-8 -*-
"""
openset_taxonomy_unified_v5.py [BIM Project - Industrial Grade v4.1]

Primary–Critic pipeline for semantic representation layer:
  1. Primary lexical input preparation (Gemini-based)
  2. Primary taxonomy induction (Gemini Flash)
  3. Critic review and refinement (GPT-4o-mini, Qwen 2.5, DeepSeek)
  4. Final strategic consolidation (claude-sonnet-4.6 - Architect)
  5. Final closed-set classification and multi-model agreement analysis

Design note:
- The main pipeline does NOT use consensus voting for upstream input construction.
- Gemini is used as the primary lexical source because prior ablation results
  show the best precision–recall balance and lower semantic noise.
- Voting-based aggregation is retained only as an evaluation mechanism in the
  downstream agreement analysis stage, not as the core input construction stage.
"""

import os
import re
import math
import time
import json
import random
import argparse
import unicodedata
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from itertools import combinations
import requests
import pandas as pd
from dotenv import load_dotenv
from collections import Counter, defaultdict
from pythainlp.tokenize import word_tokenize

# ─── CONFIGURATION & ENVIRONMENT ──────────────────────────────────────────────
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(SCRIPT_DIR, ".env"), override=True)

MODEL_CONFIGS = {
    "gemini":   {"model_id": "google/gemini-3-flash-preview", "suffix": "GEMINI", "key_env": "OPENROUTER_API_KEY_GEMINI"},
    "gpt":      {"model_id": "openai/gpt-4o-mini", "suffix": "GPT", "key_env": "OPENROUTER_API_KEY_GPT"},
    "qwen":     {"model_id": "qwen/qwen-2.5-72b-instruct", "suffix": "QWEN", "key_env": "OPENROUTER_API_KEY_QWEN"},
    "deepseek": {"model_id": "deepseek/deepseek-chat", "suffix": "DEEPSEEK", "key_env": "OPENROUTER_API_KEY_DEEPSEEK"},
    "claude":   {"model_id": "anthropic/claude-sonnet-4.6", "suffix": "CLAUDE", "key_env": "OPENROUTER_API_KEY_CLAUDE"},
}

PRIMARY_MODEL = "gemini"          # empirically selected upstream model
CRITIC_MODELS = ["gpt", "qwen", "deepseek"]
CLASSIFICATION_MODEL = PRIMARY_MODEL
ARCHITECT_MODEL = "claude"

# Main lexical input comes directly from the Gemini-based upstream filtering stage.
MASTER_INPUT_FILE = os.path.join(SCRIPT_DIR, "input", "non_stopwords_gemini.csv")
RESULT_DIR = os.path.join(SCRIPT_DIR, "result")

# Pipeline Constants
BATCH_SIZE = 15
MAX_WORKERS_MODELS = 4
MAX_WORKERS_BATCHES = 4
TEMPERATURE = 0.1
MAX_TOKENS = 8192
API_TIMEOUT = 120
DEFAULT_RUN_ID = time.strftime("%Y%m%d_%H%M%S")

# Critic convergence controls
CRITIC_MIN_SUPPORT = 2       # majority support from 3 critics
CRITIC_STRONG_SUPPORT = 3    # unanimous / strong support

# ─── PROMPTS (With Hierarchy Guard & Tone Calibration) ────────────────────────
STYLE_GUIDE = """\
ใช้ภาษาไทยมาตรฐานระดับวิชาการ ยึดถือความถูกต้องตามพจนานุกรมฉบับราชบัณฑิตยสถานและบริบททางประวัติศาสตร์/วัฒนธรรมไทยอย่างเคร่งครัด
ห้ามใช้คำแฟนตาซี ห้ามคิดไปเอง (No Hallucination) และห้ามเดาความหมายจากเสียงของคำเด็ดขาด
"""

DOMAIN_CONTEXT = """\
[บริบทโดเมน: Taxonomy เชิงวิจัยสำหรับศิลปะการแสดงไทย]

งานวิจัยนี้กำหนดกรอบหมวดหลัก (Level 1) ไว้ล่วงหน้า 6 หมวดเพื่อใช้เป็น semantic domains ระดับบนสุด
ห้ามสร้างหมวดหลักนอกเหนือจากนี้

1. วรรณคดีและสิ่งมีชีวิตเชิงตำนาน
2. ศิลปะการแสดงและดนตรี
3. พิธีกรรม ความเชื่อ และจารีตวัฒนธรรม
4. บริบทเชิงประวัติศาสตร์ ภูมิศาสตร์ และพื้นที่
5. วัฒนธรรมวัตถุ ศิลปกรรม และงานช่าง
6. กลุ่มชาติพันธุ์ ชุมชน และวิถีชีวิต

[หลักการสำคัญ]
- อนุญาตให้โมเดลคิด Level 2 และ Level 3 ขึ้นเองจากคำศัพท์จริงใน cluster
- Level 2 และ Level 3 ต้องเป็นผลจากการสังเคราะห์เชิงความหมายจากข้อมูล ไม่ใช่การคัดลอกชื่อคำตัวอย่างตรง ๆ
- ห้ามใช้ชื่อเฉพาะ เช่น พระราม หนุมาน เชียงใหม่ เป็นชื่อหมวด
- ห้ามใช้คำ generic เช่น ประเภท ลักษณะ รูปแบบ องค์ประกอบ เป็นชื่อหมวดเดี่ยว ๆ
- ชื่อหมวดต้องอธิบายได้ด้วย examples ที่แนบมา
- หากคำศัพท์ใน cluster มีหลายลักษณะ ให้เลือก Level 2 และ Level 3 ที่จำแนกความแตกต่างของคำได้ดีที่สุด
- ให้ยึดความหมายของคำในบริบทวัฒนธรรมไทยเป็นหลัก

[แนวทางตัดสิน Level 1]
- ตัวละคร เทพ อมนุษย์ สัตว์หิมพานต์ บทบาทในเรื่อง → วรรณคดีและสิ่งมีชีวิตเชิงตำนาน
- การแสดง ดนตรี เพลง ท่ารำ เครื่องดนตรี → ศิลปะการแสดงและดนตรี
- พิธีกรรม ความเชื่อ ประเพณี การบูชา → พิธีกรรม ความเชื่อ และจารีตวัฒนธรรม
- จังหวัด เมือง สถานที่ ยุคสมัย ภูมิภาค ภูมิประเทศ → บริบทเชิงประวัติศาสตร์ ภูมิศาสตร์ และพื้นที่
- สถาปัตยกรรม ศิลปกรรม หัตถกรรม เครื่องแต่งกาย วัสดุ สี เครื่องประดับ → วัฒนธรรมวัตถุ ศิลปกรรม และงานช่าง
- กลุ่มคน ชาติพันธุ์ ชุมชน อาชีพ อาหาร วิถีชีวิต → กลุ่มชาติพันธุ์ ชุมชน และวิถีชีวิต
"""

VALID_L1 = {
    "วรรณคดีและสิ่งมีชีวิตเชิงตำนาน",
    "ศิลปะการแสดงและดนตรี",
    "พิธีกรรม ความเชื่อ และจารีตวัฒนธรรม",
    "บริบทเชิงประวัติศาสตร์ ภูมิศาสตร์ และพื้นที่",
    "วัฒนธรรมวัตถุ ศิลปกรรม และงานช่าง",
    "กลุ่มชาติพันธุ์ ชุมชน และวิถีชีวิต"
}

PHASE1_PROMPT = f"""\
คุณคือผู้เชี่ยวชาญระดับสูงด้านไทยคดีศึกษาและการออกแบบอนุกรมวิธานเชิงความหมาย
{STYLE_GUIDE}

{DOMAIN_CONTEXT}

ภารกิจ: วิเคราะห์กลุ่มคำศัพท์ใน cluster และสร้าง taxonomy 3 ระดับ

[กฎเหล็ก]
1. Level 1 ต้องเลือกจาก 6 หมวดหลักในบริบทโดเมนเท่านั้น ห้ามสร้างหมวดหลักใหม่
2. Level 2 และ Level 3 ให้สร้างขึ้นจากรูปแบบความหมายที่พบจริงในคำศัพท์ชุดนี้
3. Level 2 ต้องสื่อกลุ่มย่อยเชิงความหมายที่แยกจากกันได้ชัด
4. Level 3 ต้องเฉพาะเจาะจงกว่า Level 2 และช่วยจำแนกคำตัวอย่างได้จริง
5. ห้ามใช้ชื่อเฉพาะของคำตัวอย่างเป็นชื่อหมวด
6. ห้ามใช้คำ generic เช่น ประเภท ลักษณะ รูปแบบ องค์ประกอบ เป็นชื่อหมวดเดี่ยว ๆ
7. แต่ละหมวดต้องมี examples เพื่อแสดงหลักฐานว่าหมวดนั้นเกิดจากคำใด
8. หากคำใน cluster มีหลายแนวความหมาย ให้สร้างหลายรายการ taxonomy ได้
9. ให้ตั้งชื่อหมวดแบบเป็นกลาง กระชับ และอธิบายได้ในเชิงวิชาการ

คำศัพท์: [[WORD_LIST]]

ตอบเป็น JSON array:
[
  {{
    "lvl1": "...",
    "lvl2": "...",
    "lvl3": "...",
    "examples": ["...", "..."],
    "evidence_words": ["...", "..."]
  }}
]
"""

PHASE2_PROMPT = f"""\
คุณคือผู้เชี่ยวชาญด้านสถาปัตยกรรมข้อมูลและการจัดระเบียบ taxonomy
{STYLE_GUIDE}

{DOMAIN_CONTEXT}

ภารกิจ: จัดระเบียบ taxonomy ที่ได้จากหลาย cluster ให้เป็นระบบ กระชับ และไม่ซ้ำซ้อน

[กฎเหล็ก]
1. Level 1 ต้องคงอยู่ใน 6 หมวดหลักที่กำหนดเท่านั้น
2. Level 2 และ Level 3 ต้องรักษา semantic intent เดิมจากข้อมูลให้มากที่สุด
3. ให้ยุบหมวดที่มีความหมายใกล้เคียงกัน แต่ห้ามลบความแตกต่างที่สำคัญ
4. หากชื่อหมวด generic หรือกำกวม ให้ปรับชื่อให้เฉพาะเจาะจงขึ้น
5. ห้ามสร้างหมวดย่อยจาก intuition ล้วน ๆ ที่ไม่รองรับด้วย examples
6. examples ต้องช่วยอธิบายว่าหมวดนั้นครอบคลุมคำใดบ้าง
7. เป้าหมายคือได้ taxonomy ที่เสถียร ใช้งานซ้ำได้ และยังสะท้อนรูปแบบจากข้อมูลจริง

หมวดหมู่เริ่มต้น: [[CANDIDATE_CATEGORIES]]

ตอบเป็น JSON array:
[
  {{
    "lvl1": "...",
    "lvl2": "...",
    "lvl3": "...",
    "examples": ["...", "..."],
    "evidence_words": ["...", "..."]
  }}
]
"""

CRITIC_REVIEW_PROMPT = f"""\
คุณคือผู้ตรวจสอบอนุกรมวิธาน (Taxonomy Critic)
{STYLE_GUIDE}

ภารกิจ: ตรวจสอบ taxonomy ที่สร้างโดยโมเดลหลัก โดยต้อง "รักษาโครงสร้างเดิมให้มากที่สุด"
และแก้เฉพาะกรณีที่มีปัญหาชัดเจนเท่านั้น

[กฎเหล็ก]
1. ให้คง item เดิมไว้ หากไม่มีข้อผิดพลาดชัดเจน
2. ให้ลบเฉพาะ item ที่ซ้ำซ้อน ไม่ชัดเจน หรือไม่เหมาะสมจริง
3. ให้แก้ชื่อ Level 2 หรือ Level 3 เฉพาะเมื่อชื่อเดิมกำกวม ซ้ำซ้อน หรือใกล้กับ Level 1 มากเกินไป
4. ห้าม rewrite taxonomy ทั้งชุดใหม่ในสไตล์ของตนเอง
5. ห้ามสร้างหมวดใหม่จำนวนมาก
6. ให้คง semantic intent เดิมของ taxonomy หลักให้มากที่สุด
7. หากมีหลาย item ที่ต่างกันเพียงถ้อยคำ ให้เลือกถ้อยคำที่กระชับ เป็นกลาง และรวมความหมายได้กว้างกว่า
8. ตอบกลับเป็น taxonomy ที่แก้ไขแล้วเท่านั้น
9. ตอบกลับเป็น JSON array เท่านั้น ห้ามมีคำอธิบายเพิ่มเติม
10. หากไม่มีข้อผิดพลาดสำคัญ ห้ามแก้ item เกิน 20% ของ taxonomy ทั้งหมด
11. รักษา evidence_words จาก taxonomy เดิมไว้ ห้ามลบ

Taxonomy จากโมเดลหลัก:
[[PRIMARY_TAXONOMY]]

ตอบเป็น JSON array:
[
  {{"lvl1": "...", "lvl2": "...", "lvl3": "...", "examples": [], "evidence_words": []}}
]
"""

FINAL_TAXONOMY_CLEANUP_PROMPT = f"""\
คุณคือสถาปนิกข้อมูลระดับสูง
{STYLE_GUIDE}

{DOMAIN_CONTEXT}

ภารกิจ: สรุป taxonomy ขั้นสุดท้ายให้กระชับ เสถียร และพร้อมใช้ในงานวิจัย

[หลักการ]
1. รักษา 6 หมวดหลัก Level 1 ตามที่กำหนดไว้
2. ให้คงหมวดย่อยที่มีหลักฐานจาก examples ชัดเจน
3. ยุบเฉพาะหมวดที่ซ้ำเชิงความหมายจริง
4. ห้ามสร้างชื่อหมวดใหม่ที่ไม่สอดคล้องกับข้อมูลตัวอย่าง
5. Level 2 และ Level 3 ต้องอธิบายได้จาก examples ที่แนบมา
6. ให้คงความสามารถในการจำแนกคำศัพท์ ไม่ยุบจนกว้างเกินไป
7. หลีกเลี่ยง proper nouns และคำ generic เป็นชื่อหมวด
8. รักษา evidence_words จาก taxonomy เดิมไว้ หากยุบหมวดให้รวม evidence_words ด้วย

Taxonomy:
[[MERGED_TAXONOMY]]

ตอบเป็น JSON array:
[
  {{
    "lvl1": "...",
    "lvl2": "...",
    "lvl3": "...",
    "examples": ["...", "..."],
    "evidence_words": ["...", "..."]
  }}
]
"""

PHASE3_PROMPT = f"""\
คุณคือผู้เชี่ยวชาญด้านนิรุกติศาสตร์และวัฒนธรรมไทย ภารกิจคือการจัดหมวดหมู่คำศัพท์ลงใน Taxonomy ที่กำหนดไว้อย่างแม่นยำ

[กฎเหล็กการจัดหมวดหมู่]
1. ห้ามสร้างหมวดหมู่ใหม่เด็ดขาด: ต้องเลือกใช้ชื่อหมวดหมู่จาก Taxonomy ที่ให้มาเท่านั้น
2. บังคับอธิบายความหมาย: ระบุความหมายสั้นๆ ในฟิลด์ "definition" เพื่อยืนยันความเข้าใจ
3. ความแม่นยำ: ตัวสะกดต้องตรงกับ Taxonomy ทุกตัวอักษร
4. ห้ามเดาหมวดหมู่ใหม่: หากไม่แน่ใจ ให้เลือก path ที่ใกล้เคียงที่สุดจาก Taxonomy ที่ให้มาเท่านั้น
5. เมื่อคำศัพท์อาจจัดได้หลายหมวด ให้พิจารณาบริบททางวัฒนธรรมไทยเป็นหลัก และเลือกหมวดที่จำเพาะที่สุด
6. ระบุ entity_type และ context_tag ให้สอดคล้องกับความหมายของคำ

[คู่หมวดที่มักสับสน — ให้ใช้เกณฑ์นี้]
- "วรรณคดีและสิ่งมีชีวิตเชิงตำนาน" vs "พิธีกรรม ความเชื่อ และจารีตวัฒนธรรม": คำที่เป็นชื่อเทพ/ตัวละครในวรรณคดี → วรรณคดีและสิ่งมีชีวิตเชิงตำนาน; คำที่เป็นพิธีกรรม/ความเชื่อล้วน → พิธีกรรม ความเชื่อ และจารีตวัฒนธรรม
- "วรรณคดีและสิ่งมีชีวิตเชิงตำนาน" vs "ศิลปะการแสดงและดนตรี": คำที่เกี่ยวกับตัวละคร/เนื้อเรื่อง/วิธีเล่าเรื่อง → วรรณคดีและสิ่งมีชีวิตเชิงตำนาน; คำที่เกี่ยวกับทำนอง/ท่ารำ/เครื่องดนตรี → ศิลปะการแสดงและดนตรี
- "บริบทเชิงประวัติศาสตร์ ภูมิศาสตร์ และพื้นที่" vs "พิธีกรรม ความเชื่อ และจารีตวัฒนธรรม": คำที่เป็นชื่อสถานที่/กลุ่มชาติพันธุ์ → บริบทเชิงประวัติศาสตร์ ภูมิศาสตร์ และพื้นที่; คำที่เป็นพิธีกรรม/สิ่งศักดิ์สิทธิ์ → พิธีกรรม ความเชื่อ และจารีตวัฒนธรรม

Taxonomy โครงสร้างที่อนุญาตให้ใช้:
[[TAXONOMY_STRUCTURE]]

คำศัพท์ที่ต้องจัดหมวด: [[WORD_LIST]]

ตอบเป็น JSON array:
[
  {{
    "word": "...",
    "definition": "...",
    "lvl1": "...",
    "lvl2": "...",
    "lvl3": "...",
    "entity_type": "...",
    "context_tag": "..."
  }}
]
"""

# ─── TAXONOMY QUALITY GUARDS / CRITIC DIVERSITY ──────────────────────────────

GENERIC_L3_TERMS = {
    "ประเภท", "ลักษณะ", "รูปแบบ", "องค์ประกอบ",
    "ประเภทและลักษณะ", "รูปแบบและลักษณะ",
    "รูปแบบ ลักษณะ และองค์ประกอบ",
    "ประเภท รูปแบบ และองค์ประกอบ",
    "ประเภทและบทบาท",
    "ช่วงเวลาและเหตุการณ์"
}

GENERIC_L2_TERMS = {
    "อื่น ๆ", "ทั่วไป", "เบ็ดเตล็ด"
}

CRITIC_STYLE_GUIDES = {
    "gpt": """
บทบาทเฉพาะ: นักตรวจสอบโครงสร้างเชิงอนุกรมวิธาน
ให้เน้น:
- ตรวจว่า Level 2 ซ้ำความหมายกับ Level 1 หรือไม่
- ตรวจว่า Level 3 generic เกินไปหรือไม่
- แก้เฉพาะจุดที่ทำให้ hierarchy ไม่ชัด
- จำกัดการแก้ไม่เกิน 15% ของ taxonomy
""",
    "qwen": """
บทบาทเฉพาะ: นักตรวจสอบ semantic overlap และการยุบรวม
ให้เน้น:
- หมวดใดมีความหมายทับซ้อนกัน ให้เสนอ merge
- หมวดใดใช้ถ้อยคำกว้างเกินไป ให้เปลี่ยนเป็นถ้อยคำที่จำแนกได้ดีกว่า
- จำกัดการแก้ไม่เกิน 20% ของ taxonomy
""",
    "deepseek": """
บทบาทเฉพาะ: นักตรวจสอบ discriminative power ของ Level 3
ให้เน้น:
- Level 3 ต้องจำแนกตัวอย่างคำได้จริง
- ห้ามใช้คำ generic เช่น ประเภท/ลักษณะ/องค์ประกอบ เป็นชื่อ Level 3
- ถ้า Level 3 กว้างเกินไป ให้เปลี่ยนเป็นชื่อเฉพาะเชิงความหมาย
- จำกัดการแก้ไม่เกิน 20% ของ taxonomy
"""
}

DIVERSE_CRITIC_REVIEW_PROMPT = f"""\
คุณคือผู้ตรวจสอบอนุกรมวิธาน (Taxonomy Critic)
{STYLE_GUIDE}

[[CRITIC_STYLE]]

ภารกิจ: ตรวจสอบ taxonomy ที่สร้างโดยโมเดลหลัก โดยต้อง "รักษาโครงสร้างเดิมให้มากที่สุด"
และแก้เฉพาะกรณีที่มีปัญหาชัดเจนเท่านั้น

[กฎเหล็ก]
1. ให้คง item เดิมไว้ หากไม่มีข้อผิดพลาดชัดเจน
2. ให้ลบเฉพาะ item ที่ซ้ำซ้อน ไม่ชัดเจน หรือไม่เหมาะสมจริง
3. ให้แก้ชื่อ Level 2 หรือ Level 3 เฉพาะเมื่อชื่อเดิมกำกวม ซ้ำซ้อน หรือ generic เกินไป
4. ห้าม rewrite taxonomy ทั้งชุดใหม่ในสไตล์ของตนเอง
5. ห้ามสร้างหมวดใหม่จำนวนมาก
6. ให้คง semantic intent เดิมของ taxonomy หลักให้มากที่สุด
7. หากมีหลาย item ที่ต่างกันเพียงถ้อยคำ ให้เลือกถ้อยคำที่กระชับ เป็นกลาง และรวมความหมายได้กว้างกว่า
8. ห้ามใช้ชื่อ generic เช่น "ประเภท", "ลักษณะ", "รูปแบบ", "องค์ประกอบ" เป็นชื่อ Level 3 แบบเดี่ยว ๆ
9. ตอบกลับเป็น taxonomy ที่แก้ไขแล้วเท่านั้น
10. ตอบกลับเป็น JSON array เท่านั้น ห้ามมีคำอธิบายเพิ่มเติม
11. รักษา evidence_words จาก taxonomy เดิมไว้ ห้ามลบ

Taxonomy จากโมเดลหลัก:
[[PRIMARY_TAXONOMY]]

ตอบเป็น JSON array:
[
  {{"lvl1": "...", "lvl2": "...", "lvl3": "...", "examples": [], "evidence_words": []}}
]
"""

TARGETED_CRITIC_PROMPT = f"""\
คุณคือผู้ตรวจสอบอนุกรมวิธานแบบเจาะจงปัญหา
{STYLE_GUIDE}

ภารกิจ:
- ตรวจเฉพาะรายการที่น่ากังวลจาก taxonomy หลัก
- ให้แก้เฉพาะรายการที่อยู่ใน focus list
- รายการที่ไม่ได้อยู่ใน focus list ให้คงเดิม

[ข้อกำหนด]
1. ห้าม rewrite taxonomy ทั้งหมดใหม่
2. ให้แก้เฉพาะรายการที่มีชื่อ generic, hierarchy ไม่ชัด, หรือ semantic overlap
3. จำกัดการแก้ไม่เกิน 5 รายการ
4. ห้ามใช้คำ generic เช่น "ประเภท", "ลักษณะ", "รูปแบบ", "องค์ประกอบ" เป็นชื่อ Level 3 แบบเดี่ยว ๆ
5. ตอบกลับเป็น JSON array ของ taxonomy ฉบับเต็มหลังแก้ไขแล้วเท่านั้น
6. รักษา evidence_words จาก taxonomy เดิมไว้ ห้ามลบ

Focus items:
[[FOCUS_ITEMS]]

Primary taxonomy:
[[PRIMARY_TAXONOMY]]

ตอบเป็น JSON array:
[
  {{"lvl1": "...", "lvl2": "...", "lvl3": "...", "examples": [], "evidence_words": []}}
]
"""

DEEPEN_TAXONOMY_PROMPT = f"""\
คุณคือสถาปนิกข้อมูลระดับสูง (Taxonomy Architect)
{STYLE_GUIDE}

{DOMAIN_CONTEXT}

ภารกิจ: ปรับ taxonomy ให้มีความลึกเชิงความหมายมากขึ้น โดยรักษาโดเมนหลักเดิมไว้

[เป้าหมาย]
1. ห้ามใช้ Level 3 แบบ generic เช่น "ประเภท", "ลักษณะ", "รูปแบบ", "องค์ประกอบ"
2. Level 3 ต้องเป็นชื่อที่จำแนกตัวอย่างคำได้จริง
3. หาก Level 2 ใดมีเพียง Level 3 เดียว และตัวอย่างคำหลากหลายมาก ให้แตกชื่อ Level 3 ให้เฉพาะเจาะจงขึ้น
4. รักษา Level 1 และเจตนาหลักของ taxonomy เดิมให้มากที่สุด
5. ห้ามสร้าง proper noun เป็นชื่อหมวด
6. Level 1 ให้จัดตาม 6 หมวดหลักในบริบทโดเมนเท่านั้น
7. คำที่เป็นชื่อเฉพาะ (เทพ ตัวละคร สถานที่) ให้จัดตามบริบทของคำ ตามแนวทางตัดสิน Level 1 ในบริบทโดเมน
8. รักษา evidence_words จาก taxonomy เดิมไว้
8. ตอบกลับเป็น JSON array เท่านั้น

Taxonomy เดิม:
[[MERGED_TAXONOMY]]

ตอบเป็น JSON array ที่ลึกขึ้น:
[
  {{"lvl1": "...", "lvl2": "...", "lvl3": "...", "examples": [], "evidence_words": []}}
]
"""

def is_generic_taxonomy_label(text: str) -> bool:
    text = normalize_text(text)
    if not text:
        return True
    if text in GENERIC_L3_TERMS or text in GENERIC_L2_TERMS:
        return True
    generic_hits = ["ประเภท", "ลักษณะ", "รูปแบบ", "องค์ประกอบ", "บทบาท", "เหตุการณ์"]
    if text in generic_hits:
        return True
    if len(text) <= 3 and text in {"อื่นๆ", "ทั่วไป"}:
        return True
    return False

def taxonomy_edit_ratio(base_taxonomy, new_taxonomy):
    base_keys = set(taxonomy_item_key(i) for i in base_taxonomy)
    new_keys = set(taxonomy_item_key(i) for i in new_taxonomy)
    if not base_keys:
        return 0.0
    additions = len(new_keys - base_keys)
    removals = len(base_keys - new_keys)
    return (additions + removals) / len(base_keys)

def taxonomy_needs_deepening(taxonomy):
    if not taxonomy:
        return False

    generic_l3_count = 0
    l1_l2_to_l3 = defaultdict(set)

    for item in taxonomy:
        l1 = normalize_text(item.get("lvl1", ""))
        l2 = normalize_text(item.get("lvl2", ""))
        l3 = normalize_text(item.get("lvl3", ""))

        if is_generic_taxonomy_label(l3):
            generic_l3_count += 1

        if l1 and l2 and l3:
            l1_l2_to_l3[(l1, l2)].add(l3)

    singleton_l2 = sum(1 for _, l3s in l1_l2_to_l3.items() if len(l3s) == 1)
    total_l2 = len(l1_l2_to_l3)

    generic_ratio = _safe_div(generic_l3_count, len(taxonomy))
    singleton_ratio = _safe_div(singleton_l2, total_l2)

    # trigger เฉพาะกรณีที่ shallow จริง และ taxonomy ยังเล็ก/แคบเกินไป
    if generic_ratio >= 0.40:
        return True

    if singleton_ratio >= 0.90 and len(taxonomy) <= 20:
        return True

    return False

def select_focus_taxonomy_items(taxonomy, max_items=8):
    focus = []

    for item in taxonomy:
        l3 = normalize_text(item.get("lvl3", ""))
        if is_generic_taxonomy_label(l3):
            focus.append(item)

    # ถ้ายังน้อย ให้เติม item ที่ example เยอะผิดปกติ → บ่งชี้ว่าหมวดกว้างเกิน
    if len(focus) < max_items:
        remaining = []
        for item in taxonomy:
            if item in focus:
                continue
            ex = item.get("examples", [])
            ex_count = len(ex) if isinstance(ex, list) else 0
            remaining.append((ex_count, item))
        remaining.sort(reverse=True, key=lambda x: x[0])

        for _, item in remaining:
            if len(focus) >= max_items:
                break
            focus.append(item)

    return validate_taxonomy_schema(focus[:max_items])

def run_taxonomy_deepening_if_needed(taxonomy, cp_manager):
    if not taxonomy_needs_deepening(taxonomy):
        return taxonomy

    focus_items = select_focus_taxonomy_items(taxonomy, max_items=6)

    print("   ⚠️ Taxonomy appears too shallow/generic → running focused deepening pass with architect")
    prompt = DEEPEN_TAXONOMY_PROMPT.replace(
        "[[MERGED_TAXONOMY]]",
        json.dumps(focus_items if focus_items else taxonomy, ensure_ascii=False)
    )
    content, _ = call_api(prompt, ARCHITECT_MODEL, phase="taxonomy_deepening")
    deepened_focus = validate_taxonomy_schema(extract_json(content, default=focus_items if focus_items else taxonomy))

    if not deepened_focus:
        print("   ⚠️ Deepening pass unstable → fallback to previous taxonomy")
        return taxonomy

    # แทนที่เฉพาะ focus paths เดิม แล้วคง node อื่นไว้
    focus_keys = set((normalize_text(i["lvl1"]), normalize_text(i["lvl2"]), normalize_text(i["lvl3"])) for i in focus_items)
    preserved = [
        i for i in taxonomy
        if (normalize_text(i["lvl1"]), normalize_text(i["lvl2"]), normalize_text(i["lvl3"])) not in focus_keys
    ]
    deepened = validate_taxonomy_schema(preserved + deepened_focus)

    # safeguard: ถ้า deepening ทำให้ taxonomy เล็กลงหรือเสียรูป ให้ใช้ของเดิม
    if len(deepened) < max(5, int(0.8 * len(taxonomy))):
        print("   ⚠️ Deepening pass unstable → fallback to previous taxonomy")
        return taxonomy

    # cap: ผ่อนเป็น 2.0 เท่า เพื่อให้ deepening ที่มีเหตุผลยังผ่านได้
    max_categories = int(2.0 * len(taxonomy))
    if len(deepened) > max_categories:
        print(f"   ⚠️ Deepening expanded too much ({len(deepened)} > {max_categories}) → fallback to previous taxonomy")
        return taxonomy

    return deepened

# ─── STATE-AWARE CHECKPOINT MANAGER ──────────────────────────────────────────
class CheckpointManager:
    def __init__(self, run_id):
        self.base_dir = os.path.join(RESULT_DIR, f"run_{run_id}", "checkpoints")
        os.makedirs(self.base_dir, exist_ok=True)
        self.lock = threading.Lock()

    def get_path(self, model_key, phase, extra=""):
        return os.path.join(self.base_dir, f"{model_key}_{phase}{extra}.json")

    def save(self, model_key, phase, data, extra=""):
        with self.lock:
            with open(self.get_path(model_key, phase, extra), "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)

    def load(self, model_key, phase, extra=""):
        path = self.get_path(model_key, phase, extra)
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        return None

# ─── CORE UTILS ───────────────────────────────────────────────────────────────
def normalize_text(text: str) -> str:
    text = unicodedata.normalize("NFC", str(text))
    for ch in ["\u200b", "\u200c", "\u200d", "\ufeff"]: text = text.replace(ch, "")
    return re.sub(r"\s+", " ", text).strip()

def apply_hierarchy_guard(l1, l2, l3):
    l1, l2, l3 = normalize_text(l1), normalize_text(l2), normalize_text(l3)
    if l1 == l2:
        l2 = f"ประเภทของ{l1}"
    return l1, l2, l3

def _sorted_unique_tokens(text: str):
    """
    Thai-aware tokenization for critic voting / matching.
    Used only for canonical comparison, not for final displayed labels.
    """
    text = normalize_text(text).lower()

    # unify separators but preserve semantic connective words
    text = text.replace("/", " ")
    text = text.replace("(", " ")
    text = text.replace(")", " ")
    text = text.replace("-", " ")
    text = text.replace("–", " ")
    text = text.replace("—", " ")
    text = text.replace(",", " ")
    text = text.replace("،", " ")
    text = re.sub(r"\s+", " ", text).strip()

    # Thai tokenizer
    raw_tokens = word_tokenize(text, engine="newmm")

    # normalize tokens
    raw_tokens = [normalize_text(t).strip().lower() for t in raw_tokens if normalize_text(t).strip()]

    # remove punctuation-like tokens only
    punctuation_tokens = {
        ".", ",", ":", ";", "-", "–", "—", "/", "(", ")", "[", "]", "{", "}",
        '"', "'", "“", "”", "‘", "’"
    }

    # light stop-token cleanup for category phrases only
    stop_tokens = {
        "ประเภท", "ลักษณะ", "รูปแบบ", "องค์ประกอบ", "ความหมาย",
        "ทั่วไป", "ทาง", "ของ", "ด้าน", "เชิง",
        "และ", "กับ", "รวม", "เช่น", "และการ", "กับการ"
    }

    tokens = []
    for t in raw_tokens:
        if t in punctuation_tokens:
            continue
        if not t.strip():
            continue
        if t in stop_tokens:
            continue
        tokens.append(t)

    # de-duplicate and sort for stable comparison
    return tuple(sorted(set(tokens)))

def canonicalize_category_text(text: str) -> str:
    """
    Produce a stable comparable signature string for category voting.
    """
    toks = _sorted_unique_tokens(text)
    return " | ".join(toks)

def taxonomy_item_key(item):
    """
    Canonical key used only for critic matching / voting.
    """
    l1 = canonicalize_category_text(item.get("lvl1", ""))
    l2 = canonicalize_category_text(item.get("lvl2", ""))
    l3 = canonicalize_category_text(item.get("lvl3", ""))
    # treat empty lvl3 as wildcard match (avoid all() skipping valid items)
    if not l3:
        l3 = "*"
    return (l1, l2, l3)

def choose_representative_item(items):
    """
    Pick the shortest / most compact representative label among semantically similar critic items.
    Preserve and merge both examples and evidence_words.
    """
    if not items:
        return None

    def score(item):
        l1 = normalize_text(item.get("lvl1", ""))
        l2 = normalize_text(item.get("lvl2", ""))
        l3 = normalize_text(item.get("lvl3", ""))
        total_len = len(l1) + len(l2) + len(l3)
        return (total_len, l1, l2, l3)

    best = sorted(items, key=score)[0]

    merged_examples = set()
    merged_evidence = set()

    for it in items:
        ex = it.get("examples", [])
        if isinstance(ex, list):
            merged_examples.update(
                normalize_text(w) for w in ex if normalize_text(w)
            )

        ew = it.get("evidence_words", [])
        if isinstance(ew, list):
            merged_evidence.update(
                normalize_text(w) for w in ew if normalize_text(w)
            )

    return {
        "lvl1": normalize_text(best.get("lvl1", "")),
        "lvl2": normalize_text(best.get("lvl2", "")),
        "lvl3": normalize_text(best.get("lvl3", "")),
        "examples": sorted(merged_examples),
        "evidence_words": sorted(merged_evidence)
    }

def extract_json(text: str, default=None):
    if default is None: default = []
    if text is None: return default
    raw = str(text)
    raw = re.sub(r"<!--.*?-->", "", raw, flags=re.DOTALL).strip()
    raw = re.sub(r"^```(?:json|JSON|python|txt)?\s*", "", raw).strip()
    raw = re.sub(r"\s*```$", "", raw).strip()
    try: return json.loads(raw)
    except: pass
    match_array = re.search(r"\[\s*.*\s*\]", raw, flags=re.DOTALL)
    if match_array:
        try: return json.loads(match_array.group(0))
        except: pass
    return default

def build_taxonomy_index(consensus_tax):
    valid_paths = set()
    l1_l2_to_l3 = defaultdict(Counter)
    l1_to_l2l3 = defaultdict(list)
    for item in consensus_tax:
        l1, l2, l3 = normalize_text(item.get("lvl1","")), normalize_text(item.get("lvl2","")), normalize_text(item.get("lvl3",""))
        if l1 and l2 and l3:
            valid_paths.add((l1, l2, l3))
            l1_l2_to_l3[(l1, l2)][l3] += 1
            l1_to_l2l3[l1].append((l2, l3))
    
    fallback_l3 = {k: c.most_common(1)[0][0] for k, c in l1_l2_to_l3.items() if c}
    fallback_path = {l1: Counter(paths).most_common(1)[0][0] for l1, paths in l1_to_l2l3.items() if paths}
    
    return {
        "valid_paths": valid_paths,
        "fallback_l3": fallback_l3,
        "fallback_path": fallback_path
    }

def validate_classification_records(records, batch_words, taxonomy_index, stats_sink=None, count_metrics=True):
    batch_word_set = set(normalize_text(w) for w in batch_words)
    seen_words = set()
    cleaned = []
    out_of_tax = []

    def _bump(name, amount=1):
        if stats_sink is not None:
            stats_sink[name] = stats_sink.get(name, 0) + amount

    if count_metrics and stats_sink is not None:
        stats_sink["raw_records_received"] = len(records)

    for r in records:
        if not isinstance(r, dict):
            continue

        word = normalize_text(r.get("word", ""))
        definition = normalize_text(r.get("definition", ""))
        l1 = normalize_text(r.get("lvl1", ""))
        l2 = normalize_text(r.get("lvl2", ""))
        l3 = normalize_text(r.get("lvl3", ""))

        if not word or word not in batch_word_set or word in seen_words:
            continue

        if (l1, l2, l3) in taxonomy_index["valid_paths"]:
            _bump("direct_valid")
            seen_words.add(word)
            cleaned.append({
                "word": word,
                "definition": definition,
                "lvl1": l1,
                "lvl2": l2,
                "lvl3": l3,
                "entity_type": infer_entity_type(word, l1, l2, l3),
                "context_tag": infer_context_tag(word, l1, l2, l3)
            })
            continue

        f_l3 = taxonomy_index["fallback_l3"].get((l1, l2))
        if f_l3:
            l3 = f_l3
            _bump("fallback_to_nearest")
        else:
            f_path = taxonomy_index["fallback_path"].get(l1)
            if f_path:
                l2, l3 = f_path
                _bump("fallback_to_nearest")
            else:
                out_of_tax.append(word)
                _bump("out_of_taxonomy")
                continue

        seen_words.add(word)
        cleaned.append({
            "word": word,
            "definition": definition,
            "lvl1": l1,
            "lvl2": l2,
            "lvl3": l3,
            "entity_type": infer_entity_type(word, l1, l2, l3),
            "context_tag": infer_context_tag(word, l1, l2, l3)
        })

    if stats_sink is not None:
        stats_sink["final_kept"] = len(cleaned)

    return cleaned, out_of_tax, stats_sink

def validate_taxonomy_schema(items):
    """
    Enforce schema + Level-1 constraint + hierarchy guard.
    Merge duplicate paths by accumulating examples and evidence_words.
    """
    merged = {}

    for item in items:
        if not isinstance(item, dict):
            continue

        l1 = normalize_text(item.get("lvl1", ""))
        l2 = normalize_text(item.get("lvl2", ""))
        l3 = normalize_text(item.get("lvl3", ""))

        if not l1 or not l2 or not l3:
            continue

        if l1 not in VALID_L1:
            continue

        l1, l2, l3 = apply_hierarchy_guard(l1, l2, l3)
        key = (l1, l2, l3)

        examples = item.get("examples", [])
        if not isinstance(examples, list):
            examples = []

        evidence_words = item.get("evidence_words", [])
        if not isinstance(evidence_words, list):
            evidence_words = []

        norm_examples = sorted({
            normalize_text(x) for x in examples if normalize_text(x)
        })
        norm_evidence = sorted({
            normalize_text(x) for x in evidence_words if normalize_text(x)
        })

        if key not in merged:
            merged[key] = {
                "lvl1": l1,
                "lvl2": l2,
                "lvl3": l3,
                "examples": norm_examples,
                "evidence_words": norm_evidence
            }
        else:
            ex_set = set(merged[key]["examples"])
            ex_set.update(norm_examples)
            merged[key]["examples"] = sorted(ex_set)

            ew_set = set(merged[key]["evidence_words"])
            ew_set.update(norm_evidence)
            merged[key]["evidence_words"] = sorted(ew_set)

    return list(merged.values())


def infer_entity_type(word, l1="", l2="", l3=""):
    word = normalize_text(word)
    l1 = normalize_text(l1)
    l2 = normalize_text(l2)
    l3 = normalize_text(l3)
    combo = " ".join([l1, l2, l3, word])

    if any(x in combo for x in ["ตัวละคร", "พระราม", "ทศกัณฐ์", "หนุมาน", "อิเหนา", "ขุนแผน"]):
        return "character"
    if any(x in combo for x in ["เทพ", "พระอิศวร", "พระนารายณ์", "พระพรหม", "สิ่งศักดิ์สิทธิ์"]):
        return "deity"
    if any(x in combo for x in ["สัตว์หิมพานต์", "อมนุษย์", "เหนือธรรมชาติ", "ยักษ์", "กินรี"]):
        return "mythical_being"
    if any(x in combo for x in ["พิธี", "ไหว้ครู", "บูชา", "พระราชพิธี", "ประเพณี"]):
        return "ritual"
    if any(x in combo for x in ["เพลง", "ดนตรี", "ทำนอง"]):
        return "music"
    if any(x in combo for x in ["รำ", "นาฏศิลป์", "การแสดง", "ละคร"]):
        return "performance"
    if any(x in combo for x in ["เมือง", "จังหวัด", "ภูมิภาค", "แม่น้ำ", "ภูเขา", "สถานที่"]):
        return "place"
    if any(x in combo for x in ["ผ้า", "เครื่องแต่งกาย", "เครื่องประดับ", "สถาปัตยกรรม", "ศิลปกรรม", "หัตถกรรม"]):
        return "artifact"
    if any(x in combo for x in ["ชาติพันธุ์", "ชุมชน", "วิถีชีวิต", "อาชีพ", "อาหาร"]):
        return "community"
    return "concept"


def infer_context_tag(word, l1="", l2="", l3=""):
    word = normalize_text(word)
    l1 = normalize_text(l1)
    l2 = normalize_text(l2)
    l3 = normalize_text(l3)
    combo = " ".join([l1, l2, l3, word])

    if any(x in combo for x in ["รามเกียรติ์", "พระราม", "ทศกัณฐ์", "หนุมาน"]):
        return "ramakien"
    if any(x in combo for x in ["พิธี", "บูชา", "ศาสนา", "จิตวิญญาณ"]):
        return "ritual_belief"
    if any(x in combo for x in ["ละคร", "รำ", "นาฏศิลป์", "ดนตรี", "เพลง"]):
        return "performing_arts"
    if any(x in combo for x in ["ประวัติศาสตร์", "สมัย", "โบราณ", "ภูมิศาสตร์"]):
        return "historical_spatial"
    if any(x in combo for x in ["ผ้า", "เครื่องแต่งกาย", "ศิลปกรรม", "หัตถกรรม"]):
        return "material_culture"
    if any(x in combo for x in ["ชาติพันธุ์", "ชุมชน", "วิถีชีวิต", "อาหาร"]):
        return "community_life"
    return "general"

def summarize_taxonomy_structure(taxonomy):
    """
    สรุป structural quality ของ taxonomy
    """
    total_paths = len(taxonomy)
    exact_path_set = set()
    hierarchy_violations = 0
    l1_to_l2 = defaultdict(set)
    l1_l2_to_l3 = defaultdict(set)

    duplicate_exact_paths = 0

    for item in taxonomy:
        l1 = normalize_text(item.get("lvl1", ""))
        l2 = normalize_text(item.get("lvl2", ""))
        l3 = normalize_text(item.get("lvl3", ""))

        key = (l1, l2, l3)
        if key in exact_path_set:
            duplicate_exact_paths += 1
        exact_path_set.add(key)

        if l1 == l2:
            hierarchy_violations += 1

        l1_to_l2[l1].add(l2)
        l1_l2_to_l3[(l1, l2)].add(l3)

    singleton_l2 = sum(1 for _, l3s in l1_l2_to_l3.items() if len(l3s) == 1)
    total_l2 = len(l1_l2_to_l3)
    avg_l2_per_l1 = _safe_div(sum(len(v) for v in l1_to_l2.values()), len(l1_to_l2))

    return {
        "total_paths": total_paths,
        "unique_lvl1": len(l1_to_l2),
        "unique_lvl2_pairs": total_l2,
        "duplicate_exact_path_count": duplicate_exact_paths,
        "duplicate_category_rate": _safe_div(duplicate_exact_paths, total_paths),
        "hierarchy_violation_count": hierarchy_violations,
        "hierarchy_violation_rate": _safe_div(hierarchy_violations, total_paths),
        "avg_l2_per_l1": avg_l2_per_l1,
        "singleton_l2_count": singleton_l2,
        "singleton_l2_rate": _safe_div(singleton_l2, total_l2),
        "depth_consistency_rate": 1.0 if total_paths > 0 else 0.0
    }

def compute_critic_metrics(primary_taxonomy, critic_outputs, merged):
    base_keys = set(taxonomy_item_key(i) for i in primary_taxonomy)

    vote_counter = Counter()

    for out in critic_outputs:
        seen_in_this_critic = set()
        for item in out["taxonomy"]:
            key = taxonomy_item_key(item)
            if not all(key):
                continue
            if key in seen_in_this_critic:
                continue
            seen_in_this_critic.add(key)
            vote_counter[key] += 1

    unique_critic_items = len(vote_counter)
    majority_items = sum(1 for _, v in vote_counter.items() if v >= CRITIC_MIN_SUPPORT)
    strong_items = sum(1 for _, v in vote_counter.items() if v >= CRITIC_STRONG_SUPPORT)

    base_items_supported = sum(
        1 for k in base_keys if vote_counter.get(k, 0) >= CRITIC_MIN_SUPPORT
    )
    base_agreement_rate = _safe_div(base_items_supported, len(base_keys))

    merged_keys = set(taxonomy_item_key(i) for i in merged)

    additions = len([k for k in merged_keys if k not in base_keys])
    dropped = len([k for k in base_keys if k not in merged_keys])
    kept = len([k for k in base_keys if k in merged_keys])
    change_ratio = _safe_div(additions + dropped, len(base_keys))

    return {
        "agreement_rate": _safe_div(majority_items, unique_critic_items),
        "strong_agreement_rate": _safe_div(strong_items, unique_critic_items),
        "base_agreement_rate": base_agreement_rate,
        "majority_supported_items": majority_items,
        "additions": additions,
        "dropped": dropped,
        "kept": kept,
        "change_ratio": change_ratio,
        "unique_items_proposed_by_critics": unique_critic_items
    }

# ─── API HANDLER ──────────────────────────────────────────────────────────────
def init_pipeline_stats():
    return {
        "run_id": None,
        "master_input": {
            "source_file": "",
            "original_rows": 0,
            "filtered_rows": 0,
            "kept_ratio": 0.0,
            "input_strategy": "primary_gemini"
        },
        "phase1": {
            "clusters_total": 0,
            "candidate_raw_count": 0,
            "candidate_valid_count": 0,
            "invalid_schema_count": 0,
            "avg_candidates_per_cluster_raw": 0.0,
            "avg_candidates_per_cluster_valid": 0.0,
            "invalid_schema_rate": 0.0
        },
        "phase2": {
            "input_candidate_count": 0,
            "refined_count": 0,
            "reduction_ratio": 0.0
        },
        "critic": {
            "agreement_rate": 0.0,
            "strong_agreement_rate": 0.0,
            "base_agreement_rate": 0.0,
            "majority_supported_items": 0,
            "additions": 0,
            "dropped": 0,
            "kept": 0,
            "change_ratio": 0.0,
            "unique_items_proposed_by_critics": 0,
            "per_critic_edit_ratio": {},
            "targeted_second_pass_used": False
        },
        "architect": {
            "input_count": 0,
            "final_count": 0,
            "compression_ratio": 0.0
        },
        "taxonomy_structure": {},
        "classification": {
            "total_words": 0,
            "raw_records_received": 0,
            "direct_valid": 0,
            "fallback_to_nearest": 0,
            "out_of_taxonomy": 0,
            "final_kept": 0,
            "coverage_rate": 0.0,
            "direct_valid_rate": 0.0,
            "fallback_rate": 0.0,
            "out_of_taxonomy_rate": 0.0,
            "final_valid_rate": 0.0
        },
        "classification_by_model": {},
        "classification_multi": {},
        "api": {
            "calls": 0,
            "success": 0,
            "failures": 0,
            "failure_types": {},
            "by_phase": {}
        }
    }

PIPELINE_STATS = init_pipeline_stats()
STATS_LOCK = threading.Lock()

def _safe_div(a, b):
    return float(a) / float(b) if b else 0.0

def _bump_counter(d, key, amount=1):
    d[key] = d.get(key, 0) + amount

def _record_api_phase(phase, success=False, error_type=None, latency=None):
    with STATS_LOCK:
        api = PIPELINE_STATS["api"]
        api["calls"] += 1
        phase_stats = api["by_phase"].setdefault(phase, {
            "calls": 0,
            "success": 0,
            "failures": 0,
            "failure_types": {},
            "avg_latency_sec": 0.0,
            "_latencies": []
        })
        phase_stats["calls"] += 1

        if success:
            api["success"] += 1
            phase_stats["success"] += 1
        else:
            api["failures"] += 1
            phase_stats["failures"] += 1
            if error_type:
                _bump_counter(api["failure_types"], error_type, 1)
                _bump_counter(phase_stats["failure_types"], error_type, 1)

        if latency is not None:
            phase_stats["_latencies"].append(float(latency))
            phase_stats["avg_latency_sec"] = sum(phase_stats["_latencies"]) / len(phase_stats["_latencies"])

def finalize_api_stats():
    api = PIPELINE_STATS["api"]
    for phase_name, phase_stats in api["by_phase"].items():
        phase_stats.pop("_latencies", None)

def flatten_metrics(d, prefix=""):
    rows = []
    for k, v in d.items():
        key = f"{prefix}.{k}" if prefix else k
        if isinstance(v, dict):
            rows.extend(flatten_metrics(v, key))
        else:
            rows.append({"metric": key, "value": v})
    return rows

def call_api(prompt, model_key, phase="unknown", expect_json=True):
    config = MODEL_CONFIGS[model_key]
    key = os.getenv(config["key_env"]) or os.getenv("OPENROUTER_API_KEY")
    url = "https://openrouter.ai/api/v1/chat/completions"
    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}

    payload = {
        "model": config["model_id"],
        "messages": [{"role": "user", "content": prompt}],
        "temperature": TEMPERATURE,
        "max_tokens": MAX_TOKENS
    }

    if expect_json:
        payload["messages"].insert(0, {
            "role": "system",
            "content": "ตอบกลับเป็น JSON array เท่านั้น ห้ามมีคำอธิบาย ห้ามมี markdown"
        })

    last_error_type = "UNKNOWN_ERROR"

    for attempt in range(1, 6):
        t0 = time.perf_counter()
        try:
            resp = requests.post(url, headers=headers, json=payload, timeout=API_TIMEOUT)
            resp.raise_for_status()
            content = resp.json()["choices"][0]["message"]["content"]
            latency = time.perf_counter() - t0
            _record_api_phase(phase, success=True, latency=latency)
            return content, None

        except requests.exceptions.Timeout:
            last_error_type = "TIMEOUT"
        except requests.exceptions.HTTPError:
            last_error_type = "HTTP_ERROR"
        except requests.exceptions.RequestException:
            last_error_type = "REQUEST_ERROR"
        except Exception:
            last_error_type = "UNKNOWN_ERROR"

        latency = time.perf_counter() - t0
        _record_api_phase(phase, success=False, error_type=last_error_type, latency=latency)
        time.sleep(min(2 * attempt, 30))

    return None, last_error_type

# ─── PIPELINE PHASES ──────────────────────────────────────────────────────────
def run_induction_consolidation(model_key, cp_manager):
    cached = cp_manager.load(model_key, "phase2")
    if cached:
        cached = validate_taxonomy_schema(cached)
        PIPELINE_STATS["phase2"]["refined_count"] = len(cached)
        return cached

    print(f"   [{model_key}] Starting Induction (Phase 1)...")
    df = pd.read_csv(MASTER_INPUT_FILE)

    PIPELINE_STATS["master_input"] = {
        "source_file": MASTER_INPUT_FILE,
        "original_rows": len(df),
        "filtered_rows": len(df),
        "kept_ratio": 1.0,
        "input_strategy": "primary_gemini"
    }

    clusters = list(df.groupby("cluster_label"))
    PIPELINE_STATS["phase1"]["clusters_total"] = len(clusters)

    candidates = []
    phase1_raw = 0
    phase1_valid = 0

    def process_cluster(cid, group):
        words = group["word"].astype(str).head(40).tolist()
        prompt = PHASE1_PROMPT.replace("[[WORD_LIST]]", ", ".join(words))
        content, _ = call_api(prompt, model_key, phase="phase1")
        raw_items = extract_json(content, default=[])
        valid_items = validate_taxonomy_schema(raw_items)
        return {
            "raw_count": len(raw_items),
            "valid_count": len(valid_items),
            "items": valid_items
        }

    with ThreadPoolExecutor(max_workers=MAX_WORKERS_BATCHES) as executor:
        futures = [executor.submit(process_cluster, cid, group) for cid, group in clusters]
        for f in as_completed(futures):
            result = f.result()
            phase1_raw += result["raw_count"]
            phase1_valid += result["valid_count"]
            candidates.extend(result["items"])

    # re-merge after collecting all clusters
    candidates = validate_taxonomy_schema(candidates)

    PIPELINE_STATS["phase1"]["candidate_raw_count"] = phase1_raw
    PIPELINE_STATS["phase1"]["candidate_valid_count"] = len(candidates)
    PIPELINE_STATS["phase1"]["invalid_schema_count"] = max(0, phase1_raw - len(candidates))
    PIPELINE_STATS["phase1"]["avg_candidates_per_cluster_raw"] = _safe_div(phase1_raw, len(clusters))
    PIPELINE_STATS["phase1"]["avg_candidates_per_cluster_valid"] = _safe_div(len(candidates), len(clusters))
    PIPELINE_STATS["phase1"]["invalid_schema_rate"] = _safe_div(max(0, phase1_raw - len(candidates)), phase1_raw)

    print(f"   [{model_key}] Starting Consolidation (Phase 2)...")
    PIPELINE_STATS["phase2"]["input_candidate_count"] = len(candidates)

    prompt = PHASE2_PROMPT.replace("[[CANDIDATE_CATEGORIES]]", json.dumps(candidates[:100], ensure_ascii=False))
    content, _ = call_api(prompt, model_key, phase="phase2")
    refined = validate_taxonomy_schema(extract_json(content, default=candidates))

    PIPELINE_STATS["phase2"]["refined_count"] = len(refined)
    PIPELINE_STATS["phase2"]["reduction_ratio"] = _safe_div(
        max(0, len(candidates) - len(refined)),
        len(candidates)
    )

    cp_manager.save(model_key, "phase2", refined)
    return refined

def critic_refine_taxonomy(primary_taxonomy, cp_manager):
    cached = cp_manager.load("global", "critic_refined_taxonomy")
    if cached:
        cached = validate_taxonomy_schema(cached)
        PIPELINE_STATS["architect"]["final_count"] = len(cached)
        PIPELINE_STATS["taxonomy_structure"] = summarize_taxonomy_structure(cached)
        return cached, []

    print("\n   [Global] Starting Unanimous Critic Review...")
    critic_outputs = []
    per_critic_edit_ratio = {}

    # ── Pass 1: critics with diversified review styles ────────────────────────
    for critic_model in CRITIC_MODELS:
        style_guide = CRITIC_STYLE_GUIDES.get(critic_model, "")
        prompt = DIVERSE_CRITIC_REVIEW_PROMPT \
            .replace("[[CRITIC_STYLE]]", style_guide) \
            .replace("[[PRIMARY_TAXONOMY]]", json.dumps(primary_taxonomy, ensure_ascii=False))

        content, _ = call_api(prompt, critic_model, phase=f"critic_review_{critic_model}")
        reviewed = validate_taxonomy_schema(extract_json(content, default=primary_taxonomy))

        critic_outputs.append({"critic": critic_model, "taxonomy": reviewed})
        cp_manager.save("global", f"critic_review_{critic_model}", reviewed)

        per_critic_edit_ratio[critic_model] = taxonomy_edit_ratio(primary_taxonomy, reviewed)

    # ── ถ้าทุก critic แก้แทบไม่ต่างเลย → เปิด targeted second pass ───────────
    avg_edit_ratio = sum(per_critic_edit_ratio.values()) / len(per_critic_edit_ratio) if per_critic_edit_ratio else 0.0
    targeted_second_pass_used = False

    if avg_edit_ratio < 0.02:
        focus_items = select_focus_taxonomy_items(primary_taxonomy, max_items=8)
        if focus_items:
            print("   ⚠️ Critics too conservative → running targeted second pass")
            targeted_second_pass_used = True
            critic_outputs = []
            per_critic_edit_ratio = {}

            for critic_model in CRITIC_MODELS:
                prompt = TARGETED_CRITIC_PROMPT \
                    .replace("[[FOCUS_ITEMS]]", json.dumps(focus_items, ensure_ascii=False)) \
                    .replace("[[PRIMARY_TAXONOMY]]", json.dumps(primary_taxonomy, ensure_ascii=False))

                content, _ = call_api(prompt, critic_model, phase=f"critic_targeted_{critic_model}")
                reviewed = validate_taxonomy_schema(extract_json(content, default=primary_taxonomy))

                critic_outputs.append({"critic": critic_model, "taxonomy": reviewed})
                cp_manager.save("global", f"critic_targeted_{critic_model}", reviewed)

                per_critic_edit_ratio[critic_model] = taxonomy_edit_ratio(primary_taxonomy, reviewed)

    vote_counter = Counter()
    item_store = defaultdict(list)
    base_keys = set(taxonomy_item_key(i) for i in primary_taxonomy)

    # collect critic votes on canonical keys
    for out in critic_outputs:
        seen_in_this_critic = set()
        for item in out["taxonomy"]:
            key = taxonomy_item_key(item)
            if not all(key):
                continue
            if key in seen_in_this_critic:
                continue
            seen_in_this_critic.add(key)
            vote_counter[key] += 1
            item_store[key].append(item)

    # additions = new items supported by majority of critics
    additions = []
    for k, v in vote_counter.items():
        if k not in base_keys and v >= CRITIC_MIN_SUPPORT:
            rep = choose_representative_item(item_store[k])
            if rep is not None:
                additions.append(rep)

    # keep base items if supported by majority
    kept = []
    for item in primary_taxonomy:
        base_key = taxonomy_item_key(item)
        if vote_counter.get(base_key, 0) >= CRITIC_MIN_SUPPORT:
            kept.append(item)

    dropped = [k for k in base_keys if vote_counter.get(k, 0) < CRITIC_MIN_SUPPORT]

    merged = validate_taxonomy_schema(kept + additions)

    # safeguard: ถ้า critic filtering กลายเป็น aggressive เกินไป → fallback
    if len(merged) < max(5, int(0.6 * len(primary_taxonomy))):
        print("   ⚠️ Critic merge too aggressive → fallback to primary taxonomy + majority additions")
        merged = validate_taxonomy_schema(primary_taxonomy + additions)

    critic_metrics = compute_critic_metrics(primary_taxonomy, critic_outputs, merged)
    PIPELINE_STATS["critic"].update(critic_metrics)
    PIPELINE_STATS["critic"]["per_critic_edit_ratio"] = per_critic_edit_ratio
    PIPELINE_STATS["critic"]["targeted_second_pass_used"] = targeted_second_pass_used

    print(
        f"   ✅ Majority agreement: {critic_metrics['agreement_rate']:.4f} "
        f"| 🔒 Strong agreement: {critic_metrics['strong_agreement_rate']:.4f} "
        f"| 🧱 Base agreement: {critic_metrics['base_agreement_rate']:.4f} "
        f"| ➕ Added: {len(additions)} | ❌ Dropped: {len(dropped)} | ✅ Kept: {len(kept)}"
    )

    print(f"   [Architect] Finalizing Taxonomy with {ARCHITECT_MODEL}...")
    PIPELINE_STATS["architect"]["input_count"] = len(merged)

    cleanup_prompt = FINAL_TAXONOMY_CLEANUP_PROMPT.replace(
        "[[MERGED_TAXONOMY]]",
        json.dumps(merged, ensure_ascii=False)
    )
    content, _ = call_api(cleanup_prompt, ARCHITECT_MODEL, phase="final_cleanup")
    final_tax = validate_taxonomy_schema(extract_json(content, default=merged))

    # ── เพิ่ม deepening pass ถ้า taxonomy ยัง generic / shallow ───────────────
    final_tax = run_taxonomy_deepening_if_needed(final_tax, cp_manager)

    PIPELINE_STATS["architect"]["final_count"] = len(final_tax)
    PIPELINE_STATS["architect"]["compression_ratio"] = _safe_div(
        max(0, len(merged) - len(final_tax)),
        len(merged)
    )

    PIPELINE_STATS["taxonomy_structure"] = summarize_taxonomy_structure(final_tax)

    cp_manager.save("global", "critic_refined_taxonomy", final_tax)
    return final_tax, critic_outputs

def run_classification(model_key, consensus_tax, cp_manager, run_id):
    final_path = os.path.join(RESULT_DIR, f"run_{run_id}", "Phase_3", f"labeled_{model_key}.csv")
    os.makedirs(os.path.dirname(final_path), exist_ok=True)

    print(f"   [{model_key}] Starting Classification (Phase 3)...")

    df = pd.read_csv(MASTER_INPUT_FILE)
    words = df["word"].astype(str).tolist()

    taxonomy_index = build_taxonomy_index(consensus_tax)
    tax_str = "\n".join([f"- {i['lvl1']} > {i['lvl2']} > {i['lvl3']}" for i in consensus_tax])

    results = []
    batches = [words[i:i+BATCH_SIZE] for i in range(0, len(words), BATCH_SIZE)]

    # local stats ต่อโมเดลเท่านั้น
    local_stats = {
        "total_words": len(words),
        "raw_records_received": 0,
        "direct_valid": 0,
        "fallback_to_nearest": 0,
        "out_of_taxonomy": 0,
        "final_kept": 0,
        "coverage_rate": 0.0,
        "direct_valid_rate": 0.0,
        "fallback_rate": 0.0,
        "out_of_taxonomy_rate": 0.0,
        "final_valid_rate": 0.0
    }

    def process_batch(batch):
        prompt = PHASE3_PROMPT.replace("[[TAXONOMY_STRUCTURE]]", tax_str).replace("[[WORD_LIST]]", ", ".join(batch))
        content, _ = call_api(prompt, model_key, phase="phase3")
        batch_results = extract_json(content, default=[])

        stats = {}
        cleaned, out_of_tax, stats = validate_classification_records(
            batch_results, batch, taxonomy_index, stats_sink=stats
        )
        return cleaned, out_of_tax, stats

    with ThreadPoolExecutor(max_workers=MAX_WORKERS_BATCHES) as executor:
        futures = [executor.submit(process_batch, batch) for batch in batches]

        for f in as_completed(futures):
            cleaned, out_of_tax, stats = f.result()
            results.extend(cleaned)

            local_stats["raw_records_received"] += stats.get("raw_records_received", 0)
            local_stats["direct_valid"] += stats.get("direct_valid", 0)
            local_stats["fallback_to_nearest"] += stats.get("fallback_to_nearest", 0)
            local_stats["out_of_taxonomy"] += stats.get("out_of_taxonomy", 0)

            print(f"      [{model_key}] Progress: {len(results)}/{len(words)}", end="\r")

    # deduplicate final results by word
    final_by_word = {}
    for row in results:
        final_by_word[normalize_text(row["word"])] = row
    results = list(final_by_word.values())

    total_words = local_stats["total_words"]
    raw_received = local_stats["raw_records_received"]
    direct_valid = local_stats["direct_valid"]
    fallback = local_stats["fallback_to_nearest"]
    out_tax = local_stats["out_of_taxonomy"]
    final_kept = len(results)

    local_stats["final_kept"] = final_kept
    local_stats["coverage_rate"] = _safe_div(final_kept, total_words)

    # สำคัญ: rate ระดับ record ให้ normalize ด้วย raw_records_received
    local_stats["direct_valid_rate"] = _safe_div(direct_valid, raw_received)
    local_stats["fallback_rate"] = _safe_div(fallback, raw_received)
    local_stats["out_of_taxonomy_rate"] = _safe_div(out_tax, raw_received)
    local_stats["final_valid_rate"] = _safe_div(direct_valid + fallback, raw_received)

    pd.DataFrame(results).to_csv(final_path, index=False, encoding="utf-8-sig")
    print(f"\n   [{model_key}] Classification complete.")

    return results, local_stats

# ─── MULTI-MODEL CLASSIFICATION ──────────────────────────────────────────────
def run_classification_multi(consensus_tax, cp_manager, run_id):
    """
    Run closed-set classification for multiple models using the same final taxonomy.

    Note:
    - This stage is used for robustness checking and agreement analysis.
    - It is NOT the upstream input-construction mechanism of the semantic representation layer.
    """
    model_results = {}
    PIPELINE_STATS["classification_by_model"] = {}

    for model_key in [PRIMARY_MODEL] + CRITIC_MODELS:
        print(f"\n🚀 Running classification for model: {model_key}")
        rows, local_stats = run_classification(model_key, consensus_tax, cp_manager, run_id)

        path = os.path.join(
            RESULT_DIR,
            f"run_{run_id}",
            "Phase_3",
            f"labeled_{model_key}.csv"
        )

        for _ in range(10):
            if os.path.exists(path):
                try:
                    df = pd.read_csv(path)
                    model_results[model_key] = df
                    PIPELINE_STATS["classification_by_model"][model_key] = local_stats
                    break
                except Exception:
                    time.sleep(1)
        else:
            print(f"❌ Failed to read classification file for {model_key}")

    # paper table หลักให้ใช้ของ primary model เท่านั้น
    if PRIMARY_MODEL in PIPELINE_STATS["classification_by_model"]:
        PIPELINE_STATS["classification"] = PIPELINE_STATS["classification_by_model"][PRIMARY_MODEL]

    return model_results

# ─── AGREEMENT ANALYSIS ──────────────────────────────────────────────────────
def build_consensus_and_agreement(model_results, run_id):
    """
    Build consensus classification + agreement metrics
    """
    print("\n📊 Building multi-model agreement analysis...")

    # collect all words
    all_words = set()
    for df in model_results.values():
        all_words.update(df["word"].astype(str).tolist())

    rows = []
    agreement_count = 0

    # for Fleiss' Kappa
    category_index = {}
    category_counter = 0
    kappa_matrix = []

    # pre-build lookup maps to avoid O(N²) per word
    df_maps = {}
    for model_key, df in model_results.items():
        df_maps[model_key] = {str(row["word"]): row for _, row in df.iterrows()}

    for word in sorted(all_words):
        votes = []

        for model_key in model_results:
            r = df_maps[model_key].get(word)
            if r is not None:
                label = f"{r['lvl1']}||{r['lvl2']}||{r['lvl3']}"
                votes.append(label)

        if not votes:
            continue

        vote_count = Counter(votes)
        majority_label, majority_votes = vote_count.most_common(1)[0]

        agreement = majority_votes / len(votes)
        if agreement == 1.0:
            agreement_count += 1

        rows.append({
            "word": word,
            "consensus_label": majority_label,
            "agreement": agreement,
            "n_models": len(votes)
        })

        # build kappa encoding
        row_vec = defaultdict(int)
        for v in votes:
            if v not in category_index:
                category_index[v] = category_counter
                category_counter += 1
            row_vec[category_index[v]] += 1

        kappa_matrix.append(row_vec)

    # convert to matrix
    if category_counter > 0:
        import numpy as np
        M = np.zeros((len(kappa_matrix), category_counter))

        for i, row_vec in enumerate(kappa_matrix):
            for j, count in row_vec.items():
                M[i, j] = count

        kappa = fleiss_kappa(M)
    else:
        kappa = 0.0

    agreement_rate = agreement_count / len(rows) if rows else 0.0

    # save
    final_dir = os.path.join(RESULT_DIR, f"run_{run_id}", "final")

    pd.DataFrame(rows).to_csv(
        os.path.join(final_dir, "consensus_classification.csv"),
        index=False,
        encoding="utf-8-sig"
    )

    PIPELINE_STATS["classification_multi"] = {
        "total_words": len(rows),
        "perfect_agreement_rate": agreement_rate,
        "fleiss_kappa": kappa
    }

    print(f"   ✅ Perfect Agreement Rate: {agreement_rate:.4f}")
    print(f"   ✅ Fleiss' Kappa: {kappa:.4f}")

# ─── EXPORT PAPER TABLES (AGREEMENT) ───────────────────────────────
def export_agreement_tables(run_id):
    final_dir = os.path.join(RESULT_DIR, f"run_{run_id}", "final")

    consensus_path = os.path.join(final_dir, "consensus_classification.csv")
    if not os.path.exists(consensus_path):
        print("⚠️ consensus_classification.csv not found → skipping agreement tables")
        return

    df = pd.read_csv(consensus_path)

    total = len(df)

    # Agreement distribution
    bins = {
        "1.00": (df["agreement"] == 1.0).sum(),
        "0.75-0.99": ((df["agreement"] >= 0.75) & (df["agreement"] < 1.0)).sum(),
        "0.50-0.74": ((df["agreement"] >= 0.5) & (df["agreement"] < 0.75)).sum(),
        "<0.50": (df["agreement"] < 0.5).sum(),
    }

    dist_rows = [
        {
            "level": k,
            "percentage": v / total if total else 0,
            "count": int(v)
        }
        for k, v in bins.items()
    ]

    pd.DataFrame(dist_rows).to_csv(
        os.path.join(final_dir, "table_agreement_distribution.csv"),
        index=False,
        encoding="utf-8-sig"
    )

    # Summary table
    stats = PIPELINE_STATS["classification_multi"]

    summary_rows = [
        {"metric": "Total Words", "value": stats["total_words"]},
        {"metric": "Perfect Agreement Rate", "value": stats["perfect_agreement_rate"]},
        {"metric": "Fleiss Kappa", "value": stats["fleiss_kappa"]},
    ]

    pd.DataFrame(summary_rows).to_csv(
        os.path.join(final_dir, "table_agreement_summary.csv"),
        index=False,
        encoding="utf-8-sig"
    )

    print("📄 Agreement tables exported.")

# ─── MAIN ─────────────────────────────────────────────────────────────
def export_metrics(final_dir):
    finalize_api_stats()

    metrics_json_path = os.path.join(final_dir, "metrics_summary.json")
    metrics_csv_path = os.path.join(final_dir, "metrics_summary.csv")

    with open(metrics_json_path, "w", encoding="utf-8") as f:
        json.dump(PIPELINE_STATS, f, ensure_ascii=False, indent=2)

    flat_rows = flatten_metrics(PIPELINE_STATS)
    pd.DataFrame(flat_rows).to_csv(metrics_csv_path, index=False, encoding="utf-8-sig")

    print(f"📊 Metrics JSON saved to: {metrics_json_path}")
    print(f"📊 Metrics CSV saved to:  {metrics_csv_path}")

def export_paper_tables(final_dir):
    p1 = PIPELINE_STATS["phase1"]
    p2 = PIPELINE_STATS["phase2"]
    critic = PIPELINE_STATS["critic"]
    arch = PIPELINE_STATS["architect"]
    struct = PIPELINE_STATS["taxonomy_structure"]
    cls = PIPELINE_STATS["classification"]
    api = PIPELINE_STATS["api"]

    taxonomy_json_path = os.path.join(final_dir, "taxonomy_consensus.json")
    taxonomy_needs_deepening_flag = -1
    if os.path.exists(taxonomy_json_path):
        with open(taxonomy_json_path, "r", encoding="utf-8") as f:
            loaded_taxonomy = json.load(f)
        taxonomy_needs_deepening_flag = int(taxonomy_needs_deepening(loaded_taxonomy))

    table_main = [
        {"stage": "Phase 1", "metric": "Candidate Categories", "value": p1["candidate_valid_count"]},
        {"stage": "Phase 1", "metric": "Invalid Schema Rate", "value": p1["invalid_schema_rate"]},
        {"stage": "Phase 2", "metric": "Refined Categories", "value": p2["refined_count"]},
        {"stage": "Phase 2", "metric": "Reduction Ratio", "value": p2["reduction_ratio"]},
        {"stage": "Critic", "metric": "Agreement Rate", "value": critic["agreement_rate"]},
        {"stage": "Critic", "metric": "Strong Agreement Rate", "value": critic["strong_agreement_rate"]},
        {"stage": "Critic", "metric": "Base Agreement Rate", "value": critic["base_agreement_rate"]},
        {"stage": "Critic", "metric": "Majority Supported Items", "value": critic["majority_supported_items"]},
        {"stage": "Critic", "metric": "Additions", "value": critic["additions"]},
        {"stage": "Critic", "metric": "Dropped", "value": critic["dropped"]},
        {"stage": "Critic", "metric": "Change Ratio", "value": critic["change_ratio"]},
        {"stage": "Architect", "metric": "Final Categories", "value": arch["final_count"]},
        {"stage": "Architect", "metric": "Compression Ratio", "value": arch["compression_ratio"]},
        {"stage": "Classification", "metric": "Total Words", "value": cls["total_words"]},
        {"stage": "Classification", "metric": "Coverage Rate", "value": cls["coverage_rate"]},
        {"stage": "Classification", "metric": "Direct Valid Rate", "value": cls["direct_valid_rate"]},
        {"stage": "Classification", "metric": "Fallback Rate", "value": cls["fallback_rate"]},
        {"stage": "Classification", "metric": "Out-of-Taxonomy Rate", "value": cls["out_of_taxonomy_rate"]},
        {"stage": "System", "metric": "API Success", "value": api["success"]},
        {"stage": "System", "metric": "API Failures", "value": api["failures"]}
    ]

    table_structure = [
        {"metric": "Total Paths", "value": struct.get("total_paths", 0)},
        {"metric": "Unique Level 1", "value": struct.get("unique_lvl1", 0)},
        {"metric": "Unique L1-L2 pairs", "value": struct.get("unique_lvl2_pairs", 0)},
        {"metric": "Duplicate Category Rate", "value": struct.get("duplicate_category_rate", 0.0)},
        {"metric": "Hierarchy Violation Rate", "value": struct.get("hierarchy_violation_rate", 0.0)},
        {"metric": "Average L2 per L1", "value": struct.get("avg_l2_per_l1", 0.0)},
        {"metric": "Singleton L2 Rate", "value": struct.get("singleton_l2_rate", 0.0)},
        {"metric": "Depth Consistency Rate", "value": struct.get("depth_consistency_rate", 0.0)},
        {"metric": "Taxonomy Needs Deepening", "value": taxonomy_needs_deepening_flag},
        {"metric": "Primary Model Used", "value": PRIMARY_MODEL}
    ]

    pd.DataFrame(table_main).to_csv(
        os.path.join(final_dir, "paper_table_main_results.csv"),
        index=False,
        encoding="utf-8-sig"
    )

    pd.DataFrame(table_structure).to_csv(
        os.path.join(final_dir, "paper_table_taxonomy_structure.csv"),
        index=False,
        encoding="utf-8-sig"
    )

    print("📄 Paper tables exported.")

def export_critic_vote_debug(final_dir, primary_taxonomy, critic_outputs):
    rows = []

    base_keys = set(taxonomy_item_key(i) for i in primary_taxonomy)
    vote_counter = Counter()

    for out in critic_outputs:
        seen_in_this_critic = set()
        critic_name = out["critic"]
        for item in out["taxonomy"]:
            key = taxonomy_item_key(item)
            if not all(key):
                continue
            if key in seen_in_this_critic:
                continue
            seen_in_this_critic.add(key)
            vote_counter[key] += 1
            rows.append({
                "critic": critic_name,
                "lvl1": normalize_text(item.get("lvl1", "")),
                "lvl2": normalize_text(item.get("lvl2", "")),
                "lvl3": normalize_text(item.get("lvl3", "")),
                "canonical_key": " || ".join(key),
                "is_base_item": key in base_keys
            })

    vote_rows = [{"canonical_key": " || ".join(k), "votes": v} for k, v in vote_counter.items()]

    pd.DataFrame(rows).to_csv(
        os.path.join(final_dir, "critic_vote_debug_rows.csv"),
        index=False,
        encoding="utf-8-sig"
    )
    pd.DataFrame(vote_rows).to_csv(
        os.path.join(final_dir, "critic_vote_debug_summary.csv"),
        index=False,
        encoding="utf-8-sig"
    )

    print("🧪 Critic debug tables exported.")

def export_model_comparison_table(final_dir):
    rows = []

    for model, stats in PIPELINE_STATS["classification_by_model"].items():
        rows.append({
            "model": model,
            "coverage_rate": stats.get("coverage_rate", 0),
            "direct_valid_rate": stats.get("direct_valid_rate", 0),
            "fallback_rate": stats.get("fallback_rate", 0),
            "out_of_taxonomy_rate": stats.get("out_of_taxonomy_rate", 0)
        })

    pd.DataFrame(rows).to_csv(
        os.path.join(final_dir, "paper_table_model_comparison.csv"),
        index=False,
        encoding="utf-8-sig"
    )

    print("📄 Model comparison table exported.")

def export_semantic_evidence_table(final_dir):
    taxonomy_path = os.path.join(final_dir, "taxonomy_consensus.json")

    if not os.path.exists(taxonomy_path):
        return

    with open(taxonomy_path, "r", encoding="utf-8") as f:
        taxonomy = json.load(f)

    rows = []

    for item in taxonomy:
        rows.append({
            "lvl1": item.get("lvl1"),
            "lvl2": item.get("lvl2"),
            "lvl3": item.get("lvl3"),
            "n_examples": len(item.get("examples", [])),
            "n_evidence_words": len(item.get("evidence_words", []))
        })

    pd.DataFrame(rows).to_csv(
        os.path.join(final_dir, "paper_table_semantic_evidence.csv"),
        index=False,
        encoding="utf-8-sig"
    )

    print("📄 Semantic evidence table exported.")

# ─── FLEISS' KAPPA ───────────────────────────────────────────────────────────
def fleiss_kappa(M):
    """
    Compute Fleiss' kappa for assessing the reliability of agreement
    between a fixed number of raters assigning categorical ratings.
    M is a matrix of shape (N, k) where each row contains category counts.
    """
    import numpy as np

    M = np.asarray(M, dtype=float)
    N, k = M.shape
    n_annotators = np.sum(M[0])

    if N == 0 or k == 0 or n_annotators <= 1:
        return 0.0

    p_j = np.sum(M, axis=0) / (N * n_annotators)
    P_i = (np.sum(M * M, axis=1) - n_annotators) / (n_annotators * (n_annotators - 1))
    P_bar = np.mean(P_i)
    P_e_bar = np.sum(p_j * p_j)

    if P_e_bar == 1.0:
        return 0.0

    return (P_bar - P_e_bar) / (1 - P_e_bar)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--resume", type=str)
    args = parser.parse_args()

    run_id = args.resume or DEFAULT_RUN_ID
    PIPELINE_STATS["run_id"] = run_id

    cp_manager = CheckpointManager(run_id)

    print(f"🚀 BIM Taxonomy Pipeline V4.0 (Architect: {MODEL_CONFIGS[ARCHITECT_MODEL]['model_id']})")
    print(f"📦 Input: {MASTER_INPUT_FILE}")

    if not os.path.exists(MASTER_INPUT_FILE):
        print(f"❌ Input file not found: {MASTER_INPUT_FILE}")
        return

    primary_tax = run_induction_consolidation(PRIMARY_MODEL, cp_manager)
    consensus_tax, critic_outputs = critic_refine_taxonomy(primary_tax, cp_manager)

    if not consensus_tax or len(consensus_tax) < 5:
        raise ValueError("❌ Taxonomy too small — pipeline unstable")

    final_dir = os.path.join(RESULT_DIR, f"run_{run_id}", "final")
    os.makedirs(final_dir, exist_ok=True)

    with open(os.path.join(final_dir, "taxonomy_consensus.json"), "w", encoding="utf-8") as f:
        json.dump(consensus_tax, f, ensure_ascii=False, indent=2)

    # ─── MULTI-MODEL CLASSIFICATION + AGREEMENT ─────────────────────────────────
    # Agreement analysis is retained as an evaluation layer only.
    # It does not construct the upstream lexical input for semantic induction.
    model_results = run_classification_multi(consensus_tax, cp_manager, run_id)
    build_consensus_and_agreement(model_results, run_id)
    export_agreement_tables(run_id)

    export_metrics(final_dir)
    export_paper_tables(final_dir)
    export_model_comparison_table(final_dir)
    export_semantic_evidence_table(final_dir)
    export_critic_vote_debug(final_dir, primary_tax, critic_outputs)

    print(f"\n✅ Pipeline V4.0 Finished. Results in result/run_{run_id}/")

if __name__ == "__main__":
    API_TIMEOUT = 300
    main()
