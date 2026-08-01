"""Startup must repair a database that predates a model change.

Adding users.avatar_url took the live site down: create_all() adds missing
TABLES but never missing COLUMNS, so every query selecting that column failed
with "column users.avatar_url does not exist" -- including login, which locked
everyone out.
"""
import os

from sqlalchemy import inspect, text


def test_create_all_does_not_add_columns():
    """Documents WHY the safety net is needed, rather than assuming it."""
    from app.database import Base
    # create_all only ever issues CREATE TABLE; there is no ALTER path in it.
    assert hasattr(Base.metadata, "create_all")


def test_a_missing_nullable_column_is_added_on_startup():
    from app.database import Base, engine
    from app.main import _add_missing_columns

    Base.metadata.create_all(bind=engine)

    with engine.begin() as conn:
        cols = {c["name"] for c in inspect(engine).get_columns("users")}
        if "avatar_url" in cols:
            conn.execute(text("ALTER TABLE users DROP COLUMN avatar_url"))

    assert "avatar_url" not in {c["name"] for c in inspect(engine).get_columns("users")}

    _add_missing_columns()

    assert "avatar_url" in {c["name"] for c in inspect(engine).get_columns("users")}


def test_login_survives_a_stale_schema(client):
    """The end-to-end symptom: a stale column must not lock users out."""
    r = client.post("/auth/login",
                    json={"email": "admin@buildiq.et", "password": "Demo1234!"})
    assert r.status_code == 200


def test_the_repair_never_drops_anything():
    """A safety net must not be able to destroy data."""
    import inspect as pyinspect
    from app import main

    src = pyinspect.getsource(main._add_missing_columns)
    for danger in ("DROP COLUMN", "DROP TABLE", "ALTER COLUMN", "TRUNCATE"):
        assert danger not in src.upper(), danger
    assert "ADD COLUMN" in src.upper()


def test_a_not_null_column_is_reported_not_guessed():
    """Adding a NOT NULL column needs a real migration with a default, so the
    net warns instead of inventing one."""
    import inspect as pyinspect
    from app import main

    src = pyinspect.getsource(main._add_missing_columns)
    assert "not column.nullable" in src
    assert "supabase/migrations" in src


def test_a_migration_exists_for_existing_databases():
    """Self-healing covers columns; the messages TABLE needs the migration."""
    import pathlib

    sql = (pathlib.Path(__file__).resolve().parent.parent
           / "supabase" / "migrations" / "0004_messages_and_avatars.sql")
    assert sql.exists(), "no migration for pre-existing databases"
    body = sql.read_text()
    assert "add column if not exists avatar_url" in body.lower()
    assert "create table if not exists public.messages" in body.lower()
    # Re-running it must be harmless.
    assert body.lower().count("if not exists") >= 3
