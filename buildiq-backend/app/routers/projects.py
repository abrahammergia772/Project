"""
BuildIQ — routers/projects.py
Projects, manager assignment, AI delay analysis, and purchased materials.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from .. import ai_engine
from ..database import get_db
from ..deps import (
    material_dict, new_id, project_dict, push_notification, recalc_materials_total,
    record_audit, utcnow, visible_projects,
)
from ..models import Client, Material, Project, ProjectMember, User
from ..schemas import (
    AnalyzeOut, ManagerAssign, MaterialCreate, MaterialOut, MaterialUpdate,
    OkResponse, ProjectCreate, ProjectOut, ProjectUpdate,
)
from ..security import (
    ORG_WIDE, can_assign_project_manager, can_create_project, can_manage_materials,
    get_current_user,
)
from ..services import groq_service

router = APIRouter(prefix="/projects", tags=["projects"])

ELIGIBLE_MANAGER_ROLES = {"Project Manager", "Department Manager", "Engineer"}


def _risk_for(progress: int, expected: int) -> str:
    gap = expected - progress
    return "HIGH" if gap > 15 else "MEDIUM" if gap > 5 else "LOW"


def _get_visible(db: Session, user: User, project_id: str) -> Project:
    project = db.get(Project, project_id)
    if project is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Project not found")
    if project.id not in {p.id for p in visible_projects(db, user)}:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You do not have access to this project")
    return project


@router.get("", response_model=list[ProjectOut])
def list_projects(
    type: str | None = None,
    region: str | None = None,
    risk: str | None = None,
    status_filter: str | None = Query(None, alias="status"),
    department: str | None = None,
    q: str | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    items = visible_projects(db, user)
    if type:
        items = [p for p in items if p.type == type]
    if region:
        items = [p for p in items if p.region == region]
    if risk:
        items = [p for p in items if p.delay_risk == risk]
    if status_filter:
        items = [p for p in items if p.status == status_filter]
    if department:
        items = [p for p in items if p.department == department]
    if q:
        items = [p for p in items if q.lower() in p.title.lower()]
    return [project_dict(p) for p in items]


@router.get("/{project_id}", response_model=ProjectOut)
def get_project(project_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return project_dict(_get_visible(db, user, project_id))


@router.post("", response_model=ProjectOut, status_code=status.HTTP_201_CREATED)
def create_project(payload: ProjectCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not can_create_project(user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only an admin or general manager can create projects")

    manager = db.get(User, payload.manager_id) if payload.manager_id else None
    if payload.manager_id and manager is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "The selected project manager was not found")

    client = db.get(Client, payload.client_id) if payload.client_id else None

    project = Project(
        id=new_id("proj"),
        title=payload.title.strip(),
        type=payload.type, region=payload.region, department=payload.department,
        manager_id=manager.id if manager else None,
        manager_name=manager.full_name if manager else None,
        manager_role=manager.role if manager else None,
        client_id=client.id if client else None,
        client_name=client.company if client else None,
        status="In Progress" if payload.progress > 0 else "Planning",
        progress=payload.progress,
        expected_progress=payload.expected_progress,
        delay_risk=_risk_for(payload.progress, payload.expected_progress),
        budget=payload.budget, spent=0,
        deadline=payload.deadline, description=payload.description,
        delay_reasons=[], materials_total_cost=0,
    )
    db.add(project)
    db.flush()

    # The manager is always on the team.
    team_ids = list(dict.fromkeys(payload.team_ids + ([manager.id] if manager else [])))
    for uid in team_ids:
        if db.get(User, uid):
            db.add(ProjectMember(project_id=project.id, user_id=uid))
    db.commit()
    db.refresh(project)

    record_audit(db, user, "UPDATE_RECORD", f"projects/{project.id}")
    if manager:
        push_notification(
            db, "You were made project manager",
            f'{user.full_name} assigned you to manage "{project.title}".',
            icon="fa-diagram-project", link="projects.html", user_ids=[manager.id],
        )
    return project_dict(project)


@router.put("/{project_id}", response_model=ProjectOut)
def update_project(project_id: str, payload: ProjectUpdate,
                   user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    project = _get_visible(db, user, project_id)
    # Org-wide roles, the owning department's manager, or the project's own manager.
    allowed = (user.role in ORG_WIDE
               or project.manager_id == user.id
               or (user.role == "Department Manager" and user.department == project.department))
    if not allowed:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You cannot modify this project")

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(project, field, value)
    project.delay_risk = _risk_for(project.progress, project.expected_progress)
    db.commit()
    db.refresh(project)

    record_audit(db, user, "UPDATE_RECORD", f"projects/{project.id}")
    return project_dict(project)


@router.put("/{project_id}/manager", response_model=ProjectOut)
def set_manager(project_id: str, payload: ManagerAssign,
                user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not can_assign_project_manager(user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only an admin or general manager can change the project manager")

    project = db.get(Project, project_id)
    if project is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Project not found")

    member = db.get(User, payload.manager_id)
    if member is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That person is not a member of the organization")
    if member.status != "Active":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "That member is not active")
    if not (set(member.all_roles) & ELIGIBLE_MANAGER_ROLES):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "That role cannot manage a project")

    project.manager_id = member.id
    project.manager_name = member.full_name
    project.manager_role = member.role
    already = db.query(ProjectMember).filter_by(project_id=project.id, user_id=member.id).first()
    if not already:
        db.add(ProjectMember(project_id=project.id, user_id=member.id))
    db.commit()
    db.refresh(project)

    record_audit(db, user, "PERMISSION_CHANGE", f"projects/{project.id}/manager")
    push_notification(
        db, "You were made project manager",
        f'{user.full_name} assigned you to manage "{project.title}".',
        icon="fa-diagram-project", link="projects.html", user_ids=[member.id],
    )
    return project_dict(project)


@router.post("/{project_id}/analyze", response_model=AnalyzeOut)
def analyze(project_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    project = _get_visible(db, user, project_id)
    data = project_dict(project, include_team=False)
    result = ai_engine.analyze_project(data)

    # Prefer a Groq-written explanation; the heuristic text stands in otherwise.
    source = "heuristic"
    explanation = groq_service.project_risk_explanation(data, result["delay_probability"])
    if explanation:
        result["groq_explanation"] = explanation
        source = "groq"

    record_audit(db, user, "VIEW_SENSITIVE", f"projects/{project.id}/analyze")
    return AnalyzeOut(**result, ai_source=source)


# ---------------- Materials ----------------
@router.get("/{project_id}/materials", response_model=list[MaterialOut])
def list_materials(project_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return [material_dict(m) for m in _get_visible(db, user, project_id).materials]


@router.post("/{project_id}/materials", response_model=MaterialOut, status_code=status.HTTP_201_CREATED)
def add_material(project_id: str, payload: MaterialCreate,
                 user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    project = _get_visible(db, user, project_id)
    if not can_manage_materials(user, project):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You cannot manage materials on this project")

    material = Material(
        id=new_id("mat"), project_id=project.id, name=payload.name, unit=payload.unit,
        quantity=payload.quantity, unit_price=payload.unit_price,
        total_cost=round(payload.quantity * payload.unit_price, 2),
        supplier=payload.supplier or "Unspecified",
        purchased_at=payload.purchased_at or utcnow(),
        purchased_by=payload.purchased_by or user.full_name,
    )
    db.add(material)
    db.flush()
    db.refresh(project)
    recalc_materials_total(project)
    db.commit()

    record_audit(db, user, "UPDATE_RECORD", f"projects/{project.id}/materials/{material.id}")
    return material_dict(material)


@router.put("/{project_id}/materials/{material_id}", response_model=MaterialOut)
def update_material(project_id: str, material_id: str, payload: MaterialUpdate,
                    user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    project = _get_visible(db, user, project_id)
    if not can_manage_materials(user, project):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You cannot manage materials on this project")

    material = db.get(Material, material_id)
    if material is None or material.project_id != project.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Material not found")

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(material, field, value)
    material.total_cost = round(material.quantity * material.unit_price, 2)
    db.flush()
    db.refresh(project)
    recalc_materials_total(project)
    db.commit()

    record_audit(db, user, "UPDATE_RECORD", f"projects/{project.id}/materials/{material.id}")
    return material_dict(material)


@router.delete("/{project_id}/materials/{material_id}", response_model=OkResponse)
def delete_material(project_id: str, material_id: str,
                    user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    project = _get_visible(db, user, project_id)
    if not can_manage_materials(user, project):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You cannot manage materials on this project")

    material = db.get(Material, material_id)
    if material is None or material.project_id != project.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Material not found")

    db.delete(material)
    db.flush()
    db.refresh(project)
    recalc_materials_total(project)
    db.commit()

    record_audit(db, user, "UPDATE_RECORD", f"projects/{project.id}/materials/{material_id}")
    return OkResponse()
