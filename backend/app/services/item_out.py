"""
item_out.py — Single source of truth for assembling ``ItemOut`` responses.

Every endpoint that returns a catalog item (browse, detail, like/save/rate,
recommendations, admin edits) builds its ``ItemOut`` through this mapper.
The surrounding data-access differs per module — a live DB row, an in-memory
artifact row, or a freshly-inserted ORM object — so each caller keeps its own
fetching, ``KeywordOut`` / ``ContextOut`` construction, and suitability
computation, then hands the resolved fields here.

The item is keyed by its **Artifact Item Identifier** (the immutable
``items.artifact_item_id`` / pipeline ``stable_id("item", name)``), never by a
PostgreSQL primary key.

Two invariants the callers rely on, so the signature is deliberately
permissive:

* ``performers_count`` / ``duration_minutes`` are passed through **as-is**.
  Callers that need NaN/NA-safe ints coerce them before calling (see
  ``catalogue._clean_int`` / ``ingestion._coerce_int``); callers that pass raw
  artifact values (recommendations, actions) let Pydantic do the final check.
* ``match_percent`` / ``suitability_label`` are the display-only suitability
  hint (see ``ItemOut``). They are only set on the item where the original
  code set them; otherwise they stay ``None`` — the recommendation/action
  endpoints carry the hint on their own result object instead.
"""
from __future__ import annotations

from typing import Any, List, Optional

from ..schemas.context import ContextOut
from ..schemas.item import ItemOut, UserState
from ..schemas.keyword import KeywordOut


def build_item_out(
    *,
    artifact_item_id: int,
    name: Any = "",
    description: Any = "",
    category_group: Any = "",
    performance_type: Any = "",
    performers_count: Any = None,
    duration_minutes: Any = None,
    price_text: Any = "",
    image_url: Any = "",
    video_url: Any = "",
    keywords: List[Any],
    contexts: List[Any],
    user_state: Optional[UserState] = None,
    match_percent: Optional[int] = None,
    suitability_label: Optional[str] = None,
) -> ItemOut:
    """Assemble an :class:`ItemOut` from resolved scalar fields.

    Scalar fields are normalised with the same ``str(x or "")`` idiom the
    per-module mappers used, so ``None`` / falsy values still yield empty
    strings (matching prior output exactly). ``performers_count`` and
    ``duration_minutes`` are intentionally passed through untouched, and
    ``keywords`` / ``contexts`` are forwarded verbatim to :class:`ItemOut`
    (which accepts either already-built schema objects or plain dicts).
    """
    return ItemOut(
        id=int(artifact_item_id),
        name=str(name or ""),
        description=str(description or ""),
        category_group=str(category_group or ""),
        performance_type=str(performance_type or ""),
        performers_count=performers_count,
        duration_minutes=duration_minutes,
        price_text=str(price_text or ""),
        image_url=str(image_url or ""),
        video_url=str(video_url or ""),
        keywords=keywords,
        contexts=contexts,
        user_state=user_state or UserState(),
        match_percent=match_percent,
        suitability_label=suitability_label,
    )
