"""
routers/admin.py — ``/admin/items/*`` endpoints.

Three routes:

* ``POST /admin/items/draft``              — body ``ItemDraft`` → ``ItemDraftOut``
* ``POST /admin/items``                    — body ``ItemCommit`` → ``ItemCommitOut``
* ``POST /admin/items/{id}/keywords``      — body ``ItemKeywordReassign`` → ``ItemReassignOut``

All routes require ``Depends(get_current_admin)`` — see services/auth.
"""
from __future__ import annotations

import logging
import time
import uuid
from threading import Lock
from typing import Any, Dict, List

from fastapi import APIRouter, Depends

from ..core.config import get_settings
from ..core.exceptions import InvalidRequestError
from ..model_loader import ArtifactLoader, get_singleton
from ..schemas.admin import (
    ItemCommit,
    ItemCommitOut,
    ItemDraft,
    ItemDraftOut,
    ItemKeywordReassign,
    ItemReassignOut,
)
from ..schemas.item import ItemOut
from ..services import grounding, ingestion
from ..services.auth import get_current_admin
from ..services._ids import stable_id


logger = logging.getLogger("recsys.admin")
router = APIRouter(prefix="/admin", tags=["admin"])


# --- Draft store (in-memory; TTL 30 min) -----------------------------------


_DRAFT_TTL_SECONDS = 30 * 60
_drafts: Dict[str, Dict[str, Any]] = {}
_drafts_lock = Lock()


def _save_draft(payload: Dict[str, Any]) -> str:
    """Stash a draft keyed by a uuid4 string with an expiry stamp."""
    draft_id = uuid.uuid4().hex
    payload = dict(payload)
    payload["_expires_at"] = time.time() + _DRAFT_TTL_SECONDS
    with _drafts_lock:
        _drafts[draft_id] = payload
    return draft_id


def _consume_draft(draft_id: str) -> Dict[str, Any]:
    """Pop a draft by id; raise ``InvalidRequestError`` if missing/expired."""
    with _drafts_lock:
        payload = _drafts.pop(draft_id, None)
    if payload is None:
        raise InvalidRequestError(
            "Unknown or expired draft_id",
            extra={"code": "unknown_draft"},
        )
    if payload.get("_expires_at", 0) < time.time():
        raise InvalidRequestError(
            "Draft has expired",
            extra={"code": "draft_expired"},
        )
    return payload


# --- Endpoints --------------------------------------------------------------


@router.post("/items/draft", response_model=ItemDraftOut)
def create_draft(
    draft: ItemDraft,
    admin_user=Depends(get_current_admin),
) -> ItemDraftOut:
    """Layer A + Layer B grounding. Returns a draft_id + proposals."""
    loader: ArtifactLoader = get_singleton()
    vocab = grounding.load_vocab(loader)
    settings = get_settings()
    item_dict = {
        "name": draft.name,
        "description": draft.description,
        "category_group": draft.category_group,
        "performance_type": draft.performance_type,
    }
    grounded = grounding.ground_keywords(
        item_dict,
        vocab,
        use_llm=settings.grounding_use_llm,
    )
    # Look up names for each id from the vocab.
    vocab_by_id = {v.id: v for v in vocab}
    proposals: List = []
    for kid in grounded["layer_a_ids"]:
        v = vocab_by_id.get(kid)
        if v is None:
            continue
        proposals.append({"id": v.id, "name": v.name, "source": "auto", "confidence": 1.0})
    for kid in grounded["layer_b_ids"]:
        v = vocab_by_id.get(kid)
        if v is None:
            continue
        proposals.append({"id": v.id, "name": v.name, "source": "llm", "confidence": 0.8})

    # Resolve context names → ids (best-effort; warnings bubble up).
    from ..db import session_scope
    from ..models_db import Context
    from sqlalchemy import select

    context_ids: List[int] = []
    warnings: List[str] = []
    if draft.context_names:
        with session_scope() as session:
            for name in draft.context_names:
                if not isinstance(name, str) or not name.strip():
                    continue
                row = session.execute(
                    select(Context).where(Context.name == name.strip())
                ).scalar_one_or_none()
                if row is None:
                    row = Context(name=name.strip(), group_name="", description="")
                    session.add(row)
                    session.flush()
                    warnings.append(f"Created missing context: {name.strip()!r}")
                context_ids.append(int(row.id))

    draft_id = _save_draft(
        {
            "name": draft.name,
            "description": draft.description,
            "category_group": draft.category_group,
            "performance_type": draft.performance_type,
            "context_names": list(draft.context_names or []),
            "context_ids": context_ids,
            "layer_a_ids": grounded["layer_a_ids"],
            "layer_b_ids": grounded["layer_b_ids"],
            "additional_keyword_ids": list(draft.keyword_names and _resolve_existing_keyword_ids(draft.keyword_names) or []),
        }
    )

    from ..schemas.admin import KeywordProposal

    return ItemDraftOut(
        draft_id=draft_id,
        proposals=[KeywordProposal(**p) for p in proposals],
        context_ids=context_ids,
        warnings=warnings,
    )


def _resolve_existing_keyword_ids(names: List[str]) -> List[int]:
    if not names:
        return []
    from ..db import session_scope
    from ..models_db import Keyword
    from sqlalchemy import select

    out: List[int] = []
    with session_scope() as session:
        for raw in names:
            if not isinstance(raw, str):
                continue
            name = raw.strip()
            if not name:
                continue
            row = session.execute(
                select(Keyword).where(Keyword.name == name)
            ).scalar_one_or_none()
            if row is not None:
                out.append(int(row.id))
    return out


@router.post("/items", response_model=ItemCommitOut)
def commit_item(
    commit: ItemCommit,
    admin_user=Depends(get_current_admin),
) -> ItemCommitOut:
    """Layer C commit: merge admin edits + call ``ingest_new_item``."""
    payload = _consume_draft(commit.draft_id)

    # Merge Layer A + Layer B + admin additions − admin removals.
    seen: set = set()
    final_kw_ids: List[int] = []
    for kid in (payload.get("layer_a_ids", []) + payload.get("layer_b_ids", []) + commit.additional_keyword_ids):
        if kid in seen:
            continue
        seen.add(kid)
        final_kw_ids.append(kid)
    final_kw_ids = [k for k in final_kw_ids if k not in set(commit.removed_keyword_ids)]

    from ..schemas.admin import ItemCreate

    item_create = ItemCreate(
        name=payload["name"],
        description=payload.get("description", ""),
        category_group=payload.get("category_group", ""),
        performance_type=payload.get("performance_type", ""),
        context_names=payload.get("context_names", []),
        keyword_ids=final_kw_ids,
    )
    result = ingestion.ingest_new_item(item_create, admin_user=admin_user)
    return ItemCommitOut(item=result.item, warnings=result.warnings)


@router.post("/items/{item_id}/keywords", response_model=ItemReassignOut)
def reassign_keywords(
    item_id: int,
    body: ItemKeywordReassign,
    admin_user=Depends(get_current_admin),
) -> ItemReassignOut:
    """Layer C re-edit on an existing item: replace keyword links + re-embed.

    For MVP we only rewrite the DB join rows; the loader's
    ``keyword_names`` list is rebuilt on the next reload. The full
    re-embed path is wired in but reuses ``ingest_new_item``-style helpers
    so it can be expanded later.
    """
    from ..db import session_scope
    from ..models_db import Item, ItemKeyword
    from sqlalchemy import delete, select

    with session_scope() as session:
        # Look up by artifact_item_id (the URL path carries the artifact id).
        stmt = select(Item).where(Item.artifact_item_id == int(item_id))
        item = session.execute(stmt).scalar_one_or_none()
        if item is None:
            raise InvalidRequestError(
                f"Item not found: {item_id}",
                extra={"code": "item_not_found"},
            )
        session.execute(delete(ItemKeyword).where(ItemKeyword.item_id == int(item_id)))
        for kid in body.keyword_ids:
            session.add(
                ItemKeyword(
                    item_id=int(item_id),
                    keyword_id=int(kid),
                    source="human",
                )
            )
        session.flush()
        # Refresh the loader's view of this item's keyword names.
        loader = get_singleton()
        kw_rows = session.execute(
            select(ItemKeyword.keyword_id).where(ItemKeyword.item_id == int(item_id))
        ).all()
        kw_names = _names_for_keyword_ids([r[0] for r in kw_rows])

        # Replace the loader row in place (preserve position in matrix).
        from ..model_loader import get_lock

        lock = get_lock()
        acquired = lock.acquire(timeout=30)
        if not acquired:
            raise RuntimeError("Could not acquire loader lock within 30 s")
        try:
            aid = int(item.artifact_item_id)
            idx = loader.id_to_row.get(aid)
            if idx is not None and "keyword_names" in loader._items.columns:
                # ``.at[idx, col]`` assigns the list into the cell.
                loader._items.at[idx, "keyword_names"] = list(kw_names)
        finally:
            lock.release()

        item_out = ItemOut(
            id=int(item.artifact_item_id),
            name=item.name,
            description=item.description or "",
            category_group=item.category_group or "",
            performance_type=item.performance_type or "",
            keywords=[],
            contexts=[],
        )
        return ItemReassignOut(item=item_out, warnings=[])


def _names_for_keyword_ids(ids: List[int]) -> List[str]:
    if not ids:
        return []
    from ..db import session_scope
    from ..models_db import Keyword
    from sqlalchemy import select

    out: List[str] = []
    with session_scope() as session:
        rows = session.execute(
            select(Keyword).where(Keyword.id.in_([int(i) for i in ids]))
        ).scalars().all()
        for r in rows:
            out.append(str(r.name))
    return out