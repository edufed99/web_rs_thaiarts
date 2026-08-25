"""Authenticated, versioned HTTP interface for the Private Model Service."""
from __future__ import annotations

import secrets

from fastapi import APIRouter, Depends, Header

from ..core.config import Settings, get_settings
from ..core.exceptions import (
    InternalServiceNotConfiguredError,
    InvalidInternalServiceCredentialError,
)
from ..model_loader import ArtifactLoader, get_singleton
from ..schemas.inference import (
    ArtifactRebuildRequest,
    ArtifactRebuildResponse,
    InferenceRequest,
    InferenceResponse,
    PrivateHealthResponse,
    SimilarityRequest,
    SimilarityResponse,
)
from ..services.artifact_rebuild import rebuild_artifacts
from ..services.model_inference import score_inference
from ..services.model_similarity import rank_similar_items


def require_internal_service_credential(
    authorization: str | None = Header(default=None),
    settings: Settings = Depends(get_settings),
) -> None:
    expected = settings.internal_service_secret
    if not expected:
        raise InternalServiceNotConfiguredError(
            "The Private Model Service credential is not configured."
        )
    scheme, separator, credential = (authorization or "").partition(" ")
    valid = (
        bool(separator)
        and scheme.lower() == "bearer"
        and bool(credential)
        and secrets.compare_digest(credential, expected)
    )
    if not valid:
        raise InvalidInternalServiceCredentialError(
            "Missing or invalid Internal Service Credential."
        )


router = APIRouter(
    prefix="/internal/v1",
    tags=["private-model-v1"],
    dependencies=[Depends(require_internal_service_credential)],
)


@router.get("/health", response_model=PrivateHealthResponse)
def private_health(loader: ArtifactLoader = Depends(get_singleton)) -> PrivateHealthResponse:
    metadata = loader.metadata
    return PrivateHealthResponse(
        status="ok",
        artifact_version=str(metadata.get("schema_version") or "unknown"),
        artifact_item_count=len(loader.item_ids),
    )


@router.post("/inference", response_model=InferenceResponse)
def inference(
    request: InferenceRequest,
    loader: ArtifactLoader = Depends(get_singleton),
    settings: Settings = Depends(get_settings),
) -> InferenceResponse:
    return score_inference(loader, request, settings)


@router.post("/similarity", response_model=SimilarityResponse)
def similarity(
    request: SimilarityRequest,
    loader: ArtifactLoader = Depends(get_singleton),
) -> SimilarityResponse:
    return rank_similar_items(loader, request)


@router.post("/artifacts/rebuild", response_model=ArtifactRebuildResponse)
def rebuild(
    request: ArtifactRebuildRequest,
    loader: ArtifactLoader = Depends(get_singleton),
    settings: Settings = Depends(get_settings),
) -> ArtifactRebuildResponse:
    return rebuild_artifacts(loader, request, settings)

