"""
BuildIQ — routers/audit.py
Audit intelligence across the seven audit types: logs, anomalies, the type
taxonomy, reviewer feedback and summary stats.
Access: Super Admin, General Manager, Auditor.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import ai_engine
from ..database import get_db
from ..deps import record_audit
from ..models import AuditLog, User
from ..schemas import AuditFeedbackRequest, AuditLogOut, OkResponse
from ..security import AUDITOR, ORG_WIDE, get_current_user

router = APIRouter(prefix="/audit", tags=["audit"])

AUDIT_ROLES = ORG_WIDE + [AUDITOR]


def _guard(user: User) -> None:
    if user.role not in AUDIT_ROLES:
        raise HTTPException(status.HTTP_403_FORBIDDEN, f"Access denied — {user.role} has no audit access")


@router.get("/types")
def audit_types(user: User = Depends(get_current_user)):
    """The seven audit types, their signals and the ML technique behind each."""
    _guard(user)
    return [{"key": key, **meta} for key, meta in ai_engine.AUDIT_TYPES.items()]


@router.get("/logs", response_model=list[AuditLogOut])
def list_logs(
    flagged: bool | None = None,
    action: str | None = None,
    audit_type: str | None = None,
    risk_level: str | None = None,
    limit: int = Query(200, le=1000),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _guard(user)
    stmt = select(AuditLog).order_by(AuditLog.timestamp.desc())
    if flagged is not None:
        stmt = stmt.where(AuditLog.is_flagged == flagged)
    if action:
        stmt = stmt.where(AuditLog.action == action)
    if audit_type:
        stmt = stmt.where(AuditLog.audit_type == audit_type)
    if risk_level:
        stmt = stmt.where(AuditLog.risk_level == risk_level)
    return list(db.scalars(stmt.limit(limit)).all())


@router.get("/anomalies", response_model=list[AuditLogOut])
def list_anomalies(audit_type: str | None = None,
                   user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _guard(user)
    stmt = select(AuditLog).where(AuditLog.is_flagged.is_(True)).order_by(AuditLog.anomaly_score.desc())
    if audit_type:
        stmt = stmt.where(AuditLog.audit_type == audit_type)
    return list(db.scalars(stmt).all())


@router.get("/stats")
def audit_stats(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _guard(user)
    total = db.scalar(select(func.count()).select_from(AuditLog)) or 0
    flagged = db.scalar(select(func.count()).select_from(AuditLog).where(AuditLog.is_flagged.is_(True))) or 0

    by_type_rows = db.execute(
        select(AuditLog.audit_type, func.count(), func.sum(func.cast(AuditLog.is_flagged, __import__("sqlalchemy").Integer)))
        .group_by(AuditLog.audit_type)
    ).all()
    by_type = {
        key: {
            "label": meta["label"], "ml_role": meta["ml_role"],
            "total": 0, "flagged": 0,
        } for key, meta in ai_engine.AUDIT_TYPES.items()
    }
    for type_key, count, flagged_count in by_type_rows:
        if type_key in by_type:
            by_type[type_key]["total"] = count
            by_type[type_key]["flagged"] = int(flagged_count or 0)

    buckets = [0, 0, 0, 0, 0]
    for (score,) in db.execute(select(AuditLog.anomaly_score)).all():
        buckets[min(4, int((score or 0) * 5))] += 1

    return {
        "total": total, "flagged": flagged, "clean": total - flagged,
        "by_risk_level": dict(db.execute(
            select(AuditLog.risk_level, func.count()).group_by(AuditLog.risk_level)).all()),
        "by_action": dict(db.execute(
            select(AuditLog.action, func.count()).group_by(AuditLog.action)).all()),
        "by_audit_type": by_type,
        "score_histogram": buckets,
    }


@router.post("/feedback", response_model=OkResponse)
def audit_feedback(payload: AuditFeedbackRequest,
                   user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Reviewer verdict on a flagged entry: confirm, dismiss, suspend or revoke."""
    _guard(user)
    log = db.get(AuditLog, payload.id)
    if log is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Audit log entry not found")

    verdicts = {
        "confirm-threat-btn": ("Confirmed Threat", False, "UPDATE_RECORD"),
        "false-alarm-btn": ("False Alarm", False, "UPDATE_RECORD"),
        "suspend-btn": ("Confirmed Threat", True, "SUSPEND_USER"),
        "revoke-btn": ("Confirmed Threat", True, "PERMISSION_CHANGE"),
    }
    if payload.action not in verdicts:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Unknown review action: {payload.action}")

    review_status, keep_flag, audit_action = verdicts[payload.action]
    log.review_status = review_status
    log.is_flagged = keep_flag

    # Suspending acts on the user named in the entry — admins only.
    if payload.action == "suspend-btn":
        if user.role not in ORG_WIDE:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Only an admin or general manager can suspend an account")
        if log.user:
            target = db.scalar(select(User).where(User.full_name == log.user))
            if target and target.id != user.id:
                target.status = "Inactive"

    db.commit()
    record_audit(db, user, audit_action, f"audit_logs/{payload.id}")
    return OkResponse()
