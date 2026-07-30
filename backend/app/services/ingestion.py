"""
services/ingestion.py — Live-ingest orchestrator for the admin slice.

The flow (per ADR §3 — runtime embedding exception):

1. **Compute embedding OUTSIDE the loader lock** via
   ``services.embedding.encode_item_text`` (E5 inference, ~2-3 s on CPU).
2. **Acquire the loader lock** (``model_loader.get_lock()``).
3. Open a DB session, validate uniqueness, insert ``Item``,
   ``ItemContext`` rows, ``ItemKeyword`` rows.
4. Call ``loader.append_item(...)`` so the in-memory catalog + embedding
   matrix + CF index reflect the new row.
5. Release the lock.

Atomicity caveat
----------------
DB insert and loader mutation are not in a single transaction. The
loader is in-memory, so a crash between DB insert and loader mutation
would leave the DB ahead of the loader. The orchestrator mitigates by
holding the lock for the entire window (so concurrent reads see a
consistent state) and by re-loading on the next ingest.

Hot-reload semantics
--------------------
``ArtifactLoader.append_item`` mutates the existing instance; the lifespan
that originally called ``loader.load(...)`` is NOT re-run. The next
``GET /health`` reflects the new ``item_count`` because the loader's
``metadata`` is read from the same instance.
"""
from __future__ import annotations

import logging
from typing import Iterable, List, NamedTuple, Optional, Sequence, Tuple

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..core.exceptions import InvalidRequestError
from ..db import is_db_enabled, session_scope
from ..models_db import Context, Item, ItemContext, ItemKeyword, Keyword, User
from ..model_loader import ArtifactLoader, get_lock, get_singleton
from ..schemas.item import ItemOut
from ..schemas.admin import ItemCreate
from ..services import embedding as emb
from ..services import grounding
from ..services._ids import stable_id


logger = logging.getLogger("recsys.ingestion")


class IngestResult(NamedTuple):
    item: ItemOut
    artifact_id: int
    django_id: int
    warnings: List[str]


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


# --- Public entry point -----------------------------------------------------


def ingest_new_item(
    item_create: ItemCreate,
    *,
    admin_user: Optional[User] = None,
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
    # For the embedding we use the admin-supplied keyword + context lists;
    # the loader-level lists will be filled in once we resolve ids.
    kw_for_embed: List[str] = []
    ctx_for_embed: List[str] = [n for n in (item_create.context_names or []) if n]
    # Layer A on raw names (Layer B is admin UI flow).
    if ctx_for_embed:
        kw_for_embed = list(item_create.context_names)
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
            kw_ids = list(item_create.keyword_ids or [])
            # Deduplicate while preserving order.
            seen_kw: set = set()
            kw_ids = [k for k in kw_ids if not (k in seen_kw or seen_kw.add(k))]

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
            django_id = int(item.id)

            for cid in ctx_ids:
                session.add(
                    ItemContext(
                        item_id=django_id,
                        context_id=cid,
                        validity_status="valid",
                    )
                )
            for kid in kw_ids:
                session.add(
                    ItemKeyword(
                        item_id=django_id,
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
                kw_names=[],  # resolved later via _lookup_keyword_name
                ctx_names=list(item_create.context_names or []),
                taxonomy_paths=[],
            )

            # Build the response ItemOut — keywords/contexts are empty lists
            # because the loader doesn't backfill ids, only names. The
            # catalog endpoints will resolve the lists on the next read.
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
                "ingested new item django_id=%d artifact_id=%d name=%r by admin=%s",
                django_id, aid, name, admin_user.id if admin_user else "anon",
            )
            return IngestResult(
                item=item_out,
                artifact_id=aid,
                django_id=django_id,
                warnings=warnings,
            )
    finally:
        lock.release()