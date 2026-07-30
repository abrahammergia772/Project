"""
BuildIQ — routers/notifications.py
Per-user notification inbox. Read state is stored per user id, so one person
reading a broadcast never marks it read for anyone else.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from ..database import get_db
from ..deps import notifications_for
from ..models import Notification, User
from ..schemas import NotificationOut, OkResponse
from ..security import get_current_user

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
