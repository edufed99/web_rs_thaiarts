"""Tests for ``app.services.storage`` — MIME sniff, upload, delete.

Trivial unit tests over bytes and Paths. No DB or app needed.
"""
from __future__ import annotations

import io
import os
from pathlib import Path

import pytest
from fastapi import UploadFile

from app.core.config import IMGHDR_TO_MIME
from app.core.exceptions import InvalidRequestError
from app.services.storage import (
    delete_upload,
    save_upload,
    save_video_upload,
    sniff_mime,
    sniff_video_mime,
)


# Real magic-byte headers for the supported types. ``imghdr.what``
# reads these and returns the kind string.
JPEG_BYTES = bytes.fromhex(
    "ffd8ffe000104a46494600010100000100010000ffdb004300080606070605080707"
    "070909080a0c140d0c0b0b0c1912130f141d1a1f1e1d1a1c1c20242e2720222c231c1c2837292c30313434341f27393d38323c2e333432"
)
PNG_BYTES = b"\x89PNG\r\n\x1a\n" + b"\x00\x00\x00\r" + b"IHDR" + b"\x00" * 13
WEBP_BYTES = b"RIFF\x00\x00\x00\x00WEBPVP8 \x18\x00\x00\x000\x01\x00\x9d\x01\x2a\x01\x00\x01"
MP4_BYTES = b"\x00\x00\x00\x18ftypisom\x00\x00\x02\x00isommp41" + b"video-data"
WEBM_BYTES = b"\x1aE\xdf\xa3" + b"webm-data"


def _upload_from_bytes(data: bytes, content_type: str = "image/jpeg") -> UploadFile:
    """Wrap raw bytes in an ``UploadFile``-shaped object.

    The storage module only uses ``file.file.seek`` / ``file.file.read``
    / ``file.file.close`` and ``file.content_type``, so a SpooledTemporaryFile
    is the closest match to what FastAPI gives.
    """
    spool = io.BytesIO(data)
    # FastAPI's UploadFile wraps a SpooledTemporaryFile. Mimic just enough.
    return UploadFile(filename="test.bin", file=spool)


def test_sniff_mime_detects_jpeg_png_webp():
    assert sniff_mime(_upload_from_bytes(JPEG_BYTES)) == (IMGHDR_TO_MIME["jpeg"], ".jpg")
    assert sniff_mime(_upload_from_bytes(PNG_BYTES)) == (IMGHDR_TO_MIME["png"], ".png")
    assert sniff_mime(_upload_from_bytes(WEBP_BYTES)) == (IMGHDR_TO_MIME["webp"], ".webp")


def test_sniff_mime_returns_none_for_garbage():
    assert sniff_mime(_upload_from_bytes(b"not an image at all")) == (None, None)


def test_sniff_mime_returns_none_for_empty():
    assert sniff_mime(_upload_from_bytes(b"")) == (None, None)


def test_sniff_video_mime_detects_mp4_and_webm():
    assert sniff_video_mime(_upload_from_bytes(MP4_BYTES)) == ("video/mp4", ".mp4")
    assert sniff_video_mime(_upload_from_bytes(WEBM_BYTES)) == ("video/webm", ".webm")


def test_save_upload_writes_file_and_returns_url(tmp_path: Path):
    file = _upload_from_bytes(JPEG_BYTES)
    filename, url, size, mime = save_upload(
        file, tmp_path, prefix="item-1", max_bytes=10_000, allowed_mime={"image/jpeg"}
    )
    assert filename.endswith(".jpg")
    assert url == f"/uploads/items/{filename}"
    assert mime == "image/jpeg"
    assert size == len(JPEG_BYTES)
    assert (tmp_path / filename).read_bytes() == JPEG_BYTES


def test_save_upload_supports_profile_public_subdirectory(tmp_path: Path):
    filename, url, _, _ = save_upload(
        _upload_from_bytes(PNG_BYTES),
        tmp_path,
        prefix="user-7",
        max_bytes=10_000,
        allowed_mime={"image/png"},
        public_subdir="profiles",
    )
    assert url == f"/uploads/profiles/{filename}"


def test_save_upload_rejects_unknown_mime(tmp_path: Path):
    file = _upload_from_bytes(b"plain text disguised as jpeg")
    with pytest.raises(InvalidRequestError) as exc:
        save_upload(
            file, tmp_path, prefix="x", max_bytes=10_000, allowed_mime={"image/jpeg"}
        )
    assert exc.value.extra["code"] == "image_invalid_type"
    # Nothing was written.
    assert list(tmp_path.iterdir()) == []


def test_save_upload_size_limit_raises_and_unlinks(tmp_path: Path):
    file = _upload_from_bytes(JPEG_BYTES + b"x" * 500)
    with pytest.raises(InvalidRequestError) as exc:
        save_upload(
            file, tmp_path, prefix="x", max_bytes=100, allowed_mime={"image/jpeg"}
        )
    assert exc.value.extra["code"] == "image_too_large"
    # The half-written file must be unlinked, not left behind.
    assert list(tmp_path.iterdir()) == []


def test_save_video_upload_writes_mp4_and_returns_url(tmp_path: Path):
    filename, url, size, mime = save_video_upload(
        _upload_from_bytes(MP4_BYTES),
        tmp_path,
        prefix="item-1-video",
        max_bytes=10_000,
        allowed_mime={"video/mp4"},
    )
    assert filename.endswith(".mp4")
    assert url == f"/uploads/items/{filename}"
    assert mime == "video/mp4"
    assert size == len(MP4_BYTES)
    assert (tmp_path / filename).read_bytes() == MP4_BYTES


def test_save_video_upload_rejects_wrong_magic(tmp_path: Path):
    with pytest.raises(InvalidRequestError) as exc:
        save_video_upload(
            _upload_from_bytes(b"not a video"),
            tmp_path,
            prefix="video",
            max_bytes=10_000,
            allowed_mime={"video/mp4"},
        )
    assert exc.value.extra["code"] == "video_invalid_type"


def test_save_upload_strips_unsafe_prefix_characters(tmp_path: Path):
    """Pathological prefixes must not escape ``dest_dir``. The
    safe-prefix rule keeps only alnum + ``_`` + ``-``."""
    file = _upload_from_bytes(JPEG_BYTES)
    filename, _, _, _ = save_upload(
        file, tmp_path, prefix="../../etc/passwd", max_bytes=10_000,
        allowed_mime={"image/jpeg"},
    )
    # The filename should *not* contain slashes; the prefix is sanitised.
    assert "/" not in filename.replace(".jpg", "")


def test_delete_upload_removes_file(tmp_path: Path):
    (tmp_path / "items").mkdir()
    target = tmp_path / "items" / "x.jpg"
    target.write_bytes(b"x")
    assert delete_upload("/uploads/items/x.jpg", tmp_path) is True
    assert not target.exists()


def test_delete_upload_returns_false_for_unknown_prefix(tmp_path: Path):
    assert delete_upload("/some/other/path.jpg", tmp_path) is False


def test_delete_upload_blocks_path_traversal(tmp_path: Path):
    """``../`` style escape must be refused, not silently followed."""
    (tmp_path / "items").mkdir()
    # Resolve to a sibling of ``tmp_path`` — definitely outside ``upload_root``.
    secret = tmp_path.parent / "secret.txt"
    secret.write_text("pwned")
    try:
        result = delete_upload(f"/uploads/../{secret.name}", tmp_path)
    finally:
        if secret.exists():
            secret.unlink()
    assert result is False
    # The traversal target was not touched.
    assert not secret.exists()


def test_delete_upload_returns_false_for_missing_file(tmp_path: Path):
    (tmp_path / "items").mkdir()
    assert delete_upload("/uploads/items/does-not-exist.jpg", tmp_path) is False


def test_delete_upload_returns_false_for_empty_input(tmp_path: Path):
    assert delete_upload("", tmp_path) is False
