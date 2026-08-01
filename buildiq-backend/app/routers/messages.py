"""Direct messages between members.

Scoping rule: a user may only ever read messages they sent or received. There
is no "read anyone's inbox" capability, not even for Super Admin — an admin
who needs message contents should go through the audit trail, not a backdoor
in the messaging API.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import new_id, push_notification, record_audit, visible_members
from ..models import Message, User
from ..schemas import ConversationOut, MessageCreate, MessageOut, OkResponse
from ..security import get_current_user

router = APIRouter(tags=["messages"])


def _dict(m: Message) -> dict:
    return {
        "id": m.id,
        "sender_id": m.sender_id,
        "sender_name": m.sender_name,
        "recipient_id": m.recipient_id,
        "recipient_name": m.recipient_name,
        "body": m.body,
        "is_read": m.is_read,
        "created_at": m.created_at,
    }


@router.get("/messages/contacts")
def contacts(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Who this user may message.

    Reuses visible_members(), so the address book matches the rest of the app:
    an Engineer sees their department, a Super Admin sees everyone. Clients are
    excluded — they contact the org through complaints, not direct messages.
    """
    people = [m for m in visible_members(db, user)
              if m.id != user.id and m.role != "Client"]
    return [{
        "id": m.id,
        "name": m.full_name,
        "role": m.role,
        "department": m.department,
        "job_title": m.job_title,
        "avatar_color": m.avatar_color,
        "avatar_url": getattr(m, "avatar_url", None),
    } for m in sorted(people, key=lambda x: x.full_name or "")]


@router.get("/messages/conversations", response_model=list[ConversationOut])
def conversations(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Inbox: the most recent message per person, newest first."""
    rows = db.scalars(
        select(Message)
        .where(or_(Message.sender_id == user.id, Message.recipient_id == user.id))
        .order_by(Message.created_at.desc())
    ).all()

    threads: dict[str, dict] = {}
    for m in rows:
        other_id = m.recipient_id if m.sender_id == user.id else m.sender_id
        other_name = m.recipient_name if m.sender_id == user.id else m.sender_name
        t = threads.get(other_id)
        if t is None:
            t = threads[other_id] = {
                "user_id": other_id, "name": other_name, "role": None,
                "department": None, "last_message": m.body,
                "last_at": m.created_at, "unread": 0,
            }
        # Unread means: sent TO me and not yet opened.
        if m.recipient_id == user.id and not m.is_read:
            t["unread"] += 1

    if threads:
        for u in db.scalars(select(User).where(User.id.in_(list(threads)))).all():
            threads[u.id]["role"] = u.role
            threads[u.id]["department"] = u.department
            threads[u.id]["name"] = u.full_name or threads[u.id]["name"]

    return sorted(threads.values(), key=lambda t: t["last_at"], reverse=True)


@router.get("/messages/unread-count")
def unread_count(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    n = len(db.scalars(
        select(Message).where(Message.recipient_id == user.id,
                              Message.is_read.is_(False))
    ).all())
    return {"count": n}


@router.get("/messages/{other_id}", response_model=list[MessageOut])
def thread(other_id: str, limit: int = Query(200, le=1000),
           user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """The conversation with one person, oldest first. Marks it read."""
    rows = db.scalars(
        select(Message)
        .where(or_(
            (Message.sender_id == user.id) & (Message.recipient_id == other_id),
            (Message.sender_id == other_id) & (Message.recipient_id == user.id),
        ))
        .order_by(Message.created_at.asc())
        .limit(limit)
    ).all()

    changed = False
    for m in rows:
        if m.recipient_id == user.id and not m.is_read:
            m.is_read = True
            changed = True
    if changed:
        db.commit()

    return [_dict(m) for m in rows]


@router.post("/messages", response_model=MessageOut, status_code=status.HTTP_201_CREATED)
def send(payload: MessageCreate,
         user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if payload.recipient_id == user.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            "You cannot message yourself")

    recipient = db.get(User, payload.recipient_id)
    if recipient is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such member")

    if recipient.role == "Client":
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            "Clients are contacted through complaints, not messages")

    # You may message anyone in your own visibility scope, so messaging cannot
    # be used to discover people the rest of the app hides from you.
    #
    # You may ALSO always reply to someone who has already written to you.
    # Without this an Engineer could not answer a message from the Super
    # Admin -- the Engineer's scope is their department, so the reply was
    # rejected with 403 while the original message went through fine.
    allowed = {m.id for m in visible_members(db, user)}
    if recipient.id not in allowed:
        has_written_to_me = db.scalar(
            select(Message).where(Message.sender_id == recipient.id,
                                  Message.recipient_id == user.id).limit(1)
        )
        if has_written_to_me is None:
            raise HTTPException(status.HTTP_403_FORBIDDEN,
                                "You cannot message that member")

    msg = Message(
        id=new_id("msg"),
        sender_id=user.id, sender_name=user.full_name,
        recipient_id=recipient.id, recipient_name=recipient.full_name,
        body=payload.body.strip(),
    )
    db.add(msg)

    push_notification(
        db,
        title=f"Message from {user.full_name}",
        body=payload.body.strip()[:120],
        icon="fa-envelope", ntype="info",
        link="messages", user_ids=[recipient.id], commit=False,
    )
    record_audit(db, user, "SEND_MESSAGE", f"messages/{recipient.id}")
    db.commit()
    db.refresh(msg)
    return _dict(msg)


@router.put("/messages/{message_id}/read", response_model=OkResponse)
def mark_read(message_id: str,
              user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    m = db.get(Message, message_id)
    if m is None or m.recipient_id != user.id:
        # Same response whether it is missing or someone else's, so this cannot
        # be used to probe for valid message ids.
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such message")
    m.is_read = True
    db.commit()
    return {"ok": True}
