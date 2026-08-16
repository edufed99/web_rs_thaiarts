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

from fastapi import APIRouter, Depends, File, UploadFile

from ..core.config import get_settings
from ..core.exceptions import InvalidRequestError, ItemNotFoundError
from ..model_loader import ArtifactLoader, get_singleton
from ..schemas.admin import (
    ItemCommit,
    ItemCommitOut,
    ItemDeleteOut,
    ItemDraft,
    ItemDraftOut,
    ItemFacetsOut,
    ItemImageUploadOut,
    ItemVideoUploadOut,
    ItemKeywordReassign,
    ItemReassignOut,
    ItemUpdate,
)
from ..schemas.user import (
    AdminUserCreate,
    AdminUserDeleteOut,
    AdminUserListOut,
    AdminUserUpdate,
    GmailOAuthStartOut,
    GmailOAuthStatusOut,
    UserOut,
)
from ..schemas.item import ItemOut
from ..services import gmail_oauth, grounding, ingestion, mailer, storage, user_query
from ..services.auth import get_current_admin, hash_password
from ..services._ids import stable_id


logger = logging.getLogger("recsys.admin")
router = APIRouter(prefix="/admin", tags=["admin"])


def _admin_user_out(user) -> UserOut:
    return UserOut(
        id=int(user.id),
        username=str(user.username),
        email=str(user.email or ""),
        display_name=str(user.display_name or ""),
        is_admin=bool(user.is_admin),
        role="super_admin" if bool(user.is_admin) else "user",
        auth_provider=str(getattr(user, "auth_provider", "password") or "password"),
        email_verified=bool(getattr(user, "email_verified", False)),
        created_at=user.created_at,
        last_login_at=user.last_login_at,
    )


@router.get("/users", response_model=AdminUserListOut)
def list_admin_users(admin_user=Depends(get_current_admin)) -> AdminUserListOut:
    rows = user_query.list_users(limit=500)
    return AdminUserListOut(
        users=[_admin_user_out(row) for row in rows],
        total=len(rows),
    )


@router.post("/users", response_model=UserOut)
def create_admin_user(
    payload: AdminUserCreate,
    admin_user=Depends(get_current_admin),
) -> UserOut:
    if user_query.find_user_by_username(payload.username) is not None:
        raise InvalidRequestError(
            "Username already taken",
            extra={"code": "duplicate_username"},
        )
    user = user_query.create_user(
        username=payload.username,
        password_hash=hash_password(payload.password),
        email=payload.email or "",
        display_name=payload.display_name or "",
        is_admin=payload.is_admin,
    )
    if user is None:
        raise InvalidRequestError(
            "User could not be created",
            extra={"code": "user_not_created"},
        )
    return _admin_user_out(user)


@router.put("/users/{user_id}", response_model=UserOut)
def update_admin_user(
    user_id: int,
    payload: AdminUserUpdate,
    admin_user=Depends(get_current_admin),
) -> UserOut:
    target = user_query.find_user_by_id(user_id)
    if target is None:
        raise InvalidRequestError(
            "User not found",
            extra={"code": "user_not_found"},
        )
    if payload.username is not None and payload.username != target.username:
        duplicate = user_query.find_user_by_username(payload.username)
        if duplicate is not None and int(duplicate.id) != int(user_id):
            raise InvalidRequestError(
                "Username already taken",
                extra={"code": "duplicate_username"},
            )
    if int(admin_user.id) == int(user_id) and payload.is_admin is False:
        raise InvalidRequestError(
            "You cannot remove your own administrator role",
            extra={"code": "cannot_demote_self"},
        )
    updated = user_query.update_user_by_admin(
        user_id,
        username=payload.username,
        email=payload.email,
        display_name=payload.display_name,
        password_hash=hash_password(payload.password) if payload.password else None,
        is_admin=payload.is_admin,
    )
    if updated is None:
        raise InvalidRequestError(
            "User not found",
            extra={"code": "user_not_found"},
        )
    return _admin_user_out(updated)


@router.delete("/users/{user_id}", response_model=AdminUserDeleteOut)
def delete_admin_user(
    user_id: int,
    admin_user=Depends(get_current_admin),
) -> AdminUserDeleteOut:
    if int(admin_user.id) == int(user_id):
        raise InvalidRequestError(
            "You cannot delete the account you are currently using",
            extra={"code": "cannot_delete_self"},
        )
    if user_query.find_user_by_id(user_id) is None:
        raise InvalidRequestError(
            "User not found",
            extra={"code": "user_not_found"},
        )
    if not user_query.delete_user(user_id):
        raise InvalidRequestError(
            "User could not be deleted",
            extra={"code": "user_not_deleted"},
        )
    return AdminUserDeleteOut(user_id=user_id)


@router.get("/gmail-oauth/status", response_model=GmailOAuthStatusOut)
def gmail_oauth_status(admin_user=Depends(get_current_admin)) -> GmailOAuthStatusOut:
    """Report sender setup state without returning any credential material."""
    settings = get_settings()
    return GmailOAuthStatusOut(
        client_configured=gmail_oauth.client_configured(),
        authorized=gmail_oauth.authorized(),
        delivery_configured=mailer.delivery_configured(),
        sender_email=settings.gmail_sender_email,
        redirect_uri=settings.gmail_oauth_redirect_uri,
    )


@router.post("/gmail-oauth/start", response_model=GmailOAuthStartOut)
def gmail_oauth_start(admin_user=Depends(get_current_admin)) -> GmailOAuthStartOut:
    """Create a short-lived Google consent URL for the admin sender mailbox."""
    try:
        url = gmail_oauth.start_authorization()
    except gmail_oauth.GmailOAuthError as exc:
        raise InvalidRequestError(
            str(exc), extra={"code": "gmail_oauth_not_configured"}
        ) from exc
    return GmailOAuthStartOut(authorization_url=url)


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
            "performers_count": draft.performers_count,
            "duration_minutes": draft.duration_minutes,
            "price_text": draft.price_text,
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
        performers_count=payload.get("performers_count"),
        duration_minutes=payload.get("duration_minutes"),
        price_text=payload.get("price_text", "") or "",
        context_names=payload.get("context_names", []),
        keyword_ids=final_kw_ids,
    )
    result = ingestion.ingest_new_item(item_create, admin_user=admin_user)
    _invalidate_catalog_cache()
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
        db_id = int(item.id)
        session.execute(delete(ItemKeyword).where(ItemKeyword.item_id == db_id))
        for kid in body.keyword_ids:
            session.add(
                ItemKeyword(
                    item_id=db_id,
                    keyword_id=int(kid),
                    source="human",
                )
            )
        session.flush()
        # Refresh the loader's view of this item's keyword names.
        loader = get_singleton()
        kw_rows = session.execute(
            select(ItemKeyword.keyword_id).where(ItemKeyword.item_id == db_id)
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

        item_out = _item_out_from_session(session, item)
        _invalidate_catalog_cache()
        return ItemReassignOut(item=item_out, warnings=[])


@router.put("/items/{item_id}", response_model=ItemReassignOut)
def update_item(
    item_id: int,
    body: ItemUpdate,
    admin_user=Depends(get_current_admin),
) -> ItemReassignOut:
    """Edit an existing catalog row without touching PostgreSQL manually."""
    from sqlalchemy import delete, func, select

    from ..db import session_scope
    from ..models_db import Context, Item, ItemContext, ItemKeyword, Keyword

    warnings: List[str] = []
    with session_scope() as session:
        item = session.execute(
            select(Item).where(Item.artifact_item_id == int(item_id))
        ).scalar_one_or_none()
        if item is None:
            raise ItemNotFoundError(f"Item not found: {item_id}")

        db_id = int(item.id)
        if body.name is not None:
            item.name = body.name.strip()
        if body.description is not None:
            item.description = body.description.strip()
        if body.category_group is not None:
            item.category_group = body.category_group.strip()
        if body.performance_type is not None:
            item.performance_type = body.performance_type.strip()
        if body.performers_count is not None:
            item.performers_count = int(body.performers_count)
        if body.duration_minutes is not None:
            item.duration_minutes = int(body.duration_minutes)
        if body.price_text is not None:
            item.price_text = body.price_text.strip()
        if body.image_url is not None:
            item.image_url = body.image_url.strip()
        if body.video_url is not None:
            item.video_url = body.video_url.strip()
        if body.is_active is not None:
            item.is_active = bool(body.is_active)

        context_names: List[str] | None = None
        if body.context_names is not None:
            context_names = []
            context_ids: List[int] = []
            for raw in body.context_names:
                if not isinstance(raw, str):
                    continue
                name = raw.strip()
                if not name:
                    continue
                row = session.execute(select(Context).where(Context.name == name)).scalar_one_or_none()
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

        keyword_names: List[str] | None = None
        if body.keyword_ids is not None or body.new_keyword_names is not None:
            if body.keyword_ids is None:
                current_keyword_ids = session.execute(
                    select(ItemKeyword.keyword_id).where(ItemKeyword.item_id == db_id)
                ).scalars().all()
                requested_kw_ids = _unique_ints(list(current_keyword_ids))
            else:
                requested_kw_ids = _unique_ints(body.keyword_ids)

            keyword_rows = session.execute(
                select(Keyword).where(Keyword.id.in_(requested_kw_ids))
            ).scalars().all() if requested_kw_ids else []
            keywords_by_id = {int(row.id): row for row in keyword_rows}
            kw_ids = [keyword_id for keyword_id in requested_kw_ids if keyword_id in keywords_by_id]
            missing_ids = [keyword_id for keyword_id in requested_kw_ids if keyword_id not in keywords_by_id]
            if missing_ids:
                warnings.append(f"Ignored unknown keyword ids: {missing_ids}")

            seen_names = {str(row.name).strip().casefold() for row in keyword_rows}
            for raw_name in body.new_keyword_names or []:
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
            keyword_names = [str(keywords_by_id[keyword_id].name) for keyword_id in kw_ids]

        session.flush()
        loader_values = {
            "name": item.name,
            "description": item.description or "",
            "category_group": item.category_group or "",
            "performance_type": item.performance_type or "",
            "performers_count": item.performers_count,
            "duration_minutes": item.duration_minutes,
            "price_text": item.price_text or "",
            "is_active": bool(item.is_active),
        }
        item_out = _item_out_from_session(session, item)

    _update_loader_row(
        int(item_id),
        loader_values,
        context_names=context_names,
        keyword_names=keyword_names,
    )
    _invalidate_catalog_cache()
    return ItemReassignOut(item=item_out, warnings=warnings)


@router.get("/items/facets", response_model=ItemFacetsOut)
def item_facets(
    admin_user=Depends(get_current_admin),
) -> ItemFacetsOut:
    """Distinct ``category_group`` + ``performance_type`` values for dropdowns.

    Pulls live values from Postgres when available (catches admin edits
    made via /admin/items/{id} that haven't been baked into the artifact
    yet), otherwise falls back to the in-memory loader. Also returns a
    ``category_groups_by_performance_type`` map so the form can cascade
    ``หมวดหมู่`` from the selected ``ประเภทการแสดง``.
    """
    from ..services import catalogue

    return catalogue.get_item_facets()


@router.post(
    "/items/{artifact_id}/image",
    response_model=ItemImageUploadOut,
    summary="Upload a cover image for an item",
    description=(
        "Accepts a single multipart ``file`` field (image/jpeg, image/png, "
        "or image/webp — validated by magic-byte sniffing, not the "
        "client's Content-Type). Persists the file under "
        "``data/uploads/items/`` and updates ``items.image_url`` so the "
        "catalog detail page can render it immediately. Also pushes the "
        "new URL into the in-memory ``ArtifactLoader`` (the legacy edit "
        "endpoint silently dropped this)."
    ),
)
def upload_item_image(
    artifact_id: int,
    file: UploadFile = File(..., description="JPEG/PNG/WebP, max 5 MB."),
    admin_user=Depends(get_current_admin),
) -> ItemImageUploadOut:
    """Save the cover image, persist ``image_url``, and clean up the old file."""
    from sqlalchemy import select

    from ..db import session_scope
    from ..models_db import Item

    settings = get_settings()
    items_dir = settings.upload_dir / "items"

    with session_scope() as session:
        if session is None:
            raise InvalidRequestError(
                "DB layer disabled",
                extra={"code": "db_disabled"},
            )
        item = session.execute(
            select(Item).where(Item.artifact_item_id == int(artifact_id))
        ).scalar_one_or_none()
        if item is None:
            raise InvalidRequestError(
                f"Item not found: {artifact_id}",
                extra={"code": "item_not_found"},
            )
        old_url = str(item.image_url or "")
        # Persist BEFORE writing to disk so the DB record is always in sync
        # with what we return. If the file write fails the transaction
        # rolls back and the old image_url stays intact.
        _filename, public_url, size_bytes, mime = storage.save_upload(
            file,
            items_dir,
            prefix=str(artifact_id),
            max_bytes=settings.max_upload_bytes,
            allowed_mime=settings.allowed_upload_mime,
        )
        item.image_url = public_url
        db_id = int(item.id)
        session.flush()

    _update_loader_row(int(artifact_id), {"image_url": public_url})
    _invalidate_catalog_cache()

    # Best-effort cleanup of the previous cover. We do this after the DB
    # write so a failed delete doesn't leave the DB pointing at a missing
    # file.
    storage.delete_upload(old_url, settings.upload_dir)

    return ItemImageUploadOut(
        url=public_url,
        size_bytes=int(size_bytes),
        mime=mime,
        item_id=int(artifact_id),
    )


@router.post(
    "/items/{artifact_id}/video",
    response_model=ItemVideoUploadOut,
    summary="Upload a video for an item",
    description=(
        "Accepts one MP4, WebM, or MOV file, validates its magic bytes, "
        "stores it under data/uploads/items/, and updates items.video_url."
    ),
)
def upload_item_video(
    artifact_id: int,
    file: UploadFile = File(..., description="MP4/WebM/MOV, max 100 MB."),
    admin_user=Depends(get_current_admin),
) -> ItemVideoUploadOut:
    """Save an item video, persist ``video_url``, and clean up the old upload."""
    from sqlalchemy import select

    from ..db import session_scope
    from ..models_db import Item

    settings = get_settings()
    items_dir = settings.upload_dir / "items"

    with session_scope() as session:
        if session is None:
            raise InvalidRequestError("DB layer disabled", extra={"code": "db_disabled"})
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

    _update_loader_row(int(artifact_id), {"video_url": public_url})
    _invalidate_catalog_cache()
    storage.delete_upload(old_url, settings.upload_dir)

    return ItemVideoUploadOut(
        url=public_url,
        size_bytes=int(size_bytes),
        mime=mime,
        item_id=int(artifact_id),
    )


@router.delete("/items/{item_id}", response_model=ItemDeleteOut)
def delete_item(
    item_id: int,
    admin_user=Depends(get_current_admin),
) -> ItemDeleteOut:
    """Delete a catalog row and hide it from the in-memory recommender."""
    from sqlalchemy import delete, select, update

    from ..db import session_scope
    from ..models_db import (
        InteractionLog,
        Item,
        ItemContext,
        ItemKeyword,
        LegacyInteraction,
        Like,
        Rating,
        SavedItem,
    )

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
        session.execute(delete(LegacyInteraction).where(LegacyInteraction.item_id == db_id))
        session.execute(
            update(InteractionLog)
            .where(InteractionLog.item_id == db_id)
            .values(item_id=None)
        )
        session.delete(item)
        session.flush()

    _update_loader_row(int(item_id), {"is_active": False})
    _invalidate_catalog_cache()
    return ItemDeleteOut(item_id=int(item_id), deleted=True, warnings=[])


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


def _unique_ints(values: List[int]) -> List[int]:
    out: List[int] = []
    seen: set[int] = set()
    for raw in values or []:
        value = int(raw)
        if value in seen:
            continue
        seen.add(value)
        out.append(value)
    return out


def _item_out_from_session(session, item) -> ItemOut:
    from sqlalchemy import func, select

    from ..models_db import Context, Item, ItemContext, ItemKeyword, Keyword
    from ..schemas.context import ContextOut
    from ..schemas.keyword import KeywordOut
    from ..services.suitability import catalog_match_percent, suitability_label

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
    # Coerce numeric fields to plain ``int | None`` — SQLAlchemy can hand
    # us numpy scalars (e.g. ``numpy.int64``) on SQLite, which Pydantic v2.12
    # rejects under strict ``finite_number`` validation.
    def _coerce_int(value):
        if value is None:
            return None
        try:
            n = int(value)
        except (TypeError, ValueError):
            return None
        if n != n:  # NaN guard
            return None
        return n

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


def _update_loader_row(
    artifact_id: int,
    values: Dict[str, Any],
    *,
    context_names: List[str] | None = None,
    keyword_names: List[str] | None = None,
) -> None:
    loader = get_singleton()
    idx = loader.id_to_row.get(int(artifact_id))
    if idx is None or getattr(loader, "_items", None) is None:
        return

    from ..model_loader import get_lock

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


def _invalidate_catalog_cache() -> None:
    from .catalog import invalidate_db_item_rows_cache

    invalidate_db_item_rows_cache()
