"""Stable id helper shared by services — mirrors pipeline stable_id()."""
from __future__ import annotations

import hashlib


def stable_id(kind: str, name: str) -> int:
    """Match the deterministic id scheme used by the pipeline (first 7 hex of sha256)."""
    h = hashlib.sha256(f"{kind}::{name}".encode("utf-8")).hexdigest()
    return int(h[:7], 16)