"""
services/storage.py — User-uploaded media storage.

The recommender backend keeps uploaded media on the local filesystem under
``Settings.upload_dir`` (default ``data/uploads/``). The directory is
served by FastAPI's ``StaticFiles`` mount at ``/uploads`` (see
``main.py``). Every upload is validated against an allow-list of MIME
types — sniff from magic bytes via stdlib ``imghdr``, never trust the
client's declared ``Content-Type``.
"""
from __future__ import annotations

import imghdr
import io
import logging
import os
import uuid
from pathlib import Path
from typing import Optional, Tuple
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

from fastapi import UploadFile

from ..core.config import IMGHDR_TO_MIME, get_settings
from ..core.exceptions import InvalidRequestError
from ..models_db import User
from . import identity

logger = logging.getLogger("recsys.storage")


# How many bytes we read up-front to sniff the MIME type. 32 is enough
# to cover all magic-byte signatures for JPEG, PNG, and WebP.
_SNIFF_BYTES = 32

# Map sniff result → filename extension (with leading dot). Matched
# one-to-one with ``IMGHDR_TO_MIME`` so the file written to disk and the
# Content-Type served by ``StaticFiles`` agree.
_IMGHDR_TO_EXT = {
    "jpeg": ".jpg",
    "png": ".png",
    "webp": ".webp",
}

# Trusted hosts for Google profile photos, mirrored into local uploads.
_GOOGLE_AVATAR_HOSTS = {"lh3.googleusercontent.com"}


def is_allowed_remote_image_url(url: str, allowed_hosts: set[str]) -> bool:
    """Return whether an HTTPS image URL belongs to an explicitly trusted host."""
    parsed = urlparse((url or "").strip())
    return (
        parsed.scheme == "https"
        and parsed.hostname is not None
        and parsed.hostname.lower() in {host.lower() for host in allowed_hosts}
    )


def save_remote_image(
    url: str,
    dest_dir: Path,
    *,
    prefix: str,
    max_bytes: int,
    allowed_mime: set,
    allowed_hosts: set[str],
    public_subdir: str = "profiles",
) -> Tuple[str, str, int, str]:
    """Download a trusted remote image and store it as an ordinary upload.

    The host allow-list and size bound keep this helper unsuitable as a
    general-purpose URL fetcher. Google profile photos are mirrored locally so
    browsers never need to load a third-party image from the profile page.
    """
    if not is_allowed_remote_image_url(url, allowed_hosts):
        raise InvalidRequestError(
            "Remote image host is not allowed",
            extra={"code": "remote_image_host_not_allowed"},
        )
    request = Request(
        url,
        headers={"Accept": "image/*", "User-Agent": "ThaiPerform/1.0"},
    )
    try:
        with urlopen(request, timeout=10) as response:
            final_url = response.geturl()
            if not is_allowed_remote_image_url(final_url, allowed_hosts):
                raise InvalidRequestError(
                    "Remote image redirected to an untrusted host",
                    extra={"code": "remote_image_redirect_not_allowed"},
                )
            declared_size = response.headers.get("Content-Length")
            if declared_size and int(declared_size) > max_bytes:
                raise InvalidRequestError(
                    f"Image too large (max {max_bytes // (1024 * 1024)} MB)",
                    extra={"code": "image_too_large", "max_bytes": max_bytes},
                )
            payload = response.read(max_bytes + 1)
    except InvalidRequestError:
        raise
    except (HTTPError, URLError, OSError, TypeError, ValueError) as exc:
        raise InvalidRequestError(
            "Remote profile image could not be downloaded",
            extra={"code": "remote_image_download_failed"},
        ) from exc
    if len(payload) > max_bytes:
        raise InvalidRequestError(
            f"Image too large (max {max_bytes // (1024 * 1024)} MB)",
            extra={"code": "image_too_large", "max_bytes": max_bytes},
        )
    return save_upload(
        UploadFile(filename="remote-profile-image", file=io.BytesIO(payload)),
        dest_dir,
        prefix=prefix,
        max_bytes=max_bytes,
        allowed_mime=allowed_mime,
        public_subdir=public_subdir,
    )


def mirror_google_avatar(user: User, source_url: str) -> None:
    """Cache Google's profile photo unless the member chose a custom image."""
    if not source_url:
        return
    profile = identity.get_member_profile(int(user.id))
    if profile is None:
        return
    previous = str(profile.get("avatar_url") or "")
    if previous and not is_allowed_remote_image_url(
        previous, _GOOGLE_AVATAR_HOSTS
    ):
        return
    settings = get_settings()
    try:
        _filename, public_url, _size, _mime = save_remote_image(
            source_url,
            settings.upload_dir / "profiles",
            prefix=f"user-{int(user.id)}-google",
            max_bytes=settings.max_upload_bytes,
            allowed_mime=settings.allowed_upload_mime,
            allowed_hosts=_GOOGLE_AVATAR_HOSTS,
            public_subdir="profiles",
        )
        updated = identity.update_member_profile(
            int(user.id), avatar_url=public_url
        )
        if updated is None:
            delete_upload(public_url, settings.upload_dir)
            return
        if previous and previous != public_url:
            delete_upload(previous, settings.upload_dir)
    except InvalidRequestError as exc:
        logger.warning("Google avatar cache failed for user %s: %s", user.id, exc)


def sniff_mime(file: UploadFile) -> Tuple[Optional[str], Optional[str]]:
    """Read the first bytes of ``file`` and return ``(mime, extension)``.

    Returns ``(None, None)`` if the magic bytes don't match any allowed
    image format. The ``UploadFile`` is rewound so a downstream caller
    can re-read the body.
    """
    try:
        file.file.seek(0)
    except OSError:
        pass
    head = file.file.read(_SNIFF_BYTES)
    try:
        file.file.seek(0)
    except OSError:
        pass
    if not head:
        return None, None
    kind = imghdr.what(None, h=head)
    if not kind:
        return None, None
    mime = IMGHDR_TO_MIME.get(kind)
    ext = _IMGHDR_TO_EXT.get(kind)
    return mime, ext


def sniff_video_mime(file: UploadFile) -> Tuple[Optional[str], Optional[str]]:
    """Return a browser-playable video MIME and extension from magic bytes."""
    try:
        file.file.seek(0)
    except OSError:
        pass
    head = file.file.read(_SNIFF_BYTES)
    try:
        file.file.seek(0)
    except OSError:
        pass
    if len(head) >= 12 and head[4:8] == b"ftyp":
        if head[8:12] in {b"qt  ", b"qt\x00\x00"}:
            return "video/quicktime", ".mov"
        return "video/mp4", ".mp4"
    if head.startswith(b"\x1aE\xdf\xa3"):
        return "video/webm", ".webm"
    return None, None


def save_upload(
    file: UploadFile,
    dest_dir: Path,
    *,
    prefix: str,
    max_bytes: int,
    allowed_mime: set,
    public_subdir: str = "items",
) -> Tuple[str, str, int, str]:
    """Stream ``file`` to ``dest_dir`` after validating size + MIME.

    Returns ``(filename, public_url_path, size_bytes, mime)``. Raises
    :class:`InvalidRequestError` if the upload is too big or its magic
    bytes don't match the allow-list.

    ``prefix`` is prepended to the random filename so admins (and tests)
    can identify which row an upload belongs to — typically the
    ``artifact_item_id`` of the item the file was attached to.
    """
    mime, ext = sniff_mime(file)
    if mime is None or ext is None or mime not in allowed_mime:
        raise InvalidRequestError(
            "Image type not supported (allowed: JPEG, PNG, WebP)",
            extra={
                "code": "image_invalid_type",
                "declared_content_type": file.content_type or "",
            },
        )

    dest_dir.mkdir(parents=True, exist_ok=True)
    safe_prefix = "".join(ch for ch in str(prefix) if ch.isalnum() or ch in ("_", "-")) or "file"
    filename = f"{safe_prefix}_{uuid.uuid4().hex}{ext}"
    dest_path = dest_dir / filename

    written = 0
    try:
        with open(dest_path, "wb") as out:
            while True:
                chunk = file.file.read(64 * 1024)
                if not chunk:
                    break
                written += len(chunk)
                if written > max_bytes:
                    out.close()
                    try:
                        dest_path.unlink()
                    except OSError:
                        pass
                    raise InvalidRequestError(
                        f"Image too large (max {max_bytes // (1024 * 1024)} MB)",
                        extra={
                            "code": "image_too_large",
                            "max_bytes": max_bytes,
                        },
                    )
                out.write(chunk)
    finally:
        try:
            file.file.close()
        except OSError:
            pass

    safe_subdir = "".join(ch for ch in str(public_subdir) if ch.isalnum() or ch in ("_", "-")) or "items"
    public_url = f"/uploads/{safe_subdir}/{filename}"
    logger.info(
        "stored upload prefix=%s filename=%s mime=%s size=%d",
        safe_prefix, filename, mime, written,
    )
    return filename, public_url, written, mime


def save_video_upload(
    file: UploadFile,
    dest_dir: Path,
    *,
    prefix: str,
    max_bytes: int,
    allowed_mime: set,
    public_subdir: str = "items",
) -> Tuple[str, str, int, str]:
    """Stream an MP4/WebM/MOV upload after validating magic bytes and size."""
    mime, ext = sniff_video_mime(file)
    if mime is None or ext is None or mime not in allowed_mime:
        raise InvalidRequestError(
            "Video type not supported (allowed: MP4, WebM, MOV)",
            extra={
                "code": "video_invalid_type",
                "declared_content_type": file.content_type or "",
            },
        )

    dest_dir.mkdir(parents=True, exist_ok=True)
    safe_prefix = "".join(ch for ch in str(prefix) if ch.isalnum() or ch in ("_", "-")) or "file"
    filename = f"{safe_prefix}_{uuid.uuid4().hex}{ext}"
    dest_path = dest_dir / filename

    written = 0
    try:
        with open(dest_path, "wb") as out:
            while True:
                chunk = file.file.read(64 * 1024)
                if not chunk:
                    break
                written += len(chunk)
                if written > max_bytes:
                    out.close()
                    try:
                        dest_path.unlink()
                    except OSError:
                        pass
                    raise InvalidRequestError(
                        f"Video too large (max {max_bytes // (1024 * 1024)} MB)",
                        extra={"code": "video_too_large", "max_bytes": max_bytes},
                    )
                out.write(chunk)
    finally:
        try:
            file.file.close()
        except OSError:
            pass

    safe_subdir = "".join(ch for ch in str(public_subdir) if ch.isalnum() or ch in ("_", "-")) or "items"
    public_url = f"/uploads/{safe_subdir}/{filename}"
    logger.info(
        "stored video upload prefix=%s filename=%s mime=%s size=%d",
        safe_prefix, filename, mime, written,
    )
    return filename, public_url, written, mime


def delete_upload(public_url_path: str, upload_root: Path) -> bool:
    """Best-effort delete of a previously-uploaded file.

    Only deletes paths that look like they live under
    ``upload_root/items/`` — refuses anything that smells of a
    path-traversal attempt.
    """
    if not public_url_path:
        return False
    prefix = "/uploads/"
    if not public_url_path.startswith(prefix):
        return False
    rel = public_url_path[len(prefix):].lstrip("/")
    # Resolve to absolute, then verify the resolved path is still under
    # upload_root — guards against ``..`` traversal.
    target = (upload_root / rel).resolve()
    root = upload_root.resolve()
    try:
        target.relative_to(root)
    except ValueError:
        return False
    try:
        os.remove(target)
        return True
    except OSError as exc:
        logger.warning("delete_upload failed for %s: %s", target, exc)
        return False
