"""Version 1 contract for database-free model inference."""
from __future__ import annotations

from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, field_validator


ArtifactItemId = Annotated[int, Field(gt=0)]


class PositiveHistoryInput(BaseModel):
    """One live positive interaction, already mapped into artifact ID space."""

    model_config = ConfigDict(extra="forbid")

    artifact_item_id: ArtifactItemId
    rating_weight: float = Field(default=1.0, gt=0.0, le=1.0)


class NegativeRatingInput(BaseModel):
    """One live explicit negative rating, already mapped to an artifact ID."""

    model_config = ConfigDict(extra="forbid")

    artifact_item_id: ArtifactItemId
    rating: int = Field(ge=1, le=3)


class PersonalizationInputs(BaseModel):
    """Live application state needed by the artifact scorer."""

    model_config = ConfigDict(extra="forbid")

    context_name: str = Field(default="", max_length=300)
    keyword_names: list[str] = Field(default_factory=list, max_length=200)
    positive_history: list[PositiveHistoryInput] = Field(default_factory=list, max_length=500)
    negative_ratings: list[NegativeRatingInput] = Field(default_factory=list, max_length=500)

    @field_validator("keyword_names")
    @classmethod
    def validate_keyword_names(cls, values: list[str]) -> list[str]:
        normalized = [value.strip() for value in values]
        if any(not value for value in normalized):
            raise ValueError("keyword_names must not contain blank values")
        if len(set(normalized)) != len(normalized):
            raise ValueError("keyword_names must be unique")
        return normalized

    @field_validator("positive_history", "negative_ratings")
    @classmethod
    def validate_unique_item_ids(cls, values: list) -> list:
        item_ids = [value.artifact_item_id for value in values]
        if len(set(item_ids)) != len(item_ids):
            raise ValueError("personalization item identifiers must be unique")
        return values


class InferenceRequest(BaseModel):
    """Complete internal request assembled by the Application Backend."""

    model_config = ConfigDict(extra="forbid")

    eligible_candidate_ids: list[ArtifactItemId] = Field(min_length=1, max_length=1000)
    personalization: PersonalizationInputs = Field(default_factory=PersonalizationInputs)
    top_k: int = Field(default=10, ge=1, le=50)

    @field_validator("eligible_candidate_ids")
    @classmethod
    def validate_candidate_set(cls, values: list[int]) -> list[int]:
        if len(set(values)) != len(values):
            raise ValueError("eligible_candidate_ids must be unique")
        return values


class InferenceScores(BaseModel):
    """The model components and the final score used for ordering."""

    model_config = ConfigDict(extra="forbid")

    cbf: float
    cf: float
    final: float


class RankedCandidate(BaseModel):
    """An artifact identity and scores; application enrichment is excluded."""

    model_config = ConfigDict(extra="forbid")

    artifact_item_id: ArtifactItemId
    scores: InferenceScores


class InferenceResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ranked_candidates: list[RankedCandidate]


class PrivateHealthResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: str
    artifact_version: str
    artifact_item_count: int = Field(ge=0)
