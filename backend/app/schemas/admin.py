"""
schemas/admin.py — Pydantic v2 request/response models for /admin/items/*.

The admin slice drives the live-ingest feature: an admin POSTs an item
draft → server returns Layer A (rule) + Layer B (LLM) keyword proposals
plus resolved context ids → admin edits the proposals → admin commits →
server inserts into Postgres + appends to ArtifactLoader + hot-reloads.

Three flows:
* ``POST /admin/items/draft``   body ``ItemDraft``        → ``ItemDraftOut``
* ``POST /admin/items``         body ``ItemCommit``       → ``ItemOut``
* ``POST /admin/items/{id}/keywords``  body ``ItemKeywordReassign``  → ``ItemOut``
"""
from __future__ import annotations

from typing import List, Literal, Optional

from pydantic import BaseModel, Field

from .item import ItemOut


class ItemDraft(BaseModel):
    """Item fields the admin enters on the form.

    ``keyword_names`` are optional manual hints (Layer A will pre-seed these
    if they already exist in the vocabulary). The server fills in the rest
    via Layer A + Layer B.
    """

    name: str = Field(min_length=1, max_length=255)
    description: str = Field(default="", max_length=2000)
    category_group: str = Field(default="", max_length=255)
    performance_type: str = Field(default="", max_length=255)
    context_names: List[str] = Field(default_factory=list)
    keyword_names: List[str] = Field(default_factory=list)


class ItemCreate(BaseModel):
    """Final item payload sent to ``POST /admin/items`` after Layer C edits."""

    name: str = Field(min_length=1, max_length=255)
    description: str = Field(default="", max_length=2000)
    category_group: str = Field(default="", max_length=255)
    performance_type: str = Field(default="", max_length=255)
    context_names: List[str] = Field(default_factory=list)
    keyword_ids: List[int] = Field(default_factory=list)


class KeywordProposal(BaseModel):
    """A single keyword the server suggests the admin to attach.

    ``source`` distinguishes the provenance so the admin UI can colour them
    differently (auto = rule match, llm = Gemini, human = admin-typed).
    """

    id: int
    name: str
    source: Literal["auto", "llm", "human"]
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)


class ItemDraftOut(BaseModel):
    draft_id: str
    proposals: List[KeywordProposal] = Field(default_factory=list)
    context_ids: List[int] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)


class ItemCommit(BaseModel):
    """Layer C: admin's edited selection of keywords over the draft."""

    draft_id: str
    additional_keyword_ids: List[int] = Field(default_factory=list)
    removed_keyword_ids: List[int] = Field(default_factory=list)


class ItemCommitOut(BaseModel):
    item: ItemOut
    warnings: List[str] = Field(default_factory=list)


class ItemKeywordReassign(BaseModel):
    """Layer C re-edit on an existing item."""

    keyword_ids: List[int] = Field(default_factory=list)


class ItemReassignOut(BaseModel):
    item: ItemOut
    warnings: List[str] = Field(default_factory=list)