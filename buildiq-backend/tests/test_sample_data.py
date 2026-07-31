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


# ---------------------------------------------------------------------------
# Execution test
#
# Parsing is not enough. The first version of this file passed every parse
# check and still failed in Supabase with
#
#   ERROR 23502: null value in column "experience_years" violates not-null
#
# because an explicit NULL overrides a column DEFAULT. Executing the file
# against a schema built from the real AST -- NOT NULL and DEFAULT preserved --
# catches that class of error before it reaches a database.
# ---------------------------------------------------------------------------
import re
import sqlite3


def _sqlite_from_schema():
    """CREATE TABLE statements mirroring the real NOT NULL / DEFAULT flags."""
    ddl = []
    for raw in pglast.parse_sql(SCHEMA):
        stmt = raw.stmt
        if type(stmt).__name__ != "CreateStmt":
            continue
        cols = []
        for el in stmt.tableElts or []:
            if type(el).__name__ != "ColumnDef":
                continue
            cons = el.constraints or []
            nn = any(type(c).__name__ == "Constraint" and c.contype == 1 for c in cons)
            pk = any(type(c).__name__ == "Constraint" and c.contype == 5 for c in cons)
            df = any(type(c).__name__ == "Constraint" and c.contype == 2 for c in cons)
            # Treat "id" as the primary key: the real schema declares it via a
            # table-level constraint, which ON CONFLICT (id) needs to resolve.
            cols.append(
                f'"{el.colname}" TEXT'
                + (" NOT NULL" if nn else "")
                + (" DEFAULT ''" if df else "")
                + (" PRIMARY KEY" if (pk or el.colname == "id") else "")
            )
        # Carry the table-level CHECK constraints across too. Without them the
        # simulation silently accepted 'HIGH' for complaints.severity, which
        # the real database rejects (ck_complaints_severity is lowercase).
        for col, allowed in _enum_checks().get(stmt.relation.relname, {}).items():
            quoted = ", ".join("'" + v + "'" for v in allowed)
            cols.append(f'CHECK ("{col}" IS NULL OR "{col}" = \'\' '
                        f'OR "{col}" IN ({quoted}))')
        ddl.append(f'CREATE TABLE "{stmt.relation.relname}" ({", ".join(cols)});')
    return "\n".join(ddl)


def _enum_checks():
    """{table: {column: [allowed, ...]}} from every `check (col in (...))`.

    Parsed from the DDL text because pglast represents these as expression
    trees that are far more awkward to walk than the source.
    """
    out = {}
    for m in re.finditer(
            r"create table[^(]*?\b(?:public\.)?(\w+)\s*\((.*?)\n\);",
            SCHEMA, re.S | re.I):
        table, body = m.group(1), m.group(2)
        found = {}
        for c in re.finditer(r"check\s*\(\s*(\w+)\s+in\s*\(([^)]*)\)",
                             body, re.S | re.I):
            found[c.group(1)] = [v.strip().strip("'")
                                 for v in c.group(2).split(",") if v.strip()]
        if found:
            out[table] = found
    return out


def _to_sqlite(sql: str) -> str:
    sql = re.sub(r"--.*", "", sql)
    sql = sql.replace("::jsonb", "").replace("::text", "").replace("::date", "")
    sql = sql.replace("public.", "")
    sql = re.sub(r"\bnow\(\)\s*-\s*interval\s*'[^']*'", "datetime('now')", sql)
    sql = sql.replace("now()", "datetime('now')")
    sql = re.sub(r"\(current_date - (\d+)\)", r"date('now','-\1 day')", sql)
    sql = sql.replace("current_date", "date('now')")
    sql = re.sub(r"on conflict \(id\) do update set[^;]*",
                 "on conflict(id) do nothing", sql, flags=re.I)
    return sql.replace("begin;", "").replace("commit;", "")


def _split(sql: str):
    out, buf, depth, instr = [], "", 0, False
    for ch in sql:
        buf += ch
        if ch == "'":
            instr = not instr
        elif not instr and ch == "(":
            depth += 1
        elif not instr and ch == ")":
            depth -= 1
        elif not instr and ch == ";" and depth == 0:
            if buf.strip(" \n;"):
                out.append(buf)
            buf = ""
    return out


def _run_sample():
    con = sqlite3.connect(":memory:")
    con.executescript(_sqlite_from_schema())
    for stmt in _split(_to_sqlite(SAMPLE)):
        con.execute(stmt)
    return con


def test_sample_executes_without_constraint_violations():
    """Every statement runs -- this is what the parse-only checks missed."""
    con = _run_sample()
    counts = {t: con.execute(f"select count(*) from {t}").fetchone()[0]
              for t in ["departments", "clients", "users", "projects", "tasks",
                        "complaints", "daily_workers", "attendance", "audit_logs"]}
    for table, n in counts.items():
        assert n > 0, f"{table} has no rows after running the sample"


def test_no_explicit_null_into_a_not_null_column():
    """The exact production failure: NULL overrides a DEFAULT."""
    notnull = {}
    for raw in pglast.parse_sql(SCHEMA):
        stmt = raw.stmt
        if type(stmt).__name__ != "CreateStmt":
            continue
        cols = set()
        for el in stmt.tableElts or []:
            if type(el).__name__ != "ColumnDef":
                continue
            if any(type(c).__name__ == "Constraint" and c.contype == 1
                   for c in (el.constraints or [])):
                cols.add(el.colname)
        notnull[stmt.relation.relname] = cols

    for raw in pglast.parse_sql(SAMPLE):
        stmt = raw.stmt
        if type(stmt).__name__ != "InsertStmt":
            continue
        table = stmt.relation.relname
        cols = [c.name for c in (stmt.cols or [])]
        sel = stmt.selectStmt
        if type(sel).__name__ != "SelectStmt" or not sel.valuesLists:
            continue
        for row in sel.valuesLists:
            for i, val in enumerate(row):
                if i < len(cols) and type(val).__name__ == "A_Const" \
                        and getattr(val, "isnull", False):
                    assert cols[i] not in notnull.get(table, set()), (
                        f"{table}.{cols[i]} is set to NULL but is NOT NULL "
                        "-- an explicit NULL overrides the column DEFAULT")


def test_running_the_sample_twice_does_not_duplicate():
    con = _run_sample()
    before = con.execute("select count(*) from users").fetchone()[0]
    for stmt in _split(_to_sqlite(SAMPLE)):
        con.execute(stmt)
    after = con.execute("select count(*) from users").fetchone()[0]
    assert before == after, f"re-running duplicated rows: {before} -> {after}"


def test_the_absence_workflow_has_data():
    con = _run_sample()
    n = con.execute(
        "select count(*) from attendance where reason_status='approved'").fetchone()[0]
    assert n >= 1, "no approved absence reason to demonstrate the review queue"


def test_uses_no_postgres_only_syntax_we_cannot_verify():
    """generate_series is valid PG but unrunnable here, so it hid a whole
    INSERT from the execution test. Keep the sample fully verifiable."""
    assert "generate_series" not in SAMPLE


def test_no_value_violates_a_check_constraint():
    """Enum columns must use the exact casing the schema demands.

    Reported failure:
        ERROR 23514: new row for relation "complaints" violates check
        constraint "ck_complaints_severity"

    complaints.severity is lowercase, while projects.delay_risk and
    audit_logs.risk_level are uppercase. The casing is NOT consistent across
    tables, so every enum value is checked against its own constraint.
    """
    enums = _enum_checks()
    violations = []
    for raw in pglast.parse_sql(SAMPLE):
        stmt = raw.stmt
        if type(stmt).__name__ != "InsertStmt":
            continue
        table = stmt.relation.relname
        cols = [c.name for c in (stmt.cols or [])]
        sel = stmt.selectStmt
        if type(sel).__name__ != "SelectStmt" or not sel.valuesLists:
            continue
        for row_no, row in enumerate(sel.valuesLists, start=1):
            for i, node in enumerate(row):
                if i >= len(cols) or type(node).__name__ != "A_Const":
                    continue
                if getattr(node, "isnull", False):
                    continue
                val = getattr(node.val, "sval", None)
                allowed = enums.get(table, {}).get(cols[i])
                if val is not None and allowed and val not in allowed:
                    violations.append(
                        f"{table}.{cols[i]} row {row_no}: "
                        f"{val!r} not in {allowed}")
    assert not violations, "CHECK constraint violations:\n  " + "\n  ".join(violations)


def test_enum_casing_differs_between_tables_and_is_respected():
    """Guards the specific trap: severity lower, risk levels upper."""
    enums = _enum_checks()
    assert enums["complaints"]["severity"] == ["low", "medium", "high", "critical"]
    assert enums["projects"]["delay_risk"] == ["LOW", "MEDIUM", "HIGH", "CRITICAL"]
    assert "'HIGH'" not in SAMPLE.split("insert into public.complaints")[1].split(";")[0]
