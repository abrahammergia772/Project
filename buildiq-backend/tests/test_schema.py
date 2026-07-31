"""
Verifies the hand-written Supabase SQL stays in step with app/models.py.

Schema drift is the classic failure mode for a checked-in DDL file: the ORM
changes, the SQL doesn't, and production breaks in a way no unit test catches.
These tests parse the SQL with PostgreSQL's own grammar (via pglast) and
compare it table-by-table and column-by-column against the models.
"""
from __future__ import annotations

import pathlib

import pytest

pglast = pytest.importorskip("pglast", reason="pglast provides the real PG parser")

from app.database import Base            # noqa: E402
import app.models                        # noqa: E402  (registers the tables)

SUPABASE = pathlib.Path(__file__).resolve().parent.parent / "supabase"
SCHEMA_SQL = (SUPABASE / "migrations" / "0001_schema.sql").read_text()
RLS_SQL = (SUPABASE / "migrations" / "0002_rls_policies.sql").read_text()
AUTH_RLS_SQL = (SUPABASE / "migrations" / "0003_rls_supabase_auth.sql").read_text()
SEED_SQL = (SUPABASE / "seed.sql").read_text()

ALL_TABLES = sorted(t.name for t in Base.metadata.sorted_tables)


# ---------------- Syntax ----------------
@pytest.mark.parametrize("name,sql", [
    ("0001_schema.sql", SCHEMA_SQL),
    ("0002_rls_policies.sql", RLS_SQL),
    ("0003_rls_supabase_auth.sql", AUTH_RLS_SQL),
    ("seed.sql", SEED_SQL),
])
def test_sql_parses(name, sql):
    """Every file must be valid PostgreSQL."""
    assert pglast.parse_sql(sql), f"{name} produced no statements"


# ---------------- Schema matches the ORM ----------------
def _created_tables(sql: str) -> dict[str, set[str]]:
    """table name -> column names, read out of the parse tree."""
    out: dict[str, set[str]] = {}
    for raw in pglast.parse_sql(sql):
        stmt = raw.stmt
        if type(stmt).__name__ != "CreateStmt":
            continue
        table = stmt.relation.relname
        cols = {
            e.colname for e in (stmt.tableElts or [])
            if type(e).__name__ == "ColumnDef"
        }
        out[table] = cols
    return out


def test_every_model_table_exists_in_sql():
    created = _created_tables(SCHEMA_SQL)
    missing = set(ALL_TABLES) - set(created)
    assert not missing, f"tables in models.py but not in 0001_schema.sql: {sorted(missing)}"


def test_no_extra_tables_in_sql():
    created = _created_tables(SCHEMA_SQL)
    extra = set(created) - set(ALL_TABLES)
    assert not extra, f"tables in 0001_schema.sql with no model: {sorted(extra)}"


@pytest.mark.parametrize("table_name", ALL_TABLES)
def test_columns_match_model(table_name):
    """Column-for-column agreement, in both directions."""
    created = _created_tables(SCHEMA_SQL)
    sql_cols = created[table_name]
    model_cols = {c.name for c in Base.metadata.tables[table_name].columns}

    assert not (model_cols - sql_cols), \
        f"{table_name}: in the model but missing from SQL: {sorted(model_cols - sql_cols)}"
    assert not (sql_cols - model_cols), \
        f"{table_name}: in SQL but missing from the model: {sorted(sql_cols - model_cols)}"


def test_primary_keys_present():
    """Each CREATE TABLE declares a primary key."""
    for raw in pglast.parse_sql(SCHEMA_SQL):
        stmt = raw.stmt
        if type(stmt).__name__ != "CreateStmt":
            continue
        elements = stmt.tableElts or []
        has_pk = any(
            type(e).__name__ == "Constraint" and e.contype == pglast.enums.parsenodes.ConstrType.CONSTR_PRIMARY
            for e in elements
        ) or any(
            type(e).__name__ == "ColumnDef" and any(
                c.contype == pglast.enums.parsenodes.ConstrType.CONSTR_PRIMARY
                for c in (e.constraints or []))
            for e in elements
        )
        assert has_pk, f"{stmt.relation.relname} has no primary key"


# ---------------- Constraints we rely on ----------------
def test_attendance_uniqueness_is_enforced():
    """One attendance row per person per day — the register's core invariant."""
    assert "uq_attendance_person_date" in SCHEMA_SQL
    assert "unique (person_id, date)" in SCHEMA_SQL.lower()


def test_present_days_cannot_carry_a_reason():
    """The rule a flaky test tripped over earlier, now enforced by the database."""
    assert "ck_attendance_reason_only_when_absent" in SCHEMA_SQL
    assert "status = 'Absent' or reason is null" in SCHEMA_SQL


def test_role_check_lists_all_seven_roles():
    from app.security import ALL_ROLES
    for role in ALL_ROLES:
        assert f"'{role}'" in SCHEMA_SQL, f"role {role} missing from the users CHECK constraint"


def test_audit_type_check_lists_all_seven_types():
    from app import ai_engine
    for key in ai_engine.AUDIT_TYPES:
        assert f"'{key}'" in SCHEMA_SQL, f"audit type {key} missing from the CHECK constraint"


def test_bounded_numeric_columns():
    for constraint in ("ck_projects_progress", "ck_users_on_time_pct",
                       "ck_audit_anomaly_score", "ck_complaints_confidence"):
        assert constraint in SCHEMA_SQL, f"missing bounds check: {constraint}"


# ---------------- RLS ----------------
def test_rls_enabled_on_every_table():
    """A table left out of the RLS list would be readable with the public anon key."""
    for table in ALL_TABLES:
        assert f"'{table}'" in RLS_SQL, f"{table} is not covered by 0002_rls_policies.sql"


def test_rls_denies_anon_and_authenticated():
    assert "enable row level security" in RLS_SQL
    assert "force row level security" in RLS_SQL
    assert "to anon, authenticated" in RLS_SQL
    assert "using (false)" in RLS_SQL and "with check (false)" in RLS_SQL
    assert "as restrictive" in RLS_SQL


def test_credentials_are_revoked_independently_of_rls():
    assert "revoke all on public.password_reset_tokens from anon, authenticated" in RLS_SQL
    assert "revoke select (hashed_password) on public.users from anon, authenticated" in RLS_SQL


def test_document_bucket_is_private():
    assert "set public = false where id = 'buildiq-documents'" in RLS_SQL


def test_optional_auth_rls_is_guarded():
    """0003 must not run by accident — it assumes an identity model we don't use yet."""
    assert "raise exception" in AUTH_RLS_SQL.lower()
    assert "intentionally not applied" in AUTH_RLS_SQL


def test_optional_auth_rls_covers_the_role_rules():
    """If it is ever enabled, it must reproduce the product's authorization rules."""
    # Attendance is Workforce-only, even for admins.
    assert "can_take_attendance" in AUTH_RLS_SQL
    assert "Workforce & Attendance" in AUTH_RLS_SQL
    # A PM sees only what they manage.
    assert "manager_id = auth.uid()::text" in AUTH_RLS_SQL
    # Auditors are excluded from complaints.
    assert "current_role_name() <> 'Auditor'" in AUTH_RLS_SQL
    # Notifications are targeted per user/role/department.
    assert "target_user_ids ? auth.uid()::text" in AUTH_RLS_SQL


# ---------------- Seed ----------------
def test_seed_covers_the_nine_departments():
    for dept in ("Site Operations", "Engineering & Design", "Finance & Budget",
                 "Health & Safety", "Human Resources", "Quality Control",
                 "Procurement & Supply", "Client Relations", "Workforce & Attendance"):
        assert dept in SEED_SQL, f"{dept} missing from seed.sql"


def test_seed_is_idempotent():
    assert "on conflict (id) do update" in SEED_SQL


# ---------------- The SQL actually runs ----------------
def test_schema_executes_on_a_real_database():
    """
    Execute the DDL for real. Postgres isn't available in CI here, so this runs
    against SQLite where the syntax is portable — enough to catch typos in
    table and column definitions that a parser alone might accept.
    """
    import re
    import sqlite3

    sql = SCHEMA_SQL
    # Drop comments first — prose containing a semicolon would otherwise be
    # spliced into the following statement.
    sql = re.sub(r"--[^\n]*", "", sql)
    # Strip Postgres-only constructs SQLite can't parse.
    sql = re.sub(r"\bbegin;|\bcommit;", "", sql, flags=re.I)
    sql = re.sub(r"create index[^;]*using gin[^;]*;", "", sql, flags=re.I)
    sql = re.sub(r"create index[^;]*\swhere\s[^;]*;", "", sql, flags=re.I)
    sql = sql.replace("timestamptz", "timestamp")
    sql = sql.replace("double precision", "real")
    sql = sql.replace("jsonb", "text")
    sql = re.sub(r"bigint generated always as identity", "integer", sql, flags=re.I)
    sql = re.sub(r"'\[\]'::text|'\{\}'::text", "'[]'", sql)
    sql = sql.replace("public.", "")             # SQLite has no schemas
    sql = sql.replace("default now()", "default current_timestamp")
    sql = re.sub(r"do \$\$.*?\$\$;", "", sql, flags=re.S | re.I)

    conn = sqlite3.connect(":memory:")
    try:
        conn.executescript(sql)
        created = {r[0] for r in conn.execute(
            "select name from sqlite_master where type='table'").fetchall()}
    finally:
        conn.close()

    missing = set(ALL_TABLES) - created
    assert not missing, f"DDL failed to create: {sorted(missing)}"
