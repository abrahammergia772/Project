"""
BuildIQ — services/storage.py
Document storage. Uses Supabase Storage when configured, otherwise the local
filesystem, behind one interface so the router doesn't care which is active.

Bytes are stored and returned verbatim, so a downloaded file is always
byte-identical to what was uploaded.
"""
from __future__ import annotations

import logging
from pathlib import Path

from ..config import settings

log = logging.getLogger("buildiq.storage")

try:
    from supabase import create_client  # type: ignore
    _SDK_AVAILABLE = True
except Exception:                        # pragma: no cover
    create_client = None                 # type: ignore
    _SDK_AVAILABLE = False

_client = None


def _supabase():
    global _client
    if not settings.storage_ready or not _SDK_AVAILABLE:
        return None
    if _client is None:
        try:
            # Normalised: tolerates a pasted /rest/v1 URL (see Settings.supabase_base_url).
            _client = create_client(settings.supabase_base_url, settings.SUPABASE_SERVICE_KEY)
        except Exception as exc:         # pragma: no cover
            log.warning("Supabase Storage init failed, using local disk: %s", exc)
            return None
    return _client


def backend_name() -> str:
    return "supabase" if _supabase() is not None else "local"


def ensure_bucket() -> None:
    """Create the bucket on first run. Safe to call repeatedly."""
    client = _supabase()
    if client is None:
        Path(settings.UPLOAD_DIR).mkdir(parents=True, exist_ok=True)
        return
    try:
        buckets = {b.name for b in client.storage.list_buckets()}
        if settings.SUPABASE_BUCKET not in buckets:
            # Private bucket: downloads go through the API so permissions apply.
            client.storage.create_bucket(settings.SUPABASE_BUCKET, options={"public": False})
            log.info("Created Supabase bucket %s", settings.SUPABASE_BUCKET)
    except Exception as exc:             # pragma: no cover
        # Supabase raises objects whose str() is often just 'error', which
        # tells nobody anything. Log the target URL so a misconfigured
        # SUPABASE_URL is obvious from the log line alone.
        log.warning(
            "Could not verify Supabase bucket %r at %s: %s: %s",
            settings.SUPABASE_BUCKET, settings.supabase_base_url,
            type(exc).__name__, exc or "(no detail)",
        )
        if settings.supabase_url_had_service_path:
            log.warning(
                "SUPABASE_URL contains a service path (%s). Use the bare "
                "project URL: https://<project-ref>.supabase.co",
                settings.SUPABASE_URL,
            )
        log.warning("Falling back to local disk for uploads.")
        Path(settings.UPLOAD_DIR).mkdir(parents=True, exist_ok=True)


def upload(key: str, data: bytes, content_type: str) -> tuple[str, str]:
    """Store bytes. Returns (storage_key, backend)."""
    client = _supabase()
    if client is not None:
        try:
            client.storage.from_(settings.SUPABASE_BUCKET).upload(
                path=key,
                file=data,
                file_options={"content-type": content_type, "upsert": "true"},
            )
            return key, "supabase"
        except Exception as exc:
            log.warning("Supabase upload failed (%s) — falling back to local disk", exc)

    path = Path(settings.UPLOAD_DIR) / key
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return str(path), "local"


def download(storage_key: str, backend: str) -> bytes | None:
    if backend == "supabase":
        client = _supabase()
        if client is None:
            return None
        try:
            return client.storage.from_(settings.SUPABASE_BUCKET).download(storage_key)
        except Exception as exc:
            log.warning("Supabase download failed for %s: %s", storage_key, exc)
            return None

    path = Path(storage_key)
    return path.read_bytes() if path.exists() else None


def delete(storage_key: str, backend: str) -> None:
    if backend == "supabase":
        client = _supabase()
        if client is not None:
            try:
                client.storage.from_(settings.SUPABASE_BUCKET).remove([storage_key])
            except Exception as exc:
                log.warning("Supabase delete failed for %s: %s", storage_key, exc)
        return

    try:
        Path(storage_key).unlink(missing_ok=True)
    except OSError as exc:               # pragma: no cover
        log.warning("Local delete failed for %s: %s", storage_key, exc)
