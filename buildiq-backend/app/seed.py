"""
BuildIQ — seed.py
Populates an empty database with the same demo dataset the frontend's mock
mode uses, so switching MOCK_MODE=false shows equivalent content.

Idempotent: does nothing if users already exist.
"""
from __future__ import annotations

import logging
import random
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from . import ai_engine
from .config import settings
from .models import (
    Attendance, AuditLog, Client, Complaint, DailyWorker, Department, Material,
    Notification, Overtime, Project, ProjectMember, Shift, Task, User,
)
from .security import hash_password

log = logging.getLogger("buildiq.seed")
rnd = random.Random(42)          # deterministic seed → reproducible demo data


def _utc(days_ago: float = 0) -> datetime:
    return datetime.now(timezone.utc) - timedelta(days=days_ago)


def _color(s: str) -> str:
    palette = ["#F97316", "#3B82F6", "#22C55E", "#A855F7", "#EAB308", "#EF4444"]
    return palette[abs(hash(s)) % len(palette)]


DEPARTMENTS = [
    ("Site Operations", "Meron Tadesse", 2_400_000,
     "Runs day-to-day construction activity across all active sites.",
     ["Site scheduling & crew coordination", "Equipment allocation", "Daily progress tracking"]),
    ("Engineering & Design", "Dawit Alemu", 1_800_000,
     "Owns structural, architectural and MEP design across the portfolio.",
     ["Structural & architectural drawings", "BIM modeling", "Design change control"]),
    ("Finance & Budget", "Selam Getachew", 900_000,
     "Manages project budgets, supplier payments and financial reporting.",
     ["Budget planning & tracking", "Invoice processing", "Cost variance analysis"]),
    ("Health & Safety", "Yonas Bekele", 520_000,
     "Enforces safety compliance on every site and investigates incidents.",
     ["Site safety audits", "PPE compliance", "Incident investigation"]),
    ("Human Resources", "Hanna Girma", 380_000,
     "Handles hiring, onboarding and workforce administration.",
     ["Recruitment & onboarding", "Payroll administration", "Training"]),
    ("Quality Control", "Abel Wondimu", 640_000,
     "Inspects work quality against specification and manages material testing.",
     ["Material testing", "Work quality inspection", "Non-conformance tracking"]),
    ("Procurement & Supply", "Rahel Solomon", 1_500_000,
     "Sources materials and manages supplier relationships.",
     ["Supplier sourcing", "Purchase order management", "Delivery scheduling"]),
    ("Client Relations", "Kaleb Mulugeta", 300_000,
     "Primary liaison with clients, managing communication and expectations.",
     ["Client communication", "Contract liaison", "Satisfaction tracking"]),
    ("Workforce & Attendance", "Girma Assefa", 260_000,
     "Supervises daily workforce presence across all sites for staff and daily workers.",
     ["Daily attendance supervision", "Absence pattern monitoring", "Headcount reporting"]),
]

PROJECT_NAMES = [
    "Sodo Tower Complex", "Riverside Residences", "Blue Nile Bridge Extension",
    "Adama Industrial Park", "Hawassa Lakeside Mall", "Mekelle Community Hospital",
    "Addis Ring Road Phase 3", "Green Valley Housing", "Sunrise Business Center",
    "Sodo University Annex", "Bahir Dar Marina Project", "Central Market Renovation",
    "Highland Logistics Hub", "Unity Sports Complex", "Millennium Office Park",
]

FIRST = ["Abebe", "Bethelhem", "Chala", "Dagmawit", "Ephrem", "Frehiwot", "Girma", "Helen",
         "Israel", "Kidus", "Liya", "Mikias", "Nardos", "Samuel", "Tigist", "Yohannes"]
LAST = ["Tesfaye", "Mekonnen", "Alemayehu", "Gebre", "Haile", "Tadesse", "Assefa", "Bekele",
        "Girma", "Wolde", "Kebede", "Desta", "Fikru", "Negash"]
SKILLS = ["AutoCAD", "Structural Analysis", "Project Scheduling", "Concrete Works",
          "Steel Fabrication", "BIM Modeling", "Cost Estimation", "Site Supervision",
          "Surveying", "Electrical Systems", "Safety Compliance", "Procurement"]
TRADES = ["Mason", "Carpenter", "Rebar Fixer", "General Laborer", "Painter",
          "Welder", "Scaffolder", "Site Cleaner"]


def already_seeded(db: Session) -> bool:
    return (db.scalar(select(func.count()).select_from(User)) or 0) > 0


def seed(db: Session) -> None:
    if already_seeded(db):
        log.info("Database already contains users — skipping seed")
        return

    log.info("Seeding demo data...")
    pw = hash_password(settings.SEED_DEMO_PASSWORD)

    # ---- Departments ----
    departments = []
    for i, (name, head, budget, desc, scope) in enumerate(DEPARTMENTS, start=1):
        d = Department(id=f"dep_{i}", name=name, head=head, description=desc,
                       scope=scope, budget=budget)
        db.add(d)
        departments.append(d)

    # ---- Clients ----
    companies = ["Horizon Real Estate PLC", "Sodo Municipal Government", "Nile Logistics Group",
                 "Lakeside Hospitality Ltd", "Unity Sports Federation", "Millennium Holdings"]
    clients = []
    for i, company in enumerate(companies, start=1):
        contact = "Bereket Alemu" if i == 1 else f"{rnd.choice(FIRST)} {rnd.choice(LAST)}"
        c = Client(
            id=f"client_{i}", company=company, contact_name=contact,
            email="client@buildiq.et" if i == 1 else f"{contact.lower().replace(' ', '.')}@example.com",
            phone=f"+2519{rnd.randint(10000000, 99999999)}", avatar_color=_color(company),
        )
        db.add(c)
        clients.append(c)
    db.flush()

    members: list[User] = []

    def add_user(uid, name, role, dept, title, email, *, roles=None, contexts=None,
                 exp=None, client_id=None, skills=None):
        u = User(
            id=uid, email=email, hashed_password=pw, full_name=name,
            role=role, roles=roles or [role], role_contexts=contexts or {},
            department=dept, job_title=title, org_name="Wolaita Construction Group",
            phone=f"+2519{rnd.randint(10000000, 99999999)}", status="Active",
            experience_years=exp if exp is not None else rnd.randint(3, 16),
            skills=skills or rnd.sample(SKILLS, 3),
            projects_count=rnd.randint(0, 8), on_time_pct=rnd.randint(70, 99),
            avatar_color=_color(name), client_id=client_id, joined=_utc(rnd.randint(60, 1200)),
        )
        db.add(u)
        members.append(u)
        return u

    # Fixed demo identities — one per role
    add_user("mem_1", "Admin User", "Super Admin", "Executive", "System Administrator",
             "admin@buildiq.et", exp=12, skills=["Systems Administration", "Security", "Governance"])
    add_user("mem_2", "Tsegaye Worku", "General Manager", "Executive", "General Manager",
             "gm@buildiq.et", exp=16, skills=["Executive Leadership", "Strategic Planning"])
    add_user("mem_5", "Nardos Fikru", "Auditor", "Compliance", "Compliance Auditor",
             "auditor@buildiq.et", exp=9, skills=["Risk Assessment", "Compliance", "Forensic Review"])
    add_user("mem_6", "Samuel Alemayehu", "Engineer", "Site Operations", "Site Engineer",
             "engineer@buildiq.et", exp=5, skills=["Site Supervision", "AutoCAD", "Concrete Works"])

    # One Department Manager per department. The Site Operations manager also
    # holds the Project Manager role, to exercise multi-role switching.
    for i, (name, head, *_rest) in enumerate(DEPARTMENTS, start=1):
        dual = (name == "Site Operations")
        add_user(
            f"mem_dm_{i}", head, "Department Manager", name, f"{name} Manager",
            f"{head.lower().replace(' ', '.')}@buildiq.et",
            roles=["Department Manager", "Project Manager"] if dual else None,
            contexts={
                "Department Manager": {"department": name, "job_title": f"{name} Manager"},
                "Project Manager": {"department": name, "job_title": "Project Manager"},
            } if dual else None,
            exp=rnd.randint(8, 15),
        )

    # Dedicated Project Managers
    for i, (pm_name, pm_dept) in enumerate([
        ("Bruk Haile", "Site Operations"), ("Saba Tesfaye", "Engineering & Design"),
        ("Henok Girma", "Site Operations"), ("Marta Wolde", "Quality Control"),
    ], start=1):
        add_user(f"mem_pm_{i}", pm_name, "Project Manager", pm_dept, "Project Manager",
                 "pm@buildiq.et" if i == 1 else f"{pm_name.lower().replace(' ', '.')}@buildiq.et",
                 exp=rnd.randint(7, 16),
                 skills=["Project Scheduling", "Cost Estimation", "Site Supervision"])

    # Bulk engineers
    for i in range(28):
        name = f"{rnd.choice(FIRST)} {rnd.choice(LAST)}"
        dept = rnd.choice([d[0] for d in DEPARTMENTS])
        add_user(f"mem_{100 + i}", name, "Engineer", dept,
                 rnd.choice(["Site Engineer", "Structural Engineer", "Civil Engineer"]),
                 f"{name.lower().replace(' ', '.')}.{i}@buildiq.et", exp=rnd.randint(1, 18))

    # Client login
    add_user("cu_1", clients[0].contact_name, "Client", None, "Client",
             "client@buildiq.et", client_id=clients[0].id, exp=0, skills=[])
    db.flush()

    engineers = [m for m in members if m.role == "Engineer"]
    pms = [m for m in members if m.role == "Project Manager"]

    # ---- Projects ----
    from collections import defaultdict
    pm_cursor: dict[str, int] = defaultdict(int)
    projects: list[Project] = []
    for i, title in enumerate(PROJECT_NAMES, start=1):
        progress = rnd.randint(8, 98)
        expected = min(100, progress + rnd.randint(-15, 20))
        dept = rnd.choice([d for d in DEPARTMENTS if d[0] not in ("Human Resources", "Client Relations")])[0]
        gap = expected - progress
        risk = "HIGH" if gap > 15 else "MEDIUM" if gap > 5 else "LOW"

        # Round-robin across the dedicated PMs so every one of them ends up
        # with a portfolio — `i % len(dept_pms)` alone left some with none,
        # because department assignment isn't evenly distributed.
        dept_pms = [p for p in pms if p.department == dept]
        if dept_pms:
            manager = dept_pms[pm_cursor[dept] % len(dept_pms)]
            pm_cursor[dept] += 1
        else:
            manager = next((m for m in members
                            if m.role == "Department Manager" and m.department == dept), engineers[0])
        client = clients[i % len(clients)]
        budget = rnd.randint(80_000, 4_200_000)

        p = Project(
            id=f"proj_{i}", title=title,
            type=rnd.choice(["Residential", "Commercial", "Infrastructure", "Industrial", "Renovation"]),
            region=rnd.choice(["Addis Ababa", "Wolaita Sodo", "Hawassa", "Bahir Dar", "Adama", "Mekelle"]),
            department=dept, manager_id=manager.id, manager_name=manager.full_name,
            manager_role=manager.role, client_id=client.id, client_name=client.company,
            status="Completed" if progress >= 100 else "In Progress" if progress > 0 else "Planning",
            progress=progress, expected_progress=expected,
            delay_risk="LOW" if progress >= 100 else risk,
            budget=budget, spent=round(budget * progress / 100 * rnd.uniform(0.9, 1.2)),
            deadline=_utc(-rnd.randint(-300, 30)),
            tasks_total=rnd.randint(10, 60), tasks_done=0,
            delay_reasons=[rnd.choice(["Material Delay", "Weather", "Permit Hold-up", "Labor Shortage"])] if risk != "LOW" else [],
            description="A multi-phase construction initiative covering structural works, MEP installation and finishing.",
        )
        p.tasks_done = round(p.tasks_total * progress / 100)
        db.add(p)
        projects.append(p)
    db.flush()

    # Teams (manager always included)
    for p in projects:
        team = {p.manager_id}
        team.update(m.id for m in rnd.sample(engineers, rnd.randint(3, 6)))
        for uid in team:
            db.add(ProjectMember(project_id=p.id, user_id=uid))

    # Guarantee the demo Project Manager (pm@buildiq.et) runs a project, so
    # signing in with that role always lands on a populated dashboard.
    demo_pm = next((m for m in members if m.id == "mem_pm_1"), None)
    if demo_pm and not any(p.manager_id == demo_pm.id for p in projects):
        target = next((p for p in projects if p.department == demo_pm.department), projects[1])
        target.manager_id = demo_pm.id
        target.manager_name = demo_pm.full_name
        target.manager_role = demo_pm.role
        db.add(ProjectMember(project_id=target.id, user_id=demo_pm.id))

    # Demo engineer joins the first project
    db.add(ProjectMember(project_id=projects[0].id, user_id="mem_6"))
    projects[0].department = "Site Operations"
    projects[0].client_id = clients[0].id
    projects[0].client_name = clients[0].company
    db.flush()

    # ---- Materials ----
    catalog = [("Portland Cement (50kg)", "bag", 12), ("Reinforcement Steel Bar", "ton", 980),
               ("Concrete Blocks", "piece", 0.9), ("Sand (washed)", "m³", 18),
               ("Aggregate (gravel)", "m³", 22), ("Structural Steel Beam", "piece", 340),
               ("Plywood Sheets", "sheet", 26), ("Electrical Cable", "roll", 85),
               ("PVC Pipes", "piece", 14), ("Paint (exterior, 20L)", "bucket", 62)]
    suppliers = ["Sodo Building Materials PLC", "Ethio Steel & Cement Supply",
                 "Rift Valley Aggregates", "Blue Nile Electrical Supplies"]
    mat_seq = 1
    for p in projects:
        total = 0.0
        for item, unit, price in rnd.sample(catalog, rnd.randint(4, 7)):
            qty = rnd.randint(10, 500)
            up = round(price * rnd.uniform(0.92, 1.08), 2)
            cost = round(qty * up, 2)
            total += cost
            db.add(Material(
                id=f"mat_{mat_seq}", project_id=p.id, name=item, unit=unit, quantity=qty,
                unit_price=up, total_cost=cost, supplier=rnd.choice(suppliers),
                purchased_at=_utc(rnd.randint(1, 180)), purchased_by=p.manager_name,
            ))
            mat_seq += 1
        p.materials_total_cost = round(total, 2)

    # ---- Tasks ----
    task_titles = ["Pour foundation slab", "Install rebar mesh", "Erect scaffolding",
                   "Site safety inspection", "Review structural drawings", "Update BIM model",
                   "Coordinate with electrical team", "Submit weekly report", "Order cement"]
    task_seq = 1
    for m in [u for u in members if u.role in ("Engineer", "Department Manager", "Project Manager")]:
        member_projects = [p for p in projects if p.department == m.department] or projects
        for _ in range(rnd.randint(3, 7)):
            proj = rnd.choice(member_projects)
            due_in = rnd.randint(-2, 12)
            db.add(Task(
                id=f"task_{task_seq}", title=rnd.choice(task_titles),
                category=rnd.choice(["Site Work", "Inspection", "Design", "Coordination", "Admin"]),
                assignee_id=m.id, assignee_name=m.full_name, assignee_type="staff",
                department=m.department, project_id=proj.id, project_title=proj.title,
                project_risk=proj.delay_risk,
                status="To Do" if due_in < 0 else rnd.choice(["To Do", "In Progress", "Done"]),
                blocking=rnd.random() < 0.15, estimated_hours=rnd.randint(1, 8),
                due_date=_utc(-due_in), created_at=_utc(rnd.randint(1, 20)),
            ))
            task_seq += 1

    # ---- Daily workers ----
    workers = []
    for i in range(1, 31):
        name = f"{rnd.choice(FIRST)} {rnd.choice(LAST)}"
        proj = rnd.choice(projects)
        w = DailyWorker(
            id=f"dw_{i}", full_name=name, trade=rnd.choice(TRADES), project_id=proj.id,
            project_title=proj.title, department=proj.department,
            daily_rate=rnd.randint(250, 650), phone=f"+2519{rnd.randint(10000000, 99999999)}",
            status="Active", avatar_color=_color(name), joined=_utc(rnd.randint(10, 300)),
        )
        db.add(w)
        workers.append(w)

    # ---- Attendance (last 30 days) ----
    reason_samples = {
        "Sick Leave": "Came down with a fever overnight and was advised to rest.",
        "Family Emergency": "Had to attend to an urgent family matter at home.",
        "Transport Problem": "No transport available from my area due to a road closure.",
        "Medical Appointment": "Scheduled hospital appointment that could not be moved.",
    }
    att_seq = 1
    field_staff = [m for m in members if m.role in ("Engineer", "Department Manager", "Project Manager")]

    def add_attendance(person_id, person_name, ptype, dept, proj_id, proj_title, bias):
        nonlocal att_seq
        for d in range(30):
            date = _utc(d)
            if ptype == "staff" and date.weekday() >= 5:
                continue
            absent = rnd.random() < bias
            rec = Attendance(
                id=f"att_{att_seq}", person_id=person_id, person_name=person_name,
                person_type=ptype, department=dept, project_id=proj_id, project_title=proj_title,
                date=date.strftime("%Y-%m-%d"), status="Absent" if absent else "Present",
                check_in=None if absent else f"0{rnd.randint(6, 8)}:{rnd.randint(10, 59)}",
                recorded_by="Workforce & Attendance",
                reason_status="Not Submitted" if absent else None,
            )
            # ~60% of absences already have a submitted reason
            if absent and rnd.random() < 0.6:
                cat = rnd.choice(list(reason_samples))
                outcome = rnd.choice(["Pending", "Pending", "Accepted", "Accepted", "Rejected"])
                rec.reason_category = cat
                rec.reason = reason_samples[cat]
                rec.reason_submitted_at = date + timedelta(hours=rnd.randint(2, 30))
                rec.reason_status = outcome
                if outcome != "Pending":
                    rec.reason_reviewed_by = "Girma Assefa"
                    rec.reason_reviewed_at = rec.reason_submitted_at + timedelta(hours=rnd.randint(2, 48))
                    rec.reason_review_note = ("Reason accepted — absence recorded as excused."
                                              if outcome == "Accepted"
                                              else "Insufficient notice given; recorded as unexcused.")
            db.add(rec)
            att_seq += 1

    for m in field_staff:
        add_attendance(m.id, m.full_name, "staff", m.department, None, None, 0.07)
    for i, w in enumerate(workers):
        add_attendance(w.id, w.full_name, "daily_worker", w.department, w.project_id,
                       w.project_title, 0.32 if i < 5 else 0.09)

    # ---- Complaints ----
    texts = [
        "The concrete delivered last week does not meet the specified grade and is already cracking.",
        "Our invoice for phase 2 has been pending for over 45 days despite multiple follow-ups.",
        "Workers were observed without proper harnesses while working at height on the east wing.",
        "The project has fallen three weeks behind schedule with no clear communication on the cause.",
        "The HVAC ducting installed does not match the approved design and needs rework.",
        "The steel rebar shipment arrived two weeks later than the agreed procurement schedule.",
    ]
    for i in range(26):
        text = rnd.choice(texts)
        triage = ai_engine.classify_complaint(text)
        proj = rnd.choice(projects)
        submitter = rnd.choice([m for m in members if m.role != "Auditor"])
        status_val = rnd.choice(["pending", "pending", "in_progress", "resolved", "resolved"])
        assignee = next((m for m in members if m.role == "Department Manager"
                         and m.department == triage["department"]), None)
        db.add(Complaint(
            id=f"CMP-{1000 + i}", submitted_by=submitter.id,
            submitted_by_type="client" if submitter.role == "Client" else "member",
            customer_name=submitter.full_name, category=triage["category"],
            severity=triage["severity"], status=status_val, department=triage["department"],
            project=proj.title, text=text, sentiment=triage["sentiment"],
            ai_summary=triage["ai_summary"], confidence=triage["confidence"],
            assignee=assignee.full_name if assignee else "Unassigned",
            resolution_note="Issue reviewed and resolved with the responsible department."
            if status_val == "resolved" else "",
            created_at=_utc(rnd.randint(0, 20)),
        ))

    # ---- Audit logs across all seven types ----
    type_keys = list(ai_engine.AUDIT_TYPES)
    resources = {
        "SECURITY": ["auth/login", "settings/permissions", "admin/console"],
        "FINANCIAL": ["finance/invoices", "projects/budget", "finance/payments"],
        "COMPLIANCE": ["compliance/approvals", "documents/permits"],
        "USER_ACTIVITY": ["members table", "tasks/bulk", "users/roles"],
        "DATA_INTEGRITY": ["projects/proj_3", "materials ledger", "attendance records"],
        "PROJECT_RESOURCE": ["equipment/registry", "projects/milestones"],
        "REPORT_DOCUMENT": ["reports/export", "documents/drawings.pdf"],
    }
    internal = [m for m in members if m.role != "Client"]
    for i in range(84):
        actor = rnd.choice(internal)
        tkey = type_keys[i % len(type_keys)]
        action = rnd.choice(ai_engine.AUDIT_TYPES[tkey]["actions"])
        when = _utc(rnd.randint(0, 14)) - timedelta(hours=rnd.randint(0, 23))
        scored = ai_engine.score_audit_event(action, actor.full_name, when)
        db.add(AuditLog(
            id=f"log_{i + 1}", user=actor.full_name, user_role=actor.role,
            action=action, resource=rnd.choice(resources[tkey]), timestamp=when, **scored,
        ))

    # ---- Shifts ----
    # Three patterns covering how these sites actually run. Regular is the
    # default, so anyone created without an explicit shift inherits it.
    # work_days is Monday=0..Sunday=6: a six-day week, Sunday off.
    shifts = [
        ("shift_1", "Regular Shift", "08:00", "17:00", 60, [0, 1, 2, 3, 4, 5], "#2563EB", True),
        ("shift_2", "Early Shift", "06:00", "14:00", 30, [0, 1, 2, 3, 4, 5], "#16A34A", False),
        ("shift_3", "Night Shift", "22:00", "06:00", 45, [0, 1, 2, 3, 4], "#7C3AED", False),
    ]
    for sid, name, start, end, brk, days, color, default in shifts:
        db.add(Shift(id=sid, name=name, start_time=start, end_time=end,
                     break_minutes=brk, work_days=days, color=color,
                     is_default=default, active=True))

    # Put everyone on the default unless they are already assigned, so the
    # register never shows a blank shift column.
    for m in members:
        if m.role != "Client" and not m.shift:
            m.shift = "Regular Shift"
    for w in workers:
        if not w.shift:
            w.shift = "Regular Shift"

    # ---- Overtime ----
    # A few entries in each state so the review queue is not empty on a
    # first run and the approve/reject flow can be seen working.
    internal_for_ot = [m for m in members if m.role != "Client"][:6]
    ot_states = [("Approved", "Tsegaye Worku"), ("Pending", None), ("Rejected", "Tsegaye Worku")]
    for i, person in enumerate(internal_for_ot):
        state, reviewer = ot_states[i % len(ot_states)]
        when = _utc(rnd.randint(1, 20)).strftime("%Y-%m-%d")
        db.add(Overtime(
            id=f"ot_{i + 1}", person_id=person.id, person_name=person.full_name,
            person_type="staff", department=person.department, date=when,
            hours=rnd.choice([1.5, 2, 3, 4]),
            rate_multiplier=rnd.choice([1.5, 1.5, 2.0]),
            reason=rnd.choice(["Concrete pour ran late", "Client deadline",
                               "Equipment repair", "Weekend inspection"]),
            status=state, requested_by="Girma Assefa",
            reviewed_by=reviewer,
            reviewed_at=_utc(rnd.randint(0, 3)) if reviewer else None,
            review_note="Approved for payroll." if state == "Approved" else (
                "Not pre-authorised." if state == "Rejected" else None),
        ))

    # ---- Notifications ----
    db.add(Notification(
        id="ntf_1", title="Project flagged HIGH delay risk",
        body=f"{projects[0].title} needs attention this week.",
        icon="fa-diagram-project", type="error", link="projects.html",
        target_roles=["Super Admin", "General Manager"], target_departments=[projects[0].department],
        read_by=[], created_at=_utc(0.2),
    ))
    db.add(Notification(
        id="ntf_2", title="Tasks due this week",
        body="You have open tasks ranked CRITICAL by the AI prioritizer.",
        icon="fa-list-check", type="warning", link="tasks.html",
        target_user_ids=["mem_6"], target_roles=[], target_departments=[],
        read_by=[], created_at=_utc(0.5),
    ))
    db.add(Notification(
        id="ntf_3", title="Attendance not yet recorded",
        body="Today's attendance has not been submitted for all tracked workers.",
        icon="fa-clipboard-user", type="info", link="attendance.html",
        target_roles=["Super Admin", "General Manager"],
        target_departments=["Workforce & Attendance"], read_by=[], created_at=_utc(0.1),
    ))

    db.commit()
    log.info("Seed complete: %d users, %d projects, %d departments",
             len(members), len(projects), len(departments))
