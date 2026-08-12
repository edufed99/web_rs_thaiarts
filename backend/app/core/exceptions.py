"""
core/exceptions.py — Domain exceptions and FastAPI handlers.

Every domain error carries a stable ``code`` string so the frontend can branch
on it without parsing English error messages. Handlers convert each exception
into a JSON response shaped ``{"error": {"code", "message"}}``.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, Optional

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse


logger = logging.getLogger("recsys.exceptions")


class DomainError(Exception):
    """Base class for all errors raised by this backend."""

    status_code: int = 400
    code: str = "bad_request"

    def __init__(self, message: str, *, extra: Optional[Dict[str, Any]] = None):
        super().__init__(message)
        self.message = message
        self.extra = extra or {}


class ArtifactsNotLoadedError(DomainError):
    """Raised when the artifact loader cannot find/parse required files."""

    status_code = 503
    code = "artifacts_not_loaded"


class EmbeddingBackendUnavailableError(DomainError):
    """Raised when strict research inference cannot use the real E5 model."""

    status_code = 503
    code = "embedding_backend_unavailable"


class InvalidRequestError(DomainError):
    """Raised when request data passes Pydantic but violates a business rule."""

    status_code = 400
    code = "invalid_request"


class ContextNotFoundError(DomainError):
    status_code = 404
    code = "context_not_found"


class ItemNotFoundError(DomainError):
    status_code = 404
    code = "item_not_found"


class KeywordNotFoundError(DomainError):
    status_code = 404
    code = "keyword_not_found"


class InvalidActionError(DomainError):
    """Raised when a /actions/* payload is malformed (unknown action, rating out of range)."""

    status_code = 400
    code = "invalid_action"


class DbDisabledError(DomainError):
    """Raised when an action requires the DB layer but RECSYS_DB_ENABLED=0."""

    status_code = 503
    code = "db_disabled"


class AuthError(DomainError):
    """Raised when authentication is missing / invalid / expired.

    Maps to HTTP 401. Carries ``code="unauthorized"`` by default; specific
    subclasses (or callers) can override the code via the constructor.
    """

    status_code = 401
    code = "unauthorized"


class ForbiddenError(DomainError):
    """Raised when an authenticated user lacks the required role.

    Maps to HTTP 403. Used by ``Depends(get_current_admin)``.
    """

    status_code = 403
    code = "forbidden"


def _payload(code: str, message: str, extra: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    body: Dict[str, Any] = {"code": code, "message": message}
    if extra:
        body.update(extra)
    return {"error": body}


def register_exception_handlers(app: FastAPI) -> None:
    """Attach all domain handlers to a FastAPI app."""

    @app.exception_handler(DomainError)
    async def _domain_handler(_request: Request, exc: DomainError):  # type: ignore[unused-ignore]
        return JSONResponse(
            status_code=exc.status_code,
            content=_payload(exc.code, exc.message, exc.extra),
        )

    @app.exception_handler(RequestValidationError)
    async def _validation_handler(_request: Request, exc: RequestValidationError):
        # Flatten Pydantic errors into a readable summary. We coerce error
        # contexts to strings because some contexts contain non-JSON types
        # (e.g. ValueError instances raised by validators).
        errors = []
        for err in exc.errors():
            ctx = err.get("ctx")
            ctx_str = {k: str(v) for k, v in ctx.items()} if isinstance(ctx, dict) else None
            errors.append({
                "loc": list(err.get("loc", [])),
                "msg": str(err.get("msg", "")),
                "type": str(err.get("type", "")),
                "ctx": ctx_str,
            })
        first = errors[0] if errors else {}
        loc = ".".join(str(p) for p in first.get("loc", []))
        msg = first.get("msg", "Invalid request")
        message = f"{loc}: {msg}" if loc else msg
        return JSONResponse(
            status_code=422,
            content=_payload(
                "validation_error",
                message,
                {"errors": errors},
            ),
        )

    @app.exception_handler(Exception)
    async def _unexpected_handler(_request: Request, exc: Exception):
        """Keep unexpected failures observable to cross-origin clients.

        Without an application-level response, Starlette's outer server-error
        middleware can emit a bare 500 without CORS headers. Browsers then hide
        the response and surface only ``TypeError: Failed to fetch``.
        """
        logger.exception("Unhandled API error", exc_info=exc)
        return JSONResponse(
            status_code=500,
            content=_payload(
                "internal_server_error",
                "The server could not complete this request.",
            ),
        )
