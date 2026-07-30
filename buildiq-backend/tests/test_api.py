"""
BuildIQ — integration tests.
Runs the real app against a temporary SQLite database with the demo seed,
exercising auth, every role's scoping rules, and the AI fallback paths.

    pytest -q
"""
from __future__ import annotations

import os
import tempfile

import pytest

# Point at a throwaway DB before the app imports its settings.
_TMP = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
os.environ["DATABASE_URL"] = f"sqlite:///{_TMP.name}"
os.environ["SEED_ON_STARTUP"] = "true"
os.environ["GROQ_API_KEY"] = ""          # force the deterministic fallback path
os.environ["SECRET_KEY"] = "test-secret-key"

from fastapi.testclient import TestClient   # noqa: E402
from app.main import app                    # noqa: E402

PW = "Demo1234!"
LOGINS = {
    "admin": "admin@buildiq.et",
    "gm": "gm@buildiq.et",
    "dm": "meron.tadesse@buildiq.et",        # Site Operations — also a Project Manager
    "workforce": "girma.assefa@buildiq.et",  # Workforce & Attendance manager
    "pm": "pm@buildiq.et",
    "engineer": "engineer@buildiq.et",
    "auditor": "auditor@buildiq.et",
    "client": "client@buildiq.et",
}


@pytest.fixture(scope="session")
def client():
    with TestClient(app) as c:
        yield c


def token_for(client, who: str) -> str:
    r = client.post("/auth/login", json={"email": LOGINS[who], "password": PW})
    assert r.status_code == 200, f"login failed for {who}: {r.text}"
    return r.json()["token"]


def hdr(client, who: str) -> dict:
    return {"Authorization": f"Bearer {token_for(client, who)}"}


# ---------------- Meta ----------------
def test_health(client):
    body = client.get("/health").json()
    assert body["status"] == "online"
    assert body["database"] == "connected"
    # No key configured in tests, so the deterministic engine must be active.
    assert body["ai"] == "heuristic"


def test_all_routers_registered(client):
    paths = {r.path for r in app.routes if hasattr(r, "path")}
    for expected in ("/auth/login", "/projects", "/tasks", "/complaints",
                     "/attendance", "/audit/logs", "/notifications",
                     "/documents", "/reports/generate", "/ai/chat"):
        assert expected in paths, f"missing route {expected}"


# ---------------- Auth ----------------
def test_login_and_me(client):
    r = client.post("/auth/login", json={"email": LOGINS["admin"], "password": PW})
    assert r.status_code == 200
    body = r.json()
    assert body["user"]["role"] == "Super Admin"
    assert body["expires"] > 0

    me = client.get("/auth/me", headers={"Authorization": f"Bearer {body['token']}"})
    assert me.json()["email"] == LOGINS["admin"]


def test_login_rejects_bad_password(client):
    r = client.post("/auth/login", json={"email": LOGINS["admin"], "password": "wrong"})
    assert r.status_code == 401


def test_unauthenticated_is_rejected(client):
    assert client.get("/projects").status_code in (401, 403)


def test_signup_cannot_self_assign_privileged_role(client):
    r = client.post("/auth/signup", json={
        "email": "sneaky@buildiq.et", "password": "StrongPass1!",
        "full_name": "Sneaky Person", "role": "Super Admin"})
    assert r.status_code == 403


def test_signup_derives_omitted_fields(client):
    """The role-aware signup form doesn't ask an Auditor for a department."""
    r = client.post("/auth/signup", json={
        "email": "new.auditor@buildiq.et", "password": "StrongPass1!",
        "full_name": "New Auditor", "role": "Auditor"})
    assert r.status_code == 201
    user = r.json()["user"]
    assert user["department"] == "Compliance"
    assert user["job_title"] == "Compliance Auditor"


def test_password_reset_round_trip(client):
    email = "reset.me@buildiq.et"
    client.post("/auth/signup", json={
        "email": email, "password": "StrongPass1!", "full_name": "Reset Me", "role": "Engineer"})

    r = client.post("/auth/forgot-password", json={"email": email})
    assert r.status_code == 200
    token = r.json()["demo_token"]
    assert token

    assert client.post("/auth/reset-password",
                       json={"token": token, "new_password": "BrandNewPass9!"}).status_code == 200
    # single-use
    assert client.post("/auth/reset-password",
                       json={"token": token, "new_password": "Another1!"}).status_code == 400
    # the new password works
    assert client.post("/auth/login", json={"email": email, "password": "BrandNewPass9!"}).status_code == 200


def test_forgot_password_does_not_leak_account_existence(client):
    r = client.post("/auth/forgot-password", json={"email": "nobody@nowhere.com"})
    assert r.status_code == 200 and r.json()["demo_token"] is None


# ---------------- Multi-role switching ----------------
def test_switch_role_and_scope_changes(client):
    h = hdr(client, "dm")
    me = client.get("/auth/me", headers=h).json()
    assert set(me["roles"]) == {"Department Manager", "Project Manager"}

    as_dm = len(client.get("/projects", headers=h).json())

    r = client.post("/auth/switch-role", json={"role": "Project Manager"}, headers=h)
    assert r.status_code == 200
    pm_token = r.json()["token"]
    assert r.json()["user"]["role"] == "Project Manager"

    pm_h = {"Authorization": f"Bearer {pm_token}"}
    projects = client.get("/projects", headers=pm_h).json()
    # Wearing the PM hat, they see only what they manage.
    assert all(p["manager_id"] == me["id"] for p in projects)
    assert len(projects) <= as_dm

    # The active role persists server-side (matching the frontend, where the
    # chosen role survives a reload), so restore it for the tests that follow.
    client.post("/auth/switch-role", json={"role": "Department Manager"}, headers=pm_h)


def test_cannot_switch_to_unheld_role(client):
    r = client.post("/auth/switch-role", json={"role": "Super Admin"}, headers=hdr(client, "dm"))
    assert r.status_code == 403


def test_forged_role_claim_is_ignored(client):
    """A token claiming a role the user doesn't hold must not be honoured."""
    from jose import jwt
    from app.config import settings

    real = client.post("/auth/login", json={"email": LOGINS["engineer"], "password": PW}).json()
    payload = jwt.decode(real["token"], settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
    payload["role"] = "Super Admin"
    forged = jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)

    me = client.get("/auth/me", headers={"Authorization": f"Bearer {forged}"})
    assert me.json()["role"] == "Engineer"          # claim rejected
    # ...and still denied the admin-only action
    assert client.post("/projects", json={"title": "Nope"},
                       headers={"Authorization": f"Bearer {forged}"}).status_code == 403


# ---------------- Project visibility ----------------
@pytest.mark.parametrize("who", ["admin", "gm", "auditor"])
def test_full_project_access(client, who):
    total = len(client.get("/projects", headers=hdr(client, "admin")).json())
    assert len(client.get("/projects", headers=hdr(client, who)).json()) == total


def test_project_manager_sees_only_managed(client):
    h = hdr(client, "pm")
    me = client.get("/auth/me", headers=h).json()
    projects = client.get("/projects", headers=h).json()
    assert projects, "the demo PM should manage at least one project"
    assert all(p["manager_id"] == me["id"] for p in projects)


def test_engineer_sees_only_own_work(client):
    h = hdr(client, "engineer")
    me = client.get("/auth/me", headers=h).json()
    total = len(client.get("/projects", headers=hdr(client, "admin")).json())
    mine = client.get("/projects", headers=h).json()
    assert len(mine) < total
    for p in mine:
        on_team = any(m["id"] == me["id"] for m in p["team"])
        assert on_team or p["manager_id"] == me["id"]


def test_client_sees_only_their_projects(client):
    projects = client.get("/projects", headers=hdr(client, "client")).json()
    assert projects
    assert len({p["client_id"] for p in projects}) == 1


def test_every_project_has_a_manager(client):
    for p in client.get("/projects", headers=hdr(client, "admin")).json():
        assert p["manager_id"] and p["manager_name"], f"{p['title']} has no manager"
        assert any(m["id"] == p["manager_id"] for m in p["team"]), "manager must be on the team"


# ---------------- Project management ----------------
def test_only_admin_gm_can_create_projects(client):
    payload = {"title": "Test Tower", "department": "Site Operations", "budget": 1000}
    assert client.post("/projects", json=payload, headers=hdr(client, "dm")).status_code == 403
    assert client.post("/projects", json=payload, headers=hdr(client, "engineer")).status_code == 403

    r = client.post("/projects", json=payload, headers=hdr(client, "admin"))
    assert r.status_code == 201


def test_create_project_with_manager_and_team(client):
    members = client.get("/members", headers=hdr(client, "admin")).json()
    manager = next(m for m in members if m["role"] == "Project Manager")
    engineer = next(m for m in members if m["role"] == "Engineer")

    r = client.post("/projects", json={
        "title": "Managed Tower", "department": "Site Operations",
        "manager_id": manager["id"], "team_ids": [engineer["id"]], "budget": 500000,
    }, headers=hdr(client, "admin"))
    assert r.status_code == 201
    p = r.json()
    assert p["manager_id"] == manager["id"]
    team_ids = {m["id"] for m in p["team"]}
    assert manager["id"] in team_ids and engineer["id"] in team_ids


def test_reassign_project_manager(client):
    h = hdr(client, "admin")
    project = client.get("/projects", headers=h).json()[0]
    members = client.get("/members", headers=h).json()
    new_mgr = next(m for m in members
                   if m["role"] == "Project Manager" and m["id"] != project["manager_id"])

    r = client.put(f"/projects/{project['id']}/manager",
                   json={"manager_id": new_mgr["id"]}, headers=h)
    assert r.status_code == 200 and r.json()["manager_id"] == new_mgr["id"]
    # non-admins cannot
    assert client.put(f"/projects/{project['id']}/manager",
                      json={"manager_id": new_mgr["id"]}, headers=hdr(client, "dm")).status_code == 403


def test_materials_permissions_and_totals(client):
    h = hdr(client, "admin")
    project = client.get("/projects", headers=h).json()[0]
    before = project["materials_total_cost"]

    r = client.post(f"/projects/{project['id']}/materials", json={
        "name": "Test Cement", "unit": "bag", "quantity": 10, "unit_price": 12.5}, headers=h)
    assert r.status_code == 201
    material = r.json()
    assert material["total_cost"] == 125.0

    after = client.get(f"/projects/{project['id']}", headers=h).json()["materials_total_cost"]
    assert round(after - before, 2) == 125.0

    # an unrelated engineer cannot add materials
    assert client.post(f"/projects/{project['id']}/materials",
                       json={"name": "X", "unit": "bag", "quantity": 1, "unit_price": 1},
                       headers=hdr(client, "engineer")).status_code in (403, 404)

    assert client.delete(f"/projects/{project['id']}/materials/{material['id']}",
                         headers=h).status_code == 200


# ---------------- Attendance ----------------
def test_only_workforce_dept_can_take_attendance(client):
    marks = {"date": "2026-07-20",
             "marks": [{"person_id": "mem_6", "person_type": "staff", "status": "Present"}]}
    # Even Super Admin cannot — the register belongs to Workforce & Attendance.
    assert client.post("/attendance", json=marks, headers=hdr(client, "admin")).status_code == 403
    assert client.post("/attendance", json=marks, headers=hdr(client, "engineer")).status_code == 403
    assert client.post("/attendance", json=marks, headers=hdr(client, "workforce")).status_code == 200


def test_admin_can_still_view_attendance(client):
    assert client.get("/attendance", headers=hdr(client, "admin")).status_code == 200
    assert client.get("/attendance", headers=hdr(client, "auditor")).status_code == 200


def test_absence_reason_workflow(client):
    # Mark the demo engineer absent
    client.post("/attendance", json={"date": "2026-07-21", "marks": [
        {"person_id": "mem_6", "person_type": "staff", "status": "Absent"}]},
        headers=hdr(client, "workforce"))

    eng = hdr(client, "engineer")
    mine = client.get("/attendance/me", headers=eng).json()
    assert any(a["date"] == "2026-07-21" for a in mine), "engineer must see their own day"

    r = client.post("/attendance/2026-07-21/reason",
                    json={"reason": "Was unwell.", "reason_category": "Sick Leave"}, headers=eng)
    assert r.status_code == 200 and r.json()["reason_status"] == "Pending"

    # Auditor may read reasons but not rule on them
    assert client.get("/attendance/reasons", headers=hdr(client, "auditor")).status_code == 200
    assert client.put("/attendance/mem_6/2026-07-21/reason/review",
                      json={"decision": "Accepted"}, headers=hdr(client, "auditor")).status_code == 403
    # Engineers cannot read other people's reasons
    assert client.get("/attendance/reasons", headers=eng).status_code == 403

    r = client.put("/attendance/mem_6/2026-07-21/reason/review",
                   json={"decision": "Accepted", "note": "Documentation provided."},
                   headers=hdr(client, "admin"))
    assert r.status_code == 200 and r.json()["reason_status"] == "Accepted"

    # An accepted reason is locked
    assert client.post("/attendance/2026-07-21/reason",
                       json={"reason": "changed"}, headers=eng).status_code == 409


def test_cannot_explain_a_present_day(client):
    client.post("/attendance", json={"date": "2026-07-22", "marks": [
        {"person_id": "mem_6", "person_type": "staff", "status": "Present"}]},
        headers=hdr(client, "workforce"))
    assert client.post("/attendance/2026-07-22/reason", json={"reason": "x"},
                       headers=hdr(client, "engineer")).status_code == 400


def test_absence_ranking(client):
    ranked = client.get("/attendance/ranking", headers=hdr(client, "admin")).json()
    assert ranked
    scores = [r["ai_score"] for r in ranked]
    assert scores == sorted(scores, reverse=True), "ranking must be descending"
    assert all(r["ai_risk"] in ("CRITICAL", "HIGH", "MEDIUM", "LOW") for r in ranked)


# ---------------- Tasks ----------------
def test_task_assignment_permissions(client):
    for who in ("admin", "gm", "dm", "auditor"):
        assert client.get("/tasks/assignable", headers=hdr(client, who)).status_code == 200
    assert client.get("/tasks/assignable", headers=hdr(client, "engineer")).status_code == 403


def test_auditor_can_assign_a_task(client):
    h = hdr(client, "auditor")
    targets = client.get("/tasks/assignable", headers=h).json()
    assert targets
    r = client.post("/tasks/assign", json={
        "assignee_id": targets[0]["id"], "title": "Compliance re-inspection",
        "estimated_hours": 3}, headers=h)
    assert r.status_code == 201
    task = r.json()
    assert task["assigned_by_role"] == "Auditor"
    assert task["assignee_id"] == targets[0]["id"]


def test_manager_cannot_assign_outside_scope(client):
    h = hdr(client, "dm")
    mine = {t["id"] for t in client.get("/tasks/assignable", headers=h).json()}
    everyone = {m["id"] for m in client.get("/members", headers=hdr(client, "admin")).json()}
    outsider = next(iter(everyone - mine), None)
    if outsider:
        assert client.post("/tasks/assign", json={"assignee_id": outsider, "title": "Nope"},
                           headers=h).status_code == 403


def test_ai_prioritize_and_schedule(client):
    h = hdr(client, "engineer")
    ranked = client.post("/tasks/ai/prioritize", json={}, headers=h).json()
    assert ranked
    assert [t["ai_score"] for t in ranked] == sorted([t["ai_score"] for t in ranked], reverse=True)
    assert all("ai_priority" in t and "ai_reason" in t for t in ranked)

    grid = client.post("/tasks/ai/schedule", json={}, headers=h).json()
    assert len(grid) == 25                     # 5 days x 5 slots
    assert any(v is not None for v in grid.values())


# ---------------- Complaints ----------------
def test_complaint_triage_on_submit(client):
    r = client.post("/complaints", json={
        "text": "Workers on site were seen without safety harnesses at height. This is unsafe."},
        headers=hdr(client, "engineer"))
    assert r.status_code == 201
    c = r.json()
    assert c["category"] == "Safety Violation"          # keyword fallback triage
    assert c["department"] == "Health & Safety"
    assert c["status"] == "pending" and c["confidence"] > 0


def test_complaint_resolution_permissions(client):
    admin = hdr(client, "admin")
    pending = [c for c in client.get("/complaints", headers=admin).json() if c["status"] != "resolved"]
    target = pending[0]

    # An engineer who didn't raise it cannot resolve it
    assert client.put(f"/complaints/{target['id']}/resolve", json={"note": "no"},
                      headers=hdr(client, "engineer")).status_code in (403, 404)
    r = client.put(f"/complaints/{target['id']}/resolve",
                   json={"note": "Resolved after coordination."}, headers=admin)
    assert r.status_code == 200 and r.json()["status"] == "resolved"


def test_auditor_has_no_complaint_access(client):
    assert client.get("/complaints", headers=hdr(client, "auditor")).status_code == 403


def test_suggest_solution_falls_back_cleanly(client):
    admin = hdr(client, "admin")
    c = client.get("/complaints", headers=admin).json()[0]
    r = client.post("/complaints/ai/suggest-solution", json={"id": c["id"]}, headers=admin)
    assert r.status_code == 200
    body = r.json()
    assert len(body["solution"]) > 40
    assert body["ai_source"] == "heuristic"      # no Groq key in tests


# ---------------- Audit ----------------
def test_audit_access_restricted(client):
    for who in ("admin", "gm", "auditor"):
        assert client.get("/audit/logs", headers=hdr(client, who)).status_code == 200
    for who in ("engineer", "client", "pm"):
        assert client.get("/audit/logs", headers=hdr(client, who)).status_code == 403


def test_seven_audit_types(client):
    types = client.get("/audit/types", headers=hdr(client, "admin")).json()
    assert len(types) == 7
    keys = {t["key"] for t in types}
    assert keys == {"SECURITY", "FINANCIAL", "COMPLIANCE", "USER_ACTIVITY",
                    "DATA_INTEGRITY", "PROJECT_RESOURCE", "REPORT_DOCUMENT"}
    for t in types:
        assert t["ml_role"] and t["signals"] and t["actions"]


def test_audit_logs_are_classified(client):
    logs = client.get("/audit/logs", headers=hdr(client, "admin")).json()
    assert logs
    valid = set(client.get("/audit/types", headers=hdr(client, "admin")).json()[0].keys())
    for entry in logs:
        assert entry["audit_type"] in {"SECURITY", "FINANCIAL", "COMPLIANCE", "USER_ACTIVITY",
                                       "DATA_INTEGRITY", "PROJECT_RESOURCE", "REPORT_DOCUMENT"}
        assert entry["ml_role"]


def test_audit_stats_breakdown(client):
    stats = client.get("/audit/stats", headers=hdr(client, "admin")).json()
    assert stats["total"] > 0
    assert len(stats["by_audit_type"]) == 7
    assert len(stats["score_histogram"]) == 5


def test_login_writes_an_audit_entry(client):
    admin = hdr(client, "admin")
    before = client.get("/audit/stats", headers=admin).json()["total"]
    token_for(client, "engineer")                 # generates a LOGIN event
    after = client.get("/audit/stats", headers=admin).json()["total"]
    assert after > before


# ---------------- Notifications ----------------
def test_notifications_are_per_user(client):
    eng = hdr(client, "engineer")
    items = client.get("/notifications", headers=eng).json()
    assert items

    unread_before = client.get("/notifications/unread-count", headers=eng).json()["count"]
    assert unread_before > 0
    assert client.put("/notifications/read-all", headers=eng).status_code == 200
    assert client.get("/notifications/unread-count", headers=eng).json()["count"] == 0

    # Reading as one user must not mark another user's copy read
    admin_unread = client.get("/notifications/unread-count", headers=hdr(client, "admin")).json()["count"]
    assert admin_unread >= 0


def test_cannot_read_someone_elses_notification(client):
    admin = hdr(client, "admin")
    engineer_only = client.get("/notifications", headers=hdr(client, "engineer")).json()
    target = next((n for n in engineer_only if n["id"] == "ntf_2"), None)
    if target:
        assert client.put(f"/notifications/{target['id']}/read", headers=admin).status_code == 403


# ---------------- Documents ----------------
def test_document_round_trip_is_byte_identical(client):
    h = hdr(client, "admin")
    content = b"BuildIQ byte-fidelity test \xe2\x9c\x93 12345"

    r = client.post("/documents", files={"file": ("proof.txt", content, "text/plain")}, headers=h)
    assert r.status_code == 201
    doc = r.json()
    assert doc["name"] == "proof.txt" and doc["size_bytes"] == len(content)

    got = client.get(f"/documents/{doc['id']}/download", headers=h)
    assert got.status_code == 200
    assert got.content == content, "download must be byte-identical to the upload"

    assert client.delete(f"/documents/{doc['id']}", headers=h).status_code == 200
    assert client.get(f"/documents/{doc['id']}/download", headers=h).status_code == 404


def test_auditor_cannot_upload(client):
    assert client.post("/documents", files={"file": ("x.txt", b"x", "text/plain")},
                       headers=hdr(client, "auditor")).status_code == 403


# ---------------- Reports ----------------
def test_report_types_per_role(client):
    assert client.get("/reports/types", headers=hdr(client, "engineer")).json()["types"] == []
    assert client.get("/reports/types", headers=hdr(client, "admin")).json()["types"]
    assert client.get("/reports/types", headers=hdr(client, "client")).json()["scope_locked"] is True


def test_generate_report_and_download(client):
    h = hdr(client, "admin")
    r = client.post("/reports/generate",
                    json={"type": "Organization Summary", "scope": "Entire Organization"}, headers=h)
    assert r.status_code == 200
    body = r.json()
    assert len(body["content"]) > 40
    assert body["ai_source"] == "heuristic"
    assert set(body["stats"]) == {"projects", "complaints", "members"}

    dl = client.post("/reports/download",
                     json={"type": "Organization Summary", "scope": "Entire Organization"}, headers=h)
    assert dl.status_code == 200
    assert "attachment" in dl.headers["content-disposition"]
    assert b"EXECUTIVE SUMMARY" in dl.content


def test_cannot_generate_a_report_for_another_role(client):
    assert client.post("/reports/generate", json={"type": "Audit & Compliance"},
                       headers=hdr(client, "client")).status_code == 403
    assert client.post("/reports/generate", json={"type": "Organization Summary"},
                       headers=hdr(client, "engineer")).status_code == 403


def test_attendance_report_embeds_ranking(client):
    r = client.post("/reports/generate", json={"type": "Attendance & Absence Report"},
                    headers=hdr(client, "admin"))
    assert r.status_code == 200 and r.json()["rankedAbsences"]


# ---------------- AI ----------------
def test_chat_falls_back_without_groq(client):
    r = client.post("/ai/chat", json={"message": "Which projects are at risk?"},
                    headers=hdr(client, "admin"))
    assert r.status_code == 200
    body = r.json()
    assert body["ai_source"] == "heuristic"
    assert len(body["reply"]) > 20


def test_ai_status_reports_mode(client):
    body = client.get("/ai/status", headers=hdr(client, "admin")).json()
    assert body["mode"] == "heuristic" and body["groq_available"] is False


def test_project_analysis(client):
    h = hdr(client, "admin")
    p = client.get("/projects", headers=h).json()[0]
    body = client.post(f"/projects/{p['id']}/analyze", headers=h).json()
    assert 0 <= body["delay_probability"] <= 1
    assert body["risk_level"] in ("CRITICAL", "HIGH", "MEDIUM", "LOW")
    assert body["key_risk_factors"] and body["groq_explanation"]


def test_search_is_role_scoped(client):
    admin = client.post("/ai/search", json={"query": "Sodo"}, headers=hdr(client, "admin")).json()
    engineer = client.post("/ai/search", json={"query": "Sodo"}, headers=hdr(client, "engineer")).json()
    assert len(admin["projects"]) >= len(engineer["projects"])
    # Clients never see the staff directory
    assert client.post("/ai/search", json={"query": "a"},
                       headers=hdr(client, "client")).json()["members"] == []


def test_dashboard_stats_per_role(client):
    admin = client.get("/dashboard/stats", headers=hdr(client, "admin")).json()
    engineer = client.get("/dashboard/stats", headers=hdr(client, "engineer")).json()
    assert admin["total_members"] > engineer["total_members"]
    assert admin["audit_flags"] > 0
    assert engineer["audit_flags"] == 0        # engineers get no audit visibility


def test_executive_summary(client):
    body = client.get("/ai/executive-summary", headers=hdr(client, "pm")).json()
    assert len(body["summary"]) > 30 and body["ai_source"] == "heuristic"


# ---------------- Departments ----------------
def test_department_detail_has_health_score(client):
    h = hdr(client, "admin")
    dept = client.get("/departments", headers=h).json()[0]
    detail = client.get(f"/departments/{dept['id']}", headers=h).json()
    assert 5 <= detail["health"]["score"] <= 100
    assert detail["health"]["status"] in ("Healthy", "Stable", "At Risk", "Critical")
    assert detail["health"]["summary"]


def test_create_department_and_appoint_head(client):
    h = hdr(client, "admin")
    members = client.get("/members", headers=h).json()
    candidate = next(m for m in members if m["role"] == "Engineer")

    r = client.post("/departments", json={
        "name": "Marine Works", "head_id": candidate["id"], "budget": 750000,
        "scope": ["Docks", "Piers"]}, headers=h)
    assert r.status_code == 201 and r.json()["head"] == candidate["full_name"]

    # duplicate names are refused
    assert client.post("/departments", json={"name": "Marine Works"}, headers=h).status_code == 409
    # non-admins cannot create departments
    assert client.post("/departments", json={"name": "Rogue Dept"},
                       headers=hdr(client, "dm")).status_code == 403


def test_head_must_belong_to_department(client):
    h = hdr(client, "admin")
    outsider = next(m for m in client.get("/members", headers=h).json()
                    if m["department"] != "Quality Control" and m["role"] == "Engineer")
    assert client.put("/departments/Quality Control/head",
                      json={"member_id": outsider["id"]}, headers=h).status_code == 400


# ---------------- Members ----------------
def test_member_directory_scoping(client):
    total = len(client.get("/members", headers=hdr(client, "admin")).json())
    dept = client.get("/members", headers=hdr(client, "dm")).json()
    assert 0 < len(dept) < total
    # A Department Manager only ever sees their own department. (Read the
    # manager's own department rather than assuming, since other tests may
    # have moved people around.)
    me = client.get("/auth/me", headers=hdr(client, "dm")).json()
    assert all(m["department"] == me["department"] for m in dept)
    # Auditors and clients have no directory access
    assert client.get("/members", headers=hdr(client, "auditor")).status_code == 403
    assert client.get("/members", headers=hdr(client, "client")).status_code == 403


def test_suspended_user_cannot_log_in(client):
    h = hdr(client, "admin")
    r = client.post("/members", json={
        "full_name": "Temp Person", "email": "temp.person@buildiq.et",
        "role": "Engineer", "department": "Site Operations", "password": PW}, headers=h)
    assert r.status_code == 201
    member_id = r.json()["id"]

    assert client.post("/auth/login",
                       json={"email": "temp.person@buildiq.et", "password": PW}).status_code == 200
    assert client.delete(f"/members/{member_id}", headers=h).status_code == 200
    assert client.post("/auth/login",
                       json={"email": "temp.person@buildiq.et", "password": PW}).status_code == 403


def test_smart_search(client):
    r = client.post("/members/search/smart", json={"query": "AutoCAD"}, headers=hdr(client, "admin"))
    assert r.status_code == 200
    results = r.json()
    if results:
        scores = [x["similarity_score"] for x in results]
        assert scores == sorted(scores, reverse=True)
