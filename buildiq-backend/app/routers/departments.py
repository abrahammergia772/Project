"""
BuildIQ — routers/departments.py
Department list, creation, head appointment, and the drill-down detail view
with an AI health score.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import ai_engine
from ..database import get_db
from ..deps import complaint_dict, member_dict, new_id, project_dict, push_notification, record_audit
from ..models import Complaint, Department, Project, User
from ..schemas import DepartmentCreate, DepartmentHeadAssign, OkResponse
from ..security import (
    CLIENT, DEPARTMENT_MANAGER, ENGINEER, ORG_WIDE, PROJECT_MANAGER,
    can_assign_department_head, can_view_all_departments, get_current_user,
)

router = APIRouter(prefix="/departments", tags=["departments"])


def _visible(db: Session, user: User) -> list[Department]:
    all_depts = list(db.scalars(select(Department).order_by(Department.name)).all())
    if can_view_all_departments(user):
        return all_depts
    if user.role in (DEPARTMENT_MANAGER, ENGINEER, PROJECT_MANAGER):
        return [d for d in all_depts if d.name == user.department]
    return []


@router.get("")
def list_departments(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if user.role == CLIENT:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Access denied — Client has no department access")

    out = []
    for d in _visible(db, user):
        out.append({
            "id": d.id, "name": d.name, "head": d.head, "head_id": d.head_id,
            "description": d.description, "scope": d.scope or [], "budget": d.budget,
            "members": db.scalar(select(func.count()).select_from(User).where(User.department == d.name)) or 0,
            "projects": db.scalar(select(func.count()).select_from(Project).where(Project.department == d.name)) or 0,
        })
    return out


@router.post("", status_code=status.HTTP_201_CREATED)
def create_department(payload: DepartmentCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not can_assign_department_head(user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only an admin or general manager can create departments")

    name = payload.name.strip()
    if db.scalar(select(Department).where(func.lower(Department.name) == name.lower())):
        raise HTTPException(status.HTTP_409_CONFLICT, "A department with that name already exists")

    head = db.get(User, payload.head_id) if payload.head_id else None
    scope = payload.scope if isinstance(payload.scope, list) else \
        [s.strip() for s in str(payload.scope or "").split(",") if s.strip()]

    dept = Department(
        id=new_id("dep"), name=name,
        head=head.full_name if head else "Unassigned",
        head_id=head.id if head else None,
        description=payload.description or f"{name} department.",
        scope=scope, budget=payload.budget or 0,
    )
    db.add(dept)
    # The appointed head moves into the department they now lead.
    if head:
        head.department = name
    db.commit()

    record_audit(db, user, "UPDATE_RECORD", f"departments/{dept.id}")
    if head:
        push_notification(
            db, "You were appointed department head",
            f"{user.full_name} appointed you head of {name}.",
            icon="fa-user-tie", ntype="success", link="departments.html", user_ids=[head.id],
        )
    return {"id": dept.id, "name": dept.name, "head": dept.head, "head_id": dept.head_id,
            "description": dept.description, "scope": dept.scope, "budget": dept.budget,
            "members": 1 if head else 0, "projects": 0}


@router.put("/{department_name}/head")
def set_head(department_name: str, payload: DepartmentHeadAssign,
             user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not can_assign_department_head(user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only an admin or general manager can appoint a department head")

    dept = db.scalar(select(Department).where(Department.name == department_name))
    if dept is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Department not found")

    member = db.get(User, payload.member_id)
    if member is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Member not found")
    if member.department != department_name:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "The head must already belong to that department")

    dept.head = member.full_name
    dept.head_id = member.id
    db.commit()

    record_audit(db, user, "PERMISSION_CHANGE", f"departments/{dept.name}/head")
    push_notification(
        db, "You were appointed department head",
        f"{user.full_name} appointed you head of {dept.name}.",
        icon="fa-user-tie", ntype="success", link="departments.html", user_ids=[member.id],
    )
    return {"id": dept.id, "name": dept.name, "head": dept.head, "head_id": dept.head_id}


@router.get("/{department_id}")
def department_detail(department_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    dept = db.get(Department, department_id)
    if dept is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Department not found")
    if dept.name not in {d.name for d in _visible(db, user)}:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You do not have access to that department")

    members = list(db.scalars(select(User).where(User.department == dept.name)).all())
    projects = list(db.scalars(select(Project).where(Project.department == dept.name)).all())
    complaints = list(db.scalars(select(Complaint).where(Complaint.department == dept.name)).all())

    health = ai_engine.department_health(
        dept.name,
        [project_dict(p, include_team=False) for p in projects],
        [member_dict(m) for m in members],
        [complaint_dict(c) for c in complaints],
    )
    return {
        "id": dept.id, "name": dept.name, "head": dept.head, "head_id": dept.head_id,
        "description": dept.description, "scope": dept.scope or [], "budget": dept.budget,
        "members": [member_dict(m) for m in members],
        "projects": [project_dict(p) for p in projects],
        "complaints": [complaint_dict(c) for c in complaints],
        "health": health,
    }
