"""
BuildIQ — main.py
FastAPI application entrypoint.

    uvicorn app.main:app --reload
"""
from __future__ import annotations

import logging
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
    members, notifications, projects, reports, tasks,
)
from .services import groq_service, storage

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s: %(message)s",
)
log = logging.getLogger("buildiq")


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
    docs_url="/docs",
    redoc_url="/redoc",
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
          complaints.router, attendance.router, audit.router, notifications.router,
          documents.router, reports.router, ai.router):
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
    return {"name": settings.APP_NAME, "version": settings.APP_VERSION, "docs": "/docs"}
