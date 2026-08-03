"""
BuildIQ — main.py
FastAPI application entrypoint.

    uvicorn app.main:app --reload
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

from .config import settings
from .database import Base, SessionLocal, engine
from .routers import (
    ai, attendance, audit, auth, complaints, departments, documents,
    members, notifications, projects, reports, shifts, tasks, messages)
from .services import groq_service, storage

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s: %(message)s",
)
log = logging.getLogger("buildiq")


def _add_missing_columns() -> None:
    """Add columns the models declare but the database lacks.

    Base.metadata.create_all() creates missing TABLES but never missing
    COLUMNS, so adding a field to a model silently breaks every query against
    an existing database -- adding users.avatar_url took the whole site down
    with "column users.avatar_url does not exist", including login.

    This is a safety net, not a migration system: it only ever ADDS nullable
    columns, never drops, renames or retypes anything. The real migrations
    live in supabase/migrations/. Failures are logged and ignored so a
    permissions problem cannot stop the app booting.
    """
    from sqlalchemy import inspect, text

    try:
        inspector = inspect(engine)
        existing_tables = set(inspector.get_table_names())
    except Exception as exc:                       # pragma: no cover
        log.warning("Could not inspect the schema: %s", exc)
        return

    for table in Base.metadata.sorted_tables:
        if table.name not in existing_tables:
            continue                               # create_all handles these
        try:
            have = {c["name"] for c in inspector.get_columns(table.name)}
        except Exception:                          # pragma: no cover
            continue

        for column in table.columns:
            if column.name in have:
                continue
            # Only nullable, default-less columns are safe to bolt on.
            if not column.nullable:
                log.warning(
                    "Column %s.%s is missing and NOT NULL — run the migrations "
                    "in supabase/migrations/", table.name, column.name)
                continue
            ddl = (f'ALTER TABLE {table.name} '
                   f'ADD COLUMN {column.name} {column.type.compile(engine.dialect)}')
            try:
                with engine.begin() as conn:
                    conn.execute(text(ddl))
                log.warning("Added missing column %s.%s", table.name, column.name)
            except Exception as exc:               # pragma: no cover
                log.warning("Could not add %s.%s: %s", table.name, column.name, exc)


def _backfill_employee_ids() -> None:
    """Give every person a readable staff number, once.

    The register shows EMP-2026-0001 rather than the internal id (mem_1),
    which nobody outside the database recognises. Existing rows predate the
    column, so they are numbered here on first boot after the upgrade.

    Ordered by join date so the numbers follow seniority rather than whatever
    order the rows happen to come back in. Daily workers use a DW- prefix so
    the two populations stay distinguishable at a glance.

    Never renumbers anyone who already has an id -- a staff number that
    changes is worse than no staff number at all.
    """
    from sqlalchemy import or_, select

    from .models import DailyWorker, User

    db = SessionLocal()
    try:
        year = datetime.now(timezone.utc).year
        for model, prefix in ((User, "EMP"), (DailyWorker, "DW")):
            try:
                rows = list(db.scalars(
                    select(model)
                    .where(or_(model.employee_id.is_(None), model.employee_id == ""))
                    .order_by(model.joined.asc(), model.id.asc())
                ).all())
            except Exception:
                continue                      # column not there yet on this DB
            if not rows:
                continue

            taken = {
                v for (v,) in db.execute(
                    select(model.employee_id).where(model.employee_id.is_not(None))
                ).all()
            }
            n = 0
            for row in rows:
                # Skip past numbers already in use rather than colliding on
                # the UNIQUE index and losing the whole batch.
                while True:
                    n += 1
                    candidate = f"{prefix}-{year}-{n:04d}"
                    if candidate not in taken:
                        break
                row.employee_id = candidate
                taken.add(candidate)
            log.info("Assigned %d %s numbers", len(rows), prefix)
        db.commit()
    except Exception as exc:                   # never block startup
        log.warning("Could not backfill employee ids: %s", exc)
        db.rollback()
    finally:
        db.close()


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Refuse to boot with the default signing key in production.
    if settings.is_production and settings.SECRET_KEY == "dev-only-insecure-change-me":
        raise RuntimeError(
            "SECRET_KEY is still the development default. "
            "Set a strong SECRET_KEY before running in production."
        )

    # Fail fast on a database that cannot persist data. Previously a missing
    # DATABASE_URL silently fell back to SQLite and the service came up
    # "healthy" while discarding every signup on the next restart.
    settings.validate_database()

    log.info("Starting %s v%s (env=%s)", settings.APP_NAME, settings.APP_VERSION, settings.ENV)
    log.info("Database: %s", settings.DATABASE_URL.split("@")[-1] or "sqlite")
    log.info("AI: %s", f"Groq ({settings.GROQ_MODEL})" if groq_service.is_available()
             else "local heuristics (no GROQ_API_KEY)")
    log.info("Storage: %s", storage.backend_name())

    # Loud warnings for a deployment that is reachable publicly but still
    # configured for development. These are the settings that look fine in a
    # log line yet quietly weaken a live service.
    if settings.cors_allows_any_origin:
        log.warning(
            "CORS_ORIGINS is '*' -- credentials are DISABLED so browsers cannot "
            "send cookies. Set CORS_ORIGINS to your frontend URL "
            "(e.g. https://your-frontend.onrender.com)."
        )
    if not settings.is_production:
        log.warning(
            "ENV=%s (not 'production'). /docs is public and "
            "POST /auth/forgot-password returns the reset token in its response. "
            "Set ENV=production on any publicly reachable deployment.",
            settings.ENV,
        )
    if settings.supabase_url_had_service_path:
        log.warning(
            "SUPABASE_URL was %r -- trimmed to %s. Set it to the bare project "
            "URL (https://<project-ref>.supabase.co), not the REST endpoint.",
            settings.SUPABASE_URL, settings.supabase_base_url,
        )
    if not settings.database_is_persistent:
        # Only reachable with ALLOW_SQLITE=true, i.e. the test suite.
        log.warning("Running on SQLite (ALLOW_SQLITE=true). Test use only.")

    if settings.supabase_url_had_service_path:
        log.warning(
            "SUPABASE_URL was %r -- trimmed to %s. Set it to the bare project "
            "URL (https://<project-ref>.supabase.co), not the REST endpoint.",
            settings.SUPABASE_URL, settings.supabase_base_url,
        )
    if not settings.database_is_persistent:
        # Deliberately shouty: this silently discards real user accounts, and
        # "database: connected" in /health makes it look fine.
        log.warning("=" * 72)
        log.warning("DATABASE_URL IS NOT SET -- using SQLite at %s", settings.DATABASE_URL)
        log.warning("Every signup, document and attendance record is DELETED on")
        log.warning("each deploy, restart and free-tier sleep. Setting SUPABASE_URL")
        log.warning("does NOT store data in Supabase: that variable only controls")
        log.warning("file storage. The database needs DATABASE_URL, set to your")
        log.warning("Supabase Postgres connection string:")
        log.warning("  postgresql+psycopg://postgres.<ref>:<pw>@aws-0-<region>"
                    ".pooler.supabase.com:6543/postgres")
        log.warning("=" * 72)
    if settings.storage_ready and not settings.database_is_persistent:
        log.warning(
            "SUPABASE_URL is configured but DATABASE_URL is not -- uploaded FILES "
            "go to Supabase Storage while the rows describing them live in a "
            "throwaway SQLite file. After a restart the files exist but nothing "
            "references them."
        )

    # Create tables. For real migrations use Alembic; this keeps first-run simple.
    Base.metadata.create_all(bind=engine)
    _add_missing_columns()
    storage.ensure_bucket()

    if settings.SEED_ON_STARTUP:
        from .seed import seed
        db = SessionLocal()
        try:
            seed(db)
        except Exception as exc:                 # seeding must never block startup
            log.exception("Seeding failed: %s", exc)
            db.rollback()
        finally:
            db.close()

    # AFTER seeding, not before: on a fresh database the seed runs in the same
    # boot, so numbering first would find an empty table and leave every
    # seeded member without a staff number.
    _backfill_employee_ids()

    yield
    log.info("Shutting down")


app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description=(
        "Backend for BuildIQ — AI-powered construction organization management.\n\n"
        "Data lives in Supabase Postgres, documents in Supabase Storage, and the "
        "AI features call Groq with a deterministic local fallback."
    ),
    lifespan=lifespan,
    # The interactive docs enumerate every endpoint and schema in the system,
    # which is a free reconnaissance map for an attacker. They are invaluable
    # in development and have no business on a public production service, so
    # they are switched off by ENV rather than left to be remembered.
    docs_url=None if settings.is_production else "/docs",
    redoc_url=None if settings.is_production else "/redoc",
    openapi_url=None if settings.is_production else "/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    # False when origins are a wildcard -- see Settings.cors_allow_credentials.
    allow_credentials=settings.cors_allow_credentials,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition"],      # so the browser sees download filenames
)


@app.middleware("http")
async def timing_header(request: Request, call_next):
    started = time.perf_counter()
    response = await call_next(request)
    response.headers["X-Response-Time-ms"] = f"{(time.perf_counter() - started) * 1000:.1f}"

    # --- Security headers ---
    # This is a JSON API, not a site that serves HTML to a browser, so the set
    # is deliberately small: headers that do nothing here (like a full CSP for
    # rendered pages) would just be cargo cult.
    #
    # nosniff matters most: without it a browser may re-interpret a JSON error
    # body or an uploaded file as HTML and execute it.
    response.headers["X-Content-Type-Options"] = "nosniff"
    # Uploaded documents are streamed from this origin; deny framing so they
    # cannot be embedded in a hostile page.
    response.headers["X-Frame-Options"] = "DENY"
    # Do not leak API paths (which contain record ids) to third-party sites.
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Cross-Origin-Resource-Policy"] = "same-site"
    response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"

    if settings.is_production:
        # Only in production: sending HSTS from a local http:// dev server can
        # pin a developer's browser to https for localhost and break it.
        response.headers["Strict-Transport-Security"] = (
            "max-age=31536000; includeSubDomains")
    return response


@app.exception_handler(RequestValidationError)
async def validation_handler(_: Request, exc: RequestValidationError):
    """Return a readable `detail` string — the frontend surfaces it in a toast."""
    first = exc.errors()[0] if exc.errors() else {}
    field = " → ".join(str(p) for p in first.get("loc", []) if p not in ("body", "query"))
    message = first.get("msg", "Invalid request")
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={"detail": f"{field}: {message}" if field else message},
    )


@app.exception_handler(Exception)
async def unhandled_handler(request: Request, exc: Exception):
    log.exception("Unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"detail": "An unexpected error occurred. Please try again."},
    )


# ---------------- Routers ----------------
for r in (auth.router, members.router, departments.router, projects.router, tasks.router,
          complaints.router, attendance.router, shifts.router, audit.router,
          notifications.router, documents.router, reports.router, ai.router,
          messages.router):
    app.include_router(r)


@app.get("/health", tags=["meta"])
def health():
    """Liveness + dependency check. Unauthenticated by design."""
    db_ok = True
    try:
        db = SessionLocal()
        db.execute(text("SELECT 1"))
        db.close()
    except Exception as exc:
        log.warning("Health check DB probe failed: %s", exc)
        db_ok = False

    return {
        "status": "online" if db_ok else "degraded",
        "version": settings.APP_VERSION,
        "env": settings.ENV,
        "database": "connected" if db_ok else "unreachable",
        # Which database, not just whether it answered. See database_kind.
        "database_backend": settings.database_kind,
        "data_persistent": settings.database_is_persistent,
        "ai": "groq" if groq_service.is_available() else "heuristic",
        # Which provider and model is actually serving AI requests.
        "ai_provider": settings.ai_provider_label,
        "storage": storage.backend_name(),
    }


@app.get("/", tags=["meta"])
def root():
    return {
        "name": settings.APP_NAME,
        "version": settings.APP_VERSION,
        # Honest about the docs being disabled rather than advertising a 404.
        "docs": None if settings.is_production else "/docs",
    }
