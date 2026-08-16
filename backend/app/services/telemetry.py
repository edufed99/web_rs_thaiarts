"""
services/telemetry.py — Recommendation Telemetry Seam.

Decouples recommendation scoring from persistent storage. Provides a
RecommendationTelemetry interface and adapters:
- PostgresTelemetryAdapter: Production adapter writing telemetry to PostgreSQL.
- InMemoryTelemetryAdapter: In-memory recorder for testing and offline execution.
- NullTelemetryAdapter: No-op adapter.
- get_telemetry_adapter(): Factory resolving the active adapter based on DB availability.
"""
from __future__ import annotations

import json
import logging
from typing import Any, Dict, List, Optional, Protocol, runtime_checkable

from sqlalchemy import select

from ..core.config import Settings
from ..db import is_db_enabled, session_scope
from ..schemas.keyword import KeywordOut
from ..schemas.recommendation import RecommendationRequestIn, RecommendationResultOut


logger = logging.getLogger(__name__)


@runtime_checkable
class RecommendationTelemetry(Protocol):
    """Protocol for recording recommendation request telemetry."""

    def record_recommendation(
        self,
        request: RecommendationRequestIn,
        ctx_name: str,
        results: List[RecommendationResultOut],
        settings: Settings,
        *,
        user_id: Optional[int] = None,
        candidate_count: Optional[int] = None,
        selected_keywords: Optional[List[KeywordOut]] = None,
    ) -> int:
        """Record a recommendation request and its ranked results.

        Returns the persisted telemetry request ID (integer > 0) on success,
        or 0 when persistence was skipped or not supported.
        """
        ...


class NullTelemetryAdapter:
    """No-op telemetry adapter."""

    def record_recommendation(
        self,
        request: RecommendationRequestIn,
        ctx_name: str,
        results: List[RecommendationResultOut],
        settings: Settings,
        *,
        user_id: Optional[int] = None,
        candidate_count: Optional[int] = None,
        selected_keywords: Optional[List[KeywordOut]] = None,
    ) -> int:
        return 0


class InMemoryTelemetryAdapter:
    """In-memory recording adapter for testing and offline runs."""

    def __init__(self, return_id: int = 0) -> None:
        self.records: List[Dict[str, Any]] = []
        self.return_id = return_id

    @property
    def calls(self) -> List[Dict[str, Any]]:
        return self.records

    def record_recommendation(
        self,
        request: RecommendationRequestIn,
        ctx_name: str,
        results: List[RecommendationResultOut],
        settings: Settings,
        *,
        user_id: Optional[int] = None,
        candidate_count: Optional[int] = None,
        selected_keywords: Optional[List[KeywordOut]] = None,
    ) -> int:
        self.records.append(
            {
                "request": request,
                "ctx_name": ctx_name,
                "results": results,
                "settings": settings,
                "user_id": user_id,
                "candidate_count": (
                    candidate_count if candidate_count is not None else len(results)
                ),
                "selected_keywords": selected_keywords or [],
            }
        )
        return self.return_id

    def clear(self) -> None:
        self.records.clear()


class PostgresTelemetryAdapter:
    """Production PostgreSQL adapter for recommendation telemetry."""

    def record_recommendation(
        self,
        request: RecommendationRequestIn,
        ctx_name: str,
        results: List[RecommendationResultOut],
        settings: Settings,
        *,
        user_id: Optional[int] = None,
        candidate_count: Optional[int] = None,
        selected_keywords: Optional[List[KeywordOut]] = None,
    ) -> int:
        if not is_db_enabled():
            return 0
        try:
            with session_scope() as session:
                if session is None:
                    return 0

                from ..models_db import (
                    Context,
                    Item,
                    Keyword as DbKeyword,
                    RecommendationRequest as RR,
                    RecommendationRequestSelectedKeyword as RRSK,
                    RecommendationResult as RL,
                )

                ctx_row_id: Optional[int] = None
                if ctx_name:
                    ctx_row = session.execute(
                        select(Context.id).where(Context.name == ctx_name).limit(1)
                    ).scalar_one_or_none()
                    ctx_row_id = int(ctx_row) if ctx_row is not None else None

                if ctx_row_id is None:
                    logger.warning(
                        "Recommendation telemetry skipped: context %r is missing from the database",
                        ctx_name,
                    )
                    return 0

                rr = RR(
                    user_id=int(user_id) if user_id is not None else None,
                    selected_context_id=int(ctx_row_id),
                    candidate_count=(
                        int(candidate_count)
                        if candidate_count is not None
                        else len(results)
                    ),
                    top_k=int(request.top_k),
                    method=str(settings.recommendation_method),
                    metadata_json=json.dumps(
                        {
                            "cbf_model": str(settings.e5_model_name),
                            "hybrid_alpha": float(settings.hybrid_alpha),
                            "user_key_provided": bool(request.user_key),
                            "selected_keyword_names": [
                                str(keyword.name)
                                for keyword in (selected_keywords or [])
                            ],
                        },
                        ensure_ascii=False,
                    ),
                )
                session.add(rr)
                session.flush()
                req_id = int(rr.id)

                selected_names = {
                    str(keyword.name).strip()
                    for keyword in (selected_keywords or [])
                    if str(keyword.name).strip()
                }
                if selected_names:
                    keyword_ids = session.execute(
                        select(DbKeyword.id).where(DbKeyword.name.in_(selected_names))
                    ).scalars().all()
                    for keyword_id in keyword_ids:
                        session.add(RRSK(request_id=req_id, keyword_id=int(keyword_id)))

                artifact_ids = [int(result.item.id) for result in results]
                item_id_by_artifact = (
                    {
                        int(artifact_id): int(db_id)
                        for artifact_id, db_id in session.execute(
                            select(Item.artifact_item_id, Item.id).where(
                                Item.artifact_item_id.in_(artifact_ids)
                            )
                        ).all()
                    }
                    if artifact_ids
                    else {}
                )

                for r in results:
                    db_item_id = item_id_by_artifact.get(int(r.item.id))
                    if db_item_id is None:
                        continue
                    session.add(
                        RL(
                            request_id=req_id,
                            item_id=db_item_id,
                            rank=int(r.rank),
                            cbf_score=float(r.scores.cbf),
                            cf_score=float(r.scores.cf),
                            hybrid_score=float(r.scores.hybrid),
                            is_context_valid=bool(r.is_context_valid),
                            matched_keywords_json=json.dumps(
                                list(r.matched_keywords or []), ensure_ascii=False
                            ),
                            explanation=str(r.explanation or ""),
                        )
                    )
                return req_id
        except Exception:  # noqa: BLE001 - telemetry writes must never break the request path
            logger.exception("Failed to persist recommendation request telemetry")
            return 0
        finally:
            try:
                from .dashboard_query import recompute_online_eval

                recompute_online_eval(window_days=30)
            except Exception:  # noqa: BLE001
                pass


def get_telemetry_adapter() -> RecommendationTelemetry:
    """Factory returning the active telemetry adapter based on DB availability."""
    if is_db_enabled():
        return PostgresTelemetryAdapter()
    return InMemoryTelemetryAdapter()
