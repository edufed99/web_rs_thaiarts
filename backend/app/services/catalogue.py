"""
services/catalogue.py — Deep Catalogue Read Model and Dual-ID Encapsulation.

Provides a unified read interface that encapsulates:
- In-memory TTL caching (_db_rows_cache, 60s TTL, thread lock, DB signature)
- Dual-ID translation (items.artifact_item_id <-> items.id)
- Media resolution (live_item_media_for_items)
- Live user state overlay (live_user_state_for_items)
- Taxonomy path resolution
- Automatic graceful fallback to in-memory DataFrame when DB is disabled/unreachable
"""
from __future__ import annotations

import hashlib
import math
import threading
import time
from typing import Any, Dict, Iterable, List, Optional, Set, Tuple

import pandas as pd
from sqlalchemy import func, select

from .. import db
from ..core.exceptions import ContextNotFoundError, ItemNotFoundError
from ..model_loader import ArtifactLoader, get_singleton
from ..models_db import Context, Item, ItemContext, ItemKeyword, Keyword, TaxonomyNode
from ..schemas.admin import ItemFacetsOut
from ..schemas.context import ContextOut
from ..schemas.item import EngagementListOut, EngagementOut, ItemListOut, ItemOut, UserState
from ..schemas.keyword import KeywordOut
from ._ids import stable_id
from .db_query import live_item_engagement, live_item_media_for_items, live_user_state_for_items
from .eligibility import context_name_for_id
from .suitability import catalog_match_percent, suitability_label

RANKED_MODE_LIMIT = 10
_DB_ROWS_CACHE_TTL_SECONDS = 60.0
_db_rows_cache: dict[str, Any] = {"data": None, "expires_at": 0.0, "signature": None}
_db_rows_lock = threading.Lock()
_SEARCH_FIELD_PRIORITY = ("name", "category_group", "description")


def session_scope():
    """Context manager yielding a DB session, or None when DB is disabled."""
    return db.session_scope()


def is_db_enabled() -> bool:
    """Check if the DB layer is enabled."""
    return db.is_db_enabled()


def _clean_int(value: Any) -> Optional[int]:
    """Coerce value to int, converting NaN / NA to None for Pydantic validation."""
    if value is None:
        return None
    try:
        if value != value:  # NaN guard
            return None
    except TypeError:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _search_terms(search: Optional[str]) -> list[str]:
    if not search:
        return []
    return [term.strip().lower() for term in str(search).split("|") if term.strip()]


def _matches_term(term: str, value: str) -> bool:
    if not term:
        return True
    return term in value


def _matches_all_terms(terms: list[str], values: list[Any]) -> bool:
    value_texts = [str(value or "").lower() for value in values]
    return all(any(_matches_term(term, value) for value in value_texts) for term in terms)


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


def _taxonomy_paths_by_id(session: Any) -> dict[int, str]:
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


def _db_contexts_by_item(session: Any, item_ids: list[int]) -> dict[int, list[dict[str, Any]]]:
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


def _db_keywords_by_item(session: Any, item_ids: list[int]) -> dict[int, list[dict[str, Any]]]:
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
        performers_count=_clean_int(row.get("performers_count")),
        duration_minutes=_clean_int(row.get("duration_minutes")),
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


def _row_to_item_out(
    row: Any,
    loader: ArtifactLoader,
    user_state: Optional[UserState] = None,
    media: Optional[dict[str, str]] = None,
) -> ItemOut:
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
    mp = catalog_match_percent(
        keyword_count=len(kw_names),
        context_count=len(ctx_names),
        description_length=len(str(row.get("description") or "")),
    )
    img_url = str(media.get("image_url") or "") if media else ""
    vid_url = str(media.get("video_url") or "") if media else ""
    return ItemOut(
        id=iid,
        name=str(row.get("name") or ""),
        description=str(row.get("description") or ""),
        category_group=str(row.get("category_group") or ""),
        performance_type=str(row.get("performance_type") or ""),
        performers_count=_clean_int(row.get("performers_count")),
        duration_minutes=_clean_int(row.get("duration_minutes")),
        price_text=str(row.get("price_text") or ""),
        image_url=img_url,
        video_url=vid_url,
        keywords=keyword_objs,
        contexts=context_objs,
        user_state=user_state or UserState(),
        match_percent=mp,
        suitability_label=suitability_label(mp),
    )


def _db_catalog_signature() -> Optional[str]:
    """Hash the live PostgreSQL catalog shape used by catalogue read operations."""
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


def _db_item_rows() -> Optional[list[dict[str, Any]]]:
    """Return active-capable catalog rows from Postgres, or None on fallback."""
    signature = _db_catalog_signature()
    now = time.monotonic()
    cached = _db_rows_cache["data"]
    if (
        cached is not None
        and _db_rows_cache["expires_at"] > now
        and (signature is None or _db_rows_cache.get("signature") == signature)
    ):
        return cached

    with _db_rows_lock:
        now = time.monotonic()
        cached = _db_rows_cache["data"]
        if (
            cached is not None
            and _db_rows_cache["expires_at"] > now
            and (signature is None or _db_rows_cache.get("signature") == signature)
        ):
            return cached
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
    """Drop the live DB catalog cache after admin writes."""
    with _db_rows_lock:
        _db_rows_cache["data"] = None
        _db_rows_cache["expires_at"] = 0.0
        _db_rows_cache["signature"] = None


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


def _ranked_by_context(
    df: pd.DataFrame,
    context_id: int,
    user_key: Optional[str],
    loader: ArtifactLoader,
) -> ItemListOut:
    """Return the top-10 items valid for context_id sorted by match_percent desc from DataFrame."""
    ctx_name = context_name_for_id(loader, int(context_id))
    if not ctx_name:
        raise ContextNotFoundError(
            f"Context id {context_id} is not known.",
            extra={"context_id": context_id},
        )
    mask = df["context_names"].apply(lambda names: ctx_name in (names or []))
    eligible = df[mask]
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
    media_map = live_item_media_for_items(artifact_ids)
    items = []
    for _mp, _name, row in top:
        item = _row_to_item_out(
            row,
            loader,
            user_state=state_map.get(int(row["item_id"])),
            media=media_map.get(int(row["item_id"])),
        )
        items.append(item)
    return ItemListOut(items=items, total=len(items))


def _ranked_by_context_db(
    rows: list[dict[str, Any]],
    context_id: int,
    user_key: Optional[str],
    loader: ArtifactLoader,
) -> ItemListOut:
    """Return the top-10 items valid for context_id sorted by match_percent desc from DB rows."""
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


def _parse_engagement_range_days(raw: str) -> Optional[int]:
    text = (raw or "all").strip().lower()
    if text in {"", "all", "all-time", "alltime"}:
        return None
    accepted = {"7d": 7, "30d": 30, "90d": 90, "365d": 365}
    return accepted.get(text)


# =========================================================================
# Public Service API
# =========================================================================


def get_item(loader: ArtifactLoader, item_id: int, user_key: str = "") -> Optional[ItemOut]:
    """Retrieve one catalog item by artifact item id, with user state and media."""
    db_row = _db_item_row(int(item_id))
    if db_row is not None:
        state_map = live_user_state_for_items(user_key, [int(item_id)])
        return _db_row_to_item_out(db_row, user_state=state_map.get(int(item_id)))

    row = loader.item_row(int(item_id))
    if row is None:
        return None
    state_map = live_user_state_for_items(user_key, [int(item_id)])
    media_map = live_item_media_for_items([int(item_id)])
    return _row_to_item_out(
        row,
        loader,
        user_state=state_map.get(int(item_id)),
        media=media_map.get(int(item_id)),
    )


def list_items(
    loader: ArtifactLoader,
    search: Optional[str] = None,
    limit: int = 20,
    offset: int = 0,
    context: Optional[int] = None,
    user_key: str = "",
) -> ItemListOut:
    """List active items with search, pagination, ranked context mode, and user state."""
    db_items = _db_item_rows()
    if db_items is not None:
        active_items = [row for row in db_items if row["is_active"]]
        if context is not None:
            return _ranked_by_context_db(active_items, context, user_key, loader)
        terms = _search_terms(search)
        if terms:
            active_items = _filter_rows_by_search_priority(active_items, terms)
        total = len(active_items)
        page = active_items[offset : offset + limit]
        artifact_ids = [int(row["artifact_item_id"]) for row in page]
        state_map = live_user_state_for_items(user_key, artifact_ids)
        return ItemListOut(
            items=[
                _db_row_to_item_out(row, user_state=state_map.get(int(row["artifact_item_id"])))
                for row in page
            ],
            total=total,
        )

    df = loader.items
    active = df[df["is_active"].astype(bool)]

    if context is not None:
        return _ranked_by_context(active, context, user_key, loader)

    terms = _search_terms(search)
    if terms:
        active = _filter_dataframe_by_search_priority(active, terms)

    total = int(len(active))
    page = active.iloc[offset : offset + limit]
    artifact_ids = [int(r["item_id"]) for _, r in page.iterrows()]
    state_map = live_user_state_for_items(user_key, artifact_ids)
    media_map = live_item_media_for_items(artifact_ids)
    return ItemListOut(
        items=[
            _row_to_item_out(
                row,
                loader,
                user_state=state_map.get(int(row["item_id"])),
                media=media_map.get(int(row["item_id"])),
            )
            for _, row in page.iterrows()
        ],
        total=total,
    )


def get_items_batch(
    loader: ArtifactLoader,
    item_ids: List[int],
    user_key: str = "",
) -> List[ItemOut]:
    """Retrieve multiple catalog items in requested order, with live user state and media."""
    if not item_ids:
        return []
    state_map = live_user_state_for_items(user_key, item_ids)
    db_rows = _db_item_rows()
    if db_rows is not None:
        by_id = {
            int(row["artifact_item_id"]): row
            for row in db_rows
            if bool(row.get("is_active", True))
        }
        return [
            _db_row_to_item_out(by_id[item_id], user_state=state_map.get(item_id))
            for item_id in item_ids
            if item_id in by_id
        ]
    media_map = live_item_media_for_items(item_ids)
    output: List[ItemOut] = []
    for item_id in item_ids:
        row = loader.item_row(item_id)
        if row is not None and bool(row.get("is_active", True)):
            output.append(
                _row_to_item_out(
                    row,
                    loader,
                    user_state=state_map.get(item_id),
                    media=media_map.get(item_id),
                )
            )
    return output


def get_similar_items(
    loader: ArtifactLoader,
    item_id: int,
    limit: int = 4,
    user_key: str = "",
) -> List[ItemOut]:
    """Find similar active catalog items using embeddings and metadata Jaccard similarity."""
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
    return get_items_batch(loader, selected_ids, user_key=user_key)


def get_item_engagement(loader: ArtifactLoader, item_id: int) -> Optional[EngagementOut]:
    """Return engagement metrics for a single artifact item id, or None if DB is disabled."""
    if not is_db_enabled():
        return None
    agg = live_item_engagement(item_ids=[int(item_id)])
    v = agg.get(int(item_id))
    if v is None:
        return EngagementOut(
            item_id=int(item_id),
            like_count=0,
            save_count=0,
            rating_count=0,
            engagement_score=0,
        )
    return EngagementOut(
        item_id=int(item_id),
        like_count=int(v["like_count"]),
        save_count=int(v["save_count"]),
        rating_count=int(v["rating_count"]),
        engagement_score=int(v["engagement_score"]),
    )


def list_item_engagement(loader: ArtifactLoader, limit: int = 50) -> EngagementListOut:
    """Return top engaged items across the catalog, sorted by engagement score desc."""
    if not is_db_enabled():
        return EngagementListOut(engagements=[], source="disabled")
    agg = live_item_engagement()
    rows: List[EngagementOut] = [
        EngagementOut(
            item_id=int(aid),
            like_count=int(v["like_count"]),
            save_count=int(v["save_count"]),
            rating_count=int(v["rating_count"]),
            engagement_score=int(v["engagement_score"]),
        )
        for aid, v in agg.items()
    ]
    rows.sort(key=lambda r: (-r.engagement_score, r.item_id))
    return EngagementListOut(engagements=rows[:limit], source="postgres")


def get_items_engagement(
    loader: ArtifactLoader,
    item_ids: List[int],
    range_str: str = "all",
) -> EngagementListOut:
    """Return engagement metrics for a list of artifact item ids."""
    if not is_db_enabled() or not item_ids:
        return EngagementListOut(engagements=[], source="disabled")

    window_days = _parse_engagement_range_days(range_str)
    agg = live_item_engagement(item_ids=item_ids, window_days=window_days)
    rows: List[EngagementOut] = []
    for aid in item_ids:
        v = agg.get(int(aid))
        if v is None:
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
    rows.sort(key=lambda r: (-r.engagement_score, r.item_id))
    return EngagementListOut(engagements=rows, source="postgres")


def get_item_facets(loader: Optional[ArtifactLoader] = None) -> ItemFacetsOut:
    """Return distinct category_groups, performance_types, and category_groups_by_performance_type."""
    try:
        with session_scope() as session:
            if session is None:
                raise RuntimeError("db_disabled")
            cat_rows = session.execute(
                select(Item.category_group)
                .where(Item.is_active.is_(True))
                .group_by(Item.category_group)
            ).all()
            perf_rows = session.execute(
                select(Item.performance_type)
                .where(Item.is_active.is_(True))
                .group_by(Item.performance_type)
            ).all()
            pair_rows = session.execute(
                select(Item.category_group, Item.performance_type)
                .where(Item.is_active.is_(True))
            ).all()
            cats = [str(c[0] or "").strip() for c in cat_rows if str(c[0] or "").strip()]
            perfs = [str(p[0] or "").strip() for p in perf_rows if str(p[0] or "").strip()]
            cats_by_perf: Dict[str, Set[str]] = {}
            for cat_raw, perf_raw in pair_rows:
                cat = str(cat_raw or "").strip()
                perf = str(perf_raw or "").strip()
                if not cat or not perf:
                    continue
                cats_by_perf.setdefault(perf, set()).add(cat)
            return ItemFacetsOut(
                category_groups=sorted(cats),
                performance_types=sorted(perfs),
                category_groups_by_performance_type={
                    perf: sorted(vals) for perf, vals in cats_by_perf.items()
                },
                source="db",
            )
    except Exception:  # noqa: BLE001 - fallback to artifact loader
        pass

    if loader is None:
        loader = get_singleton()
    df = loader.items
    cats_list: List[str] = []
    perfs_list: List[str] = []
    cats_by_perf_map: Dict[str, Set[str]] = {}
    if "category_group" in df.columns and "performance_type" in df.columns:
        for _, row in df.iterrows():
            cat = str(row.get("category_group") or "").strip()
            perf = str(row.get("performance_type") or "").strip()
            if cat:
                cats_list.append(cat)
            if perf:
                perfs_list.append(perf)
            if cat and perf:
                cats_by_perf_map.setdefault(perf, set()).add(cat)
    return ItemFacetsOut(
        category_groups=sorted(set(cats_list)),
        performance_types=sorted(set(perfs_list)),
        category_groups_by_performance_type={
            perf: sorted(vals) for perf, vals in cats_by_perf_map.items()
        },
        source="artifact",
    )


class CatalogueModule:
    """Deep module interface encapsulating all catalog read operations."""

    @staticmethod
    def get_item(loader: ArtifactLoader, item_id: int, user_key: str = "") -> Optional[ItemOut]:
        return get_item(loader=loader, item_id=item_id, user_key=user_key)

    @staticmethod
    def list_items(
        loader: ArtifactLoader,
        search: Optional[str] = None,
        limit: int = 20,
        offset: int = 0,
        context: Optional[int] = None,
        user_key: str = "",
    ) -> ItemListOut:
        return list_items(
            loader=loader,
            search=search,
            limit=limit,
            offset=offset,
            context=context,
            user_key=user_key,
        )

    @staticmethod
    def get_items_batch(
        loader: ArtifactLoader,
        item_ids: List[int],
        user_key: str = "",
    ) -> List[ItemOut]:
        return get_items_batch(loader=loader, item_ids=item_ids, user_key=user_key)

    @staticmethod
    def get_similar_items(
        loader: ArtifactLoader,
        item_id: int,
        limit: int = 4,
        user_key: str = "",
    ) -> List[ItemOut]:
        return get_similar_items(loader=loader, item_id=item_id, limit=limit, user_key=user_key)

    @staticmethod
    def get_item_engagement(loader: ArtifactLoader, item_id: int) -> Optional[EngagementOut]:
        return get_item_engagement(loader=loader, item_id=item_id)

    @staticmethod
    def list_item_engagement(loader: ArtifactLoader, limit: int = 50) -> EngagementListOut:
        return list_item_engagement(loader=loader, limit=limit)

    @staticmethod
    def get_items_engagement(
        loader: ArtifactLoader,
        item_ids: List[int],
        range_str: str = "all",
    ) -> EngagementListOut:
        return get_items_engagement(loader=loader, item_ids=item_ids, range_str=range_str)

    @staticmethod
    def get_item_facets(loader: Optional[ArtifactLoader] = None) -> ItemFacetsOut:
        return get_item_facets(loader=loader)

    @staticmethod
    def invalidate_cache() -> None:
        invalidate_db_item_rows_cache()
