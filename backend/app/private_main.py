"""ASGI entry point for the database-free Private Model Service."""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

from . import __version__
from .core.config import get_settings, settings_with_artifact_config
from .core.exceptions import ArtifactsNotLoadedError, register_exception_handlers
from .model_loader import ArtifactLoader, set_singleton
from .routers import private_model
from .services.embedding import preload_model


logger = logging.getLogger("recsys.private_model")


@asynccontextmanager
async def private_model_lifespan(_app: FastAPI):
    """Load immutable artifacts only; no database or Media Store setup."""
    settings = get_settings()
    loader = ArtifactLoader()
    try:
        loader.load(settings.artifact_dir)
        set_singleton(loader)
        effective = settings_with_artifact_config(settings, loader.best_model_config)
        if effective.preload_e5 and int(loader.embeddings.shape[1]) == 1024:
            preload_model()
        logger.info("Private model artifacts loaded: %d items", len(loader.item_ids))
    except ArtifactsNotLoadedError:
        logger.exception("Private Model Service artifacts failed to load")
        raise
    yield


def create_private_model_app() -> FastAPI:
    """Build the isolated app with only versioned, authenticated model routes."""
    app = FastAPI(
        title="Thai Arts Private Model Service",
        version=__version__,
        lifespan=private_model_lifespan,
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )
    register_exception_handlers(app)
    app.include_router(private_model.router)
    return app


app = create_private_model_app()
