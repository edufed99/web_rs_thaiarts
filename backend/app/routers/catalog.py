"""
routers/catalog.py — GET /items, GET /items/{id}.

Read-only browse endpoints backed by the static catalog artifact.

Two list modes:

* **Browse mode** (default) — paginated search across item name first,
  then category group, then description. Returns up to ``limit`` items.
* **Ranked mode** (``?context=<id>``) — returns the top-10 items that
  pass the eligibility gate for the selected sub-context, sorted by
  ``match_percent`` descending (legacy ``item_list`` behaviour). Each
  item carries a populated ``match_percent`` and ``suitability_label``.
"""
from __future__ import annotations

import hashlib
import math
import threading
import time
from typing import Any, List, Optional

import pandas as pd
from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select

from ..core.exceptions import ContextNotFoundError, ItemNotFoundError
from ..db import session_scope
from ..model_loader import ArtifactLoader, get_singleton
from ..models_db import Context, Item, ItemContext, ItemKeyword, Keyword, TaxonomyNode, User
from ..schemas.context import ContextOut
from ..schemas.item import EngagementListOut, EngagementOut, ItemListOut, ItemOut, UserState
from ..schemas.keyword import KeywordOut
from ..services._ids import stable_id
from ..services.db_query import live_item_engagement, live_user_state_for_items
from ..services.eligibility import context_name_for_id
from ..services.suitability import catalog_match_percent, suitability_label
from ._user_key import get_current_user_dep, resolve_user_key


router = APIRouter(tags=["catalog"])

# Legacy top-10 cap used by ``item_list`` when a context is selected.
RANKED_MODE_LIMIT = 10

# Cache TTL for the joined ``items + contexts + keywords + taxonomy_paths``
# snapshot used by ``/items`` and ``/items/{id}``. The catalog corpus is
# admin-edited, not user-driven, so 60s is well below the "feels stale"
# threshold and absorbs the per-request join + recursive taxonomy walk
# that the public home → /items search flow was paying on every request.
_DB_ROWS_CACHE_TTL_SECONDS = 60.0
_db_rows_cache: dict[str, Any] = {"data": None, "expires_at": 0.0, "signature": None}
_db_rows_lock = threading.Lock()


@router.get(
    "/items",
    response_model=ItemListOut,
    summary="List active items",
    description=(
        "Returns a paginated list of active catalog items. Supports an "
        "optional `search` that matches item `name` first, then "
        "`category_group`, then `description`, an optional "
        "`context` for the legacy top-10 ranked mode, and an optional "
        "`user_key` to populate each item's `user_state`."
    ),
)
def list_items(
    search: Optional[str] = Query(
        None,
        description=(
            "Case-insensitive substring filter. Matches name first, falls "
            "back to category_group, then description. performance_type is not searched."
        ),
    ),
    limit: int = Query(20, ge=1, le=200, description="Max items to return (1-200). Ignored when `context` is set (top-10)."),
    offset: int = Query(0, ge=0, description="Number of items to skip for pagination. Ignored when `context` is set."),
    context: Optional[int] = Query(
        None,
        gt=0,
        description=(
            "Optional sub-context id. When provided, the response is the "
            "top-10 context-valid items sorted by match_percent desc, "
            "matching the legacy `catalog.views.item_list` ranked mode."
        ),
    ),
    user_key: Optional[str] = Query(
        None,
        max_length=150,
        description="Optional opaque user id — when provided, each item's user_state is populated from the live DB.",
    ),
    user: Optional[User] = Depends(get_current_user_dep),
    loader: ArtifactLoader = Depends(get_singleton),
) -> ItemListOut:
    # Anonymous callers (no JWT, no ``user_key`` query param) are a
    # first-class case for the public home → /items search flow — they
    # have no personalised likes / saves / ratings to surface, so we
    # skip the JWT/fallback auth dance and pass an empty ``user_key``
    # straight through. ``live_user_state_for_items`` already short-
    # circuits on falsy ``user_key`` so the per-row LIKE / saved /
    # rating SELECT is never issued for anonymous traffic.
    if user is None and not user_key:
        effective_user_key = ""
    else:
        effective_user_key = resolve_user_key(user=user, body_user_key=user_key)

    db_items = _db_item_rows()
    if db_items is not None:
        active_items = [row for row in db_items if row["is_active"]]
        if context is not None:
            return _ranked_by_context_db(active_items, context, effective_user_key, loader)
        terms = _search_terms(search)
        if terms:
            active_items = _filter_rows_by_search_priority(active_items, terms)
        total = len(active_items)
        page = active_items[offset : offset + limit]
        artifact_ids = [int(row["artifact_item_id"]) for row in page]
        state_map = live_user_state_for_items(effective_user_key, artifact_ids)
        return ItemListOut(
            items=[
                _db_row_to_item_out(row, user_state=state_map.get(int(row["artifact_item_id"])))
                for row in page
            ],
            total=total,
        )

    df = loader.items
    active = df[df["is_active"].astype(bool)]

    # Optional ranked-by-context mode (legacy top-10).
    if context is not None:
        return _ranked_by_context(active, context, effective_user_key, loader)

    # Browse mode: optional substring search + pagination.
    terms = _search_terms(search)
    if terms:
        active = _filter_dataframe_by_search_priority(active, terms)

    total = int(len(active))
    page = active.iloc[offset : offset + limit]
    artifact_ids = [int(r["item_id"]) for _, r in page.iterrows()]
    state_map = live_user_state_for_items(effective_user_key, artifact_ids)
    return ItemListOut(
        items=[
            _row_to_item_out(row, loader, user_state=state_map.get(int(row["item_id"])))
            for _, row in page.iterrows()
        ],
        total=total,
    )


@router.get(
    "/items/engagement",
    response_model=EngagementListOut,
    summary="Live engagement counters per item (public homepage ranking)",
    description=(
        "Returns ``{engagements, source}`` where ``engagements`` is a row "
        "per requested artifact item id, sorted by ``engagement_score`` "
        "desc. The score sums three live-action signals from the live "
        "``likes``, ``saved_items``, and ``ratings`` tables (only ratings "
        ">= ``positive_threshold`` count — low ratings reflect "
        "dissatisfaction and are intentionally excluded). Anonymous — the "
        "homepage uses this to rank the \"ชุดการแสดงยอดนิยม\" cards and to "
        "surface real like / save / rating counts. Returns ``source="
        "'disabled'`` and an empty list when the DB layer is off."
    ),
)
def items_engagement(
    ids: str = Query(
        ...,
        description=(
            "Comma-separated artifact item ids, max 200. Same id space as "
            "``ItemOut.id``. Mirrors the ``/legacy-stats`` batch route."
        ),
    ),
    range: str = Query(
        "all",
        description="Popularity window. Accepted: all, 7d, 30d, 90d, 365d.",
    ),
):
    raw = [chunk.strip() for chunk in ids.split(",")]
    parsed: List[int] = []
    for chunk in raw:
        if not chunk:
            continue
        try:
            parsed.append(int(chunk))
        except ValueError:
            continue
    seen = set()
    unique = [i for i in parsed if not (i in seen or seen.add(i))][:200]

    from ..db import is_db_enabled

    if not is_db_enabled() or not unique:
        return EngagementListOut(engagements=[], source="disabled")

    agg = live_item_engagement(item_ids=unique, window_days=_parse_engagement_range_days(range))
    rows: List[EngagementOut] = []
    for aid in unique:
        v = agg.get(int(aid))
        if v is None:
            # Items with no engagement at all — return a zero row so the
            # client always has a 1:1 mapping for the requested ids.
            rows.append(
                EngagementOut(
                    item_id=int(aid),
                    like_count=0,
                    save_count=0,
                    rating_count=0,
                    engagement_score=0,
                )
            )
        else:
            rows.append(
                EngagementOut(
                    item_id=int(aid),
                    like_count=int(v["like_count"]),
                    save_count=int(v["save_count"]),
                    rating_count=int(v["rating_count"]),
                    engagement_score=int(v["engagement_score"]),
                )
            )

    # Sort by engagement desc so callers can render the homepage top-N
    # directly off this response without re-sorting.
    rows.sort(key=lambda r: (-r.engagement_score, r.item_id))
    return EngagementListOut(engagements=rows, source="postgres")


@router.get(
    "/items/batch",
    response_model=ItemListOut,
    summary="Get multiple catalog items in one request",
)
def get_items_batch(
    ids: str = Query(..., description="Comma-separated artifact item ids, max 200."),
    user_key: Optional[str] = Query(default=None, max_length=150),
    user: Optional[User] = Depends(get_current_user_dep),
    loader: ArtifactLoader = Depends(get_singleton),
) -> ItemListOut:
    effective_user_key = _effective_user_key(user, user_key)
    requested = _parse_item_ids(ids)
    items = _item_outs_for_ids(requested, effective_user_key, loader)
    return ItemListOut(items=items, total=len(items))


@router.get(
    "/items/{item_id}/similar",
    response_model=ItemListOut,
    summary="Find genuinely similar catalog items",
)
def get_similar_items(
    item_id: int,
    limit: int = Query(default=4, ge=1, le=20),
    user_key: Optional[str] = Query(default=None, max_length=150),
    user: Optional[User] = Depends(get_current_user_dep),
    loader: ArtifactLoader = Depends(get_singleton),
) -> ItemListOut:
    effective_user_key = _effective_user_key(user, user_key)
    rows = _similarity_rows(loader)
    reference = next((row for row in rows if int(row["item_id"]) == int(item_id)), None)
    if reference is None:
        raise ItemNotFoundError(
            f"Item id {item_id} not found.",
            extra={"item_id": int(item_id)},
        )
    scored = [
        (_similarity_score(loader, reference, candidate), str(candidate.get("name") or ""), int(candidate["item_id"]))
        for candidate in rows
        if int(candidate["item_id"]) != int(item_id) and bool(candidate.get("is_active", True))
    ]
    scored.sort(key=lambda row: (-row[0], row[1], row[2]))
    selected_ids = [candidate_id for _score, _name, candidate_id in scored[:limit]]
    items = _item_outs_for_ids(selected_ids, effective_user_key, loader)
    return ItemListOut(items=items, total=len(items))


def _parse_engagement_range_days(raw: str) -> Optional[int]:
    text = (raw or "all").strip().lower()
    if text in {"", "all", "all-time", "alltime"}:
        return None
    accepted = {"7d": 7, "30d": 30, "90d": 90, "365d": 365}
    return accepted.get(text)


@router.get(
    "/items/{item_id}",
    response_model=ItemOut,
    summary="Get one item by id",
    description="Returns the item plus its attached keywords, contexts, and per-user state.",
    responses={404: {"description": "Item id not found."}},
)
def get_item(
    item_id: int,
    user_key: Optional[str] = Query(
        None,
        max_length=150,
        description="Optional opaque user id — when provided, the item's user_state is populated from the live DB.",
    ),
    user: Optional[User] = Depends(get_current_user_dep),
    loader: ArtifactLoader = Depends(get_singleton),
) -> ItemOut:
    # Same anonymous short-circuit as ``list_items`` — see the comment
    # there. Empty ``user_key`` is safe because ``live_user_state_for_items``
    # returns ``{}`` on falsy input.
    if user is None and not user_key:
        effective_user_key = ""
    else:
        effective_user_key = resolve_user_key(user=user, body_user_key=user_key)
    db_row = _db_item_row(int(item_id))
    if db_row is not None:
        state_map = live_user_state_for_items(effective_user_key, [int(item_id)])
        return _db_row_to_item_out(db_row, user_state=state_map.get(int(item_id)))

    row = loader.item_row(int(item_id))
    if row is None:
        raise ItemNotFoundError(
            f"Item id {item_id} not found.",
            extra={"item_id": int(item_id)},
        )
    state_map = live_user_state_for_items(effective_user_key, [int(item_id)])
    return _row_to_item_out(row, loader, user_state=state_map.get(int(item_id)))


def _effective_user_key(user: Optional[User], user_key: Optional[str]) -> str:
    if user is None and not user_key:
        return ""
    return resolve_user_key(user=user, body_user_key=user_key)


def _parse_item_ids(raw_ids: str) -> list[int]:
    parsed: list[int] = []
    seen: set[int] = set()
    for chunk in str(raw_ids or "").split(","):
        try:
            item_id = int(chunk.strip())
        except ValueError:
            continue
        if item_id > 0 and item_id not in seen:
            seen.add(item_id)
            parsed.append(item_id)
        if len(parsed) >= 200:
            break
    return parsed


def _item_outs_for_ids(
    requested_ids: list[int],
    effective_user_key: str,
    loader: ArtifactLoader,
) -> list[ItemOut]:
    if not requested_ids:
        return []
    state_map = live_user_state_for_items(effective_user_key, requested_ids)
    db_rows = _db_item_rows()
    if db_rows is not None:
        by_id = {
            int(row["artifact_item_id"]): row
            for row in db_rows
            if bool(row.get("is_active", True))
        }
        return [
            _db_row_to_item_out(by_id[item_id], user_state=state_map.get(item_id))
            for item_id in requested_ids
            if item_id in by_id
        ]
    output: list[ItemOut] = []
    for item_id in requested_ids:
        row = loader.item_row(item_id)
        if row is not None and bool(row.get("is_active", True)):
            output.append(_row_to_item_out(row, loader, user_state=state_map.get(item_id)))
    return output


def _similarity_rows(loader: ArtifactLoader) -> list[dict[str, Any]]:
    db_rows = _db_item_rows()
    if db_rows is not None:
        return [
            {
                "item_id": int(row["artifact_item_id"]),
                "name": row.get("name", ""),
                "category_group": row.get("category_group", ""),
                "keyword_names": [str(k.get("name") or "") for k in row.get("keywords", [])],
                "context_names": [str(c.get("name") or "") for c in row.get("contexts", [])],
                "is_active": bool(row.get("is_active", True)),
            }
            for row in db_rows
        ]
    return [row.to_dict() for _, row in loader.items.iterrows()]


def _similarity_score(loader: ArtifactLoader, reference: dict[str, Any], candidate: dict[str, Any]) -> float:
    ref_id = int(reference["item_id"])
    candidate_id = int(candidate["item_id"])
    embedding_score = 0.0
    try:
        ref_embedding = loader.embedding_for(ref_id)
        candidate_embedding = loader.embedding_for(candidate_id)
        if ref_embedding is not None and candidate_embedding is not None:
            dot = float(sum(float(a) * float(b) for a, b in zip(ref_embedding, candidate_embedding)))
            ref_norm = math.sqrt(sum(float(v) ** 2 for v in ref_embedding))
            candidate_norm = math.sqrt(sum(float(v) ** 2 for v in candidate_embedding))
            if ref_norm and candidate_norm:
                embedding_score = max(0.0, min(1.0, (dot / (ref_norm * candidate_norm) + 1.0) / 2.0))
    except (KeyError, TypeError, ValueError):
        embedding_score = 0.0

    def jaccard(left: Any, right: Any) -> float:
        a = {str(value) for value in (left or []) if value}
        b = {str(value) for value in (right or []) if value}
        return len(a & b) / len(a | b) if a or b else 0.0

    keyword_score = jaccard(reference.get("keyword_names"), candidate.get("keyword_names"))
    context_score = jaccard(reference.get("context_names"), candidate.get("context_names"))
    category_score = float(
        bool(reference.get("category_group"))
        and str(reference.get("category_group")) == str(candidate.get("category_group"))
    )
    return 0.70 * embedding_score + 0.15 * keyword_score + 0.10 * context_score + 0.05 * category_score


def _search_terms(search: Optional[str]) -> list[str]:
    if not search:
        return []
    return [term.strip().lower() for term in str(search).split("|") if term.strip()]


def _matches_all_terms(terms: list[str], values: list[Any]) -> bool:
    value_texts = [str(value or "").lower() for value in values]
    return all(any(_matches_term(term, value) for value in value_texts) for term in terms)


_SEARCH_FIELD_PRIORITY = ("name", "category_group", "description")


def _filter_rows_by_search_priority(rows: list[dict[str, Any]], terms: list[str]) -> list[dict[str, Any]]:
    for field in _SEARCH_FIELD_PRIORITY:
        matches = [row for row in rows if _matches_all_terms(terms, [row.get(field)])]
        if matches:
            return matches
    return []


def _filter_dataframe_by_search_priority(df: pd.DataFrame, terms: list[str]) -> pd.DataFrame:
    for field in _SEARCH_FIELD_PRIORITY:
        if field not in df.columns:
            continue
        mask = df.apply(lambda row: _matches_all_terms(terms, [row.get(field)]), axis=1)
        matches = df[mask]
        if not matches.empty:
            return matches
    return df.iloc[0:0]


def _matches_term(term: str, value: str) -> bool:
    if not term:
        return True
    return term in value


def _db_item_rows() -> Optional[list[dict[str, Any]]]:
    """Return active-capable catalog rows from Postgres, or None on fallback.

    The first call joins 4 tables (items, contexts, keywords, taxonomy_nodes)
    and walks the taxonomy tree recursively to build the per-keyword path
    strings. On the public home → /items search path every request was
    paying that cost, so we memoise the result in-process for
    ``_DB_ROWS_CACHE_TTL_SECONDS``. Admin edits land on the next refresh
    after the TTL expires; that delay is acceptable for a browse page
    where the catalog corpus is admin-curated, not user-driven.
    """
    signature = _db_catalog_signature()
    now = time.monotonic()
    cached = _db_rows_cache["data"]
    if (
        cached is not None
        and _db_rows_cache["expires_at"] > now
        and (signature is None or _db_rows_cache.get("signature") == signature)
    ):
        return cached

    # Lock around the actual build so a stampede of concurrent first
    # requests doesn't fire 4 SELECTs + the recursive taxonomy walk in
    # parallel. Slow-path callers wait on the lock and then read the
    # cache that the first caller populates.
    with _db_rows_lock:
        now = time.monotonic()
        cached = _db_rows_cache["data"]
        if (
            cached is not None
            and _db_rows_cache["expires_at"] > now
            and (signature is None or _db_rows_cache.get("signature") == signature)
        ):
            return cached
        # Inside the lock we hold the post-TTL stale entry until the
        # rebuild either succeeds or fails. Clear it now so a build
        # failure (DB disabled / network blip) doesn't leave callers
        # stuck on the previous corpus indefinitely.
        _db_rows_cache["data"] = None
        _db_rows_cache["expires_at"] = 0.0
        _db_rows_cache["signature"] = None
        try:
            with session_scope() as session:
                if session is None:
                    return None
                item_rows = session.execute(select(Item).order_by(Item.id)).scalars().all()
                item_ids = [int(item.id) for item in item_rows]
                contexts_by_item = _db_contexts_by_item(session, item_ids)
                keywords_by_item = _db_keywords_by_item(session, item_ids)
        except Exception:  # noqa: BLE001 - catalog must still work in artifact-only mode
            return None

        result = [
            _db_item_to_row(
                item,
                contexts=contexts_by_item.get(int(item.id), []),
                keywords=keywords_by_item.get(int(item.id), []),
            )
            for item in item_rows
        ]
        _db_rows_cache["data"] = result
        _db_rows_cache["expires_at"] = now + _DB_ROWS_CACHE_TTL_SECONDS
        _db_rows_cache["signature"] = signature
        return result


def invalidate_db_item_rows_cache() -> None:
    """Drop the live DB catalog cache after admin writes.

    External PostgreSQL edits are also detected by ``_db_catalog_signature``
    on the next read, but in-process admin writes can invalidate directly and
    avoid one signature comparison round-trip.
    """
    with _db_rows_lock:
        _db_rows_cache["data"] = None
        _db_rows_cache["expires_at"] = 0.0
        _db_rows_cache["signature"] = None


def _db_catalog_signature() -> Optional[str]:
    """Hash the live PostgreSQL catalog shape used by ``/items``.

    The cache is only safe when items, their context/keyword links, and the
    display names behind those links are unchanged. The catalog is small, so a
    few ordered light-weight SELECTs are cheap and make external DBeaver/SQL
    edits visible without a backend restart.
    """
    try:
        with session_scope() as session:
            if session is None:
                return None
            chunks: list[tuple[str, list[Any]]] = [
                (
                    "items",
                    session.execute(
                        select(
                            Item.id,
                            Item.artifact_item_id,
                            Item.name,
                            Item.description,
                            Item.category_group,
                            Item.performance_type,
                            Item.performers_count,
                            Item.duration_minutes,
                            Item.price_text,
                            Item.image_url,
                            Item.video_url,
                            Item.is_active,
                        ).order_by(Item.id)
                    ).all(),
                ),
                (
                    "contexts",
                    session.execute(
                        select(Context.id, Context.name, Context.group_name, Context.description)
                        .order_by(Context.id)
                    ).all(),
                ),
                (
                    "keywords",
                    session.execute(
                        select(Keyword.id, Keyword.name, Keyword.taxonomy_node_id)
                        .order_by(Keyword.id)
                    ).all(),
                ),
                (
                    "item_contexts",
                    session.execute(
                        select(ItemContext.item_id, ItemContext.context_id, ItemContext.validity_status)
                        .order_by(ItemContext.item_id, ItemContext.context_id)
                    ).all(),
                ),
                (
                    "item_keywords",
                    session.execute(
                        select(ItemKeyword.item_id, ItemKeyword.keyword_id, ItemKeyword.source)
                        .order_by(ItemKeyword.item_id, ItemKeyword.keyword_id)
                    ).all(),
                ),
            ]
    except Exception:  # noqa: BLE001 - catalog must still fall back gracefully
        return None

    digest = hashlib.sha256()
    for label, rows in chunks:
        digest.update(label.encode("utf-8"))
        for row in rows:
            digest.update(repr(tuple(row)).encode("utf-8", errors="replace"))
    return digest.hexdigest()


def _db_item_row(artifact_item_id: int) -> Optional[dict[str, Any]]:
    try:
        with session_scope() as session:
            if session is None:
                return None
            item = session.execute(
                select(Item).where(Item.artifact_item_id == int(artifact_item_id))
            ).scalar_one_or_none()
            if item is None:
                return None
            contexts = _db_contexts_by_item(session, [int(item.id)]).get(int(item.id), [])
            keywords = _db_keywords_by_item(session, [int(item.id)]).get(int(item.id), [])
    except Exception:  # noqa: BLE001 - fall back to artifacts
        return None

    return _db_item_to_row(item, contexts=contexts, keywords=keywords)


def _db_item_to_row(
    item: Item,
    *,
    contexts: list[dict[str, Any]],
    keywords: list[dict[str, Any]],
) -> dict[str, Any]:
    return {
        "artifact_item_id": int(item.artifact_item_id),
        "name": str(item.name or ""),
        "description": str(item.description or ""),
        "category_group": str(item.category_group or ""),
        "performance_type": str(item.performance_type or ""),
        "performers_count": item.performers_count,
        "duration_minutes": item.duration_minutes,
        "price_text": str(item.price_text or ""),
        "image_url": str(item.image_url or ""),
        "video_url": str(item.video_url or ""),
        "is_active": bool(item.is_active),
        "contexts": contexts,
        "keywords": keywords,
    }


def _db_contexts_by_item(session, item_ids: list[int]) -> dict[int, list[dict[str, Any]]]:
    if not item_ids:
        return {}
    counts = dict(
        session.execute(
            select(ItemContext.context_id, func.count(ItemContext.item_id))
            .join(Item, Item.id == ItemContext.item_id)
            .where(Item.is_active.is_(True))
            .group_by(ItemContext.context_id)
        ).all()
    )
    rows = session.execute(
        select(
            ItemContext.item_id,
            Context.name,
            Context.group_name,
            Context.description,
            Context.id,
        )
        .join(Context, Context.id == ItemContext.context_id)
        .where(ItemContext.item_id.in_(item_ids))
        .order_by(Context.group_name, Context.name)
    ).all()
    out: dict[int, list[dict[str, Any]]] = {}
    for item_id, name, group_name, description, context_pk in rows:
        out.setdefault(int(item_id), []).append(
            {
                "id": stable_id("context", str(name)),
                "db_id": int(context_pk),
                "name": str(name or ""),
                "group": str(group_name or ""),
                "description": str(description or ""),
                "active_item_count": int(counts.get(context_pk, 0)),
            }
        )
    return out


def _db_keywords_by_item(session, item_ids: list[int]) -> dict[int, list[dict[str, Any]]]:
    if not item_ids:
        return {}
    taxonomy_paths = _taxonomy_paths_by_id(session)
    rows = session.execute(
        select(
            ItemKeyword.item_id,
            Keyword.id,
            Keyword.name,
            Keyword.taxonomy_node_id,
        )
        .join(Keyword, Keyword.id == ItemKeyword.keyword_id)
        .where(ItemKeyword.item_id.in_(item_ids))
        .order_by(Keyword.name)
    ).all()
    out: dict[int, list[dict[str, Any]]] = {}
    for item_id, keyword_id, name, taxonomy_node_id in rows:
        out.setdefault(int(item_id), []).append(
            {
                "id": int(keyword_id),
                "name": str(name or ""),
                "taxonomy_path": taxonomy_paths.get(int(taxonomy_node_id), "") if taxonomy_node_id else "",
            }
        )
    return out


def _taxonomy_paths_by_id(session) -> dict[int, str]:
    nodes = {
        int(node_id): {"name": str(name or ""), "parent_id": int(parent_id) if parent_id else None}
        for node_id, name, parent_id in session.execute(
            select(TaxonomyNode.id, TaxonomyNode.name, TaxonomyNode.parent_id)
        ).all()
    }
    cache: dict[int, str] = {}

    def path_for(node_id: int) -> str:
        if node_id in cache:
            return cache[node_id]
        node = nodes.get(int(node_id))
        if not node:
            return ""
        parent_id = node["parent_id"]
        parent_path = path_for(parent_id) if parent_id else ""
        path = f"{parent_path} > {node['name']}" if parent_path else node["name"]
        cache[node_id] = path
        return path

    return {node_id: path_for(node_id) for node_id in nodes}


def _db_row_to_item_out(row: dict[str, Any], user_state: Optional[UserState] = None) -> ItemOut:
    kw_names = [str(k["name"]) for k in row["keywords"] if k.get("name")]
    ctx_names = [str(c["name"]) for c in row["contexts"] if c.get("name")]
    mp = catalog_match_percent(
        keyword_count=len(kw_names),
        context_count=len(ctx_names),
        description_length=len(str(row.get("description") or "")),
    )
    return ItemOut(
        id=int(row["artifact_item_id"]),
        name=str(row.get("name") or ""),
        description=str(row.get("description") or ""),
        category_group=str(row.get("category_group") or ""),
        performance_type=str(row.get("performance_type") or ""),
        performers_count=row.get("performers_count"),
        duration_minutes=row.get("duration_minutes"),
        price_text=str(row.get("price_text") or ""),
        image_url=str(row.get("image_url") or ""),
        video_url=str(row.get("video_url") or ""),
        keywords=[KeywordOut(**k) for k in row["keywords"] if k.get("name")],
        contexts=[
            ContextOut(
                id=int(c["id"]),
                name=str(c["name"]),
                group=str(c.get("group", "") or ""),
                description=str(c.get("description", "") or ""),
                active_item_count=int(c.get("active_item_count", 0)),
            )
            for c in row["contexts"]
            if c.get("name")
        ],
        user_state=user_state or UserState(),
        match_percent=mp,
        suitability_label=suitability_label(mp),
    )


def _row_to_item_out(row, loader: ArtifactLoader, user_state: Optional[UserState] = None) -> ItemOut:
    iid = int(row["item_id"])
    kw_names = list(row.get("keyword_names") or [])
    kw_paths = list(row.get("taxonomy_paths") or [])
    keyword_objs = [
        KeywordOut(
            id=stable_id("keyword", str(n)),
            name=str(n),
            taxonomy_path=str(kw_paths[idx]) if idx < len(kw_paths) else "",
        )
        for idx, n in enumerate(kw_names)
        if n
    ]
    ctx_names = list(row.get("context_names") or [])
    context_objs = [
        ContextOut(
            id=stable_id("context", str(c)),
            name=str(c),
            group="",
            description="",
            active_item_count=0,
        )
        for c in ctx_names
        if c
    ]
    # Always compute match_percent for consistency; omit the label until a
    # caller actually wants it surfaced (ranked-mode + recommendation path).
    mp = catalog_match_percent(
        keyword_count=len(kw_names),
        context_count=len(ctx_names),
        description_length=len(str(row.get("description") or "")),
    )
    # Loader rows may carry pandas NaN for missing numeric fields — coerce
    # those to ``None`` so Pydantic v2.12's strict ``finite_number`` check
    # accepts them.
    def _clean_int(value):
        if value is None:
            return None
        try:
            if value != value:  # NaN guard (covers float('nan'), numpy.nan, pandas.NA-like)
                return None
        except TypeError:
            return None
        try:
            return int(value)
        except (TypeError, ValueError):
            return None

    return ItemOut(
        id=iid,
        name=str(row.get("name") or ""),
        description=str(row.get("description") or ""),
        category_group=str(row.get("category_group") or ""),
        performance_type=str(row.get("performance_type") or ""),
        performers_count=_clean_int(row.get("performers_count")),
        duration_minutes=_clean_int(row.get("duration_minutes")),
        price_text=str(row.get("price_text") or ""),
        image_url="",
        video_url="",
        keywords=keyword_objs,
        contexts=context_objs,
        user_state=user_state or UserState(),
        match_percent=mp,
        suitability_label=suitability_label(mp),
    )


def _ranked_by_context(
    df: "pd.DataFrame",
    context_id: int,
    user_key: Optional[str],
    loader: ArtifactLoader,
) -> ItemListOut:
    """Return the top-10 items valid for ``context_id`` sorted by match_percent desc."""
    ctx_name = context_name_for_id(loader, int(context_id))
    if not ctx_name:
        raise ContextNotFoundError(
            f"Context id {context_id} is not known.",
            extra={"context_id": context_id},
        )
    mask = df["context_names"].apply(lambda names: ctx_name in (names or []))
    eligible = df[mask]
    # Compute match_percent on the eligible subset, then sort desc.
    scored = []
    for _, row in eligible.iterrows():
        mp = catalog_match_percent(
            keyword_count=len(row.get("keyword_names") or []),
            context_count=len(row.get("context_names") or []),
            description_length=len(str(row.get("description") or "")),
        )
        scored.append((mp, str(row.get("name") or ""), row))
    scored.sort(key=lambda t: (-t[0], t[1]))
    top = scored[:RANKED_MODE_LIMIT]
    artifact_ids = [int(r["item_id"]) for _, _, r in top]
    state_map = live_user_state_for_items(user_key or "", artifact_ids)
    items = []
    for mp, _name, row in top:
        item = _row_to_item_out(row, loader, user_state=state_map.get(int(row["item_id"])))
        items.append(item)
    return ItemListOut(items=items, total=len(items))


def _ranked_by_context_db(
    rows: list[dict[str, Any]],
    context_id: int,
    user_key: Optional[str],
    loader: ArtifactLoader,
) -> ItemListOut:
    ctx_name = context_name_for_id(loader, int(context_id))
    if not ctx_name:
        raise ContextNotFoundError(
            f"Context id {context_id} is not known.",
            extra={"context_id": context_id},
        )
    eligible = [
        row
        for row in rows
        if any(str(c.get("name") or "") == ctx_name for c in row["contexts"])
    ]
    scored = []
    for row in eligible:
        mp = catalog_match_percent(
            keyword_count=len(row["keywords"]),
            context_count=len(row["contexts"]),
            description_length=len(str(row.get("description") or "")),
        )
        scored.append((mp, str(row.get("name") or ""), row))
    scored.sort(key=lambda t: (-t[0], t[1]))
    top = scored[:RANKED_MODE_LIMIT]
    artifact_ids = [int(r["artifact_item_id"]) for _, _, r in top]
    state_map = live_user_state_for_items(user_key or "", artifact_ids)
    return ItemListOut(
        items=[
            _db_row_to_item_out(row, user_state=state_map.get(int(row["artifact_item_id"])))
            for _, _, row in top
        ],
        total=len(top),
    )
