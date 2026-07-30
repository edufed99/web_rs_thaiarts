"""
main.py — FastAPI application entry point.

Run:
    uvicorn app.main:app --reload --port 8080

Endpoints:
    GET  /health              (health router)
    POST /recommendations     (recommendations router)
    GET  /items, /items/{id}  (catalog router)
    GET  /contexts, /keywords, /metrics  (metrics router)
    GET  /docs, /redoc, /openapi.json   (FastAPI built-ins)
"""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from . import __version__
from .core.config import get_settings
from .core.exceptions import (
    ArtifactsNotLoadedError,
    register_exception_handlers,
)
from .model_loader import ArtifactLoader, set_singleton
from .routers import actions, admin, auth, catalog, health, legacy, metrics, recommendations

logger = logging.getLogger("recsys")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Load artifacts once at startup. If anything fails, /health returns 503
    but the app still mounts so /docs remains reachable."""
    settings = get_settings()
    # Ensure the upload directory exists so the very first image upload
    # doesn't 404 — the StaticFiles mount below refuses to start on a
    # missing path.
    upload_items = settings.upload_dir / "items"
    try:
        upload_items.mkdir(parents=True, exist_ok=True)
        logger.info("Upload directory ready: %s", upload_items)
    except OSError as exc:  # noqa: BLE001 - logged, not fatal
        logger.warning("Could not prepare upload directory %s: %s", upload_items, exc)

    loader = ArtifactLoader()
    try:
        loader.load(settings.artifact_dir)
        set_singleton(loader)
        logger.info(
            "Artifacts loaded: %d items, %d embeddings, root=%s",
            len(loader.item_ids),
            int(loader.metadata.get("embedding_dim", 0)),
            settings.artifact_dir,
        )
    except ArtifactsNotLoadedError as exc:
        logger.error("Artifacts NOT loaded: %s", exc)
        # Leave singleton unset; routers will surface 503 via /health.
    except Exception as exc:  # noqa: BLE001
        logger.exception("Unexpected error loading artifacts: %s", exc)

    yield

    # No teardown needed — everything is in-process.


def create_app() -> FastAPI:
    settings = get_settings()

    app = FastAPI(
        title="Thai Arts Recommender API",
        version=__version__,
        description=(
            "REST API for the Thai performing-arts recommender. The backend "
            "loads pre-built artifacts (embeddings, CF index, catalog) at "
            "startup and serves recommendations in milliseconds. See "
            "`/docs` for the Swagger UI."
        ),
        lifespan=lifespan,
    )

    # CORS — frontend dev server runs on http://localhost:3000 by default
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins_list,
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Domain exception handlers
    register_exception_handlers(app)

    # Routers
    app.include_router(health.router)
    app.include_router(recommendations.router)
    app.include_router(catalog.router)
    app.include_router(metrics.router)
    app.include_router(legacy.router)
    app.include_router(actions.router)
    app.include_router(auth.router)
    app.include_router(admin.router)

    # Static mount for user-uploaded media (cover images for catalog
    # items). The directory is created in ``lifespan`` so the mount
    # doesn't fail on a fresh checkout.
    app.mount(
        "/uploads",
        StaticFiles(directory=str(settings.upload_dir), check_dir=False),
        name="uploads",
    )

    return app


app = create_app()