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

from typing import Dict, List, Literal, Optional

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
    performers_count: Optional[int] = Field(default=None, ge=0)
    duration_minutes: Optional[int] = Field(default=None, ge=0)
    price_text: str = Field(default="", max_length=255)
    context_names: List[str] = Field(default_factory=list)
    keyword_names: List[str] = Field(default_factory=list)


class ItemCreate(BaseModel):
    """Final item payload sent to ``POST /admin/items`` after Layer C edits."""

    name: str = Field(min_length=1, max_length=255)
    description: str = Field(default="", max_length=2000)
    category_group: str = Field(default="", max_length=255)
    performance_type: str = Field(default="", max_length=255)
    performers_count: Optional[int] = Field(default=None, ge=0)
    duration_minutes: Optional[int] = Field(default=None, ge=0)
    price_text: str = Field(default="", max_length=255)
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


class ItemUpdate(BaseModel):
    """Admin edit payload for an existing catalog item.

    The URL carries the stable artifact id. Editable scalar fields are stored
    on ``items``; contexts and keywords rewrite the DB join rows when present.
    """

    name: Optional[str] = Field(default=None, min_length=1, max_length=255)
    description: Optional[str] = Field(default=None, max_length=2000)
    category_group: Optional[str] = Field(default=None, max_length=255)
    performance_type: Optional[str] = Field(default=None, max_length=255)
    performers_count: Optional[int] = Field(default=None, ge=0)
    duration_minutes: Optional[int] = Field(default=None, ge=0)
    price_text: Optional[str] = Field(default=None, max_length=255)
    image_url: Optional[str] = Field(default=None, max_length=500)
    video_url: Optional[str] = Field(default=None, max_length=500)
    is_active: Optional[bool] = None
    context_names: Optional[List[str]] = None
    keyword_ids: Optional[List[int]] = None


class ItemDeleteOut(BaseModel):
    item_id: int
    deleted: bool = True
    warnings: List[str] = Field(default_factory=list)


class ItemFacetsOut(BaseModel):
    """Distinct categorical values used to populate the admin form dropdowns.

    Source priority is DB rows first (newer values may have been added since
    the artifact was built) with a graceful fallback to the in-memory
    artifact loader when the DB layer is disabled.

    ``category_groups_by_performance_type`` lets the form render the
    ``หมวดหมู่`` dropdown as a dependent cascade — selecting
    ``ประเภทการแสดง`` first filters the category options to only those
    seen together in the corpus.
    """

    category_groups: List[str] = Field(default_factory=list)
    performance_types: List[str] = Field(default_factory=list)
    category_groups_by_performance_type: Dict[str, List[str]] = Field(default_factory=dict)
    source: Literal["db", "artifact"] = "artifact"


class ItemImageUploadOut(BaseModel):
    """Result of a successful cover-image upload."""

    url: str = Field(..., description="Public URL where the image is served (e.g. /uploads/items/abc.jpg).")
    size_bytes: int = Field(..., ge=0, description="File size in bytes.")
    mime: str = Field(..., description="Sniffed MIME type (image/jpeg | image/png | image/webp).")
    item_id: int = Field(..., description="Artifact item id the image was attached to.")
