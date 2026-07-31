"""
BuildIQ — routers/reports.py
Role-scoped report generation with a Groq-written narrative (heuristic
fallback), saved-report history, and a plain-text download.
"""
from __future__ import annotations

import io

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import ai_engine
from ..database import get_db
from ..deps import (
    attendance_dict, complaint_dict, managed_projects, member_dict, new_id, project_dict,
    record_audit, utcnow, visible_attendance, visible_complaints, visible_members, visible_projects,
)
from ..models import SavedReport, User
from ..schemas import ReportOut, ReportRequest, SavedReportOut
from ..security import (
    CLIENT, DEPARTMENT_MANAGER, ORG_WIDE, PROJECT_MANAGER,
    get_current_user, report_scope_locked, report_types_for,
)
from ..services import groq_service

router = APIRouter(prefix="/reports", tags=["reports"])


@router.get("/types")
def available_types(user: User = Depends(get_current_user)):
    return {"types": report_types_for(user.role), "scope_locked": report_scope_locked(user.role)}


def _build(db: Session, user: User, payload: ReportRequest) -> ReportOut:
    allowed = report_types_for(user.role)
    if not allowed:
        raise HTTPException(status.HTTP_403_FORBIDDEN, f"Access denied — {user.role} cannot generate reports")
    if payload.type not in allowed:
        raise HTTPException(status.HTTP_403_FORBIDDEN, f"{user.role} cannot generate a '{payload.type}'")

    # Locked-scope roles never widen their own view.
    scope = payload.scope
    if user.role == DEPARTMENT_MANAGER:
        scope = user.department or scope
    elif user.role == CLIENT:
        scope = "My Project"
    elif user.role == PROJECT_MANAGER:
        scope = "My Projects"

    projects = [project_dict(p, include_team=False) for p in
                (managed_projects(db, user) if user.role == PROJECT_MANAGER else visible_projects(db, user))]
    complaints = [complaint_dict(c) for c in visible_complaints(db, user)]
    members = [member_dict(m) for m in visible_members(db, user)]

    # Org-wide roles may narrow to a single department.
    if user.role in ORG_WIDE and payload.scope != "Entire Organization":
        projects = [p for p in projects if p["department"] == payload.scope]
        complaints = [c for c in complaints if c["department"] == payload.scope]
        members = [m for m in members if m["department"] == payload.scope]

    ranked: list[dict] = []
    if payload.type == "Attendance & Absence Report":
        records = [attendance_dict(a) for a in visible_attendance(db, user)]
        if user.role in ORG_WIDE and payload.scope != "Entire Organization":
            records = [r for r in records if r["department"] == payload.scope]
        ranked = ai_engine.rank_absences(records)

    ctx = {"projects": projects, "complaints": complaints, "members": members,
           "department": user.department, "rankedAbsences": ranked}

    # Ask Groq for the narrative; fall back to the deterministic text.
    source = "heuristic"
    open_complaints = sum(1 for c in complaints if c["status"] != "resolved")
    high_risk = sum(1 for p in projects if p["delay_risk"] == "HIGH")
    facts = (
        f"- Projects in scope: {len(projects)} ({high_risk} at HIGH delay risk)\n"
        f"- Complaints: {len(complaints)} total, {open_complaints} still open\n"
        f"- Team members: {len(members)}\n"
        f"- Average project progress: "
        f"{round(sum(p['progress'] for p in projects) / len(projects)) if projects else 0}% "
        f"(expected {round(sum(p['expected_progress'] for p in projects) / len(projects)) if projects else 0}%)\n"
    )
    if ranked:
        flagged = [r for r in ranked if r["ai_risk"] in ("CRITICAL", "HIGH")]
        facts += f"- Attendance: {len(flagged)} of {len(ranked)} tracked people show elevated absence risk\n"
        if flagged:
            facts += "- Most concerning: " + ", ".join(
                f"{r['person_name']} ({r['absence_rate']}%)" for r in flagged[:3]) + "\n"

    content = groq_service.report_narrative(payload.type, scope, facts)
    if content:
        source = "groq"
    else:
        content = ai_engine.build_report_narrative(payload.type, scope, ctx)

    return ReportOut(
        title=payload.type, generated_at=utcnow(), content=content,
        stats={"projects": len(projects), "complaints": len(complaints), "members": len(members)},
        rankedAbsences=ranked, ai_source=source,
    )


@router.post("/generate", response_model=ReportOut)
def generate_report(payload: ReportRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    report = _build(db, user, payload)
    db.add(SavedReport(
        id=new_id("rep"), name=report.title, type=report.title, scope=payload.scope,
        content=report.content, stats=report.stats,
        generated_by=user.full_name, generated_by_id=user.id, generated_at=report.generated_at,
    ))
    db.commit()
    record_audit(db, user, "REPORT_GENERATE", f"reports/{report.title}")
    return report


@router.get("", response_model=list[SavedReportOut])
def list_saved(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    stmt = select(SavedReport).order_by(SavedReport.generated_at.desc())
    if user.role not in ORG_WIDE:
        stmt = stmt.where(SavedReport.generated_by_id == user.id)
    return list(db.scalars(stmt.limit(100)).all())


@router.post("/download")
def download_report(payload: ReportRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Returns the report as a real .txt attachment."""
    report = _build(db, user, payload)

    lines = [
        "=" * 64, f"BuildIQ — {report.title}", "=" * 64,
        f"Scope:        {payload.scope}",
        f"Generated at: {report.generated_at:%Y-%m-%d %H:%M} UTC",
        f"Generated by: {user.full_name} ({user.role})",
        "", "EXECUTIVE SUMMARY", "-" * 64, report.content, "",
    ]
    if report.rankedAbsences:
        lines += ["AI ABSENCE RANKING", "-" * 64,
                  f"{'#':<5}{'Person':<26}{'Type':<15}{'Absence':<10}AI Risk"]
        for i, r in enumerate(report.rankedAbsences, start=1):
            ptype = "Daily Worker" if r["person_type"] == "daily_worker" else "Staff"
            lines.append(f"{i:<5}{str(r['person_name'])[:25]:<26}{ptype:<15}"
                         f"{str(r['absence_rate']) + '%':<10}{r['ai_risk']}")
    else:
        lines += ["KEY METRICS", "-" * 64,
                  f"Projects:      {report.stats['projects']}",
                  f"Complaints:    {report.stats['complaints']}",
                  f"Team members:  {report.stats['members']}"]
    lines += ["", "-" * 64, "Generated by BuildIQ — AI-Powered Construction Management"]

    slug = report.title.lower().replace(" ", "-").replace("&", "and")
    filename = f"buildiq-{slug}-{report.generated_at:%Y-%m-%d}.txt"

    record_audit(db, user, "EXPORT_DATA", f"reports/{report.title}/download")
    return StreamingResponse(
        io.BytesIO("\n".join(lines).encode("utf-8")),
        media_type="text/plain; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
