"""The monthly attendance roster: employee numbers, shifts, and the grid feed.

The register used to identify people by name alone. These cover the new
employee_id/shift fields and GET /attendance/roster, which backs the monthly
grid.
"""
from __future__ import annotations

import re

PW = "Demo1234!"
EMP_PATTERN = re.compile(r"^EMP-\d{4}-\d{4}$")
DW_PATTERN = re.compile(r"^DW-\d{4}-\d{4}$")


def _tok(client, email):
    r = client.post("/auth/login", json={"email": email, "password": PW})
    assert r.status_code == 200, email
    return {"Authorization": f"Bearer {r.json()['token']}"}


# ---------------- Employee numbers ----------------

def test_every_member_gets_an_employee_number(client):
    """Backfilled on startup, so existing rows are not left blank."""
    members = client.get("/members", headers=_tok(client, "admin@buildiq.et")).json()
    assert members
    missing = [m["full_name"] for m in members if not m.get("employee_id")]
    assert not missing, f"no staff number for: {missing[:5]}"


def test_employee_numbers_look_right(client):
    members = client.get("/members", headers=_tok(client, "admin@buildiq.et")).json()
    for m in members:
        assert EMP_PATTERN.match(m["employee_id"]), m["employee_id"]


def test_employee_numbers_are_unique(client):
    """Two people sharing a staff number defeats the point of having one."""
    members = client.get("/members", headers=_tok(client, "admin@buildiq.et")).json()
    ids = [m["employee_id"] for m in members]
    assert len(ids) == len(set(ids)), "duplicate employee numbers issued"


def test_daily_workers_are_numbered_separately(client):
    """DW- prefix, so the two populations stay distinguishable."""
    workers = client.get("/daily-workers", headers=_tok(client, "admin@buildiq.et")).json()
    assert workers
    for w in workers:
        assert DW_PATTERN.match(w["employee_id"]), w["employee_id"]


def test_backfill_does_not_renumber_anyone(client):
    """A staff number that changes is worse than none at all."""
    from app.main import _backfill_employee_ids

    admin = _tok(client, "admin@buildiq.et")
    before = {m["id"]: m["employee_id"]
              for m in client.get("/members", headers=admin).json()}
    _backfill_employee_ids()
    after = {m["id"]: m["employee_id"]
             for m in client.get("/members", headers=admin).json()}
    assert before == after


# ---------------- Roster endpoint ----------------

def test_roster_returns_people_and_marks(client):
    r = client.get("/attendance/roster", params={"month": "2026-08"},
                   headers=_tok(client, "admin@buildiq.et"))
    assert r.status_code == 200
    body = r.json()
    assert body["month"] == "2026-08"
    assert body["days"] == 31
    assert body["people"]
    assert isinstance(body["marks"], dict)


def test_roster_knows_how_long_each_month_is(client):
    admin = _tok(client, "admin@buildiq.et")
    for month, days in [("2026-02", 28), ("2024-02", 29),   # leap year
                        ("2026-04", 30), ("2026-12", 31)]:
        got = client.get("/attendance/roster", params={"month": month},
                         headers=admin).json()["days"]
        assert got == days, f"{month} should have {days} days, got {got}"


def test_roster_carries_the_identity_the_register_shows(client):
    person = client.get("/attendance/roster", params={"month": "2026-08"},
                        headers=_tok(client, "admin@buildiq.et")).json()["people"][0]
    for field in ("id", "name", "employee_id", "department", "shift", "person_type"):
        assert field in person, f"missing {field}"


def test_everyone_has_a_shift_even_when_unassigned(client):
    """The column must never be blank; unassigned people fall back to a
    default rather than rendering an empty cell."""
    people = client.get("/attendance/roster", params={"month": "2026-08"},
                        headers=_tok(client, "admin@buildiq.et")).json()["people"]
    assert all(p["shift"] for p in people)


def test_roster_includes_staff_and_daily_workers(client):
    people = client.get("/attendance/roster", params={"month": "2026-08"},
                        headers=_tok(client, "admin@buildiq.et")).json()["people"]
    kinds = {p["person_type"] for p in people}
    assert kinds == {"staff", "daily_worker"}


def test_clients_are_never_on_the_register(client):
    """Clients are external; they are not employees."""
    people = client.get("/attendance/roster", params={"month": "2026-08"},
                        headers=_tok(client, "admin@buildiq.et")).json()["people"]
    members = client.get("/members", headers=_tok(client, "admin@buildiq.et")).json()
    client_ids = {m["id"] for m in members if m["role"] == "Client"}
    assert not client_ids & {p["id"] for p in people}


def test_people_are_sorted_by_name(client):
    """Matches the screenshot, and makes a long register scannable."""
    people = client.get("/attendance/roster", params={"month": "2026-08"},
                        headers=_tok(client, "admin@buildiq.et")).json()["people"]
    names = [(p["name"] or "").lower() for p in people]
    assert names == sorted(names)


# Attendance is taken ONLY by the Workforce & Attendance department, so a
# write has to be made by someone in it. The Super Admin sits in Executive
# and is refused -- an earlier version of this test posted as admin, did not
# check the response, and then wondered why no mark came back.
WORKFORCE_TAKER = "girma.assefa@buildiq.et"


def test_marks_are_keyed_for_direct_lookup(client):
    """person_id -> date -> status, which is how a grid cell asks."""
    admin = _tok(client, "admin@buildiq.et")
    wf = _tok(client, WORKFORCE_TAKER)

    people = client.get("/attendance/roster", params={"month": "2026-08"},
                        headers=admin).json()["people"]
    target = next(p for p in people if p["person_type"] == "staff")

    saved = client.post("/attendance", headers=wf, json={
        "date": "2026-08-14",
        "marks": [{"person_id": target["id"], "person_type": "staff", "status": "Absent"}],
    })
    assert saved.status_code == 200, saved.text     # assert the write, then read

    marks = client.get("/attendance/roster", params={"month": "2026-08"},
                       headers=admin).json()["marks"]
    assert marks.get(target["id"], {}).get("2026-08-14") == "Absent"


def test_the_grid_can_back_fill_a_missed_day(client):
    """The point of the monthly view: mark a day that was not taken at the
    time. The old one-day list could only reach one date."""
    wf = _tok(client, WORKFORCE_TAKER)
    admin = _tok(client, "admin@buildiq.et")
    people = client.get("/attendance/roster", params={"month": "2026-08"},
                        headers=admin).json()["people"]
    target = next(p for p in people if p["person_type"] == "staff")

    for date, status in [("2026-08-05", "Present"), ("2026-08-06", "Absent")]:
        r = client.post("/attendance", headers=wf, json={
            "date": date,
            "marks": [{"person_id": target["id"], "person_type": "staff", "status": status}],
        })
        assert r.status_code == 200, r.text

    row = client.get("/attendance/roster", params={"month": "2026-08"},
                     headers=admin).json()["marks"][target["id"]]
    assert row["2026-08-05"] == "Present"
    assert row["2026-08-06"] == "Absent"


def test_marks_outside_the_month_are_not_returned(client):
    """Otherwise the grid silently paints a cell from another month."""
    admin = _tok(client, "admin@buildiq.et")
    body = client.get("/attendance/roster", params={"month": "2026-08"},
                      headers=admin).json()
    for dates in body["marks"].values():
        for date in dates:
            assert date.startswith("2026-08"), date


def test_a_bad_month_is_rejected(client):
    admin = _tok(client, "admin@buildiq.et")
    for bad in ("2026-13", "26-08", "August", "2026-8", ""):
        r = client.get("/attendance/roster", params={"month": bad}, headers=admin)
        assert r.status_code == 422, f"{bad!r} should be rejected"


def test_roster_requires_attendance_access(client):
    """An Engineer has no oversight view, only their own record."""
    r = client.get("/attendance/roster", params={"month": "2026-08"},
                   headers=_tok(client, "engineer@buildiq.et"))
    assert r.status_code == 403


def test_roster_requires_a_session(client):
    assert client.get("/attendance/roster",
                      params={"month": "2026-08"}).status_code in (401, 403)


def test_a_department_manager_only_sees_their_own_department(client):
    """Scoping is unchanged by the new endpoint: a non-workforce manager
    oversees their own department, not the organisation."""
    dm = _tok(client, "meron.tadesse@buildiq.et")
    me = client.get("/auth/me", headers=dm).json()
    body = client.get("/attendance/roster", params={"month": "2026-08"}, headers=dm)
    if body.status_code == 403:
        return                                  # no attendance access at all
    staff = [p for p in body.json()["people"] if p["person_type"] == "staff"]
    others = {p["department"] for p in staff} - {me["department"], None}
    assert not others, f"leaked departments: {others}"


def test_a_newly_created_member_is_numbered_immediately(client):
    """Caught by the full suite, not in isolation.

    The startup backfill numbers whoever exists at boot. Members created
    afterwards -- by signup or POST /members -- had a blank column until the
    next restart, so they showed as "—" on the register. Running this file
    alone passed because no other test had created anyone yet.
    """
    admin = _tok(client, "admin@buildiq.et")
    r = client.post("/members", headers=admin, json={
        "full_name": "Late Joiner", "email": "late.joiner@buildiq.et",
        "role": "Engineer", "department": "Site Operations",
    })
    assert r.status_code == 201, r.text
    assert EMP_PATTERN.match(r.json()["employee_id"] or ""), r.json().get("employee_id")


def test_a_signup_is_numbered_immediately(client):
    r = client.post("/auth/signup", json={
        "email": "numbered.signup@buildiq.et", "password": "quarry-lift-91-north",
        "full_name": "Numbered Signup", "role": "Engineer",
    })
    assert r.status_code == 201, r.text
    me = client.get("/auth/me", headers={
        "Authorization": f"Bearer {r.json()['token']}"}).json()
    members = client.get("/members", headers=_tok(client, "admin@buildiq.et")).json()
    mine = next(m for m in members if m["id"] == me["id"])
    assert EMP_PATTERN.match(mine["employee_id"] or ""), mine.get("employee_id")


def test_numbers_are_not_reused_after_a_deletion(client):
    """Counting rows would hand a departed employee's number to the next
    hire, which corrupts historical records that reference it."""
    admin = _tok(client, "admin@buildiq.et")
    first = client.post("/members", headers=admin, json={
        "full_name": "Temp One", "email": "temp.one@buildiq.et",
        "role": "Engineer", "department": "Site Operations"}).json()
    client.delete(f"/members/{first['id']}", headers=admin)
    second = client.post("/members", headers=admin, json={
        "full_name": "Temp Two", "email": "temp.two@buildiq.et",
        "role": "Engineer", "department": "Site Operations"}).json()
    assert second["employee_id"] != first["employee_id"]
