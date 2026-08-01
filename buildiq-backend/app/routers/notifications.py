"""
BuildIQ — routers/notifications.py
Per-user notification inbox. Read state is stored per user id, so one person
reading a broadcast never marks it read for anyone else.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from ..database import get_db
from ..deps import notifications_for, push_notification, record_audit
from ..models import Notification, Project, User
from ..schemas import NotificationCreate, NotificationOut, OkResponse
from ..security import (
    DEPARTMENT_MANAGER, ORG_WIDE, PROJECT_MANAGER, get_current_user,
)

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get("", response_model=list[NotificationOut])
def list_notifications(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return [
        NotificationOut(
            id=n.id, title=n.title, body=n.body, icon=n.icon, type=n.type,
            link=n.link, created_at=n.created_at, read=user.id in (n.read_by or []),
        )
        for n in notifications_for(db, user)
    ]


@router.get("/unread-count")
def unread_count(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return {"count": sum(1 for n in notifications_for(db, user) if user.id not in (n.read_by or []))}


@router.put("/read-all", response_model=OkResponse)
def mark_all_read(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    for n in notifications_for(db, user):
        if user.id not in (n.read_by or []):
            n.read_by = list(n.read_by or []) + [user.id]
            flag_modified(n, "read_by")
    db.commit()
    return OkResponse()


@router.put("/{notification_id}/read", response_model=OkResponse)
def mark_read(notification_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    notification = db.get(Notification, notification_id)
    if notification is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Notification not found")
    # Only mark it if this notification actually targets the caller.
    if notification.id not in {n.id for n in notifications_for(db, user)}:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "That notification is not addressed to you")

    if user.id not in (notification.read_by or []):
        notification.read_by = list(notification.read_by or []) + [user.id]
        flag_modified(notification, "read_by")
        db.commit()
    return OkResponse()


# ---------------------------------------------------------------------------
# Writing notifications
#
# Who may send, and to whom:
#   Super Admin / General Manager  anyone, any role, any department
#   Department Manager             their own department only
#   Project Manager                members of projects they manage
#   everyone else                  not permitted
# ---------------------------------------------------------------------------

def _can_send(user: User) -> bool:
    return user.role in ORG_WIDE or user.role in (DEPARTMENT_MANAGER, PROJECT_MANAGER)


def _permitted_user_ids(db: Session, user: User) -> set[str] | None:
    """User ids this sender may target. None means 'no restriction'."""
    if user.role in ORG_WIDE:
        return None

    if user.role == DEPARTMENT_MANAGER:
        rows = db.scalars(
            select(User).where(User.department == user.department)).all()
        return {u.id for u in rows}

    if user.role == PROJECT_MANAGER:
        # Everyone on a project this person manages, via the team join table.
        managed = db.scalars(
            select(Project).where(Project.manager_id == user.id)).all()
        ids: set[str] = set()
        for p in managed:
            for member in getattr(p, "team", []) or []:
                uid = getattr(member, "user_id", None) or getattr(member, "id", None)
                if uid:
                    ids.add(uid)
        ids.add(user.id)
        return ids

    return set()


@router.post("", response_model=NotificationOut, status_code=status.HTTP_201_CREATED)
def create_notification(payload: NotificationCreate,
                        user: User = Depends(get_current_user),
                        db: Session = Depends(get_db)):
    if not _can_send(user):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            f"Access denied — {user.role} cannot send notifications")

    if not (payload.user_ids or payload.roles or payload.departments):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "Choose at least one recipient")

    roles = list(payload.roles)
    departments = list(payload.departments)
    user_ids = list(payload.user_ids)

    if user.role not in ORG_WIDE:
        # Broadcasting by role or department is org-wide reach, so it is
        # limited to Super Admin and General Manager. Everyone else names
        # individuals -- and only individuals inside their own scope.
        if roles:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                "Only Super Admin and General Manager can notify a whole role")
        if user.role == DEPARTMENT_MANAGER:
            outside = [d for d in departments if d != user.department]
            if outside:
                raise HTTPException(
                    status.HTTP_403_FORBIDDEN,
                    "You can only notify your own department")
        elif departments:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                "You can only notify individual members")

        allowed = _permitted_user_ids(db, user)
        if allowed is not None:
            blocked = [uid for uid in user_ids if uid not in allowed]
            if blocked:
                raise HTTPException(
                    status.HTTP_403_FORBIDDEN,
                    "Some recipients are outside the people you manage")

    n = push_notification(
        db,
        title=payload.title.strip(),
        body=payload.body.strip(),
        icon="fa-bullhorn",
        ntype=payload.type or "info",
        link=payload.link,
        user_ids=user_ids,
        roles=roles,
        departments=departments,
        commit=False,
    )
    record_audit(db, user, "SEND_NOTIFICATION", f"notifications/{n.id}")
    db.commit()
    db.refresh(n)

    return NotificationOut(
        id=n.id, title=n.title, body=n.body, icon=n.icon, type=n.type,
        link=n.link, created_at=n.created_at, read=False,
    )


@router.get("/can-send")
def can_send(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Lets the UI show or hide the compose button without guessing the rules."""
    allowed = _can_send(user)
    return {
        "can_send": allowed,
        "can_broadcast_roles": user.role in ORG_WIDE,
        "can_target_departments": user.role in ORG_WIDE or user.role == DEPARTMENT_MANAGER,
        "scope": ("organization" if user.role in ORG_WIDE else
                  "department" if user.role == DEPARTMENT_MANAGER else
                  "projects" if user.role == PROJECT_MANAGER else "none"),
    }
