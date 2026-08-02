"""Short-lived cache for expensive AI calls.

The executive summary sits at the top of every role dashboard, so it is
requested on every page load, by every user, and it costs a full LLM round
trip each time. The underlying facts change on the order of minutes, not
milliseconds, so recomputing per request buys nothing and burns quota.

Design notes
------------
* Keys MUST include the caller's scope. Two users see different projects, so
  a cache keyed only on the endpoint would serve a Department Manager the
  Super Admin's briefing -- a data leak dressed up as a performance win. The
  key here is built from the role, department and a digest of the facts that
  were actually fed to the model.
* Only successful LLM responses are cached. Caching the heuristic fallback
  would pin the degraded answer in place for the whole TTL even after the
  provider recovers.
* In-process and per-instance, like the rate limiter. Fine for a single
  Render service; with several instances each keeps its own copy, which
  costs a little more quota but is never incorrect.
"""
from __future__ import annotations

import hashlib
import threading
import time
from typing import Any

DEFAULT_TTL = 90            # seconds
MAX_ENTRIES = 512           # bounded so a long uptime cannot grow without limit

_store: dict[str, tuple[float, Any]] = {}
_lock = threading.Lock()
_hits = 0
_misses = 0


def make_key(*parts: Any) -> str:
    """Build a cache key from arbitrary parts.

    Hashed rather than concatenated because the parts include the fact block,
    which can be long and contains project names.
    """
    raw = "\x1f".join(str(p) for p in parts)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def get(key: str) -> Any | None:
    global _hits, _misses
    now = time.monotonic()
    with _lock:
        entry = _store.get(key)
        if entry is None:
            _misses += 1
            return None
        expires, value = entry
        if now >= expires:
            _store.pop(key, None)
            _misses += 1
            return None
        _hits += 1
        return value


def set(key: str, value: Any, ttl: int = DEFAULT_TTL) -> None:
    if value is None:
        return                       # never cache a failure
    now = time.monotonic()
    with _lock:
        if len(_store) >= MAX_ENTRIES:
            # Drop expired entries first; if that frees nothing, evict the
            # entry closest to expiry. Simple and adequate at this size.
            dead = [k for k, (exp, _) in _store.items() if exp <= now]
            for k in dead:
                _store.pop(k, None)
            if len(_store) >= MAX_ENTRIES:
                oldest = min(_store, key=lambda k: _store[k][0])
                _store.pop(oldest, None)
        _store[key] = (now + ttl, value)


def clear() -> None:
    """Test hook, and usable from a future admin endpoint."""
    global _hits, _misses
    with _lock:
        _store.clear()
        _hits = _misses = 0


def stats() -> dict:
    with _lock:
        total = _hits + _misses
        return {
            "entries": len(_store),
            "hits": _hits,
            "misses": _misses,
            "hit_rate": round(_hits / total, 3) if total else 0.0,
        }
