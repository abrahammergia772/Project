"""Shift Management, Overtime, and Import from Excel/CSV.

All three are Workforce & Attendance work and share one authorisation rule:
that department writes, oversight roles read. Overtime APPROVAL is the
exception -- the workforce team logs the hours, management authorises the
cost, so those are deliberately different people.
"""
from __future__ import annotations

import io
from datetime import datetime, timedelta, timezone

import pytest

PW = "Demo1234!"
# In Workforce & Attendance, so allowed to take the register and manage shifts.
WORKFORCE = "girma.assefa@buildiq.et"
WORKFORCE_ENGINEER = "samuel.gebre.5@buildiq.et"

TODAY = datetime.now(timezone.utc).strftime("%Y-%m-%d")
YESTERDAY = (datetime.now(timezone.utc) - timedelta(days=1)).strftime("%Y-%m-%d")
TOMORROW = (datetime.now(timezone.utc) + timedelta(days=1)).strftime("%Y-%m-%d")


def _tok(client, email):
    r = client.post("/auth/login", json={"email": email, "password": PW})
    assert r.status_code == 200, f"{email}: {r.text}"
    return {"Authorization": f"Bearer {r.json()['token']}"}


def _someone(client, kind="staff"):
    people = client.get("/attendance/roster", params={"month": TODAY[:7]},
                        headers=_tok(client, WORKFORCE)).json()["people"]
    return next(p for p in people if p["person_type"] == kind)


# ============================================================
#  Shift management
# ============================================================

def test_default_shifts_are_seeded(client):
    shifts = client.get("/shifts", headers=_tok(client, WORKFORCE)).json()
    names = {s["name"] for s in shifts}
    assert {"Regular Shift", "Night Shift"} <= names


def test_shift_hours_are_computed(client):
    shifts = client.get("/shifts", headers=_tok(client, WORKFORCE)).json()
    regular = next(s for s in shifts if s["name"] == "Regular Shift")
    # 08:00-17:00 with a 60-minute unpaid break.
    assert regular["hours"] == 8.0


def test_a_night_shift_crossing_midnight_is_not_negative(client):
    """22:00-06:00 is eight hours, not minus sixteen. Getting this wrong
    would make every night worker's timesheet nonsense."""
    shifts = client.get("/shifts", headers=_tok(client, WORKFORCE)).json()
    night = next(s for s in shifts if s["name"] == "Night Shift")
    assert night["hours"] > 0
    assert night["hours"] == 7.25          # 8h span minus a 45-minute break


def test_shift_hours_maths_directly():
    from app.routers.shifts import shift_hours
    assert shift_hours("08:00", "17:00", 60) == 8.0
    assert shift_hours("22:00", "06:00", 0) == 8.0          # crosses midnight
    assert shift_hours("22:00", "06:00", 45) == 7.25
    assert shift_hours("06:00", "14:00", 30) == 7.5
    # A break longer than the shift cannot produce negative paid hours.
    assert shift_hours("08:00", "09:00", 120) == 0


def test_a_shift_can_be_created(client):
    r = client.post("/shifts", headers=_tok(client, WORKFORCE), json={
        "name": "Split Shift", "start_time": "05:00", "end_time": "13:00",
        "break_minutes": 30, "work_days": [0, 2, 4],
    })
    assert r.status_code == 201, r.text
    assert r.json()["hours"] == 7.5
    assert r.json()["work_days"] == [0, 2, 4]


def test_duplicate_shift_names_are_refused(client):
    wf = _tok(client, WORKFORCE)
    client.post("/shifts", headers=wf, json={"name": "Dawn Patrol"})
    again = client.post("/shifts", headers=wf, json={"name": "dawn patrol"})
    assert again.status_code == 409, "name matching must be case-insensitive"


def test_invalid_times_are_rejected(client):
    r = client.post("/shifts", headers=_tok(client, WORKFORCE),
                    json={"name": "Bad Times", "start_time": "25:00"})
    assert r.status_code == 422


def test_invalid_work_days_are_rejected(client):
    r = client.post("/shifts", headers=_tok(client, WORKFORCE),
                    json={"name": "Bad Days", "work_days": [0, 9]})
    assert r.status_code == 422


def test_renaming_a_shift_follows_through_to_its_people(client):
    """People reference a shift by NAME. A rename that does not update them
    would silently drop everyone back to the default."""
    wf = _tok(client, WORKFORCE)
    created = client.post("/shifts", headers=wf, json={"name": "Temporary Name"}).json()
    person = _someone(client)

    client.post("/shifts/assign", headers=wf,
                json={"person_ids": [person["id"]], "shift_name": "Temporary Name"})

    renamed = client.put(f"/shifts/{created['id']}", headers=wf,
                         json={"name": "Renamed Shift"})
    assert renamed.status_code == 200

    people = client.get("/attendance/roster", params={"month": TODAY[:7]},
                        headers=wf).json()["people"]
    updated = next(p for p in people if p["id"] == person["id"])
    assert updated["shift"] == "Renamed Shift"


def test_only_one_shift_can_be_the_default(client):
    """Two defaults means a new joiner inherits whichever row came back
    first -- non-deterministic behaviour."""
    wf = _tok(client, WORKFORCE)
    client.post("/shifts", headers=wf, json={"name": "New Default", "is_default": True})
    shifts = client.get("/shifts", headers=wf, params={"include_inactive": True}).json()
    assert len([s for s in shifts if s["is_default"]]) == 1


def test_a_shift_with_people_on_it_is_deactivated_not_deleted(client):
    """Hard-deleting would leave dangling shift names on member records."""
    wf = _tok(client, WORKFORCE)
    created = client.post("/shifts", headers=wf, json={"name": "Occupied Shift"}).json()
    person = _someone(client)
    client.post("/shifts/assign", headers=wf,
                json={"person_ids": [person["id"]], "shift_name": "Occupied Shift"})

    r = client.delete(f"/shifts/{created['id']}", headers=wf)
    assert r.status_code == 200
    assert "deactivated" in (r.json().get("message") or "").lower()

    still = client.get("/shifts", headers=wf, params={"include_inactive": True}).json()
    match = next(s for s in still if s["id"] == created["id"])
    assert match["active"] is False


def test_an_empty_shift_is_deleted_outright(client):
    wf = _tok(client, WORKFORCE)
    created = client.post("/shifts", headers=wf, json={"name": "Nobody Here"}).json()
    assert client.delete(f"/shifts/{created['id']}", headers=wf).status_code == 200
    remaining = client.get("/shifts", headers=wf, params={"include_inactive": True}).json()
    assert created["id"] not in {s["id"] for s in remaining}


def test_assigning_an_unknown_shift_fails(client):
    r = client.post("/shifts/assign", headers=_tok(client, WORKFORCE),
                    json={"person_ids": ["mem_1"], "shift_name": "No Such Shift"})
    assert r.status_code == 404


def test_assignment_counts_are_reported(client):
    wf = _tok(client, WORKFORCE)
    shifts = client.get("/shifts", headers=wf).json()
    regular = next(s for s in shifts if s["name"] == "Regular Shift")
    assert regular["assigned_count"] > 0, "seeded people should be on the default"


def test_only_the_workforce_department_manages_shifts(client):
    for email in ("admin@buildiq.et", "gm@buildiq.et", "engineer@buildiq.et"):
        r = client.post("/shifts", headers=_tok(client, email), json={"name": f"X {email}"})
        assert r.status_code == 403, f"{email} should not create shifts"


def test_a_workforce_engineer_can_manage_shifts(client):
    """Department-based, not role-based -- same rule as the register."""
    r = client.post("/shifts", headers=_tok(client, WORKFORCE_ENGINEER),
                    json={"name": "Engineer Made This"})
    assert r.status_code == 201


def test_oversight_roles_can_read_shifts(client):
    for email in ("admin@buildiq.et", "auditor@buildiq.et"):
        assert client.get("/shifts", headers=_tok(client, email)).status_code == 200


# ============================================================
#  Overtime
# ============================================================

def test_overtime_can_be_logged(client):
    person = _someone(client)
    r = client.post("/overtime", headers=_tok(client, WORKFORCE), json={
        "person_id": person["id"], "person_type": "staff",
        "date": YESTERDAY, "hours": 3, "rate_multiplier": 1.5,
        "reason": "Concrete pour ran late",
    })
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["status"] == "Pending"
    assert body["equivalent_hours"] == 4.5      # 3 x 1.5, computed server-side


def test_future_overtime_is_refused(client):
    """The hours have not been worked yet."""
    person = _someone(client)
    r = client.post("/overtime", headers=_tok(client, WORKFORCE), json={
        "person_id": person["id"], "date": TOMORROW, "hours": 2})
    assert r.status_code == 422


def test_absurd_hours_are_refused(client):
    person = _someone(client)
    r = client.post("/overtime", headers=_tok(client, WORKFORCE), json={
        "person_id": person["id"], "date": YESTERDAY, "hours": 20})
    assert r.status_code == 422


def test_the_daily_total_is_capped_not_just_one_entry(client):
    """Three 6-hour claims on one day is the same impossible day as one
    18-hour claim, so the check has to look at the running total."""
    wf = _tok(client, WORKFORCE)
    person = _someone(client)
    date = "2026-07-15"
    assert client.post("/overtime", headers=wf, json={
        "person_id": person["id"], "date": date, "hours": 8}).status_code == 201
    assert client.post("/overtime", headers=wf, json={
        "person_id": person["id"], "date": date, "hours": 6}).status_code == 201
    third = client.post("/overtime", headers=wf, json={
        "person_id": person["id"], "date": date, "hours": 6})
    assert third.status_code == 422
    assert "16" in third.json()["detail"]


def test_a_manager_approves_overtime(client):
    person = _someone(client)
    entry = client.post("/overtime", headers=_tok(client, WORKFORCE), json={
        "person_id": person["id"], "date": YESTERDAY, "hours": 2}).json()

    r = client.put(f"/overtime/{entry['id']}/review",
                   headers=_tok(client, "gm@buildiq.et"),
                   json={"status": "Approved", "note": "Fine for payroll"})
    assert r.status_code == 200
    assert r.json()["status"] == "Approved"
    assert r.json()["reviewed_by"]


def test_the_workforce_team_cannot_approve_its_own_logging(client):
    """They record the hours; management authorises the cost. Letting one
    department do both removes the only check on payroll spend."""
    person = _someone(client)
    entry = client.post("/overtime", headers=_tok(client, WORKFORCE), json={
        "person_id": person["id"], "date": YESTERDAY, "hours": 2}).json()
    r = client.put(f"/overtime/{entry['id']}/review", headers=_tok(client, WORKFORCE),
                   json={"status": "Approved"})
    assert r.status_code == 403


def test_nobody_approves_their_own_overtime(client):
    """Even a General Manager."""
    gm = _tok(client, "gm@buildiq.et")
    gm_id = client.get("/auth/me", headers=gm).json()["id"]
    entry = client.post("/overtime", headers=_tok(client, WORKFORCE), json={
        "person_id": gm_id, "date": YESTERDAY, "hours": 2}).json()
    r = client.put(f"/overtime/{entry['id']}/review", headers=gm,
                   json={"status": "Approved"})
    assert r.status_code == 403


def test_a_department_manager_cannot_approve_another_department(client):
    dm = _tok(client, "meron.tadesse@buildiq.et")
    mine = client.get("/auth/me", headers=dm).json()
    people = client.get("/attendance/roster", params={"month": TODAY[:7]},
                        headers=_tok(client, WORKFORCE)).json()["people"]
    outsider = next(p for p in people
                    if p["person_type"] == "staff"
                    and p["department"] not in (mine["department"], None))
    entry = client.post("/overtime", headers=_tok(client, WORKFORCE), json={
        "person_id": outsider["id"], "date": YESTERDAY, "hours": 2}).json()
    r = client.put(f"/overtime/{entry['id']}/review", headers=dm,
                   json={"status": "Approved"})
    assert r.status_code == 403


def test_an_invalid_review_status_is_rejected(client):
    person = _someone(client)
    entry = client.post("/overtime", headers=_tok(client, WORKFORCE), json={
        "person_id": person["id"], "date": YESTERDAY, "hours": 1}).json()
    r = client.put(f"/overtime/{entry['id']}/review",
                   headers=_tok(client, "gm@buildiq.et"), json={"status": "Maybe"})
    assert r.status_code == 422


def test_approved_overtime_cannot_be_deleted(client):
    """Rejecting keeps the decision on record; deleting hides that it was
    ever approved."""
    person = _someone(client)
    entry = client.post("/overtime", headers=_tok(client, WORKFORCE), json={
        "person_id": person["id"], "date": YESTERDAY, "hours": 1}).json()
    client.put(f"/overtime/{entry['id']}/review", headers=_tok(client, "gm@buildiq.et"),
               json={"status": "Approved"})
    r = client.delete(f"/overtime/{entry['id']}", headers=_tok(client, WORKFORCE))
    assert r.status_code == 409


def test_a_pending_entry_can_be_removed(client):
    person = _someone(client)
    entry = client.post("/overtime", headers=_tok(client, WORKFORCE), json={
        "person_id": person["id"], "date": YESTERDAY, "hours": 1}).json()
    assert client.delete(f"/overtime/{entry['id']}",
                         headers=_tok(client, WORKFORCE)).status_code == 200


def test_the_summary_only_counts_approved_hours(client):
    """Pending and rejected claims are not a payroll liability."""
    wf = _tok(client, WORKFORCE)
    gm = _tok(client, "gm@buildiq.et")
    person = _someone(client)
    month = "2026-06"

    before = client.get("/overtime/summary", params={"month": month},
                        headers=wf).json()["equivalent_hours"]

    pending = client.post("/overtime", headers=wf, json={
        "person_id": person["id"], "date": f"{month}-10", "hours": 4,
        "rate_multiplier": 2.0}).json()
    mid = client.get("/overtime/summary", params={"month": month},
                     headers=wf).json()["equivalent_hours"]
    assert mid == before, "a pending claim must not count yet"

    client.put(f"/overtime/{pending['id']}/review", headers=gm, json={"status": "Approved"})
    after = client.get("/overtime/summary", params={"month": month},
                       headers=wf).json()["equivalent_hours"]
    assert after == pytest.approx(before + 8.0)     # 4h x 2.0


def test_an_engineer_sees_only_their_own_overtime(client):
    eng = _tok(client, "engineer@buildiq.et")
    me = client.get("/auth/me", headers=eng).json()
    rows = client.get("/overtime", headers=eng).json()
    assert all(o["person_id"] == me["id"] for o in rows)


# ============================================================
#  Import from Excel / CSV
# ============================================================

def _csv(rows, headers=("Employee ID", "Date", "Status")):
    body = ",".join(headers) + "\n" + "\n".join(",".join(str(c) for c in r) for r in rows)
    return {"file": ("attendance.csv", io.BytesIO(body.encode()), "text/csv")}


def test_a_clean_csv_imports(client):
    wf = _tok(client, WORKFORCE)
    person = _someone(client)
    r = client.post("/attendance/import", headers=wf,
                    files=_csv([(person["employee_id"], "2026-05-04", "Present")]))
    assert r.status_code == 200, r.text
    assert r.json()["imported"] == 1


def test_preview_writes_nothing(client):
    """A dry run that quietly wrote rows would be the worst of both worlds."""
    wf = _tok(client, WORKFORCE)
    person = _someone(client)
    date = "2026-05-11"

    preview = client.post("/attendance/import/preview", headers=wf,
                          files=_csv([(person["employee_id"], date, "Present")]))
    assert preview.status_code == 200
    assert preview.json()["valid"] == 1

    marks = client.get("/attendance/roster", params={"month": "2026-05"},
                       headers=wf).json()["marks"]
    assert marks.get(person["id"], {}).get(date) is None, "preview must not write"


def test_messy_headers_are_understood(client):
    """Whoever built the spreadsheet did not read our docs."""
    wf = _tok(client, WORKFORCE)
    person = _someone(client)
    r = client.post("/attendance/import", headers=wf,
                    files=_csv([(person["employee_id"], "2026-05-05", "P")],
                               headers=("EMP ID", "day", "attendance")))
    assert r.status_code == 200, r.text
    assert r.json()["imported"] == 1


def test_people_can_be_named_instead_of_numbered(client):
    wf = _tok(client, WORKFORCE)
    person = _someone(client)
    r = client.post("/attendance/import", headers=wf,
                    files=_csv([(person["name"], "2026-05-06", "Absent")]))
    assert r.json()["imported"] == 1


@pytest.mark.parametrize("written,expected", [
    ("P", "Present"), ("present", "Present"), ("YES", "Present"), ("1", "Present"),
    ("A", "Absent"), ("absent", "Absent"), ("no", "Absent"), ("0", "Absent"),
])
def test_status_spellings_people_actually_use(client, written, expected):
    wf = _tok(client, WORKFORCE)
    person = _someone(client)
    date = f"2026-04-{abs(hash(written)) % 27 + 1:02d}"
    client.post("/attendance/import", headers=wf,
                files=_csv([(person["employee_id"], date, written)]))
    marks = client.get("/attendance/roster", params={"month": "2026-04"},
                       headers=wf).json()["marks"]
    assert marks.get(person["id"], {}).get(date) == expected


@pytest.mark.parametrize("date_text", ["2026-03-09", "09/03/2026", "09-03-2026"])
def test_common_date_formats_are_accepted(client, date_text):
    wf = _tok(client, WORKFORCE)
    person = _someone(client)
    r = client.post("/attendance/import", headers=wf,
                    files=_csv([(person["employee_id"], date_text, "Present")]))
    assert r.json()["imported"] == 1, f"{date_text} should parse"


def test_unknown_people_are_reported_not_silently_dropped(client):
    wf = _tok(client, WORKFORCE)
    r = client.post("/attendance/import/preview", headers=wf,
                    files=_csv([("WHO-IS-THIS", "2026-05-07", "Present")]))
    body = r.json()
    assert body["invalid"] == 1
    assert "register" in body["rows"][0]["error"].lower()


def test_duplicate_rows_are_refused(client):
    """One person, one date, two conflicting marks: the second would silently
    overwrite the first, so neither is trusted."""
    wf = _tok(client, WORKFORCE)
    person = _someone(client)
    r = client.post("/attendance/import/preview", headers=wf, files=_csv([
        (person["employee_id"], "2026-05-08", "Present"),
        (person["employee_id"], "2026-05-08", "Absent"),
    ]))
    body = r.json()
    assert body["valid"] == 1 and body["invalid"] == 1
    assert "duplicate" in body["rows"][1]["error"].lower()


def test_future_dates_are_refused(client):
    wf = _tok(client, WORKFORCE)
    person = _someone(client)
    r = client.post("/attendance/import/preview", headers=wf,
                    files=_csv([(person["employee_id"], TOMORROW, "Present")]))
    assert r.json()["invalid"] == 1


def test_a_missing_column_is_explained(client):
    wf = _tok(client, WORKFORCE)
    body = "Employee ID,Date\nEMP-2026-0001,2026-05-09"
    r = client.post("/attendance/import", headers=wf,
                    files={"file": ("x.csv", io.BytesIO(body.encode()), "text/csv")})
    assert r.status_code == 422
    assert "status" in r.json()["detail"].lower()


def test_an_unsupported_file_type_is_refused(client):
    r = client.post("/attendance/import", headers=_tok(client, WORKFORCE),
                    files={"file": ("notes.pdf", io.BytesIO(b"%PDF-1.4"), "application/pdf")})
    assert r.status_code == 415


def test_strict_mode_rejects_the_whole_file(client):
    """Default is to skip bad rows; skip_invalid=false is all-or-nothing."""
    wf = _tok(client, WORKFORCE)
    person = _someone(client)
    r = client.post("/attendance/import", headers=wf, params={"skip_invalid": "false"},
                    files=_csv([
                        (person["employee_id"], "2026-05-10", "Present"),
                        ("GHOST-1", "2026-05-10", "Present"),
                    ]))
    assert r.status_code == 422


def test_an_xlsx_file_imports(client):
    openpyxl = pytest.importorskip("openpyxl")
    wf = _tok(client, WORKFORCE)
    person = _someone(client)

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(["Employee ID", "Date", "Status"])
    # A real datetime, which is what Excel gives back for a date-formatted
    # cell -- not the string a CSV would contain.
    ws.append([person["employee_id"], datetime(2026, 5, 12), "Present"])
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)

    r = client.post("/attendance/import", headers=wf, files={
        "file": ("register.xlsx", buf,
                 "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")})
    assert r.status_code == 200, r.text
    assert r.json()["imported"] == 1


def test_importing_twice_updates_rather_than_duplicating(client):
    wf = _tok(client, WORKFORCE)
    person = _someone(client)
    date = "2026-05-13"
    client.post("/attendance/import", headers=wf,
                files=_csv([(person["employee_id"], date, "Present")]))
    client.post("/attendance/import", headers=wf,
                files=_csv([(person["employee_id"], date, "Absent")]))
    marks = client.get("/attendance/roster", params={"month": "2026-05"},
                       headers=wf).json()["marks"]
    assert marks[person["id"]][date] == "Absent"


def test_only_the_workforce_department_can_import(client):
    for email in ("admin@buildiq.et", "gm@buildiq.et", "engineer@buildiq.et"):
        r = client.post("/attendance/import", headers=_tok(client, email),
                        files=_csv([("EMP-2026-0001", "2026-05-14", "Present")]))
        assert r.status_code == 403, f"{email} should not be able to import"


def test_a_template_is_downloadable(client):
    r = client.get("/attendance/import/template", headers=_tok(client, WORKFORCE))
    assert r.status_code == 200
    assert "Employee ID" in r.text and "Status" in r.text


def test_an_import_is_audited(client):
    """Bulk-writing the register must leave a trail."""
    wf = _tok(client, WORKFORCE)
    person = _someone(client)
    client.post("/attendance/import", headers=wf,
                files=_csv([(person["employee_id"], "2026-05-15", "Present")]))
    logs = client.get("/audit/logs", params={"action": "EXTERNAL_IMPORT"},
                      headers=_tok(client, "admin@buildiq.et")).json()
    assert logs, "the import should appear in the audit log"
