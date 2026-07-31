"""
BuildIQ — database.py
SQLAlchemy engine / session / declarative base.

Targets Supabase Postgres (postgresql+psycopg://...). A sqlite:// URL also
works unchanged, which keeps tests and local development dependency-free.
"""
import logging

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from .config import settings

log = logging.getLogger("buildiq.db")

# Validate BEFORE create_engine(). The engine is built at import time, so an
# empty or malformed DATABASE_URL would otherwise surface as an opaque
# SQLAlchemy ArgumentError traceback instead of the actionable message below.
settings.validate_database()

_is_sqlite = settings.DATABASE_URL.startswith("sqlite")

if _is_sqlite:
    engine = create_engine(
        settings.DATABASE_URL,
        connect_args={"check_same_thread": False},
        echo=settings.DB_ECHO,
        future=True,
    )

    # SQLite ignores foreign keys unless explicitly told otherwise.
    @event.listens_for(engine, "connect")
    def _fk_pragma(dbapi_conn, _):
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA foreign_keys=ON")
        cur.close()
else:
    engine = create_engine(
        settings.DATABASE_URL,
        pool_size=settings.DB_POOL_SIZE,
        max_overflow=settings.DB_MAX_OVERFLOW,
        pool_pre_ping=True,        # survives Supabase dropping idle connections
        pool_recycle=1800,
        echo=settings.DB_ECHO,
        future=True,
        connect_args={"application_name": "buildiq-api"},
    )

SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False, future=True)


class Base(DeclarativeBase):
    pass


def get_db():
    """FastAPI dependency: a request-scoped session that always closes."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
