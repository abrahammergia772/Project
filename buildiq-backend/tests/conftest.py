"""Test-suite defaults.

The application refuses to start without a Supabase Postgres DATABASE_URL --
a missing one used to fall back to SQLite and silently discard data. The test
suite has no Postgres server available, so it opts in explicitly via
ALLOW_SQLITE. That flag exists only for tests and must never be set in a
deployment.
"""
import os

os.environ.setdefault("ALLOW_SQLITE", "true")
os.environ.setdefault("SECRET_KEY", "test-secret-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///./test_default.db")


# The TestClient fixture lives here so every test module can use it. It was
# previously defined inside test_api.py, which made it invisible to new files.
import pytest


@pytest.fixture(scope="session")
def client():
    from fastapi.testclient import TestClient
    from app.main import app
    with TestClient(app) as c:
        yield c
