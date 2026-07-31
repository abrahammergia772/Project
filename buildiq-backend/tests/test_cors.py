"""CORS hardening.

A live deploy was found echoing back ANY Origin together with
Access-Control-Allow-Credentials: true. That combination is worse than a plain
wildcard: any site a signed-in user visits could call the API with their
credentials. These tests pin the corrected behaviour.
"""
import importlib
import os
import sys

import pytest

GOOD = "https://buildiq-frontend.onrender.com"
EVIL = "https://evil-attacker.example.com"


def _client(cors_origins: str):
    """Rebuild the app with a specific CORS_ORIGINS (middleware is set at import)."""
    for mod in [m for m in list(sys.modules) if m.startswith("app")]:
        del sys.modules[mod]
    os.environ["CORS_ORIGINS"] = cors_origins
    os.environ["SECRET_KEY"] = "test-secret-key"
    os.environ["DATABASE_URL"] = "sqlite:///./test_cors.db"
    os.environ["SEED_ON_STARTUP"] = "false"
    from fastapi.testclient import TestClient
    main = importlib.import_module("app.main")
    return TestClient(main.app)


def _preflight(client, origin):
    return client.options("/auth/login", headers={
        "Origin": origin, "Access-Control-Request-Method": "POST"})


@pytest.fixture(autouse=True)
def _restore_app_modules():
    """Put the original app.* modules back after each test.

    CORS middleware is configured at import time, so these tests must reimport
    the app under different settings. Simply deleting app.* from sys.modules
    leaves other suites holding stale module objects -- test_groq monkeypatches
    app.services.groq_service and its patches then apply to an orphaned copy,
    which made two unrelated tests fail. Snapshot and restore instead.
    """
    saved = {m: sys.modules[m] for m in list(sys.modules) if m.startswith("app")}
    saved_env = {k: os.environ.get(k)
                 for k in ("CORS_ORIGINS", "SECRET_KEY", "DATABASE_URL", "SEED_ON_STARTUP")}
    yield
    for mod in [m for m in list(sys.modules) if m.startswith("app")]:
        del sys.modules[mod]
    sys.modules.update(saved)
    for k, v in saved_env.items():
        if v is None:
            os.environ.pop(k, None)
        else:
            os.environ[k] = v


def test_wildcard_never_allows_credentials():
    """allow_origins=* must force allow_credentials off."""
    with _client("*") as c:
        r = _preflight(c, EVIL)
        assert r.headers.get("access-control-allow-origin") == "*"
        # The dangerous header must be absent.
        assert r.headers.get("access-control-allow-credentials") is None


def test_explicit_origin_is_allowed():
    with _client(GOOD) as c:
        r = _preflight(c, GOOD)
        assert r.headers.get("access-control-allow-origin") == GOOD
        assert r.headers.get("access-control-allow-credentials") == "true"


def test_unlisted_origin_is_rejected():
    with _client(GOOD) as c:
        r = _preflight(c, EVIL)
        assert r.headers.get("access-control-allow-origin") is None


def test_multiple_origins_are_supported():
    other = "https://buildiq.et"
    with _client(f"{GOOD},{other}") as c:
        for allowed in (GOOD, other):
            assert _preflight(c, allowed).headers.get(
                "access-control-allow-origin") == allowed
        assert _preflight(c, EVIL).headers.get("access-control-allow-origin") is None


def test_settings_flags_agree():
    """Pure-value check -- no reimport needed, so nothing to clean up."""
    from app.config import Settings

    wildcard = Settings(CORS_ORIGINS="*")
    assert wildcard.cors_allows_any_origin is True
    assert wildcard.cors_allow_credentials is False

    explicit = Settings(CORS_ORIGINS=GOOD)
    assert explicit.cors_allows_any_origin is False
    assert explicit.cors_allow_credentials is True
