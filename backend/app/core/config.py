"""
core/config.py — Centralized settings.

Reads from environment variables with the prefix ``RECSYS_``. All defaults
match the behaviour of the legacy Django prototype at
``../web_appRS/thai_arts_webapp/`` (read-only reference; this project does
not run Django) so the new system produces identical recommendations out of
the box.

Env vars:
    RECSYS_ARTIFACT_DIR          Root of artifacts/ (default: ../artifacts relative to backend/)
    RECSYS_HYBRID_ALPHA          Float in [0, 1] — CBF weight in hybrid (default: 0.7)
    RECSYS_CBF_KEYWORD_BOOST     Float — additive boost when item keyword matches query (default: 0.05)
    RECSYS_ITEMKNN_K             Int — top-K neighbours for ItemKNN (default: 10)
    RECSYS_ITEMKNN_SHRINK        Float — shrinkage term in ItemKNN cosine (default: 50.0)
    RECSYS_POSITIVE_THRESHOLD    Int — minimum rating to count as positive (default: 4)
    RECSYS_RATING_FLOOR          Float — floor for normalized rating (default: 0.01)
    RECSYS_NEGATIVE_PENALTY_ALPHA Float — additive negative-rating penalty strength (default: 1.0; legacy env name)
    RECSYS_MIN_CANDS             Int — minimum candidate pool size (default: 10)
    RECSYS_MAX_CANDS             Int or "" — max candidates, "" means no cap (default: "")
    RECSYS_DEFAULT_TOP_K         Int — default top-K for /recommendations (default: 10)
    RECSYS_CORS_ORIGINS          Comma-separated CORS origins (default: http://localhost:3000)
"""
from __future__ import annotations

import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Set

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


# Skip the local ``.env`` file when pytest is running so unit tests get
# pure defaults (no admin allow-list, default JWT secret, Layer B off).
# Production / dev still load ``.env`` via pydantic-settings.
_ENV_FILE = None if "pytest" in sys.modules else ".env"


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


def _default_upload_dir() -> Path:
    """Locate the runtime upload directory.

    Kept separate from ``artifacts/`` (which the offline recommender
    pipeline owns and the legacy project treats as regenerated build
    output — see ``CLAUDE.md`` §architecture-invariants). Uploaded
    media is user-generated and must persist across pipeline re-runs.
    """
    return Path(__file__).resolve().parents[2] / "data" / "uploads"


def _default_gmail_oauth_token_file() -> Path:
    """Private local token store used after the one-time Gmail consent flow."""
    return Path(__file__).resolve().parents[2] / "data" / "secrets" / "gmail_oauth_token.json"


def _default_google_login_client_file() -> Path:
    """Private Google OAuth client used only for member sign-in."""
    return Path(__file__).resolve().parents[2] / "data" / "secrets" / "google_login_client.json"


# Magic-byte MIME → canonical Content-Type mapping. ``imghdr.what``
# returns strings like ``"jpeg"`` / ``"png"`` / ``"webp"`` that we
# normalize for client consumption.
IMGHDR_TO_MIME: Dict[str, str] = {
    "jpeg": "image/jpeg",
    "png": "image/png",
    "webp": "image/webp",
}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="RECSYS_",
        env_file=_ENV_FILE,
        env_file_encoding="utf-8",
        extra="ignore",
    )

    artifact_dir: Path = Field(default_factory=_default_artifact_dir)
    upload_dir: Path = Field(default_factory=_default_upload_dir)
    # 5 MB upload cap — generous for a 4K phone snapshot, small enough to
    # keep request bodies bounded and to fit comfortably in process memory
    # while streaming.
    max_upload_bytes: int = 5 * 1024 * 1024
    # Only formats browsers render natively without plugins.
    allowed_upload_mime: Set[str] = Field(
        default_factory=lambda: {"image/jpeg", "image/png", "image/webp"}
    )
    # Video uploads are streamed to disk and receive their own larger cap.
    max_video_upload_bytes: int = 100 * 1024 * 1024
    allowed_video_upload_mime: Set[str] = Field(
        default_factory=lambda: {"video/mp4", "video/webm", "video/quicktime"}
    )
    hybrid_alpha: float = 0.7
    cbf_keyword_boost: float = 0.05
    itemknn_k: int = 10
    itemknn_shrink: float = 50.0
    positive_threshold: int = 4
    rating_floor: float = 0.01
    # Retain the historical env/field name for deployment compatibility.  The
    # value is now the additive monotonic penalty strength, not an exponent.
    negative_penalty_alpha: float = 1.0
    min_cands: int = 10
    max_cands: Optional[int] = None  # None = no cap
    default_top_k: int = 10
    recommendation_method: str = "Hybrid-WeightedSum"
    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000"
    app_version: str = "1.0.0"
    # Shared only by the Application Backend and Private Model Service.
    # There is deliberately no code default: an unset credential makes the
    # private contract unavailable instead of silently weakening auth.
    internal_service_secret: str = ""
    db_enabled: bool = True
    database_url: str = "postgresql+psycopg://postgres:postgres@127.0.0.1:5432/web_rs_thaiarts"

    # Auth (admin slice — see ADR §11.1)
    jwt_secret: str = "dev-only-change-me"
    jwt_expiry_days: int = 7
    admin_usernames: str = ""
    password_reset_token_minutes: int = 30
    frontend_base_url: str = "http://localhost:3000"

    # SMTP credentials are intentionally environment-only. Gmail requires an
    # App Password or OAuth token; never put a personal mailbox password here.
    smtp_host: str = "smtp.gmail.com"
    smtp_port: int = 587
    smtp_username: str = ""
    smtp_password: str = ""
    smtp_from_email: str = ""
    smtp_use_tls: bool = True

    # Gmail API OAuth. For local development the downloaded Google client
    # JSON may be referenced by path. Production should inject the client ID,
    # client secret and refresh token through its secret manager instead.
    gmail_oauth_client_file: Optional[Path] = None
    gmail_oauth_client_id: str = ""
    gmail_oauth_client_secret: str = ""
    gmail_oauth_refresh_token: str = ""
    gmail_oauth_redirect_uri: str = "http://localhost:8001/auth/google/callback"
    gmail_oauth_token_file: Path = Field(default_factory=_default_gmail_oauth_token_file)
    gmail_sender_email: str = "dpatt148@gmail.com"

    # Member Google sign-in is deliberately isolated from the Gmail sender
    # OAuth client above. It requests only OpenID profile/email scopes and
    # never receives permission to read or send mail.
    google_login_client_file: Optional[Path] = Field(
        default_factory=_default_google_login_client_file
    )
    google_login_client_id: str = ""
    google_login_client_secret: str = ""
    google_login_redirect_uri: str = "http://localhost:8001/auth/google/login/callback"
    google_login_state_ttl_seconds: int = 600
    google_login_code_ttl_seconds: int = 120

    # Live ingest (see ADR §3 — runtime embedding exception)
    e5_model_name: str = "intfloat/multilingual-e5-large-instruct"
    e5_max_length: int = 512
    e5_local_path: Optional[Path] = None
    e5_enabled: bool = True
    # Research serving must reproduce the offline E5 experiment.  When this
    # switch is on, an unavailable/incompatible E5 encoder is a 503 error;
    # the deterministic proxy is never used silently.
    research_mode: bool = False
    # Load E5 during application lifespan so the first participant does not
    # pay model-load latency.  Kept opt-in for lightweight test/dev fixtures.
    preload_e5: bool = False

    # Popularity telemetry (see ADR-002 §3)
    # Dedupe window for item_view: a second view of the same item by the same
    # user inside this many minutes is a no-op, so page refreshes don't
    # inflate the count.
    view_dedupe_minutes: int = 30
    # An item needs at least this many impressions before its CTR is
    # considered meaningful; below the floor `ctr` is None (not 0.0) so a
    # single lucky click can't top the ranking.
    ctr_impression_floor: int = 20

    # Layer B (LLM assist — Gemini per paper)
    gemini_api_key: str = ""
    gemini_model: str = "gemini-3-flash-preview"
    grounding_use_llm: bool = True
    analytics_use_llm: bool = True
    analytics_cache_seconds: int = 600

    @field_validator("max_cands", mode="before")
    @classmethod
    def _parse_max_cands(cls, v):
        """Allow empty string from env to mean 'no cap'."""
        if v is None or v == "" or v == "all":
            return None
        return int(v)

    @field_validator("cors_origins", "admin_usernames", mode="before")
    @classmethod
    def _normalize_csv(cls, v):
        """Accept strings (preferred) and lists (legacy test fixtures).

        Strings are normalized to comma-separated strings; lists are
        comma-joined. Downstream callers should use the ``*_list`` properties
        which re-split on demand.
        """
        if isinstance(v, str):
            return ",".join(o.strip() for o in v.split(",") if o.strip())
        if isinstance(v, list):
            return ",".join(str(o).strip() for o in v if str(o).strip())
        return v

    @property
    def cors_origins_list(self) -> List[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def admin_usernames_list(self) -> List[str]:
        return [n.strip() for n in self.admin_usernames.split(",") if n.strip()]

    @property
    def models_dir(self) -> Path:
        return self.artifact_dir / "models"

    @property
    def outputs_dir(self) -> Path:
        return self.artifact_dir / "outputs"


def settings_with_artifact_config(settings: Settings, manifest: dict[str, Any]) -> Settings:
    """Return settings overridden by an optional best-model artifact manifest.

    Environment/default settings remain the fallback. Only recognized serving
    fields from ``selected_model`` are copied, so malformed or incomplete
    manifests cannot break startup.
    """
    selected = manifest.get("selected_model") if isinstance(manifest, dict) else None
    if not isinstance(selected, dict):
        return settings

    overrides: dict[str, Any] = {}
    _copy_float(selected, overrides, "hybrid_alpha", "hybrid_alpha")
    _copy_float(selected, overrides, "cbf_keyword_boost", "cbf_keyword_boost")
    _copy_float(selected, overrides, "itemknn_shrink", "itemknn_shrink")
    _copy_int(selected, overrides, "itemknn_k", "itemknn_k")
    _copy_int(selected, overrides, "max_cands", "max_cands", allow_none=True)
    _copy_int(selected, overrides, "top_k", "default_top_k")

    cbf_model = selected.get("cbf_model")
    if isinstance(cbf_model, str) and cbf_model.strip():
        overrides["e5_model_name"] = cbf_model.strip()

    method = selected.get("method")
    if isinstance(method, str) and method.strip():
        overrides["recommendation_method"] = method.strip()
    else:
        hybrid_method = selected.get("hybrid_method")
        if isinstance(hybrid_method, str) and hybrid_method.strip():
            overrides["recommendation_method"] = f"Hybrid-{hybrid_method.strip()}"

    return settings.model_copy(update=overrides) if overrides else settings


def _copy_float(source: dict[str, Any], target: dict[str, Any], key: str, field: str) -> None:
    if key not in source or source[key] is None:
        return
    try:
        target[field] = float(source[key])
    except (TypeError, ValueError):
        return


def _copy_int(
    source: dict[str, Any],
    target: dict[str, Any],
    key: str,
    field: str,
    *,
    allow_none: bool = False,
) -> None:
    if key not in source:
        return
    value = source[key]
    if value is None and allow_none:
        target[field] = None
        return
    try:
        target[field] = int(value)
    except (TypeError, ValueError):
        return


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
