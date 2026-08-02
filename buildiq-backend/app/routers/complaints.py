"""
BuildIQ — routers/complaints.py
Role-scoped complaint read/submit/resolve, with Groq-backed triage and
suggested resolutions (falling back to keyword heuristics).
"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import ai_engine
from ..database import get_db
from ..deps import (
    complaint_dict, managed_projects, push_notification, record_audit, utcnow, visible_complaints,
)
from ..models import Complaint, Project, User
from ..schemas import (
    ComplaintCreate, ComplaintFeedback, ComplaintOut, ComplaintResolve,
    OkResponse, SuggestSolutionOut, SuggestSolutionRequest,
)
from ..security import AUDITOR, ORG_WIDE, PROJECT_MANAGER, can_resolve_complaint, get_current_user
from ..services import audit_classifier, groq_service

router = APIRouter(prefix="/complaints", tags=["complaints"])


def _managed_titles(db: Session, user: User) -> set[str]:
    if user.role != PROJECT_MANAGER:
        return set()
    return {p.title for p in managed_projects(db, user)}


@router.get("", response_model=list[ComplaintOut])
def list_complaints(
    status_filter: str | None = Query(None, alias="status"),
    severity: str | None = None,
    department: str | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if user.role == AUDITOR:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Access denied — Auditor has no complaint access")

    items = visible_complaints(db, user)
    if status_filter:
        items = [c for c in items if c.status == status_filter]
    if severity:
        items = [c for c in items if c.severity == severity]
    if department:
        items = [c for c in items if c.department == department]
    return [complaint_dict(c) for c in items]


@router.post("", response_model=ComplaintOut, status_code=status.HTTP_201_CREATED)
def create_complaint(payload: ComplaintCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if user.role == AUDITOR:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Access denied — Auditor cannot submit complaints")

    # Groq triage first; keyword heuristics if it's unavailable.
    triage = groq_service.classify_complaint(
        payload.text, ai_engine.COMPLAINT_CATEGORIES, ai_engine.DEPARTMENT_ROUTING
    ) or ai_engine.classify_complaint(payload.text)

    # Sort the complaint into one of the seven audit types from its wording.
    # Independent of the triage above: that picks a department to act on it,
    # this records what KIND of audit concern it is, so the audit dashboard
    # can count complaints alongside structured events.
    classified = audit_classifier.classify(payload.text)

    project = db.get(Project, payload.project_id) if payload.project_id else None
    severity = payload.severity or triage["severity"]

    assignee = db.scalar(select(User).where(
        User.role == "Department Manager", User.department == triage["department"]))

    complaint = Complaint(
        id=f"CMP-{uuid.uuid4().hex[:6].upper()}",
        submitted_by=user.id,
        submitted_by_type="client" if user.role == "Client" else "member",
        customer_name=user.full_name,
        category=triage["category"], severity=severity, status="pending",
        department=triage["department"],
        project=project.title if project else None,
        text=payload.text, sentiment=triage["sentiment"],
        ai_summary=triage["ai_summary"], confidence=triage["confidence"],
        # Stored even when unconfident -- the confidence travels with it so
        # the UI can mark it "needs review" rather than pretending certainty.
        audit_type=classified["audit_type"],
        audit_type_confidence=classified["confidence"],
        assignee=assignee.full_name if assignee else "Unassigned",
        resolution_note="", created_at=utcnow(),
    )
    db.add(complaint)
    db.commit()

    record_audit(db, user, "UPDATE_RECORD", f"complaints/{complaint.id}")
    push_notification(
        db, "New complaint submitted",
        f"{complaint.id} — {complaint.category} on {complaint.project or 'an unassigned project'}.",
        icon="fa-triangle-exclamation", ntype="warning", link="complaints.html",
        roles=list(ORG_WIDE), departments=[complaint.department],
    )
    return complaint_dict(complaint)


@router.put("/{complaint_id}/resolve", response_model=ComplaintOut)
def resolve_complaint(complaint_id: str, payload: ComplaintResolve,
                      user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    complaint = db.get(Complaint, complaint_id)
    if complaint is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Complaint not found")
    if not can_resolve_complaint(user, complaint, _managed_titles(db, user)):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You cannot resolve this complaint")

    complaint.status = "resolved"
    complaint.resolution_note = payload.note
    complaint.resolved_at = utcnow()
    db.commit()

    record_audit(db, user, "UPDATE_RECORD", f"complaints/{complaint.id}")
    if complaint.submitted_by:
        push_notification(
            db, "Your complaint was resolved",
            f"{complaint.id} — {complaint.category} has been marked resolved.",
            icon="fa-circle-check", ntype="success", link="complaints.html",
            user_ids=[complaint.submitted_by],
        )
    return complaint_dict(complaint)


@router.post("/feedback", response_model=OkResponse)
def complaint_feedback(payload: ComplaintFeedback,
                       user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Records whether the AI classification was judged correct (retraining signal)."""
    record_audit(db, user, "UPDATE_RECORD", f"complaints/{payload.id}/feedback")
    return OkResponse()


@router.post("/ai/suggest-solution", response_model=SuggestSolutionOut)
def suggest_solution(payload: SuggestSolutionRequest,
                     user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    category, severity, text = payload.category, payload.severity, payload.text or ""

    if payload.id:
        complaint = db.get(Complaint, payload.id)
        if complaint is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Complaint not found")
        if not can_resolve_complaint(user, complaint, _managed_titles(db, user)):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "You cannot resolve this complaint")
        category, severity, text = complaint.category, complaint.severity, complaint.text
    elif user.role not in ORG_WIDE and user.role not in ("Department Manager", PROJECT_MANAGER):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You cannot resolve complaints")

    drafted = groq_service.suggest_resolution(category, severity, text)
    if drafted:
        return SuggestSolutionOut(solution=drafted, ai_source="groq")
    return SuggestSolutionOut(
        solution=ai_engine.suggest_complaint_solution(category, severity), ai_source="heuristic")
