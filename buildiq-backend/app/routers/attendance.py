"""
BuildIQ — routers/attendance.py
Daily attendance (taken only by the Workforce & Attendance department),
the personal absence-reason workflow, and the AI absence ranking.
"""
from __future__ import annotations

import csv
import io

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import ai_engine
from ..database import get_db
from ..deps import (
    attendance_dict, new_id, own_attendance, push_notification, record_audit, utcnow,
    visible_attendance, visible_daily_workers,
)
from ..models import Attendance, DailyWorker, User
from ..schemas import (
    AbsenceReasonRequest, AbsenceReviewRequest, AttendanceBulkRequest, AttendanceOut, DailyWorkerOut,
)
from ..security import (
    ORG_WIDE, WORKFORCE_DEPT, can_review_absence_reason, can_take_attendance,
    can_view_absence_reasons, can_view_attendance, get_current_user,
)

router = APIRouter(tags=["attendance"])

REASON_CATEGORIES = [
    "Sick Leave", "Family Emergency", "Medical Appointment", "Transport Problem",
    "Bereavement", "Approved Leave", "Personal Matter", "Other",
]


@router.get("/attendance", response_model=list[AttendanceOut])
def list_attendance(
    date: str | None = None,
    status_filter: str | None = Query(None, alias="status"),
    person_type: str | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not can_view_attendance(user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, f"Access denied — {user.role} has no attendance access")

    records = visible_attendance(db, user)
    if date:
        records = [a for a in records if a.date == date]
    if status_filter:
        records = [a for a in records if a.status == status_filter]
    if person_type:
        records = [a for a in records if a.person_type == person_type]
    return [attendance_dict(a) for a in records]


@router.get("/attendance/me", response_model=list[AttendanceOut])
def my_attendance(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Every user can see their own days, whatever their role."""
    return [attendance_dict(a) for a in own_attendance(db, user)]


@router.get("/attendance/reason-categories")
def reason_categories():
    return {"categories": REASON_CATEGORIES}


@router.post("/attendance", response_model=list[AttendanceOut])
def save_attendance(payload: AttendanceBulkRequest,
                    user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Upserts one record per person for the given date. Workforce dept only."""
    if not can_take_attendance(user):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Attendance is taken exclusively by the Workforce & Attendance department",
        )

    saved, absentees = [], []
    for mark in payload.marks:
        existing = db.scalar(select(Attendance).where(
            Attendance.person_id == mark.person_id, Attendance.date == payload.date))

        if mark.person_type == "daily_worker":
            person = db.get(DailyWorker, mark.person_id)
            name = person.full_name if person else mark.person_id
            department = person.department if person else None
            project_id = person.project_id if person else None
            project_title = person.project_title if person else None
        else:
            person = db.get(User, mark.person_id)
            name = person.full_name if person else mark.person_id
            department = person.department if person else None
            project_id = project_title = None

        if existing:
            existing.status = mark.status
            existing.check_in = None if mark.status == "Absent" else (existing.check_in or "08:00")
            existing.recorded_by = user.full_name
            if mark.status == "Absent" and not existing.reason_status:
                existing.reason_status = "Not Submitted"
            if mark.status == "Present":
                existing.reason_status = None
            saved.append(existing)
        else:
            rec = Attendance(
                id=new_id("att"), person_id=mark.person_id, person_name=name,
                person_type=mark.person_type, department=department,
                project_id=project_id, project_title=project_title,
                date=payload.date, status=mark.status,
                check_in=None if mark.status == "Absent" else "08:00",
                recorded_by=user.full_name,
                reason_status="Not Submitted" if mark.status == "Absent" else None,
            )
            db.add(rec)
            saved.append(rec)

        if mark.status == "Absent":
            absentees.append(name)

    db.commit()
    record_audit(db, user, "UPDATE_RECORD", f"attendance/{payload.date}")

    if absentees:
        preview = ", ".join(absentees[:3])
        more = f" +{len(absentees) - 3} more" if len(absentees) > 3 else ""
        push_notification(
            db, f"{len(absentees)} absence{'s' if len(absentees) > 1 else ''} recorded",
            f"{payload.date}: {preview}{more}.",
            icon="fa-user-slash", ntype="warning", link="attendance.html",
            roles=list(ORG_WIDE), departments=[WORKFORCE_DEPT],
        )
    return [attendance_dict(a) for a in saved]


@router.get("/attendance/export")
def export_attendance(
    date: str | None = Query(None, description="Single day, YYYY-MM-DD"),
    start: str | None = Query(None, description="Range start, inclusive"),
    end: str | None = Query(None, description="Range end, inclusive"),
    department: str | None = Query(None),
    status_filter: str | None = Query(None, alias="status",
                                      description="Present or Absent"),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Download the register as a CSV file.

    Defaults to today. Rows are scoped by the caller's own visibility, so a
    Department Manager exports their department while the Workforce &
    Attendance team exports the whole organization -- the file can never
    contain rows the user could not already see on screen.

    Declared BEFORE /attendance/{date}/reason so "export" is not captured as
    a date parameter.
    """
    if not can_view_attendance(user):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            f"Access denied — {user.role} has no attendance access",
        )

    records = visible_attendance(db, user)

    if not date and not start and not end:
        date = utcnow().strftime("%Y-%m-%d")

    if date:
        records = [a for a in records if a.date == date]
    else:
        if start:
            records = [a for a in records if a.date >= start]
        if end:
            records = [a for a in records if a.date <= end]

    if department:
        records = [a for a in records if (a.department or "") == department]
    if status_filter:
        records = [a for a in records if a.status == status_filter]

    records.sort(key=lambda a: (a.date, a.person_name or "", a.person_id))

    buf = io.StringIO()
    writer = csv.writer(buf, lineterminator="\n")
    writer.writerow([
        "Date", "Person", "Person ID", "Type", "Department", "Project",
        "Status", "Check In", "Recorded By",
        "Absence Reason", "Reason Category", "Reason Status", "Reviewed By",
    ])
    for a in records:
        writer.writerow([
            a.date,
            a.person_name or "",
            a.person_id,
            "Daily Worker" if a.person_type == "daily_worker" else "Staff",
            a.department or "",
            a.project_title or "",
            a.status,
            a.check_in or "",
            a.recorded_by or "",
            (a.reason or "").replace("\n", " "),
            a.reason_category or "",
            a.reason_status or "",
            a.reason_reviewed_by or "",
        ])

    present = sum(1 for a in records if a.status == "Present")
    absent = sum(1 for a in records if a.status == "Absent")
    writer.writerow([])
    writer.writerow(["TOTAL", len(records), "", "", "", "",
                     f"Present {present} / Absent {absent}"])

    label = date if date else f"{start or 'start'}_to_{end or 'end'}"
    filename = f"buildiq-attendance-{label}.csv"

    record_audit(db, user, "EXPORT_DATA", f"attendance/export/{label}")
    db.commit()

    # utf-8-sig: Excel needs the BOM to read non-ASCII names correctly.
    return StreamingResponse(
        io.BytesIO(buf.getvalue().encode("utf-8-sig")),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/attendance/{date}/reason", response_model=AttendanceOut)
def submit_reason(date: str, payload: AbsenceReasonRequest,
                  user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """A user explains their own absence. Anyone may do this for their own day."""
    record = db.scalar(select(Attendance).where(
        Attendance.person_id == user.id, Attendance.date == date))
    if record is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No attendance record for that day")
    if record.status != "Absent":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "You can only explain a day marked Absent")
    if record.reason_status == "Accepted":
        raise HTTPException(status.HTTP_409_CONFLICT, "This reason was already accepted and is locked")

    record.reason = payload.reason
    record.reason_category = payload.reason_category or "Other"
    record.reason_submitted_at = utcnow()
    record.reason_status = "Pending"
    # Re-submitting after a rejection clears the previous review.
    record.reason_reviewed_by = None
    record.reason_reviewed_at = None
    record.reason_review_note = None
    db.commit()

    record_audit(db, user, "LATE_SUBMISSION", f"attendance/{date}/reason")
    push_notification(
        db, "Absence reason submitted",
        f"{user.full_name} explained their absence on {date} ({record.reason_category}).",
        icon="fa-comment-dots", link="attendance.html",
        roles=list(ORG_WIDE),
        departments=[d for d in {record.department, WORKFORCE_DEPT} if d],
    )
    return attendance_dict(record)


@router.put("/attendance/{person_id}/{date}/reason/review", response_model=AttendanceOut)
def review_reason(person_id: str, date: str, payload: AbsenceReviewRequest,
                  user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Accept or reject a submitted reason. Auditors read but cannot rule."""
    record = db.scalar(select(Attendance).where(
        Attendance.person_id == person_id, Attendance.date == date))
    if record is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No attendance record for that day")
    if not record.reason:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No reason has been submitted for that day")
    if not can_review_absence_reason(user, record):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You cannot review this absence reason")

    record.reason_status = payload.decision
    record.reason_reviewed_by = user.full_name
    record.reason_reviewed_at = utcnow()
    record.reason_review_note = payload.note or (
        "Reason accepted — absence recorded as excused." if payload.decision == "Accepted"
        else "Reason rejected — absence recorded as unexcused.")
    db.commit()

    record_audit(db, user, "APPROVAL_BYPASS", f"attendance/{date}/reason/{payload.decision.lower()}")
    push_notification(
        db, f"Absence reason {payload.decision.lower()}",
        f"Your reason for {date} was {payload.decision.lower()} by {user.full_name}.",
        icon="fa-circle-check" if payload.decision == "Accepted" else "fa-circle-xmark",
        ntype="success" if payload.decision == "Accepted" else "error",
        link="attendance.html", user_ids=[person_id],
    )
    return attendance_dict(record)


@router.get("/attendance/reasons")
def list_reasons(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """The review queue — Dept Manager, GM, Auditor and Super Admin."""
    if not can_view_absence_reasons(user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, f"Access denied — {user.role} cannot read absence reasons")
    records = [a for a in visible_attendance(db, user) if a.status == "Absent" and a.reason]
    records.sort(key=lambda a: a.reason_submitted_at or utcnow(), reverse=True)
    return [attendance_dict(a) for a in records]


@router.get("/attendance/ranking")
def absence_ranking(window_days: int = 30,
                    user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not can_view_attendance(user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, f"Access denied — {user.role} has no attendance access")
    records = [attendance_dict(a) for a in visible_attendance(db, user)]
    return ai_engine.rank_absences(records, window_days)


@router.get("/daily-workers", response_model=list[DailyWorkerOut])
def list_daily_workers(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not can_view_attendance(user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, f"Access denied — {user.role} has no workforce access")
    return visible_daily_workers(db, user)
