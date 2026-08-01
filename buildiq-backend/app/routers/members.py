"""
BuildIQ — routers/members.py
Staff directory, smart search, department assignment, and client records.
"""
from __future__ import annotations

from fastapi import (
    APIRouter, Depends, File, HTTPException, Query, Response, UploadFile, status)
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db
from ..deps import member_dict, new_id, push_notification, record_audit, visible_members
from ..models import Client, Department, User
from ..schemas import (
    ClientCreate, ClientOut, DepartmentAssign, MemberCreate, MemberOut, MemberUpdate,
    OkResponse, SmartSearchRequest, SmartSearchResult,
)
from ..services import storage
from ..security import (
    ALL_ROLES, AUDITOR, CLIENT, DEPARTMENT_MANAGER, ORG_WIDE, PRIVILEGED_ROLES,
    get_current_user, hash_password,
)

router = APIRouter(tags=["members"])


def _no_member_access(user: User) -> bool:
    return user.role in (AUDITOR, CLIENT)


@router.get("/members", response_model=list[MemberOut])
def list_members(
    department: str | None = None,
    role: str | None = None,
    status_filter: str | None = Query(None, alias="status"),
    q: str | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if _no_member_access(user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, f"Access denied — {user.role} has no member access")

    members = visible_members(db, user)
    if department:
        members = [m for m in members if m.department == department]
    if role:
        members = [m for m in members if role in m.all_roles]
    if status_filter:
        members = [m for m in members if m.status == status_filter]
    if q:
        needle = q.lower()
        members = [m for m in members
                   if needle in m.full_name.lower() or needle in " ".join(m.skills or []).lower()]
    return [member_dict(m) for m in members]


@router.post("/members", response_model=MemberOut, status_code=status.HTTP_201_CREATED)
def create_member(payload: MemberCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if user.role not in ORG_WIDE + [DEPARTMENT_MANAGER]:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only an admin or manager can add members")
    if payload.role not in ALL_ROLES:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Unknown role: {payload.role}")
    # Only org-wide roles may mint privileged accounts.
    if payload.role in PRIVILEGED_ROLES and user.role not in ORG_WIDE:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You cannot create that role")
    if user.role == DEPARTMENT_MANAGER and payload.department != user.department:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You can only add members to your own department")

    email = (payload.email or
             f"{payload.full_name.lower().replace(' ', '.')}@buildiq.et").lower()
    if db.scalar(select(User).where(User.email == email)):
        raise HTTPException(status.HTTP_409_CONFLICT, "An account with that email already exists")

    member = User(
        id=new_id("mem"), email=email,
        hashed_password=hash_password(payload.password or settings.SEED_DEMO_PASSWORD),
        full_name=payload.full_name, role=payload.role, roles=[payload.role], role_contexts={},
        department=payload.department,
        job_title=payload.job_title or ("Project Manager" if payload.role == "Project Manager" else "Site Engineer"),
        experience_years=payload.experience_years, skills=payload.skills,
        phone=payload.phone, org_name="Wolaita Construction Group", status="Active",
    )
    db.add(member)
    db.commit()

    record_audit(db, user, "UPDATE_RECORD", f"members/{member.id}")
    return member_dict(member)


@router.put("/members/{member_id}", response_model=MemberOut)
def update_member(member_id: str, payload: MemberUpdate,
                  user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if user.role not in ORG_WIDE + [DEPARTMENT_MANAGER]:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You cannot modify members")

    member = db.get(User, member_id)
    if member is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Member not found")
    if user.role == DEPARTMENT_MANAGER and member.department != user.department:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "That member is outside your department")

    data = payload.model_dump(exclude_unset=True)
    # Role changes are admin-only.
    if ("role" in data or "roles" in data) and user.role not in ORG_WIDE:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only administrators can change a user's role")
    for key in ("role", "roles"):
        if key in data:
            wanted = [data[key]] if key == "role" else data[key]
            for r in wanted:
                if r not in ALL_ROLES:
                    raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Unknown role: {r}")

    for field, value in data.items():
        setattr(member, field, value)
    # Keep `roles` consistent when only `role` was set.
    if "role" in data and "roles" not in data and member.role not in member.all_roles:
        member.roles = list(dict.fromkeys((member.roles or []) + [member.role]))
    db.commit()

    record_audit(db, user, "UPDATE_RECORD", f"members/{member.id}")
    return member_dict(member)


@router.put("/members/{member_id}/department", response_model=MemberOut)
def assign_department(member_id: str, payload: DepartmentAssign,
                      user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if user.role not in ORG_WIDE:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only an admin or general manager can move members between departments")

    member = db.get(User, member_id)
    if member is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Member not found")
    if member.role == CLIENT:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Clients do not belong to a department")
    if not db.scalar(select(Department).where(Department.name == payload.department)):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Department not found")

    member.department = payload.department
    db.commit()

    record_audit(db, user, "UPDATE_RECORD", f"members/{member_id}/department")
    push_notification(
        db, "Your department changed",
        f"{user.full_name} moved you to {payload.department}.",
        icon="fa-building", link="departments.html", user_ids=[member_id],
    )
    return member_dict(member)


@router.delete("/members/{member_id}", response_model=OkResponse)
def suspend_member(member_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if user.role not in ORG_WIDE:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only an admin or general manager can suspend accounts")

    member = db.get(User, member_id)
    if member is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Member not found")
    if member.id == user.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "You cannot suspend your own account")

    # Soft-delete preserves audit history and foreign keys.
    member.status = "Inactive"
    db.commit()

    record_audit(db, user, "SUSPEND_USER", f"members/{member_id}")
    return OkResponse()


@router.post("/members/search/smart", response_model=list[SmartSearchResult])
def smart_search(payload: SmartSearchRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Deterministic skill/title/department keyword similarity."""
    if _no_member_access(user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, f"Access denied — {user.role} has no member access")

    terms = [t for t in payload.query.lower().split() if t]
    results = []
    for m in visible_members(db, user):
        score = 0
        skills = " ".join(m.skills or []).lower()
        for t in terms:
            if t in skills:
                score += 40
            if t in (m.job_title or "").lower():
                score += 25
            if t in (m.department or "").lower():
                score += 15
            if t in m.full_name.lower():
                score += 20
        if score:
            results.append({"member": member_dict(m),
                            "similarity_score": min(99, score + min(20, m.experience_years))})
    results.sort(key=lambda r: r["similarity_score"], reverse=True)
    return results[:8]


# ---------------- Clients ----------------
@router.get("/clients", response_model=list[ClientOut])
def list_clients(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if user.role not in ORG_WIDE:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only an admin or general manager can view clients")
    return list(db.scalars(select(Client).order_by(Client.company)).all())


@router.post("/clients", response_model=ClientOut, status_code=status.HTTP_201_CREATED)
def create_client(payload: ClientCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if user.role not in ORG_WIDE:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only an admin or general manager can add clients")

    # Reuse rather than duplicate when the company already exists.
    existing = db.scalar(select(Client).where(func.lower(Client.company) == payload.company.strip().lower()))
    if existing:
        return existing

    client = Client(
        id=new_id("client"), company=payload.company.strip(),
        contact_name=payload.contact_name or payload.company.strip(),
        email=(payload.email or "").lower() or None, phone=payload.phone,
    )
    db.add(client)
    db.commit()

    record_audit(db, user, "UPDATE_RECORD", f"clients/{client.id}")
    return client


# ---------------- Profile photo ----------------
MAX_AVATAR_BYTES = 2 * 1024 * 1024          # 2 MB
ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}


@router.post("/members/me/avatar")
async def upload_avatar(file: UploadFile = File(...),
                        user: User = Depends(get_current_user),
                        db: Session = Depends(get_db)):
    """Replace the signed-in user's profile photo.

    Anyone may change their OWN photo -- there is no role check, because this
    only ever writes to the caller's row. Uploading someone else's avatar is
    not possible through this endpoint.
    """
    if file.content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(
            status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            f"Unsupported image type: {file.content_type or 'unknown'}. "
            "Use JPEG, PNG, WebP or GIF.")

    data = await file.read()
    if not data:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "The file is empty")
    if len(data) > MAX_AVATAR_BYTES:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            f"Image is {len(data) // 1024} KB; the limit is "
            f"{MAX_AVATAR_BYTES // 1024} KB.")

    ext = {"image/jpeg": "jpg", "image/png": "png",
           "image/webp": "webp", "image/gif": "gif"}[file.content_type]
    # Overwrite per user rather than accumulating one file per upload.
    key = f"avatars/{user.id}.{ext}"
    stored_key, backend = storage.upload(key, data, file.content_type)

    # Record the backend alongside the key: download() needs it, and a
    # deployment can switch between Supabase Storage and local disk.
    user.avatar_url = f"{backend}:{stored_key}"
    record_audit(db, user, "UPDATE_RECORD", f"members/{user.id}/avatar")
    db.commit()

    return {"ok": True, "avatar_url": stored_key, "backend": backend}


@router.get("/members/{member_id}/avatar")
def get_avatar(member_id: str,
               user: User = Depends(get_current_user),
               db: Session = Depends(get_db)):
    """Stream a member's photo. Requires a session, like every other read."""
    target = db.get(User, member_id)
    if target is None or not target.avatar_url:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No photo set")

    backend, _, key = target.avatar_url.partition(":")
    if not key:                       # legacy value without a backend prefix
        backend, key = storage.backend_name(), target.avatar_url
    data = storage.download(key, backend)
    if data is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Photo unavailable")

    ext = key.rsplit(".", 1)[-1].lower()
    media = {"jpg": "image/jpeg", "png": "image/png",
             "webp": "image/webp", "gif": "image/gif"}.get(ext, "image/jpeg")
    return Response(content=data, media_type=media,
                    headers={"Cache-Control": "private, max-age=300"})
