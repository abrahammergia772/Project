"""
BuildIQ — routers/tasks.py
Tasks, assignment to workers, and the AI prioritization / auto-scheduling endpoints.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from .. import ai_engine
from ..database import get_db
from ..deps import (
    assignable_workers, managed_projects, new_id, push_notification, record_audit,
    task_dict, utcnow,
)
from ..models import DailyWorker, Project, Task, User
from ..schemas import OkResponse, TaskAssign, TaskCreate, TaskIdsRequest, TaskOut, TaskUpdate
from ..security import (
    AUDITOR, CLIENT, DEPARTMENT_MANAGER, ORG_WIDE, PROJECT_MANAGER,
    can_assign_tasks, get_current_user,
)

router = APIRouter(prefix="/tasks", tags=["tasks"])


def _scoped(db: Session, user: User, assignee_id: str | None = None,
            department: str | None = None, status_filter: str | None = None) -> list[Task]:
    if user.role == CLIENT:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Access denied — Client has no task access")

    stmt = select(Task)
    if user.role in ORG_WIDE or user.role == AUDITOR:
        pass
    elif user.role == DEPARTMENT_MANAGER:
        stmt = stmt.where(or_(Task.department == user.department, Task.assignee_id == user.id))
    elif user.role == PROJECT_MANAGER:
        ids = {p.id for p in managed_projects(db, user)}
        stmt = stmt.where(or_(Task.project_id.in_(ids or {"__none__"}), Task.assignee_id == user.id))
    else:                                       # Engineer — own tasks only
        stmt = stmt.where(Task.assignee_id == user.id)

    if assignee_id:
        stmt = stmt.where(Task.assignee_id == assignee_id)
    if department:
        stmt = stmt.where(Task.department == department)
    if status_filter:
        stmt = stmt.where(Task.status == status_filter)
    return list(db.scalars(stmt).all())


@router.get("", response_model=list[TaskOut])
def list_tasks(
    assignee_id: str | None = None,
    department: str | None = None,
    status_filter: str | None = Query(None, alias="status"),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return [task_dict(t) for t in _scoped(db, user, assignee_id, department, status_filter)]


@router.post("", response_model=TaskOut, status_code=status.HTTP_201_CREATED)
def create_task(payload: TaskCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if user.role in (AUDITOR, CLIENT):
        raise HTTPException(status.HTTP_403_FORBIDDEN, f"Access denied — {user.role} cannot create tasks")

    assignee_id = payload.assignee_id or user.id
    if assignee_id != user.id and not can_assign_tasks(user.role):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You can only create tasks for yourself")

    assignee = db.get(User, assignee_id)
    if assignee is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Assignee not found")
    if user.role == DEPARTMENT_MANAGER and assignee.department != user.department:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "That assignee is outside your department")

    project = db.get(Project, payload.project_id) if payload.project_id else None
    task = Task(
        id=new_id("task"), title=payload.title, category=payload.category,
        assignee_id=assignee.id, assignee_name=assignee.full_name, assignee_type="staff",
        department=assignee.department,
        project_id=project.id if project else None,
        project_title=project.title if project else "General",
        project_risk=project.delay_risk if project else "LOW",
        status=payload.status, blocking=payload.blocking,
        estimated_hours=payload.estimated_hours, due_date=payload.due_date,
        created_at=utcnow(),
    )
    db.add(task)
    db.commit()

    record_audit(db, user, "UPDATE_RECORD", f"tasks/{task.id}")
    return task_dict(task)


@router.post("/assign", response_model=TaskOut, status_code=status.HTTP_201_CREATED)
def assign_task(payload: TaskAssign, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Dept Manager, GM, Auditor and Super Admin can send work to a worker."""
    if not can_assign_tasks(user.role):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You cannot assign tasks")

    targets = {t["id"]: t for t in assignable_workers(db, user)}
    target = targets.get(payload.assignee_id)
    if target is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "That worker is not in your assignable scope")

    project = db.get(Project, payload.project_id) if payload.project_id else None
    task = Task(
        id=new_id("task"), title=payload.title, category=payload.category or "Coordination",
        assignee_id=target["id"], assignee_name=target["name"], assignee_type=target["type"],
        department=target["department"],
        project_id=project.id if project else None,
        project_title=project.title if project else "General",
        project_risk=project.delay_risk if project else "LOW",
        status="To Do", blocking=payload.blocking,
        estimated_hours=payload.estimated_hours, due_date=payload.due_date,
        created_at=utcnow(), assigned_by=user.full_name, assigned_by_role=user.role,
        note=payload.note or "",
    )
    db.add(task)
    db.commit()

    record_audit(db, user, "UPDATE_RECORD", f"tasks/{task.id}")
    # Daily workers have no login, so only notify staff.
    if target["type"] == "staff":
        due = task.due_date.strftime("%a %b %d %Y") if task.due_date else "soon"
        push_notification(
            db, "New task assigned to you",
            f'{user.full_name} ({user.role}) assigned "{task.title}" — due {due}.',
            icon="fa-list-check", link="tasks.html", user_ids=[target["id"]],
        )
    return task_dict(task)


@router.put("/{task_id}", response_model=TaskOut)
def update_task(task_id: str, payload: TaskUpdate,
                user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    task = db.get(Task, task_id)
    if task is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Task not found")

    managed_ids = {p.id for p in managed_projects(db, user)} if user.role == PROJECT_MANAGER else set()
    allowed = (task.assignee_id == user.id
               or user.role in ORG_WIDE
               or (user.role == DEPARTMENT_MANAGER and task.department == user.department)
               or (task.project_id in managed_ids))
    if not allowed:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You cannot modify this task")

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(task, field, value)
    db.commit()

    record_audit(db, user, "UPDATE_RECORD", f"tasks/{task.id}")
    return task_dict(task)


@router.delete("/{task_id}", response_model=OkResponse)
def delete_task(task_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    task = db.get(Task, task_id)
    if task is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Task not found")

    managed_ids = {p.id for p in managed_projects(db, user)} if user.role == PROJECT_MANAGER else set()
    allowed = (task.assignee_id == user.id or user.role in ORG_WIDE
               or (user.role == DEPARTMENT_MANAGER and task.department == user.department)
               or (task.project_id in managed_ids))
    if not allowed:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You cannot delete this task")

    db.delete(task)
    db.commit()
    record_audit(db, user, "UPDATE_RECORD", f"tasks/{task_id}")
    return OkResponse()


@router.post("/ai/prioritize")
def ai_prioritize(payload: TaskIdsRequest | None = None,
                  user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Re-ranks tasks by urgency + project risk + blocking impact."""
    payload = payload or TaskIdsRequest()
    scoped = _scoped(db, user)
    if payload.task_ids:
        wanted = set(payload.task_ids)
        scoped = [t for t in scoped if t.id in wanted]
    return ai_engine.prioritize_tasks(task_dict(t) for t in scoped)


@router.post("/ai/schedule")
def ai_schedule(payload: TaskIdsRequest | None = None,
                user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Places the highest-priority open tasks into a Mon-Fri weekly slot grid."""
    payload = payload or TaskIdsRequest()
    scoped = _scoped(db, user, assignee_id=user.id)
    if payload.task_ids:
        wanted = set(payload.task_ids)
        scoped = [t for t in scoped if t.id in wanted]
    return ai_engine.auto_schedule(task_dict(t) for t in scoped)


@router.get("/assignable")
def list_assignable(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Who this user may hand a task to (staff + daily workers in scope)."""
    if not can_assign_tasks(user.role):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You cannot assign tasks")
    return assignable_workers(db, user)
