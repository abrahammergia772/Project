"""Daily attendance register download (CSV).

Rows are scoped to what the caller may already see, so an export can never
leak records that were not visible on screen.
"""
import csv
import io

PW = "Demo1234!"


def _tok(client, email):
    r = client.post("/auth/login", json={"email": email, "password": PW})
    assert r.status_code == 200, email
    return {"Authorization": f"Bearer {r.json()['token']}"}


def _rows(resp):
    text = resp.content.decode("utf-8-sig")
    return list(csv.reader(io.StringIO(text)))


def test_export_returns_a_csv_attachment(client):
    r = client.get("/attendance/export", headers=_tok(client, "girma.assefa@buildiq.et"))
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/csv")
    assert "attachment; filename=" in r.headers["content-disposition"]
    assert r.headers["content-disposition"].endswith('.csv"')


def test_export_defaults_to_today(client):
    from datetime import datetime, timezone
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    r = client.get("/attendance/export", headers=_tok(client, "girma.assefa@buildiq.et"))
    assert today in r.headers["content-disposition"]


def test_csv_has_the_expected_columns(client):
    rows = _rows(client.get("/attendance/export",
                            headers=_tok(client, "girma.assefa@buildiq.et")))
    assert rows[0][:7] == ["Date", "Person", "Person ID", "Type",
                           "Department", "Project", "Status"]
    # The absence-review columns matter for payroll disputes.
    assert "Absence Reason" in rows[0]
    assert "Reason Status" in rows[0]


def test_csv_ends_with_a_total_line(client):
    rows = _rows(client.get("/attendance/export",
                            headers=_tok(client, "girma.assefa@buildiq.et")))
    last = [c for c in rows[-1] if c]
    assert last[0] == "TOTAL"
    assert "Present" in " ".join(last)


def test_export_is_scoped_to_what_the_user_can_see(client):
    """A Department Manager must not export the whole organization."""
    wf = len(_rows(client.get("/attendance/export",
                              headers=_tok(client, "girma.assefa@buildiq.et"))))
    dm = len(_rows(client.get("/attendance/export",
                              headers=_tok(client, "meron.tadesse@buildiq.et"))))
    assert dm < wf, "department manager exported org-wide rows"


def test_roles_without_attendance_access_are_refused(client):
    for email in ("engineer@buildiq.et", "client@buildiq.et"):
        r = client.get("/attendance/export", headers=_tok(client, email))
        assert r.status_code == 403, email


def test_a_date_range_can_be_exported(client):
    r = client.get("/attendance/export?start=2020-01-01&end=2099-12-31",
                   headers=_tok(client, "girma.assefa@buildiq.et"))
    assert r.status_code == 200
    assert "_to_" in r.headers["content-disposition"]
    assert len(_rows(r)) > 2


def test_status_filter_narrows_the_file(client):
    h = _tok(client, "girma.assefa@buildiq.et")
    everything = client.get("/attendance/export?start=2020-01-01&end=2099-12-31", headers=h)
    absent = client.get("/attendance/export?start=2020-01-01&end=2099-12-31&status=Absent",
                        headers=h)
    assert len(_rows(absent)) < len(_rows(everything))
    for row in _rows(absent)[1:-2]:
        if row and row[0].startswith("20"):
            assert row[6] == "Absent"


def test_export_does_not_shadow_the_reason_route(client):
    """/attendance/export must be declared BEFORE /attendance/{date}/reason.

    Registered the other way round, FastAPI matches "export" as a {date} path
    parameter and the export 404s. Asserting on the reason route's status is
    unreliable -- it legitimately 404s for a day with no attendance record --
    so check the registered route order directly.
    """
    from app.main import app

    paths = [r.path for r in app.routes if hasattr(r, "path")]
    assert "/attendance/export" in paths
    assert paths.index("/attendance/export") < paths.index("/attendance/{date}/reason"), \
        "the export route is shadowed by the {date} parameter route"

    # And it really resolves, rather than being swallowed as a date.
    r = client.get("/attendance/export", headers=_tok(client, "girma.assefa@buildiq.et"))
    assert r.status_code == 200


def test_export_is_recorded_in_the_audit_trail(client):
    client.get("/attendance/export", headers=_tok(client, "girma.assefa@buildiq.et"))
    logs = client.get("/audit/logs?action=EXPORT_DATA&limit=50",
                      headers=_tok(client, "admin@buildiq.et")).json()
    assert any("attendance/export" in (e.get("resource") or "") for e in logs)


def test_csv_is_excel_safe(client):
    """A UTF-8 BOM so Excel renders non-ASCII names correctly."""
    r = client.get("/attendance/export", headers=_tok(client, "girma.assefa@buildiq.et"))
    assert r.content.startswith(b"\xef\xbb\xbf")
