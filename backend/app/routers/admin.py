"""
routers/admin.py — HTTP authorization and validation dispatcher for /admin/* endpoints.

Delegates core domain operations to:
* ``services.ingestion``: Item drafting, committing, keyword reassignment, editing, deleting, and media attachments.
* ``services.user_query``: Admin user CRUD management.
* ``services.catalogue``: Item facets aggregation.
* ``services.gmail_oauth``: Admin Gmail OAuth flow.
"""
from __future__ import annotations

import logging
from typing import List

from fastapi import APIRouter, Depends, File, UploadFile

from ..core.config import get_settings
from ..core.exceptions import InvalidRequestError
from ..schemas.admin import (
    ItemCommit,
    ItemCommitOut,
    ItemDeleteOut,
    ItemDraft,
    ItemDraftOut,
    ItemFacetsOut,
    ItemImageUploadOut,
    ItemKeywordReassign,
    ItemReassignOut,
    ItemUpdate,
    ItemVideoUploadOut,
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
from ..services import catalogue, gmail_oauth, identity, ingestion, mailer, user_query
from ..services.identity import get_current_admin, hash_password, user_to_out


logger = logging.getLogger("recsys.admin")
router = APIRouter(prefix="/admin", tags=["admin"])


# --- Backward compatibility aliases -----------------------------------------
_drafts = ingestion._drafts
_drafts_lock = ingestion._drafts_lock
_save_draft = ingestion._save_draft
_consume_draft = ingestion._consume_draft
_unique_ints = ingestion._unique_ints
_update_loader_row = ingestion.update_loader_row
_invalidate_catalog_cache = ingestion.invalidate_catalog_cache
_item_out_from_session = ingestion._item_out_from_session
_names_for_keyword_ids = ingestion._names_for_keyword_ids
_admin_user_out = user_to_out


# --- User Management --------------------------------------------------------


@router.get("/users", response_model=AdminUserListOut)
def list_admin_users(admin_user=Depends(get_current_admin)) -> AdminUserListOut:
    rows = identity.list_users(limit=500)
    return AdminUserListOut(
        users=[user_to_out(row) for row in rows],
        total=len(rows),
    )


@router.post("/users", response_model=UserOut)
def create_admin_user(
    payload: AdminUserCreate,
    admin_user=Depends(get_current_admin),
) -> UserOut:
    user = identity.create_admin_user(
        username=payload.username,
        password=payload.password,
        email=payload.email or "",
        display_name=payload.display_name or "",
        is_admin=payload.is_admin,
    )
    return user_to_out(user)


@router.put("/users/{user_id}", response_model=UserOut)
def update_admin_user(
    user_id: int,
    payload: AdminUserUpdate,
    admin_user=Depends(get_current_admin),
) -> UserOut:
    updated = identity.update_user_by_admin(
        user_id,
        current_admin_id=admin_user.id,
        username=payload.username,
        email=payload.email,
        display_name=payload.display_name,
        password=payload.password,
        is_admin=payload.is_admin,
    )
    return user_to_out(updated)


@router.delete("/users/{user_id}", response_model=AdminUserDeleteOut)
def delete_admin_user(
    user_id: int,
    admin_user=Depends(get_current_admin),
) -> AdminUserDeleteOut:
    identity.delete_user_by_admin(user_id, current_admin_id=admin_user.id)
    return AdminUserDeleteOut(user_id=user_id)


# --- Gmail OAuth ------------------------------------------------------------


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


# --- Item Ingestion Lifecycle Endpoints -------------------------------------


@router.post("/items/draft", response_model=ItemDraftOut)
def create_draft(
    draft: ItemDraft,
    admin_user=Depends(get_current_admin),
) -> ItemDraftOut:
    """Layer A + Layer B grounding. Returns a draft_id + proposals."""
    return ingestion.draft_item(draft)


@router.post("/items", response_model=ItemCommitOut)
def commit_item(
    commit: ItemCommit,
    admin_user=Depends(get_current_admin),
) -> ItemCommitOut:
    """Layer C commit: merge admin edits + commit to DB and loader."""
    return ingestion.commit_item(commit, admin_user=admin_user)


@router.post("/items/{item_id}/keywords", response_model=ItemReassignOut)
def reassign_keywords(
    item_id: int,
    body: ItemKeywordReassign,
    admin_user=Depends(get_current_admin),
) -> ItemReassignOut:
    """Layer C re-edit on an existing item: replace keyword links + sync loader."""
    return ingestion.reassign_item_keywords(item_id, body)


@router.put("/items/{item_id}", response_model=ItemReassignOut)
def update_item(
    item_id: int,
    body: ItemUpdate,
    admin_user=Depends(get_current_admin),
) -> ItemReassignOut:
    """Edit an existing catalog row without touching PostgreSQL manually."""
    return ingestion.update_item(item_id, body)


@router.delete("/items/{item_id}", response_model=ItemDeleteOut)
def delete_item(
    item_id: int,
    admin_user=Depends(get_current_admin),
) -> ItemDeleteOut:
    """Delete a catalog row and hide it from the in-memory recommender."""
    return ingestion.delete_item(item_id)


@router.get("/items/facets", response_model=ItemFacetsOut)
def item_facets(
    admin_user=Depends(get_current_admin),
) -> ItemFacetsOut:
    """Distinct ``category_group`` + ``performance_type`` values for dropdowns."""
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
        "new URL into the in-memory ``ArtifactLoader``."
    ),
)
def upload_item_image(
    artifact_id: int,
    file: UploadFile = File(..., description="JPEG/PNG/WebP, max 5 MB."),
    admin_user=Depends(get_current_admin),
) -> ItemImageUploadOut:
    """Save the cover image, persist ``image_url``, and clean up the old file."""
    return ingestion.attach_item_image(artifact_id, file)


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
    return ingestion.attach_item_video(artifact_id, file)
