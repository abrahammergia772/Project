"""
BuildIQ — security.py
Password hashing, JWT issue/verify, auth dependencies, and the role-capability
helpers that mirror buildiq-frontend/js/roles.js.

The server is the real enforcement point — the frontend's role logic is a UX
convenience and every rule here is re-checked independently.
"""
from datetime import datetime, timedelta, timezone
from typing import Iterable

import bcrypt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from .config import settings
from .database import get_db
from .models import User

bearer_scheme = HTTPBearer(auto_error=False)

# ---------------- Roles ----------------
SUPER_ADMIN = "Super Admin"
GENERAL_MANAGER = "General Manager"
DEPARTMENT_MANAGER = "Department Manager"
PROJECT_MANAGER = "Project Manager"
ENGINEER = "Engineer"
AUDITOR = "Auditor"
CLIENT = "Client"

ALL_ROLES = [SUPER_ADMIN, GENERAL_MANAGER, DEPARTMENT_MANAGER, PROJECT_MANAGER, ENGINEER, AUDITOR, CLIENT]
ORG_WIDE = [SUPER_ADMIN, GENERAL_MANAGER]
FULL_PROJECT_ACCESS = [SUPER_ADMIN, GENERAL_MANAGER, AUDITOR]
WORKFORCE_DEPT = "Workforce & Attendance"

# Roles a user may never self-assign at signup.
PRIVILEGED_ROLES = {SUPER_ADMIN, GENERAL_MANAGER}


# ---------------- Passwords ----------------
def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except (ValueError, TypeError):
        return False


# ---------------- JWT ----------------
def create_access_token(user: User, active_role: str | None = None) -> tuple[str, int]:
    """Returns (token, expires_at_ms) — ms because the frontend stores epoch millis."""
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    payload = {
        "sub": user.id,
        "email": user.email,
        "role": active_role or user.role,
        "roles": user.all_roles,
        "exp": expire,
    }
    token = jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)
    return token, int(expire.timestamp() * 1000)


def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
    except JWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired token")


# ---------------- Dependencies ----------------
def get_current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    if creds is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")
    payload = decode_token(creds.credentials)

    user = db.get(User, payload.get("sub"))
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "User no longer exists")
    if user.status != "Active":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This account is suspended")

    # The token carries the role the client is acting as. Honour it only if the
    # user genuinely holds it — this is what stops role-switch tampering.
    claimed = payload.get("role")
    if claimed and claimed in user.all_roles and claimed != user.role:
        user.role = claimed
        ctx = (user.role_contexts or {}).get(claimed) or {}
        if "department" in ctx:
            user.department = ctx["department"]
    return user


def require_roles(*roles: str):
    allowed = set(roles)

    def _guard(user: User = Depends(get_current_user)) -> User:
        if user.role not in allowed:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                f"Access denied — {user.role} cannot perform this action",
            )
        return user

    return _guard


def roles_or_403(user: User, roles: Iterable[str]) -> None:
    if user.role not in set(roles):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            f"Access denied — {user.role} cannot perform this action",
        )


# ---------------- Capability helpers (mirror of js/roles.js) ----------------
def is_org_wide(user: User) -> bool:
    return user.role in ORG_WIDE


def has_full_project_access(role: str) -> bool:
    return role in FULL_PROJECT_ACCESS


def manages_project(user: User, project) -> bool:
    return bool(project) and project.manager_id == user.id


def can_create_project(user: User) -> bool:
    return is_org_wide(user)


def can_assign_project_manager(user: User) -> bool:
    return is_org_wide(user)


def can_assign_department_head(user: User) -> bool:
    return is_org_wide(user)


def can_manage_materials(user: User, project) -> bool:
    if not project:
        return False
    if is_org_wide(user):
        return True
    if manages_project(user, project):
        return True
    return user.role == DEPARTMENT_MANAGER and user.department == project.department


def can_resolve_complaint(user: User, complaint, managed_titles: set[str] | None = None) -> bool:
    if is_org_wide(user):
        return True
    if user.role == DEPARTMENT_MANAGER:
        return complaint.department == user.department
    if user.role == PROJECT_MANAGER:
        return bool(managed_titles) and complaint.project in managed_titles
    return False


def can_view_all_departments(user: User) -> bool:
    return is_org_wide(user) or user.role == AUDITOR


# --- Attendance: taking the register belongs to the Workforce & Attendance dept ---
def is_workforce_dept(user: User) -> bool:
    return user.department == WORKFORCE_DEPT


def can_take_attendance(user: User) -> bool:
    return is_workforce_dept(user) and user.role != CLIENT


def can_view_attendance(user: User) -> bool:
    return (
        is_org_wide(user)
        or user.role in (DEPARTMENT_MANAGER, AUDITOR, PROJECT_MANAGER)
        or can_take_attendance(user)
    )


def can_view_absence_reasons(user: User) -> bool:
    return is_org_wide(user) or user.role in (DEPARTMENT_MANAGER, AUDITOR)


def can_review_absence_reason(user: User, record) -> bool:
    """Auditors may read reasons but never rule on them."""
    if is_org_wide(user):
        return True
    if user.role == DEPARTMENT_MANAGER:
        return is_workforce_dept(user) or record.department == user.department
    return False


# --- Tasks ---
def can_assign_tasks(role: str) -> bool:
    return role in ORG_WIDE or role in (DEPARTMENT_MANAGER, AUDITOR, PROJECT_MANAGER)


def can_view_team_tasks(role: str) -> bool:
    return can_assign_tasks(role)


# --- Reports ---
REPORT_TYPES: dict[str, list[str]] = {
    SUPER_ADMIN: ["Organization Summary", "Project Progress Summary", "Complaint Analysis",
                  "Audit & Compliance", "Team Performance", "Financial Overview",
                  "Attendance & Absence Report"],
    GENERAL_MANAGER: ["Organization Summary", "Project Progress Summary", "Complaint Analysis",
                      "Audit & Compliance", "Team Performance", "Financial Overview",
                      "Attendance & Absence Report"],
    DEPARTMENT_MANAGER: ["Department Performance", "Department Complaint Summary",
                         "Department Team Report", "Attendance & Absence Report"],
    PROJECT_MANAGER: ["My Projects Summary", "Project Progress Summary", "Team Performance",
                      "Attendance & Absence Report"],
    AUDITOR: ["Audit & Compliance", "Anomaly Summary"],
    CLIENT: ["My Project Status Report"],
    ENGINEER: [],
}


def report_types_for(role: str) -> list[str]:
    return REPORT_TYPES.get(role, [])


def report_scope_locked(role: str) -> bool:
    return role in (DEPARTMENT_MANAGER, CLIENT, PROJECT_MANAGER)
