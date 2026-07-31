"""supabase/sample_data.sql must match the schema and contain usable logins.

Validated with pglast (PostgreSQL's own parser) rather than regex: an earlier
regex checker produced false positives by splitting on commas inside string
literals, and false negatives by missing columns entirely. Parsing the AST is
exact.
"""
import pathlib
import re

import bcrypt
import pytest

pglast = pytest.importorskip("pglast", reason="pglast provides the real PG parser")

SUPA = pathlib.Path(__file__).resolve().parent.parent / "supabase"
SCHEMA = (SUPA / "migrations" / "0001_schema.sql").read_text()
SAMPLE = (SUPA / "sample_data.sql").read_text()


def _schema_columns():
    """{table: {column, ...}} from the CREATE TABLE statements."""
    out = {}
    for raw in pglast.parse_sql(SCHEMA):
        stmt = raw.stmt
        if type(stmt).__name__ != "CreateStmt":
            continue
        name = stmt.relation.relname
        cols = set()
        for el in stmt.tableElts or []:
            if type(el).__name__ == "ColumnDef":
                cols.add(el.colname)
        out[name] = cols
    return out


def _sample_statements():
    return pglast.parse_sql(SAMPLE)


def test_sample_parses_as_valid_postgresql():
    stmts = _sample_statements()
    assert len(stmts) > 5


def test_every_inserted_column_exists_in_the_schema():
    schema = _schema_columns()
    checked = 0
    for raw in _sample_statements():
        stmt = raw.stmt
        if type(stmt).__name__ != "InsertStmt":
            continue
        table = stmt.relation.relname
        assert table in schema, f"unknown table: {table}"
        used = [c.name for c in (stmt.cols or [])]
        missing = [c for c in used if c not in schema[table]]
        assert not missing, f"{table}: columns not in schema: {missing}"
        checked += 1
    assert checked >= 8, f"expected several INSERTs, found {checked}"


def test_every_updated_column_exists_in_the_schema():
    schema = _schema_columns()
    for raw in _sample_statements():
        stmt = raw.stmt
        if type(stmt).__name__ != "UpdateStmt":
            continue
        table = stmt.relation.relname
        used = [t.name for t in (stmt.targetList or [])]
        missing = [c for c in used if c not in schema[table]]
        assert not missing, f"{table}: UPDATE sets unknown columns: {missing}"


def test_inserts_are_idempotent():
    """Re-running the sample must not duplicate or crash."""
    for raw in _sample_statements():
        stmt = raw.stmt
        if type(stmt).__name__ != "InsertStmt":
            continue
        assert stmt.onConflictClause is not None, \
            f"{stmt.relation.relname}: INSERT has no ON CONFLICT clause"


def test_passwords_are_real_bcrypt_hashes():
    """The demo accounts must actually be able to log in."""
    hashes = re.findall(r"\$2b\$12\$[./A-Za-z0-9]{53}", SAMPLE)
    assert len(hashes) >= 8, f"expected 8 hashed passwords, found {len(hashes)}"
    for h in hashes:
        assert bcrypt.checkpw(b"Demo1234!", h.encode()), f"hash does not match: {h[:20]}"


def test_each_hash_is_uniquely_salted():
    hashes = re.findall(r"\$2b\$12\$[./A-Za-z0-9]{53}", SAMPLE)
    assert len(set(hashes)) == len(hashes), "identical hashes: salting is broken"


def test_no_plaintext_password_is_stored():
    """Demo1234! may appear in comments, never as a column value."""
    for line in SAMPLE.splitlines():
        code = line.split("--")[0]
        assert "'Demo1234!'" not in code, f"plaintext password in: {line.strip()}"


def test_all_seven_roles_are_represented():
    for role in ["Super Admin", "General Manager", "Department Manager",
                 "Project Manager", "Engineer", "Auditor", "Client"]:
        assert f"'{role}'" in SAMPLE, f"no sample user with role {role}"


def test_workforce_department_exists():
    """Attendance can only be taken by this department, so it must be seeded."""
    assert "Workforce & Attendance" in SAMPLE


def test_a_multi_role_user_exists():
    """Exercises the role switcher."""
    assert '"Department Manager","Project Manager"' in SAMPLE
