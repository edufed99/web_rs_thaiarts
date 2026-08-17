"""
routers/actions.py — Live user actions (Like / Save / Rate / View).

RESTful resource-style endpoints: each action is its own route so Swagger
shows a clean shape and the frontend can use semantically meaningful verbs.
The five state-changing endpoints return an ``ItemActionOut`` containing the
full item (with ``UserState`` resolved) plus the action name.

``POST /actions/view`` (ADR-002 §3.1) is the exception: it only appends to
``interaction_logs``, is deduped per time window, and returns a lightweight
``ItemViewOut`` rather than the full item — it fires on every detail-page
open, so it stays cheap.

Auth (Phase G): if a JWT is present (``Authorization: Bearer <jwt>``),
the ``User`` is resolved and the action is logged against
``"user:<id>"``. If no JWT is present, the request must carry an
``anon:<uuid>`` ``user_key`` in the body (catalog-browse parity).
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends

from ..core.config import get_settings
from ..core.exceptions import InvalidRequestError, ItemNotFoundError
from ..model_loader import ArtifactLoader, get_singleton
from ..models_db import User
from ..schemas.action import ActionRequestIn, ItemActionOut, ItemViewOut, ViewRequestIn
from ..schemas.item import ItemOut, UserState
from ..services._ids import stable_id
from ..services.actions import fetch_user_state, perform_item_action
from ..services.item_out import build_item_out
from ._user_key import get_current_user_dep, resolve_user_key


router = APIRouter(tags=["actions"])


def _row_to_item_out(loader: ArtifactLoader, artifact_id: int, user_state: UserState) -> ItemOut:
    row = loader.item_row(int(artifact_id))
    if row is None:
        raise ItemNotFoundError(
            f"Item id {artifact_id} not found in artifacts.",
            extra={"item_id": int(artifact_id)},
        )
    kw_names = list(row.get("keyword_names") or [])
    kw_paths = list(row.get("taxonomy_paths") or [])
    keyword_objs = [
        {
            "id": stable_id("keyword", str(n)),
            "name": str(n),
            "taxonomy_path": str(kw_paths[idx]) if idx < len(kw_paths) else "",
        }
        for idx, n in enumerate(kw_names)
        if n
    ]
    ctx_names = list(row.get("context_names") or [])
    context_objs = [
        {
            "id": stable_id("context", str(c)),
            "name": str(c),
            "group": "",
            "description": "",
            "active_item_count": 0,
        }
        for c in ctx_names
        if c
    ]
    return build_item_out(
        artifact_item_id=int(artifact_id),
        name=row.get("name"),
        description=row.get("description"),
        category_group=row.get("category_group"),
        performance_type=row.get("performance_type"),
        performers_count=row.get("performers_count"),
        duration_minutes=row.get("duration_minutes"),
        price_text=row.get("price_text"),
        image_url="",
        video_url="",
        keywords=keyword_objs,
        contexts=context_objs,
        user_state=user_state,
    )


def _build_response(
    loader: ArtifactLoader,
    *,
    user_key: str,
    item_id: int,
    action: str,
    metadata: dict,
) -> ItemActionOut:
    state_dict = fetch_user_state(user_key, int(item_id))
    user_state = UserState(
        liked=bool(state_dict["liked"]),
        saved=bool(state_dict["saved"]),
        rating=int(state_dict["rating"]),
    )
    return ItemActionOut(
        item=_row_to_item_out(loader, int(item_id), user_state),
        action=action,
        rating=user_state.rating or None,
        metadata=metadata or {},
    )


# --- Like -------------------------------------------------------------------

@router.post(
    "/actions/like",
    response_model=ItemActionOut,
    status_code=200,
    summary="Like an item",
    description=(
        "Adds a row to the ``likes`` table for ``(user_key, item_id)``. "
        "Idempotent: liking an already-liked item is a no-op. "
        "Returns the item with its resolved ``user_state``."
    ),
)
def post_like(
    payload: ActionRequestIn,
    user: Optional[User] = Depends(get_current_user_dep),
    loader: ArtifactLoader = Depends(get_singleton),
) -> ItemActionOut:
    user_key = resolve_user_key(user=user, body_user_key=payload.user_key)
    result = perform_item_action(
        user_key=user_key,
        item_id=int(payload.item_id),
        action="like",
        request_id=payload.request_id,
        context_id=payload.context_id,
    )
    return _build_response(
        loader,
        user_key=user_key,
        item_id=int(payload.item_id),
        action=result["action"],
        metadata=result["metadata"],
    )


@router.delete(
    "/actions/like",
    response_model=ItemActionOut,
    summary="Remove a like",
    description=(
        "Deletes the ``likes`` row for ``(user_key, item_id)`` if present. "
        "Idempotent: unliking a not-liked item is a no-op."
    ),
)
def delete_like(
    payload: ActionRequestIn,
    user: Optional[User] = Depends(get_current_user_dep),
    loader: ArtifactLoader = Depends(get_singleton),
) -> ItemActionOut:
    user_key = resolve_user_key(user=user, body_user_key=payload.user_key)
    result = perform_item_action(
        user_key=user_key,
        item_id=int(payload.item_id),
        action="unlike",
        request_id=payload.request_id,
        context_id=payload.context_id,
    )
    return _build_response(
        loader,
        user_key=user_key,
        item_id=int(payload.item_id),
        action=result["action"],
        metadata=result["metadata"],
    )


# --- Save -------------------------------------------------------------------

@router.post(
    "/actions/save",
    response_model=ItemActionOut,
    summary="Save an item",
    description=(
        "Adds a row to the ``saved_items`` table for ``(user_key, item_id)``. "
        "Idempotent."
    ),
)
def post_save(
    payload: ActionRequestIn,
    user: Optional[User] = Depends(get_current_user_dep),
    loader: ArtifactLoader = Depends(get_singleton),
) -> ItemActionOut:
    user_key = resolve_user_key(user=user, body_user_key=payload.user_key)
    result = perform_item_action(
        user_key=user_key,
        item_id=int(payload.item_id),
        action="save",
        request_id=payload.request_id,
        context_id=payload.context_id,
    )
    return _build_response(
        loader,
        user_key=user_key,
        item_id=int(payload.item_id),
        action=result["action"],
        metadata=result["metadata"],
    )


@router.delete(
    "/actions/save",
    response_model=ItemActionOut,
    summary="Remove a saved item",
    description=(
        "Deletes the ``saved_items`` row for ``(user_key, item_id)`` if present. "
        "Idempotent."
    ),
)
def delete_save(
    payload: ActionRequestIn,
    user: Optional[User] = Depends(get_current_user_dep),
    loader: ArtifactLoader = Depends(get_singleton),
) -> ItemActionOut:
    user_key = resolve_user_key(user=user, body_user_key=payload.user_key)
    result = perform_item_action(
        user_key=user_key,
        item_id=int(payload.item_id),
        action="unsave",
        request_id=payload.request_id,
        context_id=payload.context_id,
    )
    return _build_response(
        loader,
        user_key=user_key,
        item_id=int(payload.item_id),
        action=result["action"],
        metadata=result["metadata"],
    )


# --- View -------------------------------------------------------------------

@router.post(
    "/actions/view",
    response_model=ItemViewOut,
    status_code=200,
    summary="Log an item view",
    description=(
        "Appends an ``item_view`` row to ``interaction_logs``. Unlike the "
        "other actions this writes no state table — a view has no undo and "
        "no per-user current state.\n\n"
        "**Deduplicated:** a repeat view of the same item by the same user "
        "inside ``RECSYS_VIEW_DEDUPE_MINUTES`` (default 30) is a no-op and "
        "returns ``deduped: true``, so page refreshes don't inflate counts.\n\n"
        "**Attribution:** when ``request_id`` is a persisted recommendation "
        "id, the view is linked to it, which is what makes per-item "
        "click-through rate computable. A uuid fallback id is ignored.\n\n"
        "Views are excluded from user history and interest bars on purpose "
        "(ADR-002 §3.1)."
    ),
)
def post_view(
    payload: ViewRequestIn,
    user: Optional[User] = Depends(get_current_user_dep),
) -> ItemViewOut:
    user_key = resolve_user_key(user=user, body_user_key=payload.user_key)
    result = perform_item_action(
        user_key=user_key,
        item_id=int(payload.item_id),
        action="item_view",
        request_id=payload.request_id,
        context_id=payload.context_id,
    )
    return ItemViewOut(
        action=result["action"],
        item_id=int(payload.item_id),
        deduped=bool(result["metadata"].get("deduped", False)),
    )


# --- Rate -------------------------------------------------------------------

@router.put(
    "/actions/rating",
    response_model=ItemActionOut,
    summary="Set a 1..5 rating",
    description=(
        "Upserts the ``ratings`` row for ``(user_key, item_id)``. "
        "Validates ``rating`` is in 1..5. Returns 422 if the value is out of range. "
        "The user's existing rating (if any) is overwritten."
    ),
)
def put_rating(
    payload: ActionRequestIn,
    user: Optional[User] = Depends(get_current_user_dep),
    loader: ArtifactLoader = Depends(get_singleton),
) -> ItemActionOut:
    user_key = resolve_user_key(user=user, body_user_key=payload.user_key)
    if payload.rating is None:
        raise InvalidRequestError(
            "rating is required for PUT /actions/rating.",
            extra={"field": "rating"},
        )
    result = perform_item_action(
        user_key=user_key,
        item_id=int(payload.item_id),
        action="rate",
        rating=int(payload.rating),
        request_id=payload.request_id,
        context_id=payload.context_id,
    )
    return _build_response(
        loader,
        user_key=user_key,
        item_id=int(payload.item_id),
        action=result["action"],
        metadata=result["metadata"],
    )
