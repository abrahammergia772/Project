#!/usr/bin/env python3
"""Validate a Supabase DATABASE_URL before deploying with it.

    python3 check_db.py "postgresql+psycopg://postgres.ref:pw@aws-0-us-east-2.pooler.supabase.com:6543/postgres"
    python3 check_db.py            # reads $DATABASE_URL

Checks the shape of the URI, then actually connects and reports what the
database contains. Every failure mode below was hit for real during setup, so
each maps to a specific, actionable message rather than a raw driver traceback.
"""
from __future__ import annotations

import os
import sys
from urllib.parse import unquote, urlparse

OK, BAD, WARN = "  [ok]", "  [!!]", "  [??]"


def main() -> int:
    url = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("DATABASE_URL", "")
    if not url:
        print(BAD, "No URL given and DATABASE_URL is not set.")
        print("      usage: python3 check_db.py '<connection string>'")
        return 2

    print("\n--- 1. URI shape ---")
    problems: list[str] = []
    fixes: list[str] = []

    if url.startswith("sqlite"):
        print(BAD, "This is SQLite, not Postgres. Data will be lost on restart.")
        return 1

    if url.startswith("postgresql+psycopg://"):
        print(OK, "driver is postgresql+psycopg")
    elif url.startswith(("postgresql://", "postgres://")):
        print(BAD, "missing the +psycopg driver")
        scheme = url.split("://", 1)[0]
        fixes.append(f"change {scheme}:// to postgresql+psycopg://")
        problems.append("driver")
    else:
        print(BAD, f"unrecognised scheme: {url.split('://', 1)[0]}://")
        return 1

    # urlparse treats [...] as an IPv6 literal, so an unreplaced
    # "[YOUR-PASSWORD]" placeholder raises before we can report it -- and that
    # is the most common thing to paste straight from the dashboard.
    if "[" in url or "]" in url:
        print(BAD, "URI still contains [ ] — the password placeholder was not replaced")
        print("\n--- fixes ---")
        print("  * replace [YOUR-PASSWORD] with your real database password")
        print("  * if the password itself contains [ or ], URL-encode it:"
              " [ -> %5B, ] -> %5D")
        return 1

    try:
        parsed = urlparse(url.replace("postgresql+psycopg://", "postgresql://", 1))
        host, port = parsed.hostname or "", parsed.port
        user, pw = parsed.username or "", parsed.password or ""
    except ValueError as exc:
        print(BAD, f"URI could not be parsed: {exc}")
        print("      A special character in the password usually causes this.")
        print("      URL-encode it: @ -> %40, # -> %23, / -> %2F, : -> %3A")
        return 1

    if "pooler.supabase.com" in host:
        print(OK, f"host is the pooler ({host})")
    elif host.startswith("db.") and host.endswith(".supabase.co"):
        print(BAD, "direct host — IPv6-only on the free tier, unreachable from Render")
        fixes.append("use the Session pooler host: aws-<n>-<region>.pooler.supabase.com")
        problems.append("host")
    else:
        print(WARN, f"unexpected host: {host}")

    if port == 6543:
        print(OK, "port 6543 (session pooler)")
    elif port == 5432:
        print(WARN, "port 5432 — works, but 6543 is the pooler and is preferred on Render")
    else:
        print(BAD, f"unexpected port: {port}")
        problems.append("port")

    if user.startswith("postgres.") and len(user.split(".", 1)[1]) > 10:
        print(OK, f"user includes the project ref ({user})")
    elif user == "postgres":
        print(BAD, "user is bare 'postgres' — the pooler needs postgres.<project-ref>")
        fixes.append("set the user to postgres.<your-project-ref>")
        problems.append("user")
    else:
        print(WARN, f"unusual user: {user}")

    if not pw:
        print(BAD, "no password in the URI")
        problems.append("password")
    elif pw in ("YOUR-PASSWORD", "[YOUR-PASSWORD]", "YOURPASSWORD"):
        print(BAD, "password placeholder was never replaced")
        problems.append("password")
    else:
        print(OK, f"password present ({len(pw)} chars)")
        # A raw special character means the URI was mis-parsed.
        if unquote(pw) != pw:
            print(OK, "password is URL-encoded")
        elif any(c in pw for c in "@:/?#&"):
            print(BAD, "password contains a special character that is NOT encoded")
            fixes.append("URL-encode the password: @ -> %40, # -> %23, / -> %2F, : -> %3A")
            problems.append("password-encoding")

    if fixes:
        print("\n--- fixes ---")
        for f in fixes:
            print("  *", f)
        if "password-encoding" not in problems and "password" not in problems:
            print("\n  corrected URI:")
            fixed = url
            if "driver" in problems:
                fixed = fixed.replace("postgres://", "postgresql://", 1)
                fixed = fixed.replace("postgresql://", "postgresql+psycopg://", 1)
            print("   ", fixed)
        return 1

    print("\n--- 2. connecting ---")
    try:
        from sqlalchemy import create_engine, text
    except ImportError:
        print(BAD, "SQLAlchemy not installed — run: pip install -r requirements.txt")
        return 2

    try:
        engine = create_engine(url, pool_pre_ping=True,
                               connect_args={"connect_timeout": 15})
        with engine.connect() as conn:
            ver = conn.execute(text("SELECT version()")).scalar() or ""
            print(OK, "connected:", ver.split(",")[0])

            print("\n--- 3. contents ---")
            tables = [r[0] for r in conn.execute(text(
                "SELECT tablename FROM pg_tables WHERE schemaname='public' "
                "ORDER BY tablename"))]
            if not tables:
                print(WARN, "no tables yet — run supabase/migrations/0001_schema.sql,")
                print("       or just start the API (it creates tables at boot)")
            else:
                print(OK, f"{len(tables)} tables: {', '.join(tables[:8])}"
                          + (" ..." if len(tables) > 8 else ""))
                if "users" in tables:
                    n = conn.execute(text("SELECT count(*) FROM users")).scalar()
                    print(OK, f"users table has {n} row(s)")
                    if n:
                        rows = conn.execute(text(
                            "SELECT email, role, substring(hashed_password,1,7) "
                            "FROM users ORDER BY created_at LIMIT 3"))
                        for email, role, h in rows:
                            print(f"        {email:32} {role:18} hash={h}...")
                        print("       (passwords are bcrypt hashes by design —"
                              " never readable)")
    except Exception as exc:
        msg = str(exc)
        print(BAD, f"{type(exc).__name__}: {msg.splitlines()[0][:160]}")
        print("\n--- likely cause ---")
        low = msg.lower()
        if "password authentication failed" in low:
            print("  Wrong database password. It is NOT your Supabase account password.")
            print("  Reset: Project Settings -> Database -> Reset database password.")
        elif "could not translate host name" in low or "name or service not known" in low:
            print("  Hostname does not resolve. Check the pooler prefix — it may be")
            print("  aws-1- rather than aws-0-. Copy the host from the dashboard.")
        elif "network is unreachable" in low:
            print("  IPv6-only host. Use the Session pooler (port 6543), not db.<ref>.")
        elif "timeout" in low or "timed out" in low:
            print("  Port blocked, or the project is paused (free projects pause after")
            print("  a week idle). Check Project Overview and resume it.")
        elif "tenant" in low and ("not found" in low or "enotfound" in low):
            print("  The pooler does not recognise this tenant. In order of likelihood:")
            print("   1. The project is PAUSED. Free projects pause after ~1 week idle.")
            print("      Open the dashboard and click Resume, then retry.")
            print("   2. Wrong pooler prefix — try aws-1- instead of aws-0- (or vice")
            print("      versa). Copy the exact host from the dashboard.")
            print("   3. Username must be postgres.<project-ref>, not bare 'postgres'.")
        else:
            print("  Compare against Project Settings -> Database -> Connection string -> URI.")
        return 1

    print("\nAll good. Set this as DATABASE_URL on your Render API service.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
