"""/health must say WHICH database, not just that one answered.

A live deploy reported {"database": "connected"} while running on ephemeral
SQLite, so every real signup was silently discarded on the next restart. The
user had set SUPABASE_URL and reasonably assumed data was going to Supabase --
but that variable only controls file storage; the database is DATABASE_URL.
"""
from app.config import Settings

SUPA = ("postgresql+psycopg://postgres.abc:pw@aws-0-eu-west-1"
        ".pooler.supabase.com:6543/postgres")


def test_sqlite_is_reported_as_ephemeral():
    s = Settings(DATABASE_URL="sqlite:///./buildiq.db")
    assert s.database_is_persistent is False
    assert "EPHEMERAL" in s.database_kind


def test_supabase_postgres_is_recognised():
    s = Settings(DATABASE_URL=SUPA)
    assert s.database_is_persistent is True
    assert s.database_kind == "postgres (supabase)"


def test_plain_postgres_is_persistent():
    s = Settings(DATABASE_URL="postgresql://u:p@host:5432/db")
    assert s.database_is_persistent is True
    assert "postgres" in s.database_kind


def test_supabase_storage_does_not_imply_a_database():
    """Setting SUPABASE_URL must never make the DB look persistent."""
    s = Settings(SUPABASE_URL="https://abc.supabase.co",
                 SUPABASE_SERVICE_KEY="k")
    assert s.storage_ready is True
    assert s.database_is_persistent is False, \
        "SUPABASE_URL controls file storage only -- the DB needs DATABASE_URL"


def test_health_exposes_the_backend(monkeypatch):
    import os
    os.environ["SECRET_KEY"] = "test-secret-key"
    os.environ["SEED_ON_STARTUP"] = "false"
    from fastapi.testclient import TestClient
    from app.main import app
    with TestClient(app) as c:
        body = c.get("/health").json()
    assert "database_backend" in body
    assert "data_persistent" in body
