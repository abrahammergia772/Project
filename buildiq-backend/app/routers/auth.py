"""
BuildIQ — routers/auth.py
Login, signup, token refresh, role switching, and the forgot/reset password flow.
"""
from __future__ import annotations

import secrets
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db
from ..deps import new_id, record_audit, utcnow
from ..models import Client, PasswordResetToken, User
from ..schemas import (
    ForgotPasswordRequest, ForgotPasswordResponse, LoginRequest, OkResponse,
    ResetPasswordRequest, SignupRequest, SwitchRoleRequest, TokenResponse, UserOut,
)
from ..security import (
    ALL_ROLES, CLIENT, PRIVILEGED_ROLES, create_access_token, get_current_user,
    hash_password, verify_password,
)

router = APIRouter(prefix="/auth", tags=["auth"])

# Roles that are department-scoped; others get a derived department.
DERIVED_CONTEXT = {
    "Super Admin": ("Executive", "System Administrator"),
    "General Manager": ("Executive", "General Manager"),
    "Auditor": ("Compliance", "Compliance Auditor"),
}


def _user_out(u: User) -> UserOut:
    return UserOut(
        id=u.id, name=u.full_name, email=u.email, role=u.role,
        roles=u.all_roles, role_contexts=u.role_contexts or {},
        department=u.department, job_title=u.job_title,
        org_name=u.org_name, avatar=None, client_id=u.client_id,
    )


def _token_response(u: User) -> TokenResponse:
    token, expires = create_access_token(u)
    return TokenResponse(token=token, user=_user_out(u), expires=expires)


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.email == payload.email.lower()))
    # Never reveal whether the email exists.
    if user is None or not verify_password(payload.password, user.hashed_password):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Incorrect email or password")
    if user.status != "Active":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This account is suspended")

    record_audit(db, user, "LOGIN", "auth/login")
    return _token_response(user)


@router.post("/signup", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
def signup(payload: SignupRequest, db: Session = Depends(get_db)):
    if payload.role not in ALL_ROLES:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Unknown role: {payload.role}")
    # Self-service signup must never mint a privileged account.
    if payload.role in PRIVILEGED_ROLES:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "That role can only be assigned by an administrator")

    email = payload.email.lower()
    if db.scalar(select(User).where(User.email == email)):
        raise HTTPException(status.HTTP_409_CONFLICT, "An account with that email already exists")

    client_id = None
    if payload.role == CLIENT:
        client = Client(
            id=new_id("client"),
            company=payload.organization_name or f"{payload.full_name} Co.",
            contact_name=payload.full_name, email=email, phone=payload.phone,
        )
        db.add(client)
        db.flush()
        client_id = client.id

    # Fill in whatever the role-aware signup form didn't ask for.
    derived_dept, derived_title = DERIVED_CONTEXT.get(payload.role, (None, None))
    department = None if payload.role == CLIENT else (payload.department or derived_dept)
    job_title = (payload.job_title
                 or (f"{department} Manager" if payload.role == "Department Manager" and department else None)
                 or derived_title
                 or ("Client" if payload.role == CLIENT else payload.role))

    user = User(
        id=new_id("mem" if payload.role != CLIENT else "cu"),
        email=email,
        hashed_password=hash_password(payload.password),
        full_name=payload.full_name,
        role=payload.role,
        roles=[payload.role],
        role_contexts={},
        department=department,
        job_title=job_title,
        org_name=payload.organization_name or ("Wolaita Construction Group" if payload.role != CLIENT else None),
        org_type=payload.organization_type,
        phone=payload.phone,
        experience_years=payload.experience_years or 0,
        client_id=client_id,
        linked_project=payload.linked_project,
        joined=utcnow(),
    )
    db.add(user)
    db.commit()

    record_audit(db, user, "UPDATE_RECORD", f"users/{user.id}")
    return _token_response(user)


@router.post("/refresh", response_model=TokenResponse)
def refresh(user: User = Depends(get_current_user)):
    """Issues a fresh token for an already-valid session, preserving the active role."""
    token, expires = create_access_token(user, active_role=user.role)
    return TokenResponse(token=token, user=_user_out(user), expires=expires)


@router.post("/switch-role", response_model=TokenResponse)
def switch_role(payload: SwitchRoleRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """
    Re-issues the token with a different active role. The role must be one the
    account actually holds — this is the server-side guard against tampering.
    """
    if payload.role not in user.all_roles:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You do not hold that role")

    ctx = (user.role_contexts or {}).get(payload.role) or {}
    user.role = payload.role
    if "department" in ctx:
        user.department = ctx["department"]
    if ctx.get("job_title"):
        user.job_title = ctx["job_title"]
    db.commit()

    record_audit(db, user, "ROLE_MISUSE", f"auth/role-switch/{payload.role}")
    token, expires = create_access_token(user, active_role=payload.role)
    return TokenResponse(token=token, user=_user_out(user), expires=expires)


@router.post("/logout", response_model=OkResponse)
def logout(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    record_audit(db, user, "LOGOUT", "auth/logout")
    return OkResponse()


@router.post("/forgot-password", response_model=ForgotPasswordResponse)
def forgot_password(payload: ForgotPasswordRequest, db: Session = Depends(get_db)):
    """
    Always reports success so this can't be used to enumerate accounts.
    Outside production the token is returned directly so the flow is walkable
    without a mail server.
    """
    email = payload.email.lower()
    user = db.scalar(select(User).where(User.email == email))
    generic = "If that email exists, a reset link has been sent."

    if user is None:
        return ForgotPasswordResponse(message=generic, demo_token=None)

    token = secrets.token_urlsafe(32)
    db.add(PasswordResetToken(
        token=token, email=email,
        expires_at=utcnow() + timedelta(minutes=settings.RESET_TOKEN_EXPIRE_MINUTES),
        used=False,
    ))
    db.commit()
    # TODO: hand `token` to your mail provider in production.
    return ForgotPasswordResponse(message=generic, demo_token=None if settings.is_production else token)


@router.post("/reset-password", response_model=OkResponse)
def reset_password(payload: ResetPasswordRequest, db: Session = Depends(get_db)):
    entry = db.get(PasswordResetToken, payload.token)
    if entry is None or entry.used:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This reset link is invalid.")

    expires = entry.expires_at
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=utcnow().tzinfo)
    if utcnow() > expires:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This reset link has expired.")

    user = db.scalar(select(User).where(User.email == entry.email))
    if user is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This reset link is invalid.")

    user.hashed_password = hash_password(payload.new_password)
    entry.used = True
    db.commit()

    record_audit(db, user, "PERMISSION_CHANGE", f"users/{user.id}/password")
    return OkResponse()


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)):
    return _user_out(user)
