"""
routers/admin.py — HTTP authorization and validation dispatcher for /admin/* endpoints.

Delegates core domain operations to:
* ``services.ingestion``: Item drafting, committing, keyword reassignment, editing, deleting, and media attachments.
* ``services.identity``: Admin user CRUD management.
* ``services.catalogue``: Item facets aggregation.
* ``services.gmail_oauth``: Admin Gmail OAuth flow.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import List

from fastapi import APIRouter, Depends, File, UploadFile

from ..core.config import get_settings
from ..core.exceptions import InvalidRequestError
from ..db import session_scope
from ..models_db import User
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
from ..schemas.popularity import PopularityWeightsOut, PopularityWeightsUpdateIn
from ..schemas.user import (
    AdminUserCreate,
    AdminUserDeleteOut,
    AdminUserListOut,
    AdminUserUpdate,
    GmailOAuthStartOut,
    GmailOAuthStatusOut,
    UserOut,
    user_to_out,
)
from ..services import catalogue, gmail_oauth, identity, ingestion, mailer
from ..services.auth import get_current_admin
from ..services.identity import hash_password
from ..services.popularity import WeightsValidationError, set_weights


logger = logging.getLogger("recsys.admin")
router = APIRouter(prefix="/admin", tags=["admin"])

# --- Popularity weights write endpoint --------------------------------------
#
# ``PUT /metrics/popularity/weights`` is the *only* write endpoint among the
# read-only ``/metrics`` routes. It is served from the admin router because
# admin endpoints live here, but its external path must stay exactly
# ``/metrics/popularity/weights`` (the client and existing tests call that
# path). The main ``router`` above is prefixed ``/admin``, so this route is
# declared on a separate un-prefixed sub-router that ``main`` includes
# alongside ``router`` — keeping the mounted path byte-identical.


metrics_router = APIRouter(tags=["metrics"])


@metrics_router.put(
    "/metrics/popularity/weights",
    response_model=PopularityWeightsOut,
    summary="Replace the active popularity weights",
    description=(
        "Validates the body (weights in [0, 1], sum 1.0 ± 1e-3, every "
        "factor in the known set; half_life_days and bayes_m ≥ 0), "
        "deactivates the previous active row in the same transaction, "
        "and inserts the new one. Admin-only. ``updated_by`` is "
        "populated by the operator for audit."
    ),
)
def popularity_weights_update(
    payload: PopularityWeightsUpdateIn,
    admin: User = Depends(get_current_admin),
) -> PopularityWeightsOut:
    try:
        with session_scope() as session:
            if session is None:
                from fastapi import HTTPException, status

                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail="Database is not enabled.",
                )
            w = set_weights(
                session,
                weights_dict={k: float(v) for k, v in payload.weights.items()},
                half_life_days=int(payload.half_life_days),
                bayes_m=int(payload.bayes_m),
                updated_by=str(payload.updated_by or admin.username or "admin"),
            )
            session.commit()
            return PopularityWeightsOut(
                id=int(w.id),
                weights=w.weights(),
                half_life_days=int(w.half_life_days),
                bayes_m=int(w.bayes_m),
                updated_at=(w.updated_at or datetime.now(timezone.utc)).isoformat(),
                updated_by=str(w.updated_by or ""),
            )
    except WeightsValidationError as e:
        from fastapi import HTTPException, status

        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "invalid_weights", "message": str(e)},
        )


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
