"""
routers/health.py — GET /health.

Returns 200 with build metadata when artifacts are loaded, 503 when not.
"""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, status

from ..core.config import get_settings
from ..model_loader import get_singleton
from ..schemas.metrics import HealthOut


router = APIRouter(tags=["health"])


@router.get(
    "/health",
    response_model=HealthOut,
    summary="Liveness probe",
    description=(
        "Returns ``status='ok'`` and build metadata when artifacts are loaded. "
        "Returns 503 with ``status='degraded'`` when artifacts are missing or "
        "the loader failed to initialize."
    ),
)
def health() -> HealthOut:
    settings = get_settings()
    try:
        loader = get_singleton()
        md = loader.metadata or {}
        return HealthOut(
            status="ok",
            version=settings.app_version,
            artifacts_loaded_at=loader.loaded_at,
            item_count=int(md.get("item_count", len(loader.item_ids))),
            context_count=int(md.get("context_count", 0)),
            embedding_dim=int(md.get("embedding_dim", 0)),
        )
    except Exception:
        return HealthOut(
            status="degraded",
            version=settings.app_version,
            artifacts_loaded_at=None,
            item_count=0,
            context_count=0,
            embedding_dim=0,
        )