"""
services/actions.py — Live user actions.

Mirrors ``recommender.actions.perform_item_action`` from the legacy Django
prototype (``../web_appRS/thai_arts_webapp/``; this project itself does not
use Django). Translates artifact id <-> DB id through
``items.artifact_item_id`` and writes both the action table
(``likes`` / ``saved_items`` / ``ratings``) and an ``interaction_logs`` row.

When ``RECSYS_DB_ENABLED=0`` every public function raises ``DbDisabledError``
(via ``core.exceptions``) — the actions endpoints are write-side and
require a real database.
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy.orm import Session

from ..core.exceptions import (
    DbDisabledError,
    InvalidActionError,
    ItemNotFoundError,
)
from ..db import is_db_enabled, session_scope
from ..models_db import (
    InteractionLog,
    Item,
    Like,
    Rating,
    RecommendationRequest,
    SavedItem,
)
from .db_query import artifact_id_to_db_id, live_user_state_for_items


# Names match the legacy VALID_ACTIONS set minus 'dismiss' / 'submit_feedback'
# (those are out of scope for this app's UI).
#
# ``item_view`` (ADR-002 §3.1) is deliberately different from the other five:
# it has no state table and no undo, writes only an ``interaction_logs`` row,
# and is deduped per ``VIEW_DEDUPE_MINUTES``. It is excluded from user history
# (see ``member_query.HISTORY_ACTIONS``) because a page open is not a
# history-worthy user action.
VALID_ACTIONS = {"like", "unlike", "save", "unsave", "rate", "item_view"}

# Actions that only append to interaction_logs (no state table to mutate).
LOG_ONLY_ACTIONS = {"item_view"}


def perform_item_action(
    *,
    user_key: str,
    item_id: int,
    action: str,
    rating: Optional[int] = None,
    request_id: Optional[str] = None,
    context_id: Optional[int] = None,
) -> dict:
    """Apply an action and return the resulting ``{action, metadata}`` payload.

    The router wraps this in an ``ItemActionOut`` and adds the full item
    with the resolved ``UserState`` so the frontend can update its UI
    in one round-trip.
    """
    if action not in VALID_ACTIONS:
        raise InvalidActionError(
            f"Unknown action '{action}'. Valid: {sorted(VALID_ACTIONS)}",
            extra={"action": action, "valid": sorted(VALID_ACTIONS)},
        )

    if not is_db_enabled():
        raise DbDisabledError(
            "Live user actions require a database. Set RECSYS_DB_ENABLED=1.",
        )

    artifact_id = int(item_id)
    db_id = artifact_id_to_db_id(artifact_id)
    if db_id is None:
        raise ItemNotFoundError(
            f"Item id {artifact_id} has no catalog row in Postgres.",
            extra={"item_id": artifact_id},
        )

    metadata: dict = {}
    with session_scope() as session:
        if session is None:
            # Should not happen because is_db_enabled() is true, but guard
            # so the type checker is happy.
            raise DbDisabledError("Database session unavailable.")

        if action == "like":
            _like(session, user_key, db_id)
            metadata["liked"] = True
        elif action == "unlike":
            _unlike(session, user_key, db_id)
            metadata["liked"] = False
        elif action == "save":
            _save(session, user_key, db_id)
            metadata["saved"] = True
        elif action == "unsave":
            _unsave(session, user_key, db_id)
            metadata["saved"] = False
        elif action == "rate":
            if rating is None:
                raise InvalidActionError(
                    "rating is required for action='rate'.",
                    extra={"action": action},
                )
            _rate(session, user_key, db_id, int(rating))
            metadata["rating"] = int(rating)
        elif action == "item_view":
            # Log-only (ADR-002 §3.1). Suppress repeats inside the dedupe
            # window so refreshing a detail page doesn't inflate the count.
            if _view_is_duplicate(session, user_key, db_id):
                return {"action": "viewed", "metadata": {"deduped": True}}
            metadata["deduped"] = False

        # Always log the action.
        _log_action(
            session,
            user_key=user_key,
            db_id=db_id,
            action=action,
            metadata=metadata,
            request_id=request_id,
            context_id=context_id,
        )

    return {"action": _past_tense(action), "metadata": metadata}


def fetch_user_state(user_key: str, item_id: int) -> dict:
    """Look up the per-item user state for a single item, in artifact-id space."""
    if not is_db_enabled() or not user_key:
        return {"liked": False, "saved": False, "rating": 0}
    state_map = live_user_state_for_items(user_key, [int(item_id)])
    state = state_map.get(int(item_id))
    if state is None:
        return {"liked": False, "saved": False, "rating": 0}
    return {"liked": state.liked, "saved": state.saved, "rating": state.rating}


# --- Internal helpers -------------------------------------------------------

def _like(session: Session, user_key: str, db_id: int) -> None:
    existing = session.query(Like).filter_by(user_key=user_key, item_id=db_id).first()
    if existing is None:
        session.add(Like(user_key=user_key, item_id=db_id))


def _unlike(session: Session, user_key: str, db_id: int) -> None:
    session.query(Like).filter_by(user_key=user_key, item_id=db_id).delete()


def _save(session: Session, user_key: str, db_id: int) -> None:
    existing = session.query(SavedItem).filter_by(user_key=user_key, item_id=db_id).first()
    if existing is None:
        session.add(SavedItem(user_key=user_key, item_id=db_id))


def _unsave(session: Session, user_key: str, db_id: int) -> None:
    session.query(SavedItem).filter_by(user_key=user_key, item_id=db_id).delete()


def _rate(session: Session, user_key: str, db_id: int, rating: int) -> None:
    if not 1 <= int(rating) <= 5:
        raise InvalidActionError(
            f"rating must be 1..5, got {rating}.",
            extra={"rating": int(rating)},
        )
    # update_or_create
    existing = session.query(Rating).filter_by(user_key=user_key, item_id=db_id).first()
    if existing is None:
        session.add(Rating(user_key=user_key, item_id=db_id, rating=int(rating)))
    else:
        existing.rating = int(rating)
        existing.updated_at = datetime.now(timezone.utc)


def _resolve_request_fk(session: Session, request_id: Optional[str]) -> Optional[int]:
    """Translate the client's ``request_id`` into a ``recommendation_requests`` FK.

    ``RecommendationResponseOut.request_id`` is a *string* that is either the
    stringified DB primary key (when the persist succeeded) or a uuid4
    fallback (when the DB was unreachable) — see
    ``recommendation_service.py:391``. Only the former is a usable foreign
    key, so we parse it and confirm the row exists; anything else returns
    ``None`` and the log row simply carries no attribution rather than
    raising an integrity error.
    """
    if not request_id:
        return None
    try:
        candidate = int(str(request_id))
    except (TypeError, ValueError):
        return None  # uuid fallback — not a FK.
    if candidate <= 0:
        return None
    exists = (
        session.query(RecommendationRequest.id)
        .filter(RecommendationRequest.id == candidate)
        .first()
    )
    return candidate if exists else None


def _log_action(
    session: Session,
    *,
    user_key: str,
    db_id: int,
    action: str,
    metadata: dict,
    request_id: Optional[str],
    context_id: Optional[int],
) -> None:
    log = InteractionLog(
        user_key=user_key,
        item_id=db_id,
        action_type=action,
        metadata_json=json.dumps(metadata or {}, ensure_ascii=False),
        recommendation_request_id=_resolve_request_fk(session, request_id),
    )
    session.add(log)


def _view_is_duplicate(session: Session, user_key: str, db_id: int) -> bool:
    """True when this user already viewed this item inside the dedupe window.

    The window is a *policy* (configurable via ``RECSYS_VIEW_DEDUPE_MINUTES``),
    not an invariant, so it is enforced here rather than by a DB constraint —
    a unique index would also wrongly reject a genuine repeat view a week
    later.
    """
    from ..core.config import get_settings

    minutes = max(0, int(get_settings().view_dedupe_minutes))
    if minutes == 0:
        return False
    since = datetime.now(timezone.utc) - timedelta(minutes=minutes)
    existing = (
        session.query(InteractionLog.id)
        .filter(
            InteractionLog.user_key == user_key,
            InteractionLog.item_id == db_id,
            InteractionLog.action_type == "item_view",
            InteractionLog.created_at >= since,
        )
        .first()
    )
    return existing is not None


def _past_tense(action: str) -> str:
    return {
        "like": "liked",
        "unlike": "unliked",
        "save": "saved",
        "unsave": "unsaved",
        "rate": "rated",
        "item_view": "viewed",
    }.get(action, action)
