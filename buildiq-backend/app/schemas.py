"""
BuildIQ — schemas.py
Pydantic request/response models. Field names match exactly what the existing
frontend reads, so no JS changes are required.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ---------------- Auth ----------------
class LoginRequest(BaseModel):
    email: EmailStr
    password: str
    # Set by the administrator portal so the audit trail records which door
    # was used. Untrusted -- it only labels the event, never grants anything.
    portal: str | None = None


class SignupRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)
    full_name: str = Field(min_length=1, max_length=160)
    role: str = "Engineer"
    department: str | None = None
    job_title: str | None = None
    organization_name: str | None = None
    organization_type: str | None = None
    phone: str | None = None
    experience_years: int | None = 0
    linked_project: str | None = None


class UserOut(BaseModel):
    id: str
    name: str
    email: EmailStr
    role: str
    roles: list[str] = []
    role_contexts: dict[str, Any] = {}
    department: str | None = None
    job_title: str | None = None
    org_name: str | None = None
    avatar: str | None = None
    client_id: str | None = None


class TokenResponse(BaseModel):
    token: str
    user: UserOut
    expires: int          # epoch millis — matches Auth.setSession


class SwitchRoleRequest(BaseModel):
    role: str


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ForgotPasswordResponse(BaseModel):
    ok: bool = True
    message: str
    demo_token: str | None = None


class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str = Field(min_length=8)


# ---------------- Members ----------------
class MemberOut(ORMModel):
    id: str
    full_name: str
    email: EmailStr
    role: str
    roles: list[str] = []
    department: str | None = None
    job_title: str | None = None
    experience_years: int = 0
    skills: list[str] = []
    status: str = "Active"
    projects_count: int = 0
    on_time_pct: int = 0
    phone: str | None = None
    joined: datetime | None = None
    avatar_color: str | None = None


class MemberCreate(BaseModel):
    full_name: str = Field(min_length=1)
    email: EmailStr | None = None
    role: str = "Engineer"
    department: str | None = None
    job_title: str | None = None
    experience_years: int = 0
    skills: list[str] = []
    phone: str | None = None
    password: str | None = None


class MemberUpdate(BaseModel):
    full_name: str | None = None
    role: str | None = None
    roles: list[str] | None = None
    department: str | None = None
    job_title: str | None = None
    experience_years: int | None = None
    skills: list[str] | None = None
    phone: str | None = None
    status: str | None = None


class DepartmentAssign(BaseModel):
    department: str


class SmartSearchRequest(BaseModel):
    query: str


class SmartSearchResult(BaseModel):
    member: MemberOut
    similarity_score: int


# ---------------- Clients ----------------
class ClientOut(ORMModel):
    id: str
    company: str
    contact_name: str | None = None
    email: str | None = None
    phone: str | None = None
    avatar_color: str | None = None


class ClientCreate(BaseModel):
    company: str = Field(min_length=1)
    contact_name: str | None = None
    email: EmailStr | None = None
    phone: str | None = None


# ---------------- Departments ----------------
class DepartmentCreate(BaseModel):
    name: str = Field(min_length=1)
    head_id: str | None = None
    description: str | None = None
    scope: list[str] | str = []
    budget: float = 0


class DepartmentHeadAssign(BaseModel):
    member_id: str


# ---------------- Materials ----------------
class MaterialOut(ORMModel):
    id: str
    project_id: str
    name: str
    unit: str
    quantity: float
    unit_price: float
    total_cost: float
    supplier: str | None = None
    purchased_at: datetime
    purchased_by: str | None = None


class MaterialCreate(BaseModel):
    name: str = Field(min_length=1)
    unit: str = "unit"
    quantity: float = Field(gt=0)
    unit_price: float = Field(gt=0)
    supplier: str | None = None
    purchased_at: datetime | None = None
    purchased_by: str | None = None


class MaterialUpdate(BaseModel):
    name: str | None = None
    unit: str | None = None
    quantity: float | None = Field(default=None, gt=0)
    unit_price: float | None = Field(default=None, gt=0)
    supplier: str | None = None
    purchased_at: datetime | None = None


# ---------------- Projects ----------------
class ProjectOut(BaseModel):
    id: str
    title: str
    type: str | None = None
    region: str | None = None
    department: str | None = None
    manager_id: str | None = None
    manager_name: str | None = None
    manager_role: str | None = None
    client_id: str | None = None
    client_name: str | None = None
    status: str
    progress: int
    expected_progress: int
    delay_risk: str
    budget: float
    spent: float
    deadline: datetime | None = None
    tasks_total: int = 0
    tasks_done: int = 0
    delay_reasons: list[str] = []
    description: str | None = None
    materials_total_cost: float = 0
    team: list[MemberOut] = []
    materials: list[MaterialOut] = []


class ProjectCreate(BaseModel):
    title: str = Field(min_length=1)
    type: str | None = None
    region: str | None = None
    department: str | None = None
    client_id: str | None = None
    manager_id: str | None = None
    team_ids: list[str] = []
    budget: float = 0
    progress: int = 0
    expected_progress: int = 0
    deadline: datetime | None = None
    description: str | None = None


class ProjectUpdate(BaseModel):
    title: str | None = None
    type: str | None = None
    region: str | None = None
    department: str | None = None
    status: str | None = None
    progress: int | None = None
    expected_progress: int | None = None
    budget: float | None = None
    deadline: datetime | None = None
    description: str | None = None


class ManagerAssign(BaseModel):
    manager_id: str


class AnalyzeOut(BaseModel):
    delay_probability: float
    risk_level: str
    key_risk_factors: list[str]
    groq_explanation: str
    ai_source: str = "heuristic"       # groq | heuristic


# ---------------- Tasks ----------------
class TaskOut(ORMModel):
    id: str
    title: str
    category: str | None = None
    assignee_id: str | None = None
    assignee_name: str | None = None
    assignee_type: str = "staff"
    department: str | None = None
    project_id: str | None = None
    project_title: str | None = None
    project_risk: str = "LOW"
    status: str
    blocking: bool = False
    estimated_hours: float = 2
    due_date: datetime | None = None
    created_at: datetime | None = None
    assigned_by: str | None = None
    assigned_by_role: str | None = None
    note: str = ""


class TaskCreate(BaseModel):
    title: str = Field(min_length=1)
    category: str | None = "Admin"
    assignee_id: str | None = None
    project_id: str | None = None
    status: str = "To Do"
    blocking: bool = False
    estimated_hours: float = 2
    due_date: datetime | None = None


class TaskAssign(BaseModel):
    assignee_id: str
    title: str = Field(min_length=1)
    category: str | None = "Coordination"
    project_id: str | None = None
    due_date: datetime | None = None
    estimated_hours: float = 2
    blocking: bool = False
    note: str | None = ""


class TaskUpdate(BaseModel):
    title: str | None = None
    status: str | None = None
    blocking: bool | None = None
    estimated_hours: float | None = None
    due_date: datetime | None = None
    assignee_id: str | None = None


class TaskIdsRequest(BaseModel):
    task_ids: list[str] | None = None
    tasks: list[dict[str, Any]] | None = None


# ---------------- Attendance ----------------
class AttendanceOut(ORMModel):
    id: str
    person_id: str
    person_name: str | None = None
    person_type: str
    department: str | None = None
    project_id: str | None = None
    project_title: str | None = None
    date: str
    status: str
    check_in: str | None = None
    recorded_by: str | None = None
    reason: str | None = None
    reason_category: str | None = None
    reason_submitted_at: datetime | None = None
    reason_status: str | None = None
    reason_reviewed_by: str | None = None
    reason_reviewed_at: datetime | None = None
    reason_review_note: str | None = None


class AttendanceMark(BaseModel):
    person_id: str
    person_type: str = "staff"
    status: str = Field(pattern="^(Present|Absent)$")


class AttendanceBulkRequest(BaseModel):
    date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    marks: list[AttendanceMark]


class AbsenceReasonRequest(BaseModel):
    reason: str = Field(min_length=1)
    reason_category: str | None = "Other"


class AbsenceReviewRequest(BaseModel):
    decision: str = Field(pattern="^(Accepted|Rejected)$")
    note: str | None = None


class DailyWorkerOut(ORMModel):
    id: str
    full_name: str
    trade: str | None = None
    project_id: str | None = None
    project_title: str | None = None
    department: str | None = None
    daily_rate: float = 0
    phone: str | None = None
    status: str = "Active"
    avatar_color: str | None = None
    joined: datetime | None = None


# ---------------- Complaints ----------------
class ComplaintOut(ORMModel):
    id: str
    submitted_by: str | None = None
    submitted_by_type: str
    customer_name: str | None = None
    category: str | None = None
    severity: str
    status: str
    department: str | None = None
    project: str | None = None
    text: str
    sentiment: str | None = None
    ai_summary: str | None = None
    confidence: int = 0
    assignee: str | None = None
    resolution_note: str = ""
    created_at: datetime | None = None
    resolved_at: datetime | None = None


class ComplaintCreate(BaseModel):
    text: str = Field(min_length=1)
    project_id: str | None = None
    severity: str | None = None


class ComplaintResolve(BaseModel):
    note: str = Field(min_length=1)


class ComplaintFeedback(BaseModel):
    id: str
    correct: bool


class SuggestSolutionRequest(BaseModel):
    id: str | None = None
    category: str | None = None
    severity: str | None = None
    text: str | None = None


class SuggestSolutionOut(BaseModel):
    solution: str
    ai_source: str = "heuristic"


# ---------------- Audit ----------------
class AuditLogOut(ORMModel):
    id: str
    user: str | None = None
    user_role: str | None = None
    action: str
    action_label: str | None = None
    audit_type: str
    ml_role: str | None = None
    resource: str | None = None
    timestamp: datetime
    anomaly_score: float
    risk_level: str
    is_flagged: bool
    context: str | None = None
    explanation: str | None = None
    review_status: str


class AuditFeedbackRequest(BaseModel):
    id: str
    action: str


# ---------------- Notifications ----------------
class NotificationOut(BaseModel):
    id: str
    title: str
    body: str
    icon: str
    type: str
    link: str | None = None
    created_at: datetime
    read: bool = False


# ---------------- Documents ----------------
class DocumentOut(ORMModel):
    id: str
    name: str
    size_label: str
    size_bytes: int
    icon: str
    color: str
    uploaded_by: str | None = None
    uploaded_by_id: str | None = None
    department: str | None = None
    uploaded_at: datetime


# ---------------- Reports ----------------
class ReportRequest(BaseModel):
    type: str
    scope: str = "Entire Organization"


class ReportOut(BaseModel):
    title: str
    generated_at: datetime
    content: str
    stats: dict[str, int]
    rankedAbsences: list[dict[str, Any]] = []
    ai_source: str = "heuristic"


class SavedReportOut(ORMModel):
    id: str
    name: str
    type: str
    scope: str
    generated_by: str | None = None
    generated_at: datetime


# ---------------- AI / search ----------------
class ChatRequest(BaseModel):
    message: str = Field(min_length=1)
    history: list[dict[str, Any]] = []
    # Optional model override. Validated against settings.allowed_models();
    # anything unrecognised falls back to the configured default.
    model: str | None = None


class ChatResponse(BaseModel):
    reply: str
    # Which model actually produced this reply, so the UI can show it and a
    # silent fallback is visible rather than hidden.
    model: str | None = None
    ai_source: str = "heuristic"


class SearchRequest(BaseModel):
    query: str


class SearchResponse(BaseModel):
    members: list[MemberOut] = []
    projects: list[ProjectOut] = []
    complaints: list[ComplaintOut] = []


class DashboardStats(BaseModel):
    active_projects: int
    total_members: int
    high_risk: int
    open_complaints: int
    audit_flags: int


class OkResponse(BaseModel):
    ok: bool = True
