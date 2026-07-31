"""The app must run on Supabase Postgres only.

A missing DATABASE_URL used to fall back to sqlite:///./buildiq.db. On Render
that file is erased on every deploy, restart and free-tier sleep, so real
signups vanished -- while /health still reported "database": "connected".
Startup now refuses anything that cannot persist data.
"""
import pytest

from app.config import Settings


@pytest.fixture(autouse=True)
def _no_ambient_allow_sqlite(monkeypatch):
    """conftest.py sets ALLOW_SQLITE=true so the rest of the suite can use a
    throwaway database. These tests assert the DEPLOYED defaults, so the
    ambient value must not leak in through pydantic's env loading."""
    monkeypatch.delenv("ALLOW_SQLITE", raising=False)

GOOD = ("postgresql+psycopg://postgres.abc:pw"
        "@aws-0-us-east-2.pooler.supabase.com:6543/postgres")


def test_no_sqlite_default():
    """An unset DATABASE_URL must not quietly become a local file."""
    assert Settings(DATABASE_URL="").DATABASE_URL == ""


def test_missing_url_is_refused():
    with pytest.raises(RuntimeError, match="DATABASE_URL is not set"):
        Settings(DATABASE_URL="").validate_database()


def test_the_error_says_where_to_set_it():
    """A deploy-time failure should be actionable from the log alone."""
    with pytest.raises(RuntimeError) as exc:
        Settings(DATABASE_URL="").validate_database()
    msg = str(exc.value)
    assert "Render" in msg
    assert "pooler.supabase.com" in msg
    # The exact confusion that caused this: SUPABASE_URL is not the database.
    assert "SUPABASE_URL" in msg and "file storage only" in msg


def test_sqlite_is_refused_in_deployment():
    with pytest.raises(RuntimeError, match="SQLite"):
        Settings(DATABASE_URL="sqlite:///./buildiq.db",
                 ALLOW_SQLITE=False).validate_database()


def test_sqlite_error_explains_the_data_loss():
    with pytest.raises(RuntimeError) as exc:
        Settings(DATABASE_URL="sqlite:///./x.db",
                 ALLOW_SQLITE=False).validate_database()
    assert "deleted" in str(exc.value).lower()


def test_tests_may_opt_into_sqlite():
    """ALLOW_SQLITE is the single, explicit escape hatch."""
    Settings(DATABASE_URL="sqlite:///./x.db", ALLOW_SQLITE=True).validate_database()


def test_allow_sqlite_defaults_to_false():
    """It must never be on unless somebody asked for it."""
    assert Settings(DATABASE_URL=GOOD).ALLOW_SQLITE is False


def test_non_postgres_is_refused():
    with pytest.raises(RuntimeError, match="not a PostgreSQL URL"):
        Settings(DATABASE_URL="mysql://u:p@h/db").validate_database()


def test_missing_psycopg_driver_is_refused():
    """The dashboard hands you postgresql://; psycopg2 is not installed."""
    with pytest.raises(RuntimeError, match="psycopg"):
        Settings(DATABASE_URL="postgresql://u:p@h:6543/postgres").validate_database()


def test_supabase_pooler_url_is_accepted():
    Settings(DATABASE_URL=GOOD).validate_database()   # must not raise


def test_accepted_url_is_reported_as_persistent():
    s = Settings(DATABASE_URL=GOOD)
    assert s.database_is_persistent is True
    assert s.database_kind == "postgres (supabase)"


def test_startup_calls_the_validator():
    """Guards the wiring: the check must actually run at boot."""
    import inspect
    from app import main
    assert "settings.validate_database()" in inspect.getsource(main)
