"""
services/ingestion.py — Live-ingest orchestrator for item lifecycle.

Consolidates:
1. **Drafting (Layer A + Layer B grounding + Draft Store)**:
   - ``draft_item(payload: ItemDraft, loader: Optional[ArtifactLoader] = None) -> ItemDraftOut``
2. **Committing (Layer C merge + E5 vector encoding + Transactional DB insert + Loader Append)**:
   - ``commit_item(payload: ItemCommit, loader: Optional[ArtifactLoader] = None, *, admin_user: Optional[User] = None) -> ItemCommitOut``
3. **Keyword Reassignment & In-memory Sync**:
   - ``reassign_item_keywords(item_id: int, payload: ItemKeywordReassign, loader: Optional[ArtifactLoader] = None) -> ItemReassignOut``
4. **Item Update & Delete**:
   - ``update_item(item_id: int, payload: ItemUpdate, loader: Optional[ArtifactLoader] = None) -> ItemReassignOut``
   - ``delete_item(item_id: int, loader: Optional[ArtifactLoader] = None) -> ItemDeleteOut``
5. **Media Attachments**:
   - ``attach_item_image(artifact_id: int, file: UploadFile, loader: Optional[ArtifactLoader] = None) -> ItemImageUploadOut``
   - ``attach_item_video(artifact_id: int, file: UploadFile, loader: Optional[ArtifactLoader] = None) -> ItemVideoUploadOut``
6. **Loader Mutators & Invalidation**:
   - ``update_loader_row(...)``
   - ``invalidate_catalog_cache()``

The flow (per ADR-0003 §2.3):
- Compute embedding OUTSIDE the loader lock via ``services.embedding.encode_item_text``.
- Acquire loader lock (``get_lock()``).
- Transactionally write DB rows.
- Mutate loader in-memory structures.
- Release lock.
"""
from __future__ import annotations

import logging
import time
import uuid
from threading import Lock
from typing import Any, Dict, Iterable, List, NamedTuple, Optional, Sequence, Tuple

from fastapi import UploadFile
from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session

from ..core.config import get_settings
from ..core.exceptions import InvalidRequestError, ItemNotFoundError
from ..db import is_db_enabled, session_scope
from ..models_db import (
    Context,
    InteractionLog,
    Item,
    ItemContext,
    ItemKeyword,
    Keyword,
    LegacyInteraction,
    Like,
    Rating,
    SavedItem,
    User,
)
from ..model_loader import ArtifactLoader, get_lock, get_singleton
from ..schemas.admin import (
    ItemCommit,
    ItemCommitOut,
    ItemCreate,
    ItemDeleteOut,
    ItemDraft,
    ItemDraftOut,
    ItemImageUploadOut,
    ItemKeywordReassign,
    ItemReassignOut,
    ItemUpdate,
    ItemVideoUploadOut,
    KeywordProposal,
)
from ..schemas.context import ContextOut
from ..schemas.item import ItemOut
from ..schemas.keyword import KeywordOut
from ..services import embedding as emb
from ..services import grounding, storage
from ..services._ids import stable_id
from ..services.suitability import catalog_match_percent, suitability_label


logger = logging.getLogger("recsys.ingestion")


class IngestResult(NamedTuple):
    item: ItemOut
    artifact_id: int
    db_id: int
    warnings: List[str]


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


def reset_draft_store() -> None:
    """Clear in-memory draft store. Useful for testing."""
    with _drafts_lock:
        _drafts.clear()


# --- Context resolution -----------------------------------------------------


def _resolve_contexts(
    session: Session,
    names: Sequence[str],
) -> Tuple[List[int], List[str]]:
    """Look up context ids by name. Auto-creates missing rows.

    Returns ``(resolved_ids, warnings)``. Names that are blank are
    skipped silently (returns no warning) — the admin may leave
    context_names empty for items where context isn't yet known.
    """
    resolved: List[int] = []
    warnings: List[str] = []
    for raw in names or []:
        if not isinstance(raw, str):
            continue
        name = raw.strip()
        if not name:
            continue
        stmt = select(Context).where(Context.name == name)
        row = session.execute(stmt).scalar_one_or_none()
        if row is None:
            row = Context(name=name, group_name="", description="")
            session.add(row)
            session.flush()
            warnings.append(f"Created missing context: {name!r}")
        resolved.append(int(row.id))
    return resolved, warnings


# --- Keyword resolution -----------------------------------------------------


def _resolve_keyword_names(session: Session, names: Iterable[str]) -> List[int]:
    """Best-effort resolve keyword *names* to ids (admin can type free text)."""
    out: List[int] = []
    for raw in names or []:
        if not isinstance(raw, str):
            continue
        name = raw.strip()
        if not name:
            continue
        stmt = select(Keyword).where(Keyword.name == name)
        row = session.execute(stmt).scalar_one_or_none()
        if row is not None:
            out.append(int(row.id))
    return out


def _names_for_keyword_ids(session: Session, ids: Sequence[int]) -> List[str]:
    if not ids:
        return []
    rows = session.execute(
        select(Keyword.name).where(Keyword.id.in_([int(i) for i in ids]))
    ).scalars().all()
    return [str(r) for r in rows]


def _unique_ints(values: Optional[Iterable[int]]) -> List[int]:
    out: List[int] = []
    seen: set[int] = set()
    for raw in values or []:
        value = int(raw)
        if value in seen:
            continue
        seen.add(value)
        out.append(value)
    return out


# --- ItemOut formatting -----------------------------------------------------


def _coerce_int(value: Any) -> Optional[int]:
    if value is None:
        return None
    try:
        n = int(value)
    except (TypeError, ValueError):
        return None
    if n != n:  # NaN guard
        return None
    return n


def _item_out_from_session(session: Session, item: Item) -> ItemOut:
    db_id = int(item.id)
    context_counts = dict(
        session.execute(
            select(ItemContext.context_id, func.count(ItemContext.item_id))
            .join(Item, Item.id == ItemContext.item_id)
            .where(Item.is_active.is_(True))
            .group_by(ItemContext.context_id)
        ).all()
    )
    context_rows = session.execute(
        select(Context.id, Context.name, Context.group_name, Context.description)
        .join(ItemContext, ItemContext.context_id == Context.id)
        .where(ItemContext.item_id == db_id)
        .order_by(Context.group_name, Context.name)
    ).all()
    keyword_rows = session.execute(
        select(Keyword.id, Keyword.name)
        .join(ItemKeyword, ItemKeyword.keyword_id == Keyword.id)
        .where(ItemKeyword.item_id == db_id)
        .order_by(Keyword.name)
    ).all()
    mp = catalog_match_percent(
        keyword_count=len(keyword_rows),
        context_count=len(context_rows),
        description_length=len(str(item.description or "")),
    )

    return ItemOut(
        id=int(item.artifact_item_id),
        name=str(item.name or ""),
        description=str(item.description or ""),
        category_group=str(item.category_group or ""),
        performance_type=str(item.performance_type or ""),
        performers_count=_coerce_int(item.performers_count),
        duration_minutes=_coerce_int(item.duration_minutes),
        price_text=str(item.price_text or ""),
        image_url=str(item.image_url or ""),
        video_url=str(item.video_url or ""),
        keywords=[
            KeywordOut(id=int(keyword_id), name=str(name or ""), taxonomy_path="")
            for keyword_id, name in keyword_rows
        ],
        contexts=[
            ContextOut(
                id=stable_id("context", str(name or "")),
                name=str(name or ""),
                group=str(group_name or ""),
                description=str(description or ""),
                active_item_count=int(context_counts.get(context_id, 0)),
            )
            for context_id, name, group_name, description in context_rows
        ],
        match_percent=mp,
        suitability_label=suitability_label(mp),
    )


# --- Loader Row & Cache Helpers ---------------------------------------------


def update_loader_row(
    artifact_id: int,
    values: Dict[str, Any],
    *,
    context_names: Optional[List[str]] = None,
    keyword_names: Optional[List[str]] = None,
    loader: Optional[ArtifactLoader] = None,
) -> None:
    """Update a specific row in the ArtifactLoader's in-memory DataFrame under lock."""
    if loader is None:
        loader = get_singleton()
    idx = loader.id_to_row.get(int(artifact_id))
    if idx is None or getattr(loader, "_items", None) is None:
        return

    lock = get_lock()
    acquired = lock.acquire(timeout=30)
    if not acquired:
        raise RuntimeError("Could not acquire loader lock within 30 s")
    try:
        for column, value in values.items():
            if column in loader._items.columns:
                loader._items.at[idx, column] = value
        if context_names is not None and "context_names" in loader._items.columns:
            loader._items.at[idx, "context_names"] = list(context_names)
        if keyword_names is not None and "keyword_names" in loader._items.columns:
            loader._items.at[idx, "keyword_names"] = list(keyword_names)
    finally:
        lock.release()


def invalidate_catalog_cache() -> None:
    """Invalidate cached catalog rows across active routers."""
    try:
        from ..routers.catalog import invalidate_db_item_rows_cache

        invalidate_db_item_rows_cache()
    except Exception:  # pragma: no cover
        pass


# --- Public Entry Points: Deep Module Lifecycle -----------------------------


def draft_item(
    payload: ItemDraft,
    loader: Optional[ArtifactLoader] = None,
) -> ItemDraftOut:
    """Encapsulates Layer A token Jaccard matching + Layer B Gemini LLM
    schema suggestion and draft cache management.
    """
    if loader is None:
        loader = get_singleton()
    vocab = grounding.load_vocab(loader)
    settings = get_settings()
    item_dict = {
        "name": payload.name,
        "description": payload.description,
        "category_group": payload.category_group,
        "performance_type": payload.performance_type,
    }
    grounded = grounding.ground_keywords(
        item_dict,
        vocab,
        use_llm=settings.grounding_use_llm,
    )
    vocab_by_id = {v.id: v for v in vocab}
    proposals: List[KeywordProposal] = []
    for kid in grounded["layer_a_ids"]:
        v = vocab_by_id.get(kid)
        if v is None:
            continue
        proposals.append(
            KeywordProposal(id=v.id, name=v.name, source="auto", confidence=1.0)
        )
    for kid in grounded["layer_b_ids"]:
        v = vocab_by_id.get(kid)
        if v is None:
            continue
        proposals.append(
            KeywordProposal(id=v.id, name=v.name, source="llm", confidence=0.8)
        )

    context_ids: List[int] = []
    warnings: List[str] = []
    additional_kw_ids: List[int] = []

    if is_db_enabled():
        with session_scope() as session:
            if payload.context_names:
                c_ids, c_warns = _resolve_contexts(session, payload.context_names)
                context_ids.extend(c_ids)
                warnings.extend(c_warns)
            if payload.keyword_names:
                additional_kw_ids = _resolve_keyword_names(
                    session, payload.keyword_names
                )

    draft_id = _save_draft(
        {
            "name": payload.name,
            "description": payload.description,
            "category_group": payload.category_group,
            "performance_type": payload.performance_type,
            "performers_count": payload.performers_count,
            "duration_minutes": payload.duration_minutes,
            "price_text": payload.price_text,
            "context_names": list(payload.context_names or []),
            "context_ids": context_ids,
            "layer_a_ids": grounded["layer_a_ids"],
            "layer_b_ids": grounded["layer_b_ids"],
            "additional_keyword_ids": additional_kw_ids,
        }
    )

    return ItemDraftOut(
        draft_id=draft_id,
        proposals=proposals,
        context_ids=context_ids,
        warnings=warnings,
    )


def commit_item(
    payload: ItemCommit,
    loader: Optional[ArtifactLoader] = None,
    *,
    admin_user: Optional[User] = None,
) -> ItemCommitOut:
    """Encapsulates draft resolution, E5 text embedding computation outside
    lock, transactional PostgreSQL commit (items, item_contexts, item_keywords),
    and in-memory ArtifactLoader.append_item update inside get_lock().
    """
    draft_data = _consume_draft(payload.draft_id)

    # Merge Layer A + Layer B + draft additional keywords + commit additional keywords - removed keywords.
    seen: set[int] = set()
    final_kw_ids: List[int] = []
    all_kws = (
        draft_data.get("layer_a_ids", [])
        + draft_data.get("layer_b_ids", [])
        + draft_data.get("additional_keyword_ids", [])
        + (payload.additional_keyword_ids or [])
    )
    for kid in all_kws:
        if kid in seen:
            continue
        seen.add(kid)
        final_kw_ids.append(kid)

    removed = set(payload.removed_keyword_ids or [])
    final_kw_ids = [k for k in final_kw_ids if k not in removed]

    item_create = ItemCreate(
        name=draft_data["name"],
        description=draft_data.get("description", ""),
        category_group=draft_data.get("category_group", ""),
        performance_type=draft_data.get("performance_type", ""),
        performers_count=draft_data.get("performers_count"),
        duration_minutes=draft_data.get("duration_minutes"),
        price_text=draft_data.get("price_text", "") or "",
        context_names=draft_data.get("context_names", []),
        keyword_ids=final_kw_ids,
    )
    result = ingest_new_item(item_create, admin_user=admin_user, loader=loader)
    invalidate_catalog_cache()
    return ItemCommitOut(item=result.item, warnings=result.warnings)


def reassign_item_keywords(
    item_id: int,
    payload: ItemKeywordReassign,
    loader: Optional[ArtifactLoader] = None,
) -> ItemReassignOut:
    """Encapsulates updating item keywords and synchronizing loader state."""
    if not is_db_enabled():
        raise InvalidRequestError(
            "DB layer disabled",
            extra={"code": "db_disabled"},
        )
    if loader is None:
        loader = get_singleton()

    with session_scope() as session:
        stmt = select(Item).where(Item.artifact_item_id == int(item_id))
        item = session.execute(stmt).scalar_one_or_none()
        if item is None:
            raise InvalidRequestError(
                f"Item not found: {item_id}",
                extra={"code": "item_not_found"},
            )
        db_id = int(item.id)
        session.execute(delete(ItemKeyword).where(ItemKeyword.item_id == db_id))
        for kid in payload.keyword_ids or []:
            session.add(
                ItemKeyword(
                    item_id=db_id,
                    keyword_id=int(kid),
                    source="human",
                )
            )
        session.flush()

        kw_names = _names_for_keyword_ids(session, payload.keyword_ids or [])
        item_out = _item_out_from_session(session, item)

    update_loader_row(
        int(item_id),
        {},
        keyword_names=kw_names,
        loader=loader,
    )
    invalidate_catalog_cache()
    return ItemReassignOut(item=item_out, warnings=[])


def update_item(
    item_id: int,
    payload: ItemUpdate,
    loader: Optional[ArtifactLoader] = None,
) -> ItemReassignOut:
    """Encapsulates editing an existing catalog item and synchronizing loader state."""
    if not is_db_enabled():
        raise InvalidRequestError(
            "DB layer disabled",
            extra={"code": "db_disabled"},
        )
    if loader is None:
        loader = get_singleton()

    warnings: List[str] = []
    with session_scope() as session:
        item = session.execute(
            select(Item).where(Item.artifact_item_id == int(item_id))
        ).scalar_one_or_none()
        if item is None:
            raise ItemNotFoundError(f"Item not found: {item_id}")

        db_id = int(item.id)
        if payload.name is not None:
            item.name = payload.name.strip()
        if payload.description is not None:
            item.description = payload.description.strip()
        if payload.category_group is not None:
            item.category_group = payload.category_group.strip()
        if payload.performance_type is not None:
            item.performance_type = payload.performance_type.strip()
        if payload.performers_count is not None:
            item.performers_count = int(payload.performers_count)
        if payload.duration_minutes is not None:
            item.duration_minutes = int(payload.duration_minutes)
        if payload.price_text is not None:
            item.price_text = payload.price_text.strip()
        if payload.image_url is not None:
            item.image_url = payload.image_url.strip()
        if payload.video_url is not None:
            item.video_url = payload.video_url.strip()
        if payload.is_active is not None:
            item.is_active = bool(payload.is_active)

        context_names: Optional[List[str]] = None
        if payload.context_names is not None:
            context_names = []
            context_ids: List[int] = []
            for raw in payload.context_names:
                if not isinstance(raw, str):
                    continue
                name = raw.strip()
                if not name:
                    continue
                row = session.execute(
                    select(Context).where(Context.name == name)
                ).scalar_one_or_none()
                if row is None:
                    row = Context(name=name, group_name="", description="")
                    session.add(row)
                    session.flush()
                    warnings.append(f"Created missing context: {name!r}")
                context_names.append(str(row.name))
                context_ids.append(int(row.id))
            session.execute(delete(ItemContext).where(ItemContext.item_id == db_id))
            for context_id in context_ids:
                session.add(
                    ItemContext(
                        item_id=db_id,
                        context_id=context_id,
                        validity_status="valid",
                    )
                )

        keyword_names: Optional[List[str]] = None
        if payload.keyword_ids is not None or payload.new_keyword_names is not None:
            if payload.keyword_ids is None:
                current_keyword_ids = session.execute(
                    select(ItemKeyword.keyword_id).where(ItemKeyword.item_id == db_id)
                ).scalars().all()
                requested_kw_ids = _unique_ints(list(current_keyword_ids))
            else:
                requested_kw_ids = _unique_ints(payload.keyword_ids)

            keyword_rows = (
                session.execute(
                    select(Keyword).where(Keyword.id.in_(requested_kw_ids))
                ).scalars().all()
                if requested_kw_ids
                else []
            )
            keywords_by_id = {int(row.id): row for row in keyword_rows}
            kw_ids = [k for k in requested_kw_ids if k in keywords_by_id]
            missing_ids = [k for k in requested_kw_ids if k not in keywords_by_id]
            if missing_ids:
                warnings.append(f"Ignored unknown keyword ids: {missing_ids}")

            seen_names = {str(row.name).strip().casefold() for row in keyword_rows}
            for raw_name in payload.new_keyword_names or []:
                if not isinstance(raw_name, str):
                    continue
                name = " ".join(raw_name.split())
                if not name:
                    continue
                if len(name) > 255:
                    raise InvalidRequestError(
                        "Keyword must not exceed 255 characters",
                        extra={"code": "keyword_name_too_long"},
                    )
                normalized = name.casefold()
                if normalized in seen_names:
                    continue
                row = session.execute(
                    select(Keyword).where(func.lower(Keyword.name) == name.lower())
                ).scalars().first()
                if row is None:
                    row = Keyword(name=name)
                    session.add(row)
                    session.flush()
                    warnings.append(f"Created keyword: {name!r}")
                keyword_id = int(row.id)
                keywords_by_id[keyword_id] = row
                kw_ids.append(keyword_id)
                seen_names.add(str(row.name).strip().casefold())

            kw_ids = _unique_ints(kw_ids)
            session.execute(delete(ItemKeyword).where(ItemKeyword.item_id == db_id))
            for keyword_id in kw_ids:
                session.add(
                    ItemKeyword(
                        item_id=db_id,
                        keyword_id=keyword_id,
                        source="admin",
                    )
                )
            keyword_names = [str(keywords_by_id[kid].name) for kid in kw_ids]

        session.flush()
        loader_values = {
            "name": item.name,
            "description": item.description or "",
            "category_group": item.category_group or "",
            "performance_type": item.performance_type or "",
            "performers_count": item.performers_count,
            "duration_minutes": item.duration_minutes,
            "price_text": item.price_text or "",
            "image_url": item.image_url or "",
            "video_url": item.video_url or "",
            "is_active": bool(item.is_active),
        }
        item_out = _item_out_from_session(session, item)

    update_loader_row(
        int(item_id),
        loader_values,
        context_names=context_names,
        keyword_names=keyword_names,
        loader=loader,
    )
    invalidate_catalog_cache()
    return ItemReassignOut(item=item_out, warnings=warnings)


def delete_item(
    item_id: int,
    loader: Optional[ArtifactLoader] = None,
) -> ItemDeleteOut:
    """Encapsulates deleting a catalog row and hiding it from the in-memory recommender."""
    if not is_db_enabled():
        raise InvalidRequestError(
            "DB layer disabled",
            extra={"code": "db_disabled"},
        )
    if loader is None:
        loader = get_singleton()

    with session_scope() as session:
        item = session.execute(
            select(Item).where(Item.artifact_item_id == int(item_id))
        ).scalar_one_or_none()
        if item is None:
            raise InvalidRequestError(
                f"Item not found: {item_id}",
                extra={"code": "item_not_found"},
            )
        db_id = int(item.id)
        session.execute(delete(ItemKeyword).where(ItemKeyword.item_id == db_id))
        session.execute(delete(ItemContext).where(ItemContext.item_id == db_id))
        session.execute(delete(Like).where(Like.item_id == db_id))
        session.execute(delete(SavedItem).where(SavedItem.item_id == db_id))
        session.execute(delete(Rating).where(Rating.item_id == db_id))
        session.execute(
            delete(LegacyInteraction).where(LegacyInteraction.item_id == db_id)
        )
        session.execute(
            update(InteractionLog)
            .where(InteractionLog.item_id == db_id)
            .values(item_id=None)
        )
        session.delete(item)
        session.flush()

    update_loader_row(int(item_id), {"is_active": False}, loader=loader)
    invalidate_catalog_cache()
    return ItemDeleteOut(item_id=int(item_id), deleted=True, warnings=[])


def attach_item_image(
    artifact_id: int,
    file: UploadFile,
    loader: Optional[ArtifactLoader] = None,
) -> ItemImageUploadOut:
    """Save cover image upload, update DB row and in-memory loader, clean up old file."""
    if not is_db_enabled():
        raise InvalidRequestError(
            "DB layer disabled",
            extra={"code": "db_disabled"},
        )
    if loader is None:
        loader = get_singleton()

    settings = get_settings()
    items_dir = settings.upload_dir / "items"

    with session_scope() as session:
        item = session.execute(
            select(Item).where(Item.artifact_item_id == int(artifact_id))
        ).scalar_one_or_none()
        if item is None:
            raise InvalidRequestError(
                f"Item not found: {artifact_id}",
                extra={"code": "item_not_found"},
            )
        old_url = str(item.image_url or "")
        _filename, public_url, size_bytes, mime = storage.save_upload(
            file,
            items_dir,
            prefix=str(artifact_id),
            max_bytes=settings.max_upload_bytes,
            allowed_mime=settings.allowed_upload_mime,
        )
        item.image_url = public_url
        session.flush()

    update_loader_row(int(artifact_id), {"image_url": public_url}, loader=loader)
    invalidate_catalog_cache()
    storage.delete_upload(old_url, settings.upload_dir)

    return ItemImageUploadOut(
        url=public_url,
        size_bytes=int(size_bytes),
        mime=mime,
        item_id=int(artifact_id),
    )


def attach_item_video(
    artifact_id: int,
    file: UploadFile,
    loader: Optional[ArtifactLoader] = None,
) -> ItemVideoUploadOut:
    """Save video upload, update DB row and in-memory loader, clean up old file."""
    if not is_db_enabled():
        raise InvalidRequestError(
            "DB layer disabled",
            extra={"code": "db_disabled"},
        )
    if loader is None:
        loader = get_singleton()

    settings = get_settings()
    items_dir = settings.upload_dir / "items"

    with session_scope() as session:
        item = session.execute(
            select(Item).where(Item.artifact_item_id == int(artifact_id))
        ).scalar_one_or_none()
        if item is None:
            raise InvalidRequestError(
                f"Item not found: {artifact_id}",
                extra={"code": "item_not_found"},
            )
        old_url = str(item.video_url or "")
        _filename, public_url, size_bytes, mime = storage.save_video_upload(
            file,
            items_dir,
            prefix=f"{artifact_id}_video",
            max_bytes=settings.max_video_upload_bytes,
            allowed_mime=settings.allowed_video_upload_mime,
        )
        item.video_url = public_url
        session.flush()

    update_loader_row(int(artifact_id), {"video_url": public_url}, loader=loader)
    invalidate_catalog_cache()
    storage.delete_upload(old_url, settings.upload_dir)

    return ItemVideoUploadOut(
        url=public_url,
        size_bytes=int(size_bytes),
        mime=mime,
        item_id=int(artifact_id),
    )


# --- Legacy Entry Point: Ingest New Item ------------------------------------


def ingest_new_item(
    item_create: ItemCreate,
    *,
    admin_user: Optional[User] = None,
    loader: Optional[ArtifactLoader] = None,
) -> IngestResult:
    """Insert a new item into DB + ArtifactLoader. Returns ``IngestResult``.

    Steps
    -----
    1. Compute embedding outside the loader lock.
    2. Acquire loader lock.
    3. Open DB session, validate uniqueness.
    4. Insert Item + ItemContext + ItemKeyword rows.
    5. Append to the loader.
    6. Release lock, return.

    Raises ``InvalidRequestError`` on duplicate name or missing required
    fields, ``RuntimeError`` if embedding generation fails.
    """
    if not is_db_enabled():
        raise InvalidRequestError(
            "Ingestion requires the DB layer (RECSYS_DB_ENABLED=1)",
            extra={"code": "db_disabled"},
        )
    if loader is None:
        loader = get_singleton()
    if not loader.is_loaded:
        raise InvalidRequestError(
            "ArtifactLoader not loaded — backend startup incomplete.",
            extra={"code": "artifacts_not_loaded"},
        )

    name = (item_create.name or "").strip()
    if not name:
        raise InvalidRequestError("name is required", extra={"code": "invalid_request"})
    description = (item_create.description or "").strip()
    category = (item_create.category_group or "").strip()
    ptype = (item_create.performance_type or "").strip()
    performers = (
        int(item_create.performers_count)
        if item_create.performers_count is not None
        else None
    )
    duration = (
        int(item_create.duration_minutes)
        if item_create.duration_minutes is not None
        else None
    )
    price = (item_create.price_text or "").strip()

    # Step 1 — embedding OUTSIDE the lock (slow).
    row_for_embed = {
        "name": name,
        "description": description,
        "category_group": category,
        "performance_type": ptype,
    }
    # Embedding uses only the textual fields.
    embed_vec = emb.encode_item_text(
        row_for_embed,
        kw_names=[],
        ctx_names=[],
    )

    # Step 2 — acquire loader lock.
    lock = get_lock()
    acquired = lock.acquire(timeout=30)
    if not acquired:
        raise RuntimeError("Could not acquire loader lock within 30 s")
    try:
        # Step 3 — open DB session.
        with session_scope() as session:
            # Validate uniqueness (case-insensitive).
            existing = session.execute(
                select(Item).where(Item.name.ilike(name))
            ).scalar_one_or_none()
            if existing is not None:
                raise InvalidRequestError(
                    f"Item name already exists: {name!r}",
                    extra={"code": "duplicate_name"},
                )

            # Resolve context ids.
            ctx_ids, ctx_warnings = _resolve_contexts(
                session, item_create.context_names or []
            )

            # Resolve keyword ids (only ids — admin must pre-resolve).
            kw_ids = _unique_ints(item_create.keyword_ids or [])

            aid = int(stable_id("item", name))

            # Step 4 — insert Item row.
            item = Item(
                name=name,
                description=description,
                category_group=category,
                performance_type=ptype,
                performers_count=performers,
                duration_minutes=duration,
                price_text=price,
                image_url="",
                video_url="",
                is_active=True,
                artifact_item_id=aid,
            )
            session.add(item)
            session.flush()
            db_id = int(item.id)

            for cid in ctx_ids:
                session.add(
                    ItemContext(
                        item_id=db_id,
                        context_id=cid,
                        validity_status="valid",
                    )
                )
            for kid in kw_ids:
                session.add(
                    ItemKeyword(
                        item_id=db_id,
                        keyword_id=kid,
                        source="admin",
                    )
                )
            session.flush()

            # Step 5 — append to the loader.
            loader.append_item(
                row={
                    "name": name,
                    "description": description,
                    "category_group": category,
                    "performance_type": ptype,
                    "performers_count": performers if performers is not None else 0,
                    "duration_minutes": duration if duration is not None else 0,
                    "price_text": price,
                    "is_active": True,
                },
                embedding=embed_vec,
                kw_names=[],
                ctx_names=list(item_create.context_names or []),
                taxonomy_paths=[],
            )

            warnings = list(ctx_warnings)
            item_out = ItemOut(
                id=aid,
                name=name,
                description=description,
                category_group=category,
                performance_type=ptype,
                performers_count=performers,
                duration_minutes=duration,
                price_text=price,
                keywords=[],
                contexts=[],
            )
            logger.info(
                "ingested new item db_id=%d artifact_id=%d name=%r by admin=%s",
                db_id,
                aid,
                name,
                admin_user.id if admin_user else "anon",
            )
            return IngestResult(
                item=item_out,
                artifact_id=aid,
                db_id=db_id,
                warnings=warnings,
            )
    finally:
        lock.release()