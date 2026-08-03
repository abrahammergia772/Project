"""
BuildIQ — routers/shifts.py
Shift patterns, overtime, and bulk attendance import from Excel/CSV.

All three are Workforce & Attendance work, so they share this module and the
same authorisation rule as the register itself: only that department may
write. Oversight roles may read.
"""
from __future__ import annotations

import csv
import io
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import (
    new_id, push_notification, record_audit, registerable_staff, utcnow,
    visible_daily_workers,
)
from ..models import Attendance, DailyWorker, Overtime, Shift, User
from ..schemas import (
    ImportPreview, ImportResult, ImportRowResult, OkResponse, OvertimeCreate,
    OvertimeOut, OvertimeReviewRequest, ShiftAssignRequest, ShiftCreate,
    ShiftOut, ShiftUpdate,
)
from ..security import (
    ORG_WIDE, can_take_attendance, can_view_attendance, get_current_user,
)

router = APIRouter(tags=["shifts"])

MAX_IMPORT_BYTES = 5 * 1024 * 1024        # 5 MB
MAX_IMPORT_ROWS = 5000


def _require_workforce(user: User) -> None:
    if not can_take_attendance(user):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Only the Workforce & Attendance department can manage shifts, "
            "overtime and imports",
        )


def _require_oversight(user: User) -> None:
    if not can_view_attendance(user):
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            f"Access denied — {user.role} has no attendance access")


# ---------------- Shift maths ----------------
def _minutes(hhmm: str) -> int:
    h, m = hhmm.split(":")
    return int(h) * 60 + int(m)


def shift_hours(start: str, end: str, break_minutes: int) -> float:
    """Paid hours in one shift.

    An end time at or before the start means the shift crosses midnight: a
    night shift is 22:00-06:00 (eight hours), not minus sixteen.
    """
    span = _minutes(end) - _minutes(start)
    if span <= 0:
        span += 24 * 60
    return round(max(0, span - max(0, break_minutes)) / 60, 2)


def _shift_dict(s: Shift, assigned: int = 0) -> dict:
    return {
        "id": s.id, "name": s.name, "start_time": s.start_time,
        "end_time": s.end_time, "break_minutes": s.break_minutes,
        "work_days": s.work_days or [], "color": s.color,
        "is_default": s.is_default, "active": s.active,
        "hours": shift_hours(s.start_time, s.end_time, s.break_minutes),
        "assigned_count": assigned,
    }


def _assignment_counts(db: Session) -> dict[str, int]:
    rows = db.execute(
        select(User.shift, func.count()).where(User.shift.is_not(None)).group_by(User.shift)
    ).all()
    counts = {name: n for name, n in rows}
    for name, n in db.execute(
        select(DailyWorker.shift, func.count())
        .where(DailyWorker.shift.is_not(None)).group_by(DailyWorker.shift)
    ).all():
        counts[name] = counts.get(name, 0) + n
    return counts


@router.get("/shifts", response_model=list[ShiftOut])
def list_shifts(include_inactive: bool = False,
                user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _require_oversight(user)
    stmt = select(Shift).order_by(Shift.start_time)
    if not include_inactive:
        stmt = stmt.where(Shift.active.is_(True))
    counts = _assignment_counts(db)
    return [_shift_dict(s, counts.get(s.name, 0)) for s in db.scalars(stmt).all()]


@router.post("/shifts", response_model=ShiftOut, status_code=status.HTTP_201_CREATED)
def create_shift(payload: ShiftCreate,
                 user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _require_workforce(user)

    name = payload.name.strip()
    if db.scalar(select(Shift).where(func.lower(Shift.name) == name.lower())):
        raise HTTPException(status.HTTP_409_CONFLICT, f"A shift called {name!r} already exists")

    bad = [d for d in payload.work_days if d < 0 or d > 6]
    if bad:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            f"Work days must be 0 (Monday) to 6 (Sunday); got {bad}")

    shift = Shift(
        id=new_id("shift"), name=name, start_time=payload.start_time,
        end_time=payload.end_time, break_minutes=payload.break_minutes,
        work_days=sorted(set(payload.work_days)), color=payload.color,
        is_default=payload.is_default,
    )
    db.add(shift)
    db.flush()
    if payload.is_default:
        _clear_other_defaults(db, shift.id)
    record_audit(db, user, "UPDATE_RECORD", f"shifts/{shift.id}")
    db.commit()
    db.refresh(shift)
    return _shift_dict(shift)


def _clear_other_defaults(db: Session, keep_id: str) -> None:
    """Exactly one default. Two defaults means new joiners get whichever the
    query happened to return first."""
    for other in db.scalars(select(Shift).where(Shift.is_default.is_(True),
                                                Shift.id != keep_id)).all():
        other.is_default = False


@router.put("/shifts/{shift_id}", response_model=ShiftOut)
def update_shift(shift_id: str, payload: ShiftUpdate,
                 user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _require_workforce(user)
    shift = db.get(Shift, shift_id)
    if shift is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such shift")

    old_name = shift.name
    data = payload.model_dump(exclude_unset=True)

    if "name" in data and data["name"]:
        new_name = data["name"].strip()
        clash = db.scalar(select(Shift).where(func.lower(Shift.name) == new_name.lower(),
                                              Shift.id != shift_id))
        if clash:
            raise HTTPException(status.HTTP_409_CONFLICT,
                                f"A shift called {new_name!r} already exists")
        data["name"] = new_name

    if "work_days" in data and data["work_days"] is not None:
        bad = [d for d in data["work_days"] if d < 0 or d > 6]
        if bad:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                                f"Work days must be 0-6; got {bad}")
        data["work_days"] = sorted(set(data["work_days"]))

    for key, value in data.items():
        setattr(shift, key, value)

    # People reference a shift by NAME, so a rename has to follow through or
    # everyone silently falls back to the default.
    if shift.name != old_name:
        for model in (User, DailyWorker):
            for person in db.scalars(select(model).where(model.shift == old_name)).all():
                person.shift = shift.name

    if data.get("is_default"):
        _clear_other_defaults(db, shift.id)

    record_audit(db, user, "UPDATE_RECORD", f"shifts/{shift.id}")
    db.commit()
    db.refresh(shift)
    return _shift_dict(shift, _assignment_counts(db).get(shift.name, 0))


@router.delete("/shifts/{shift_id}", response_model=OkResponse)
def delete_shift(shift_id: str,
                 user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Deactivates rather than deletes when people are still assigned.

    Hard-deleting a shift someone is on would leave dangling names on member
    records, and historical rosters would stop making sense.
    """
    _require_workforce(user)
    shift = db.get(Shift, shift_id)
    if shift is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such shift")

    assigned = _assignment_counts(db).get(shift.name, 0)
    if assigned:
        shift.active = False
        record_audit(db, user, "UPDATE_RECORD", f"shifts/{shift.id}/deactivate")
        db.commit()
        return OkResponse(ok=True,
                          message=f"{assigned} people are on this shift, so it was "
                                  "deactivated rather than deleted.")

    db.delete(shift)
    record_audit(db, user, "RECORD_DELETE", f"shifts/{shift_id}")
    db.commit()
    return OkResponse(ok=True, message="Shift deleted.")


@router.post("/shifts/assign", response_model=OkResponse)
def assign_shift(payload: ShiftAssignRequest,
                 user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _require_workforce(user)

    name = (payload.shift_name or "").strip() or None
    if name:
        shift = db.scalar(select(Shift).where(func.lower(Shift.name) == name.lower()))
        if shift is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, f"No shift called {name!r}")
        if not shift.active:
            raise HTTPException(status.HTTP_409_CONFLICT,
                                f"{shift.name} is not active; reactivate it first")
        name = shift.name                      # canonical casing

    updated = 0
    for pid in payload.person_ids:
        person = db.get(User, pid) or db.get(DailyWorker, pid)
        if person is None:
            continue
        person.shift = name
        updated += 1

    record_audit(db, user, "UPDATE_RECORD", f"shifts/assign/{updated}")
    db.commit()
    return OkResponse(ok=True, message=f"{updated} people updated.")


# ---------------- Overtime ----------------
def _overtime_dict(o: Overtime) -> dict:
    return {
        "id": o.id, "person_id": o.person_id, "person_name": o.person_name,
        "person_type": o.person_type, "department": o.department, "date": o.date,
        "hours": o.hours, "rate_multiplier": o.rate_multiplier, "reason": o.reason,
        "status": o.status, "requested_by": o.requested_by,
        "reviewed_by": o.reviewed_by, "reviewed_at": o.reviewed_at,
        "review_note": o.review_note, "created_at": o.created_at,
        "equivalent_hours": round(o.hours * o.rate_multiplier, 2),
    }


def _visible_overtime(db: Session, user: User) -> list[Overtime]:
    stmt = select(Overtime).order_by(Overtime.date.desc(), Overtime.created_at.desc())
    if can_take_attendance(user) or user.role in ORG_WIDE or user.role == "Auditor":
        return list(db.scalars(stmt).all())
    if user.role == "Department Manager":
        return list(db.scalars(stmt.where(Overtime.department == user.department)).all())
    # Everyone else sees only their own claims.
    return list(db.scalars(stmt.where(Overtime.person_id == user.id)).all())


@router.get("/overtime", response_model=list[OvertimeOut])
def list_overtime(month: str | None = Query(None, pattern=r"^\d{4}-\d{2}$"),
                  status_filter: str | None = Query(None, alias="status"),
                  user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    records = _visible_overtime(db, user)
    if month:
        records = [o for o in records if o.date.startswith(month)]
    if status_filter:
        records = [o for o in records if o.status == status_filter]
    return [_overtime_dict(o) for o in records]


@router.post("/overtime", response_model=OvertimeOut, status_code=status.HTTP_201_CREATED)
def log_overtime(payload: OvertimeCreate,
                 user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _require_workforce(user)

    if payload.person_type == "daily_worker":
        person = db.get(DailyWorker, payload.person_id)
        name = person.full_name if person else None
        dept = person.department if person else None
    else:
        person = db.get(User, payload.person_id)
        name = person.full_name if person else None
        dept = person.department if person else None
    if person is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such person")

    # Overtime in the future is always a mistake -- the hours have not been
    # worked yet.
    if payload.date > datetime.now(timezone.utc).strftime("%Y-%m-%d"):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "Overtime cannot be logged for a future date")

    # Guard the daily total, not just one entry: three separate 6-hour claims
    # on one day is the same impossible day as a single 18-hour claim.
    already = sum(o.hours for o in db.scalars(select(Overtime).where(
        Overtime.person_id == payload.person_id, Overtime.date == payload.date,
        Overtime.status != "Rejected")).all())
    if already + payload.hours > 16:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"That would total {already + payload.hours:g} overtime hours on "
            f"{payload.date}; the daily limit is 16.")

    entry = Overtime(
        id=new_id("ot"), person_id=payload.person_id, person_name=name,
        person_type=payload.person_type, department=dept, date=payload.date,
        hours=payload.hours, rate_multiplier=payload.rate_multiplier,
        reason=payload.reason, status="Pending", requested_by=user.full_name,
    )
    db.add(entry)

    push_notification(
        db, "Overtime awaiting approval",
        f"{name} — {payload.hours:g}h on {payload.date}.",
        icon="fa-clock", ntype="info", link="attendance",
        roles=list(ORG_WIDE), departments=[dept] if dept else None, commit=False,
    )
    record_audit(db, user, "UPDATE_RECORD", f"overtime/{entry.id}")
    db.commit()
    db.refresh(entry)
    return _overtime_dict(entry)


@router.put("/overtime/{overtime_id}/review", response_model=OvertimeOut)
def review_overtime(overtime_id: str, payload: OvertimeReviewRequest,
                    user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Approve or reject. Deliberately NOT the workforce department's call:
    they log the hours, management authorises the cost."""
    if user.role not in ORG_WIDE and user.role != "Department Manager":
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            "Only a manager can approve or reject overtime")

    entry = db.get(Overtime, overtime_id)
    if entry is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such overtime record")

    # Separation of duties: whoever LOGGED the hours cannot also authorise
    # them. The Workforce & Attendance lead is a Department Manager, so
    # without this the one person who records overtime could sign off their
    # own entries -- removing the only check on payroll spend. Org-wide roles
    # are exempt because they are the escalation path.
    if user.role not in ORG_WIDE and entry.requested_by == user.full_name:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "You logged this overtime, so you cannot also approve it. "
            "Ask a general manager or admin to review it.")

    if user.role == "Department Manager" and entry.department != user.department:
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            "That overtime belongs to another department")

    if payload.status not in ("Approved", "Rejected"):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "Status must be Approved or Rejected")

    # Nobody may approve their own overtime, whatever their role.
    if entry.person_id == user.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            "You cannot review your own overtime")

    entry.status = payload.status
    entry.reviewed_by = user.full_name
    entry.reviewed_at = utcnow()
    entry.review_note = payload.note

    push_notification(
        db, f"Overtime {payload.status.lower()}",
        f"{entry.hours:g}h on {entry.date}"
        + (f" — {payload.note}" if payload.note else "."),
        icon="fa-clock", ntype="success" if payload.status == "Approved" else "warning",
        link="attendance", user_ids=[entry.person_id], commit=False,
    )
    record_audit(db, user, "UPDATE_RECORD", f"overtime/{entry.id}/{payload.status.lower()}")
    db.commit()
    db.refresh(entry)
    return _overtime_dict(entry)


@router.delete("/overtime/{overtime_id}", response_model=OkResponse)
def delete_overtime(overtime_id: str,
                    user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _require_workforce(user)
    entry = db.get(Overtime, overtime_id)
    if entry is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such overtime record")
    if entry.status == "Approved":
        raise HTTPException(status.HTTP_409_CONFLICT,
                            "Approved overtime cannot be deleted; reject it instead "
                            "so the decision stays on record")
    db.delete(entry)
    record_audit(db, user, "RECORD_DELETE", f"overtime/{overtime_id}")
    db.commit()
    return OkResponse(ok=True, message="Overtime entry removed.")


@router.get("/overtime/summary")
def overtime_summary(month: str = Query(..., pattern=r"^\d{4}-\d{2}$"),
                     user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _require_oversight(user)
    records = [o for o in _visible_overtime(db, user) if o.date.startswith(month)]
    approved = [o for o in records if o.status == "Approved"]
    by_person: dict[str, dict] = {}
    for o in approved:
        row = by_person.setdefault(o.person_id, {
            "person_id": o.person_id, "person_name": o.person_name,
            "department": o.department, "hours": 0.0, "equivalent_hours": 0.0,
        })
        row["hours"] += o.hours
        row["equivalent_hours"] += o.hours * o.rate_multiplier
    for row in by_person.values():
        row["hours"] = round(row["hours"], 2)
        row["equivalent_hours"] = round(row["equivalent_hours"], 2)

    return {
        "month": month,
        "total_hours": round(sum(o.hours for o in approved), 2),
        "equivalent_hours": round(sum(o.hours * o.rate_multiplier for o in approved), 2),
        "pending": len([o for o in records if o.status == "Pending"]),
        "approved": len(approved),
        "rejected": len([o for o in records if o.status == "Rejected"]),
        "by_person": sorted(by_person.values(),
                            key=lambda r: -r["equivalent_hours"]),
    }


# ---------------- Import from Excel / CSV ----------------
# Column headings people actually type. Matching is case- and space-
# insensitive, so "Employee ID", "employee_id" and "EMP ID" all work rather
# than forcing one exact spelling on whoever built the spreadsheet.
COLUMN_ALIASES = {
    "person": {"employee id", "employee", "emp id", "empid", "id", "staff id",
               "employee number", "name", "full name", "employee name", "person"},
    "date": {"date", "day", "attendance date", "work date"},
    "status": {"status", "attendance", "present", "presence", "mark"},
}

# What people write in a status column, mapped to the two values the database
# accepts. A CHECK constraint allows only 'Present' and 'Absent'.
STATUS_WORDS = {
    "p": "Present", "present": "Present", "yes": "Present", "y": "Present",
    "1": "Present", "true": "Present", "attended": "Present", "in": "Present",
    "a": "Absent", "absent": "Absent", "no": "Absent", "n": "Absent",
    "0": "Absent", "false": "Absent", "off": "Absent",
}


def _norm(text: str) -> str:
    return " ".join(str(text or "").strip().lower().replace("_", " ").split())


def _map_columns(headers: list[str]) -> dict[str, int]:
    found: dict[str, int] = {}
    for idx, raw in enumerate(headers):
        key = _norm(raw)
        for field, aliases in COLUMN_ALIASES.items():
            if field not in found and key in aliases:
                found[field] = idx
    return found


def _parse_date(value) -> str | None:
    """Accept what spreadsheets actually contain.

    Excel hands back a real datetime for a date-formatted cell, but a string
    when the column is text -- and people type both 2026-08-01 and 01/08/2026.
    """
    if value is None or str(value).strip() == "":
        return None
    if isinstance(value, datetime):
        return value.strftime("%Y-%m-%d")
    text = str(value).strip()
    if " " in text:                       # "2026-08-01 00:00:00"
        text = text.split(" ")[0]
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%m/%d/%Y", "%d-%m-%Y", "%Y/%m/%d"):
        try:
            return datetime.strptime(text, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None


def _read_table(filename: str, data: bytes) -> list[list]:
    """Return rows from .xlsx or .csv. Raises HTTPException on bad input."""
    name = (filename or "").lower()

    if name.endswith((".xlsx", ".xlsm")):
        try:
            import openpyxl                              # noqa: PLC0415
        except ImportError:                              # pragma: no cover
            raise HTTPException(
                status.HTTP_503_SERVICE_UNAVAILABLE,
                "Excel support is not installed on this server. Save the file "
                "as CSV and upload that instead.")
        try:
            # read_only + data_only: we want values, not formulas, and not a
            # whole workbook object graph for a 5,000-row sheet.
            wb = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
            ws = wb.active
            rows = [list(r) for r in ws.iter_rows(values_only=True)]
            wb.close()
            return rows
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                                f"Could not read that spreadsheet: {exc}")

    if name.endswith(".csv") or name.endswith(".txt"):
        for encoding in ("utf-8-sig", "utf-8", "latin-1"):
            try:
                text = data.decode(encoding)
                break
            except UnicodeDecodeError:
                continue
        else:                                            # pragma: no cover
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                                "Could not decode that CSV file")
        try:
            dialect = csv.Sniffer().sniff(text[:4096], delimiters=",;\t")
        except csv.Error:
            dialect = csv.excel                          # fall back to commas
        return [row for row in csv.reader(io.StringIO(text), dialect)]

    raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
                        "Upload a .xlsx or .csv file")


def _build_lookup(db: Session, user: User) -> dict[str, tuple[str, str, str | None, str | None]]:
    """Every way a person might be named in a spreadsheet -> who they are.

    Keyed on employee number AND full name, both normalised, because a
    spreadsheet from the site office will use one or the other.
    """
    lookup: dict[str, tuple] = {}
    for person in registerable_staff(db, user):
        entry = (person.id, "staff", person.department, person.full_name)
        if person.employee_id:
            lookup[_norm(person.employee_id)] = entry
        if person.full_name:
            lookup.setdefault(_norm(person.full_name), entry)
    for worker in visible_daily_workers(db, user):
        entry = (worker.id, "daily_worker", worker.department, worker.full_name)
        if worker.employee_id:
            lookup[_norm(worker.employee_id)] = entry
        if worker.full_name:
            lookup.setdefault(_norm(worker.full_name), entry)
    return lookup


def _analyse(db: Session, user: User, filename: str, data: bytes):
    if len(data) > MAX_IMPORT_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                            f"File is {len(data) // 1024} KB; the limit is "
                            f"{MAX_IMPORT_BYTES // 1024} KB")

    table = _read_table(filename, data)
    table = [r for r in table if any(str(c).strip() for c in r if c is not None)]
    if not table:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "That file is empty")

    headers = [str(c or "") for c in table[0]]
    columns = _map_columns(headers)
    missing = [f for f in ("person", "date", "status") if f not in columns]
    if missing:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"Could not find {', '.join(missing)} column(s). Found: "
            f"{', '.join(h for h in headers if h) or 'nothing'}. Expected headings "
            "like 'Employee ID', 'Date' and 'Status'.")

    body = table[1:]
    if len(body) > MAX_IMPORT_ROWS:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                            f"{len(body)} rows; the limit is {MAX_IMPORT_ROWS}")

    lookup = _build_lookup(db, user)
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    results: list[ImportRowResult] = []
    parsed: list[dict] = []
    seen: set[tuple[str, str]] = set()

    for offset, raw in enumerate(body):
        rowno = offset + 2                       # 1-based, and row 1 is headings

        def cell(field):
            i = columns[field]
            return raw[i] if i < len(raw) else None

        who_raw = str(cell("person") or "").strip()
        date_raw = cell("date")
        status_raw = str(cell("status") or "").strip()

        who = lookup.get(_norm(who_raw))
        date = _parse_date(date_raw)
        mark = STATUS_WORDS.get(_norm(status_raw))

        if not who_raw:
            results.append(ImportRowResult(row=rowno, ok=False, error="No employee given"))
            continue
        if who is None:
            results.append(ImportRowResult(row=rowno, person=who_raw, ok=False,
                                           error="Not on your register"))
            continue
        if date is None:
            results.append(ImportRowResult(row=rowno, person=who[3], ok=False,
                                           error=f"Unreadable date: {date_raw!r}"))
            continue
        if date > today:
            results.append(ImportRowResult(row=rowno, person=who[3], date=date, ok=False,
                                           error="Date is in the future"))
            continue
        if mark is None:
            results.append(ImportRowResult(row=rowno, person=who[3], date=date, ok=False,
                                           error=f"Unrecognised status: {status_raw!r}"))
            continue

        # A spreadsheet listing someone twice for one day is ambiguous: the
        # database allows one row per person per date, so the second silently
        # overwrites the first. Rejecting is more honest than guessing.
        key = (who[0], date)
        if key in seen:
            results.append(ImportRowResult(row=rowno, person=who[3], date=date,
                                           status=mark, ok=False,
                                           error="Duplicate of an earlier row"))
            continue
        seen.add(key)

        results.append(ImportRowResult(row=rowno, person=who[3], date=date,
                                       status=mark, ok=True))
        parsed.append({"person_id": who[0], "person_type": who[1],
                       "department": who[2], "name": who[3],
                       "date": date, "status": mark})

    return headers, results, parsed


@router.post("/attendance/import/preview", response_model=ImportPreview)
async def preview_import(file: UploadFile = File(...),
                         user: User = Depends(get_current_user),
                         db: Session = Depends(get_db)):
    """Dry run. Nothing is written.

    An import that silently half-succeeds is far worse than one that refuses:
    the register would be wrong and nobody would know which rows landed. This
    reports exactly what would happen first.
    """
    _require_workforce(user)
    data = await file.read()
    headers, results, parsed = _analyse(db, user, file.filename or "", data)

    existing = {
        (a.person_id, a.date)
        for a in db.scalars(select(Attendance).where(
            Attendance.date.in_({p["date"] for p in parsed} or {"__none__"}))).all()
    }
    updates = sum(1 for p in parsed if (p["person_id"], p["date"]) in existing)

    return ImportPreview(
        total_rows=len(results),
        valid=len(parsed),
        invalid=len(results) - len(parsed),
        would_create=len(parsed) - updates,
        would_update=updates,
        # Cap the sample: a 5,000-row response helps nobody read the problem.
        rows=results[:200],
        columns=[h for h in headers if h],
    )


@router.post("/attendance/import", response_model=ImportResult)
async def commit_import(file: UploadFile = File(...),
                        skip_invalid: bool = Query(True),
                        user: User = Depends(get_current_user),
                        db: Session = Depends(get_db)):
    """Write the rows in. Invalid rows are skipped unless skip_invalid=false,
    in which case a single bad row rejects the whole file."""
    _require_workforce(user)
    data = await file.read()
    _, results, parsed = _analyse(db, user, file.filename or "", data)

    bad = [r for r in results if not r.ok]
    if bad and not skip_invalid:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"{len(bad)} row(s) are invalid and skip_invalid is false. "
            f"First problem: row {bad[0].row} — {bad[0].error}")

    imported = 0
    for item in parsed:
        existing = db.scalar(select(Attendance).where(
            Attendance.person_id == item["person_id"], Attendance.date == item["date"]))
        if existing:
            existing.status = item["status"]
            existing.check_in = None if item["status"] == "Absent" else (existing.check_in or "08:00")
            existing.recorded_by = f"{user.full_name} (import)"
            if item["status"] == "Absent" and not existing.reason_status:
                existing.reason_status = "Not Submitted"
            if item["status"] == "Present":
                existing.reason_status = None
        else:
            db.add(Attendance(
                id=new_id("att"), person_id=item["person_id"], person_name=item["name"],
                person_type=item["person_type"], department=item["department"],
                date=item["date"], status=item["status"],
                check_in=None if item["status"] == "Absent" else "08:00",
                recorded_by=f"{user.full_name} (import)",
                reason_status="Not Submitted" if item["status"] == "Absent" else None,
            ))
        imported += 1

    record_audit(db, user, "EXTERNAL_IMPORT", f"attendance/import/{imported}")
    db.commit()
    return ImportResult(imported=imported, skipped=len(bad), errors=bad[:200])


@router.get("/attendance/import/template")
def import_template(user: User = Depends(get_current_user)):
    """A CSV with the right headings, so nobody has to guess the format."""
    _require_workforce(user)
    from fastapi.responses import StreamingResponse

    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["Employee ID", "Date", "Status"])
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    w.writerow(["EMP-2026-0001", today, "Present"])
    w.writerow(["EMP-2026-0002", today, "Absent"])
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]), media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="attendance-template.csv"'},
    )
