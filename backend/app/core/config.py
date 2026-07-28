"""
core/config.py — Centralized settings.

Reads from environment variables with the prefix ``RECSYS_``. All defaults
match the legacy Django project's behaviour so the new system produces
identical recommendations out of the box.

Env vars:
    RECSYS_ARTIFACT_DIR          Root of artifacts/ (default: ../artifacts relative to backend/)
    RECSYS_HYBRID_ALPHA          Float in [0, 1] — CBF weight in hybrid (default: 0.7)
    RECSYS_CBF_KEYWORD_BOOST     Float — additive boost when item keyword matches query (default: 0.05)
    RECSYS_ITEMKNN_K             Int — top-K neighbours for ItemKNN (default: 10)
    RECSYS_ITEMKNN_SHRINK        Float — shrinkage term in ItemKNN cosine (default: 50.0)
    RECSYS_POSITIVE_THRESHOLD    Int — minimum rating to count as positive (default: 4)
    RECSYS_RATING_FLOOR          Float — floor for normalized rating (default: 0.01)
    RECSYS_NEGATIVE_PENALTY_ALPHA Float — exponent on negative rating factor (default: 1.0)
    RECSYS_MIN_CANDS             Int — minimum candidate pool size (default: 10)
    RECSYS_MAX_CANDS             Int or "" — max candidates, "" means no cap (default: "")
    RECSYS_DEFAULT_TOP_K         Int — default top-K for /recommendations (default: 10)
    RECSYS_CORS_ORIGINS          Comma-separated CORS origins (default: http://localhost:3000)
"""
from __future__ import annotations

from pathlib import Path
from typing import List, Optional

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


def _default_artifact_dir() -> Path:
    """Locate artifacts/ by walking up from this file."""
    here = Path(__file__).resolve()
    for parent in here.parents:
        candidate = parent / "artifacts"
        if candidate.exists():
            return candidate
    # Fall back to <repo_root>/artifacts even if it doesn't exist yet —
    # the loader will raise a clear error on startup if files are missing.
    return here.parents[1] / "artifacts"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="RECSYS_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    artifact_dir: Path = Field(default_factory=_default_artifact_dir)
    hybrid_alpha: float = 0.7
    cbf_keyword_boost: float = 0.05
    itemknn_k: int = 10
    itemknn_shrink: float = 50.0
    positive_threshold: int = 4
    rating_floor: float = 0.01
    negative_penalty_alpha: float = 1.0
    min_cands: int = 10
    max_cands: Optional[int] = None  # None = no cap
    default_top_k: int = 10
    cors_origins: List[str] = Field(default_factory=lambda: ["http://localhost:3000"])
    app_version: str = "1.0.0"

    @field_validator("max_cands", mode="before")
    @classmethod
    def _parse_max_cands(cls, v):
        """Allow empty string from env to mean 'no cap'."""
        if v is None or v == "" or v == "all":
            return None
        return int(v)

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_cors(cls, v):
        if isinstance(v, str):
            return [origin.strip() for origin in v.split(",") if origin.strip()]
        return v

    @property
    def models_dir(self) -> Path:
        return self.artifact_dir / "models"

    @property
    def outputs_dir(self) -> Path:
        return self.artifact_dir / "outputs"


_settings: Optional[Settings] = None


def get_settings() -> Settings:
    """Lazy singleton. Imported by FastAPI Depends()."""
    global _settings
    if _settings is None:
        _settings = Settings()
    return _settings


def reset_settings_cache() -> None:
    """Test helper — drop the cached singleton so a fresh Settings() is built."""
    global _settings
    _settings = None