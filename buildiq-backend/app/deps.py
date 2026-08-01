"""
BuildIQ — deps.py
Cross-router helpers: role-scoped querying, audit logging, notifications,
and serialization. Keeping scoping in one place means every endpoint enforces
the same visibility rules.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import or_, select
from sqlalchemy.orm import Session, selectinload

from . import ai_engine
from .models import (
    Attendance, AuditLog, Complaint, DailyWorker, Notification, Project, ProjectMember, User
)
from .security import (
    AUDITOR, CLIENT, DEPARTMENT_MANAGER, ENGINEER, ORG_WIDE, PROJECT_MANAGER,
    has_full_project_access, is_workforce_dept,
)


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


# ---------------- Audit ----------------
def record_audit(db: Session, actor: User | None, action: str, resource: str, commit: bool = True) -> AuditLog:
    """Every meaningful mutation funnels through here."""
    actor_name = actor.full_name if actor else "System"
    scored = ai_engine.score_audit_event(action, actor_name)
    entry = AuditLog(
        id=new_id("log"),
        user=actor_name,
        user_role=actor.role if actor else "System",
        action=action,
        resource=resource,
        timestamp=utcnow(),
        **scored,
    )
    db.add(entry)
    if commit:
        db.commit()
    return entry


# ---------------- Notifications ----------------
def push_notification(
    db: Session, title: str, body: str, *, icon: str = "fa-bell", ntype: str = "info",
    link: str | None = None, user_ids: list[str] | None = None,
    roles: list[str] | None = None, departments: list[str] | None = None,
    commit: bool = True,
) -> Notification:
    n = Notification(
        id=new_id("ntf"), title=title, body=body, icon=icon, type=ntype, link=link,
        target_user_ids=[u for u in (user_ids or []) if u],
        target_roles=roles or [],
        target_departments=[d for d in (departments or []) if d],
        read_by=[], created_at=utcnow(),
    )
    db.add(n)
    if commit:
        db.commit()
    return n


def notifications_for(db: Session, user: User) -> list[Notification]:
    rows = db.scalars(select(Notification).order_by(Notification.created_at.desc()).limit(200)).all()
    out = []
    for n in rows:
        if user.id in (n.target_user_ids or []):
            out.append(n)
        elif user.department and user.department in (n.target_departments or []):
            out.append(n)
        elif user.role in (n.target_roles or []):
            out.append(n)
    return out


# ---------------- Role-scoped queries ----------------
def _project_query():
    return select(Project).options(
        selectinload(Project.materials),
        selectinload(Project.members).selectinload(ProjectMember.user),
    )


def visible_projects(db: Session, user: User) -> list[Project]:
    stmt = _project_query()
    if has_full_project_access(user.role):
        pass
    elif user.role == DEPARTMENT_MANAGER:
        assigned = select(ProjectMember.project_id).where(ProjectMember.user_id == user.id)
        stmt = stmt.where(or_(Project.department == user.department,
                              Project.manager_id == user.id,
                              Project.id.in_(assigned)))
    elif user.role == PROJECT_MANAGER:
        # A PM's project list is exactly what they manage — nothing else.
        stmt = stmt.where(Project.manager_id == user.id)
    elif user.role == ENGINEER:
        assigned = select(ProjectMember.project_id).where(ProjectMember.user_id == user.id)
        stmt = stmt.where(or_(Project.id.in_(assigned), Project.manager_id == user.id))
    elif user.role == CLIENT:
        stmt = stmt.where(Project.client_id == (user.client_id or user.id))
    else:
        return []
    return list(db.scalars(stmt).unique().all())


def managed_projects(db: Session, user: User) -> list[Project]:
    return list(db.scalars(_project_query().where(Project.manager_id == user.id)).unique().all())


def managed_team_ids(db: Session, user: User) -> set[str]:
    ids: set[str] = set()
    for p in managed_projects(db, user):
        for pm in p.members:
            if pm.user_id != user.id:
                ids.add(pm.user_id)
    return ids


def visible_members(db: Session, user: User) -> list[User]:
    stmt = select(User)
    if user.role in ORG_WIDE:
        pass
    elif user.role == DEPARTMENT_MANAGER:
        stmt = stmt.where(User.department == user.department)
    elif user.role == PROJECT_MANAGER:
        ids = managed_team_ids(db, user) | {user.id}
        stmt = stmt.where(User.id.in_(ids))
    else:
        stmt = stmt.where(User.id == user.id)
    return list(db.scalars(stmt).all())


def visible_complaints(db: Session, user: User) -> list[Complaint]:
    stmt = select(Complaint).order_by(Complaint.created_at.desc())
    if user.role in ORG_WIDE:
        pass
    elif user.role == DEPARTMENT_MANAGER:
        stmt = stmt.where(Complaint.department == user.department)
    elif user.role == PROJECT_MANAGER:
        titles = {p.title for p in managed_projects(db, user)}
        if not titles:
            stmt = stmt.where(Complaint.submitted_by == user.id)
        else:
            stmt = stmt.where(or_(Complaint.project.in_(titles), Complaint.submitted_by == user.id))
    elif user.role in (ENGINEER, CLIENT):
        stmt = stmt.where(Complaint.submitted_by == user.id)
    else:                                  # Auditor has no complaint access
        return []
    return list(db.scalars(stmt).all())


def visible_attendance(db: Session, user: User) -> list[Attendance]:
    stmt = select(Attendance)
    if user.role in ORG_WIDE or user.role == AUDITOR or is_workforce_dept(user):
        pass
    elif user.role == DEPARTMENT_MANAGER:
        stmt = stmt.where(Attendance.department == user.department)
    elif user.role == PROJECT_MANAGER:
        ids = managed_team_ids(db, user)
        proj_ids = {p.id for p in managed_projects(db, user)}
        if not ids and not proj_ids:
            return []
        stmt = stmt.where(or_(Attendance.person_id.in_(ids or {"__none__"}),
                              Attendance.project_id.in_(proj_ids or {"__none__"})))
    else:
        return []
    return list(db.scalars(stmt).all())


def own_attendance(db: Session, user: User) -> list[Attendance]:
    return list(db.scalars(
        select(Attendance).where(Attendance.person_id == user.id).order_by(Attendance.date.desc())
    ).all())


def visible_daily_workers(db: Session, user: User) -> list[DailyWorker]:
    stmt = select(DailyWorker)
    if user.role in ORG_WIDE or user.role == AUDITOR or is_workforce_dept(user):
        pass
    elif user.role == DEPARTMENT_MANAGER:
        stmt = stmt.where(DailyWorker.department == user.department)
    elif user.role == PROJECT_MANAGER:
        proj_ids = {p.id for p in managed_projects(db, user)}
        if not proj_ids:
            return []
        stmt = stmt.where(DailyWorker.project_id.in_(proj_ids))
    else:
        return []
    return list(db.scalars(stmt).all())


def assignable_workers(db: Session, user: User) -> list[dict]:
    """Who this user may hand a task to."""
    from .security import can_assign_tasks
    if not can_assign_tasks(user.role):
        return []

    if user.role in ORG_WIDE or user.role == AUDITOR:
        staff = list(db.scalars(select(User).where(User.role != CLIENT, User.status == "Active")).all())
        daily = list(db.scalars(select(DailyWorker)).all())
    elif user.role == PROJECT_MANAGER:
        ids = managed_team_ids(db, user)
        staff = list(db.scalars(select(User).where(User.id.in_(ids or {"__none__"}))).all())
        proj_ids = {p.id for p in managed_projects(db, user)}
        daily = list(db.scalars(select(DailyWorker).where(
            DailyWorker.project_id.in_(proj_ids or {"__none__"}))).all())
    else:                                   # Department Manager
        staff = list(db.scalars(select(User).where(
            User.department == user.department, User.role != CLIENT, User.status == "Active")).all())
        daily = list(db.scalars(select(DailyWorker).where(DailyWorker.department == user.department)).all())

    return (
        [{"id": m.id, "name": m.full_name, "type": "staff", "department": m.department} for m in staff]
        + [{"id": w.id, "name": w.full_name, "type": "daily_worker", "department": w.department} for w in daily]
    )


# ---------------- Serialization ----------------
def member_dict(u: User) -> dict:
    return {
        "id": u.id, "full_name": u.full_name, "email": u.email, "role": u.role,
        "roles": u.all_roles, "department": u.department, "job_title": u.job_title,
        "experience_years": u.experience_years, "skills": u.skills or [],
        "status": u.status, "projects_count": u.projects_count,
        "on_time_pct": u.on_time_pct, "phone": u.phone, "joined": u.joined,
        "avatar_color": u.avatar_color,
        "has_avatar": bool(getattr(u, "avatar_url", None)),
    }


def material_dict(m) -> dict:
    return {
        "id": m.id, "project_id": m.project_id, "name": m.name, "unit": m.unit,
        "quantity": m.quantity, "unit_price": m.unit_price, "total_cost": m.total_cost,
        "supplier": m.supplier, "purchased_at": m.purchased_at, "purchased_by": m.purchased_by,
    }


def project_dict(p: Project, include_team: bool = True) -> dict:
    return {
        "id": p.id, "title": p.title, "type": p.type, "region": p.region,
        "department": p.department, "manager_id": p.manager_id,
        "manager_name": p.manager_name, "manager_role": p.manager_role,
        "client_id": p.client_id, "client_name": p.client_name,
        "status": p.status, "progress": p.progress, "expected_progress": p.expected_progress,
        "delay_risk": p.delay_risk, "budget": p.budget, "spent": p.spent,
        "deadline": p.deadline, "tasks_total": p.tasks_total, "tasks_done": p.tasks_done,
        "delay_reasons": p.delay_reasons or [], "description": p.description,
        "materials_total_cost": p.materials_total_cost,
        "materials": [material_dict(m) for m in (p.materials or [])],
        "team": [member_dict(pm.user) for pm in (p.members or []) if pm.user] if include_team else [],
    }


def complaint_dict(c: Complaint) -> dict:
    return {
        "id": c.id, "submitted_by": c.submitted_by, "submitted_by_type": c.submitted_by_type,
        "customer_name": c.customer_name, "category": c.category, "severity": c.severity,
        "status": c.status, "department": c.department, "project": c.project, "text": c.text,
        "sentiment": c.sentiment, "ai_summary": c.ai_summary, "confidence": c.confidence,
        "assignee": c.assignee, "resolution_note": c.resolution_note,
        "created_at": c.created_at, "resolved_at": c.resolved_at,
    }


def attendance_dict(a: Attendance) -> dict:
    return {
        "id": a.id, "person_id": a.person_id, "person_name": a.person_name,
        "person_type": a.person_type, "department": a.department, "project_id": a.project_id,
        "project_title": a.project_title, "date": a.date, "status": a.status,
        "check_in": a.check_in, "recorded_by": a.recorded_by,
        "reason": a.reason, "reason_category": a.reason_category,
        "reason_submitted_at": a.reason_submitted_at, "reason_status": a.reason_status,
        "reason_reviewed_by": a.reason_reviewed_by, "reason_reviewed_at": a.reason_reviewed_at,
        "reason_review_note": a.reason_review_note,
    }


def task_dict(t) -> dict:
    return {
        "id": t.id, "title": t.title, "category": t.category, "assignee_id": t.assignee_id,
        "assignee_name": t.assignee_name, "assignee_type": t.assignee_type,
        "department": t.department, "project_id": t.project_id,
        "project_title": t.project_title, "project_risk": t.project_risk, "status": t.status,
        "blocking": t.blocking, "estimated_hours": t.estimated_hours,
        "due_date": t.due_date, "created_at": t.created_at,
        "assigned_by": t.assigned_by, "assigned_by_role": t.assigned_by_role, "note": t.note or "",
    }


def recalc_materials_total(project: Project) -> float:
    project.materials_total_cost = round(sum(m.total_cost for m in (project.materials or [])), 2)
    return project.materials_total_cost


def format_bytes(n: int) -> str:
    if n < 1024:
        return f"{n} B"
    if n < 1024 * 1024:
        return f"{n / 1024:.0f} KB"
    return f"{n / (1024 * 1024):.1f} MB"


def icon_for_file(name: str) -> tuple[str, str]:
    ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
    table = {
        "pdf": ("fa-file-pdf", "red"),
        "doc": ("fa-file-word", "blue"), "docx": ("fa-file-word", "blue"),
        "xls": ("fa-file-excel", "green"), "xlsx": ("fa-file-excel", "green"), "csv": ("fa-file-excel", "green"),
        "zip": ("fa-file-zipper", "yellow"), "rar": ("fa-file-zipper", "yellow"), "7z": ("fa-file-zipper", "yellow"),
        "png": ("fa-file-image", "purple"), "jpg": ("fa-file-image", "purple"), "jpeg": ("fa-file-image", "purple"),
        "gif": ("fa-file-image", "purple"), "webp": ("fa-file-image", "purple"), "svg": ("fa-file-image", "purple"),
        "txt": ("fa-file-lines", "cyan"), "md": ("fa-file-lines", "cyan"), "log": ("fa-file-lines", "cyan"),
    }
    return table.get(ext, ("fa-file", "gray"))
