"""
services/actions.py — Live user actions.

Mirrors ``recommender.actions.perform_item_action`` from the legacy Django
project. Translates artifact id <-> Django id through ``items.artifact_item_id``
and writes both the action table (``likes`` / ``saved_items`` / ``ratings``)
and an ``interaction_logs`` row.

When ``RECSYS_DB_ENABLED=0`` every public function raises ``DbDisabledError``
(via ``core.exceptions``) — the actions endpoints are write-side and
require a real database.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy.orm import Session

from ..core.exceptions import (
    DbDisabledError,
    InvalidActionError,
    ItemNotFoundError,
)
from ..db import is_db_enabled, session_scope
from ..models_db import InteractionLog, Item, Like, Rating, SavedItem
from .db_query import artifact_id_to_django_id, live_user_state_for_items


# Names match the legacy VALID_ACTIONS set minus 'dismiss' / 'submit_feedback'
# (those are out of scope for this app's UI).
VALID_ACTIONS = {"like", "unlike", "save", "unsave", "rate"}


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
    django_id = artifact_id_to_django_id(artifact_id)
    if django_id is None:
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
            _like(session, user_key, django_id)
            metadata["liked"] = True
        elif action == "unlike":
            _unlike(session, user_key, django_id)
            metadata["liked"] = False
        elif action == "save":
            _save(session, user_key, django_id)
            metadata["saved"] = True
        elif action == "unsave":
            _unsave(session, user_key, django_id)
            metadata["saved"] = False
        elif action == "rate":
            if rating is None:
                raise InvalidActionError(
                    "rating is required for action='rate'.",
                    extra={"action": action},
                )
            _rate(session, user_key, django_id, int(rating))
            metadata["rating"] = int(rating)

        # Always log the action.
        _log_action(
            session,
            user_key=user_key,
            django_id=django_id,
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

def _like(session: Session, user_key: str, django_id: int) -> None:
    existing = session.query(Like).filter_by(user_key=user_key, item_id=django_id).first()
    if existing is None:
        session.add(Like(user_key=user_key, item_id=django_id))


def _unlike(session: Session, user_key: str, django_id: int) -> None:
    session.query(Like).filter_by(user_key=user_key, item_id=django_id).delete()


def _save(session: Session, user_key: str, django_id: int) -> None:
    existing = session.query(SavedItem).filter_by(user_key=user_key, item_id=django_id).first()
    if existing is None:
        session.add(SavedItem(user_key=user_key, item_id=django_id))


def _unsave(session: Session, user_key: str, django_id: int) -> None:
    session.query(SavedItem).filter_by(user_key=user_key, item_id=django_id).delete()


def _rate(session: Session, user_key: str, django_id: int, rating: int) -> None:
    if not 1 <= int(rating) <= 5:
        raise InvalidActionError(
            f"rating must be 1..5, got {rating}.",
            extra={"rating": int(rating)},
        )
    # update_or_create
    existing = session.query(Rating).filter_by(user_key=user_key, item_id=django_id).first()
    if existing is None:
        session.add(Rating(user_key=user_key, item_id=django_id, rating=int(rating)))
    else:
        existing.rating = int(rating)
        existing.updated_at = datetime.now(timezone.utc)


def _log_action(
    session: Session,
    *,
    user_key: str,
    django_id: int,
    action: str,
    metadata: dict,
    request_id: Optional[str],
    context_id: Optional[int],
) -> None:
    log = InteractionLog(
        user_key=user_key,
        item_id=django_id,
        action_type=action,
        metadata_json=json.dumps(metadata or {}, ensure_ascii=False),
    )
    session.add(log)


def _past_tense(action: str) -> str:
    return {
        "like": "liked",
        "unlike": "unliked",
        "save": "saved",
        "unsave": "unsaved",
        "rate": "rated",
    }.get(action, action)
