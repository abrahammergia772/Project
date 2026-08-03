"""
BuildIQ — models.py
SQLAlchemy ORM models mirroring the shapes the frontend already consumes
(see buildiq-frontend/js/mock-data.js), so no frontend changes are needed.
"""
from datetime import datetime, timezone

from sqlalchemy import (
    Boolean, DateTime, Float, ForeignKey, Index, Integer, JSON, String, Text, UniqueConstraint
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    """Internal staff and external clients both authenticate through this table."""
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    full_name: Mapped[str] = mapped_column(String(160), nullable=False)

    # `role` is the currently-active role; `roles` lists every role held.
    # This mirrors the frontend's multi-role switching.
    role: Mapped[str] = mapped_column(String(48), nullable=False, index=True)
    roles: Mapped[list] = mapped_column(JSON, default=list)
    role_contexts: Mapped[dict] = mapped_column(JSON, default=dict)

    department: Mapped[str | None] = mapped_column(String(96), index=True)
    job_title: Mapped[str | None] = mapped_column(String(120))
    org_name: Mapped[str | None] = mapped_column(String(160))
    org_type: Mapped[str | None] = mapped_column(String(96))
    phone: Mapped[str | None] = mapped_column(String(40))
    status: Mapped[str] = mapped_column(String(24), default="Active", index=True)
    experience_years: Mapped[int] = mapped_column(Integer, default=0)
    skills: Mapped[list] = mapped_column(JSON, default=list)
    projects_count: Mapped[int] = mapped_column(Integer, default=0)
    on_time_pct: Mapped[int] = mapped_column(Integer, default=90)
    avatar_color: Mapped[str | None] = mapped_column(String(16))
    # Uploaded profile photo. Stored via services/storage.py (Supabase Storage,
    # or local disk when that is not configured); this holds the storage key.
    avatar_url: Mapped[str | None] = mapped_column(String(400))
    # Human-readable staff number shown on the register (EMP-2026-0001).
    # Nullable and UNIQUE: existing rows predate it and are backfilled on
    # startup, but two people must never share one.
    employee_id: Mapped[str | None] = mapped_column(String(32), unique=True, index=True)
    # Which shift this person works. Free text rather than an enum so an
    # organisation can name its own shifts without a migration.
    shift: Mapped[str | None] = mapped_column(String(64))
    client_id: Mapped[str | None] = mapped_column(String(64), ForeignKey("clients.id", ondelete="SET NULL"))
    linked_project: Mapped[str | None] = mapped_column(String(200))
    joined: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    client = relationship("Client", back_populates="users")

    @property
    def all_roles(self) -> list[str]:
        return list(self.roles) if self.roles else [self.role]


class Client(Base):
    __tablename__ = "clients"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    company: Mapped[str] = mapped_column(String(160), nullable=False, index=True)
    contact_name: Mapped[str | None] = mapped_column(String(160))
    email: Mapped[str | None] = mapped_column(String(255), index=True)
    phone: Mapped[str | None] = mapped_column(String(40))
    avatar_color: Mapped[str | None] = mapped_column(String(16))

    users = relationship("User", back_populates="client")
    projects = relationship("Project", back_populates="client")


class Department(Base):
    __tablename__ = "departments"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(96), unique=True, nullable=False, index=True)
    head: Mapped[str | None] = mapped_column(String(160))
    head_id: Mapped[str | None] = mapped_column(String(64))
    description: Mapped[str | None] = mapped_column(Text)
    scope: Mapped[list] = mapped_column(JSON, default=list)
    budget: Mapped[float] = mapped_column(Float, default=0)


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    type: Mapped[str | None] = mapped_column(String(48))
    region: Mapped[str | None] = mapped_column(String(96))
    department: Mapped[str | None] = mapped_column(String(96), index=True)

    # Every project has exactly one accountable manager.
    manager_id: Mapped[str | None] = mapped_column(String(64), ForeignKey("users.id", ondelete="SET NULL"), index=True)
    manager_name: Mapped[str | None] = mapped_column(String(160))
    manager_role: Mapped[str | None] = mapped_column(String(48))

    client_id: Mapped[str | None] = mapped_column(String(64), ForeignKey("clients.id", ondelete="SET NULL"), index=True)
    client_name: Mapped[str | None] = mapped_column(String(160))
    status: Mapped[str] = mapped_column(String(32), default="Planning", index=True)
    progress: Mapped[int] = mapped_column(Integer, default=0)
    expected_progress: Mapped[int] = mapped_column(Integer, default=0)
    delay_risk: Mapped[str] = mapped_column(String(16), default="LOW", index=True)
    budget: Mapped[float] = mapped_column(Float, default=0)
    spent: Mapped[float] = mapped_column(Float, default=0)
    deadline: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    tasks_total: Mapped[int] = mapped_column(Integer, default=0)
    tasks_done: Mapped[int] = mapped_column(Integer, default=0)
    delay_reasons: Mapped[list] = mapped_column(JSON, default=list)
    description: Mapped[str | None] = mapped_column(Text)
    materials_total_cost: Mapped[float] = mapped_column(Float, default=0)

    client = relationship("Client", back_populates="projects")
    manager = relationship("User", foreign_keys=[manager_id])
    materials = relationship("Material", back_populates="project", cascade="all, delete-orphan")
    members = relationship("ProjectMember", back_populates="project", cascade="all, delete-orphan")


class ProjectMember(Base):
    """Join table for a project's assigned team."""
    __tablename__ = "project_members"
    __table_args__ = (UniqueConstraint("project_id", "user_id", name="uq_project_member"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    project_id: Mapped[str] = mapped_column(String(64), ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[str] = mapped_column(String(64), ForeignKey("users.id", ondelete="CASCADE"), index=True)

    project = relationship("Project", back_populates="members")
    user = relationship("User")


class Material(Base):
    __tablename__ = "materials"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    project_id: Mapped[str] = mapped_column(String(64), ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    unit: Mapped[str] = mapped_column(String(32), default="unit")
    quantity: Mapped[float] = mapped_column(Float, default=0)
    unit_price: Mapped[float] = mapped_column(Float, default=0)
    total_cost: Mapped[float] = mapped_column(Float, default=0)
    supplier: Mapped[str | None] = mapped_column(String(160))
    purchased_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    purchased_by: Mapped[str | None] = mapped_column(String(160))

    project = relationship("Project", back_populates="materials")


class Task(Base):
    __tablename__ = "tasks"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    category: Mapped[str | None] = mapped_column(String(48))
    assignee_id: Mapped[str | None] = mapped_column(String(64), index=True)
    assignee_name: Mapped[str | None] = mapped_column(String(160))
    assignee_type: Mapped[str] = mapped_column(String(24), default="staff")  # staff | daily_worker
    department: Mapped[str | None] = mapped_column(String(96), index=True)
    project_id: Mapped[str | None] = mapped_column(String(64), ForeignKey("projects.id", ondelete="SET NULL"), index=True)
    project_title: Mapped[str | None] = mapped_column(String(200))
    project_risk: Mapped[str] = mapped_column(String(16), default="LOW")
    status: Mapped[str] = mapped_column(String(32), default="To Do", index=True)
    blocking: Mapped[bool] = mapped_column(Boolean, default=False)
    estimated_hours: Mapped[float] = mapped_column(Float, default=2)
    due_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    # Provenance when a manager/auditor assigns work to someone
    assigned_by: Mapped[str | None] = mapped_column(String(160))
    assigned_by_role: Mapped[str | None] = mapped_column(String(48))
    note: Mapped[str] = mapped_column(Text, default="")


class DailyWorker(Base):
    """Casual/day labour — distinct from permanent staff in `users`."""
    __tablename__ = "daily_workers"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    full_name: Mapped[str] = mapped_column(String(160), nullable=False)
    trade: Mapped[str | None] = mapped_column(String(96))
    project_id: Mapped[str | None] = mapped_column(String(64), ForeignKey("projects.id", ondelete="SET NULL"), index=True)
    project_title: Mapped[str | None] = mapped_column(String(200))
    department: Mapped[str | None] = mapped_column(String(96), index=True)
    daily_rate: Mapped[float] = mapped_column(Float, default=0)
    phone: Mapped[str | None] = mapped_column(String(40))
    status: Mapped[str] = mapped_column(String(24), default="Active")
    avatar_color: Mapped[str | None] = mapped_column(String(16))
    # Daily workers appear on the same register as staff, so they carry the
    # same two identity fields. Prefixed DW- to stay distinguishable.
    employee_id: Mapped[str | None] = mapped_column(String(32), unique=True, index=True)
    shift: Mapped[str | None] = mapped_column(String(64))
    joined: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Attendance(Base):
    __tablename__ = "attendance"
    __table_args__ = (
        UniqueConstraint("person_id", "date", name="uq_attendance_person_date"),
        Index("ix_attendance_dept_date", "department", "date"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    person_id: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    person_name: Mapped[str | None] = mapped_column(String(160))
    person_type: Mapped[str] = mapped_column(String(24), default="staff")
    department: Mapped[str | None] = mapped_column(String(96), index=True)
    project_id: Mapped[str | None] = mapped_column(String(64))
    project_title: Mapped[str | None] = mapped_column(String(200))
    date: Mapped[str] = mapped_column(String(10), index=True)     # YYYY-MM-DD
    status: Mapped[str] = mapped_column(String(16), default="Present")
    check_in: Mapped[str | None] = mapped_column(String(8))
    recorded_by: Mapped[str | None] = mapped_column(String(160))

    # Absence-reason workflow
    reason: Mapped[str | None] = mapped_column(Text)
    reason_category: Mapped[str | None] = mapped_column(String(64))
    reason_submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    reason_status: Mapped[str | None] = mapped_column(String(24))  # Not Submitted|Pending|Accepted|Rejected
    reason_reviewed_by: Mapped[str | None] = mapped_column(String(160))
    reason_reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    reason_review_note: Mapped[str | None] = mapped_column(Text)


class Shift(Base):
    """A named working pattern (Regular Shift, Night Shift, ...).

    Times are "HH:MM" strings to match Attendance.check_in, which is already
    stored that way. A shift whose end time is <= its start time is treated as
    crossing midnight -- a night shift is 22:00-06:00, not an eight-hour
    negative.
    """
    __tablename__ = "shifts"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    start_time: Mapped[str] = mapped_column(String(5), default="08:00")
    end_time: Mapped[str] = mapped_column(String(5), default="17:00")
    break_minutes: Mapped[int] = mapped_column(Integer, default=60)
    # Weekday numbers, Monday=0 .. Sunday=6. Defaults to a six-day week,
    # which is the norm on these sites -- Saturday is a working day.
    work_days: Mapped[list] = mapped_column(JSON, default=lambda: [0, 1, 2, 3, 4, 5])
    color: Mapped[str | None] = mapped_column(String(16))
    # Exactly one shift is the default; new people inherit it.
    is_default: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Overtime(Base):
    """Extra hours worked beyond a person's shift, and their approval state.

    Deliberately separate from `attendance`: attendance answers "were they
    here", overtime answers "how much extra, at what rate, approved by whom".
    Folding overtime into the attendance row would mean a person could not
    have two overtime entries on one day, and the unique (person_id, date)
    constraint there would silently prevent it.
    """
    __tablename__ = "overtime"
    __table_args__ = (
        Index("ix_overtime_person_date", "person_id", "date"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    person_id: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    person_name: Mapped[str | None] = mapped_column(String(160))
    person_type: Mapped[str] = mapped_column(String(24), default="staff")
    department: Mapped[str | None] = mapped_column(String(96), index=True)
    date: Mapped[str] = mapped_column(String(10), index=True)      # YYYY-MM-DD
    hours: Mapped[float] = mapped_column(Float, default=0)
    # 1.5 = time-and-a-half, 2.0 = double time. Stored per record because the
    # multiplier depends on when the hours fell (weeknight vs public holiday).
    rate_multiplier: Mapped[float] = mapped_column(Float, default=1.5)
    reason: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(24), default="Pending", index=True)
    requested_by: Mapped[str | None] = mapped_column(String(160))
    reviewed_by: Mapped[str | None] = mapped_column(String(160))
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    review_note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Complaint(Base):
    __tablename__ = "complaints"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    submitted_by: Mapped[str | None] = mapped_column(String(64), index=True)
    submitted_by_type: Mapped[str] = mapped_column(String(24), default="member")
    customer_name: Mapped[str | None] = mapped_column(String(160))
    category: Mapped[str | None] = mapped_column(String(64), index=True)
    severity: Mapped[str] = mapped_column(String(16), default="medium", index=True)
    status: Mapped[str] = mapped_column(String(24), default="pending", index=True)
    department: Mapped[str | None] = mapped_column(String(96), index=True)
    project: Mapped[str | None] = mapped_column(String(200))
    text: Mapped[str] = mapped_column(Text)
    sentiment: Mapped[str | None] = mapped_column(String(32))
    ai_summary: Mapped[str | None] = mapped_column(Text)
    confidence: Mapped[int] = mapped_column(Integer, default=80)
    # Which of the seven audit types this complaint belongs to, predicted from
    # its text by services/audit_classifier.py. Nullable so older rows and the
    # self-healing column check in main.py both cope.
    audit_type: Mapped[str | None] = mapped_column(String(32), index=True)
    audit_type_confidence: Mapped[float | None] = mapped_column(Float)
    assignee: Mapped[str | None] = mapped_column(String(160))
    resolution_note: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class AuditLog(Base):
    """Every log entry is classified into one of the seven audit types."""
    __tablename__ = "audit_logs"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user: Mapped[str | None] = mapped_column(String(160), index=True)
    user_role: Mapped[str | None] = mapped_column(String(48))
    action: Mapped[str] = mapped_column(String(48), index=True)
    action_label: Mapped[str | None] = mapped_column(String(96))
    audit_type: Mapped[str] = mapped_column(String(32), index=True, default="USER_ACTIVITY")
    ml_role: Mapped[str | None] = mapped_column(String(64))
    resource: Mapped[str | None] = mapped_column(String(255))
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    anomaly_score: Mapped[float] = mapped_column(Float, default=0)
    risk_level: Mapped[str] = mapped_column(String(16), default="LOW", index=True)
    is_flagged: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    context: Mapped[str | None] = mapped_column(String(255))
    explanation: Mapped[str | None] = mapped_column(Text)
    review_status: Mapped[str] = mapped_column(String(32), default="Cleared")


class Notification(Base):
    __tablename__ = "notifications"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    title: Mapped[str] = mapped_column(String(200))
    body: Mapped[str] = mapped_column(Text)
    icon: Mapped[str] = mapped_column(String(48), default="fa-bell")
    type: Mapped[str] = mapped_column(String(24), default="info")
    link: Mapped[str | None] = mapped_column(String(120))
    target_user_ids: Mapped[list] = mapped_column(JSON, default=list)
    target_roles: Mapped[list] = mapped_column(JSON, default=list)
    target_departments: Mapped[list] = mapped_column(JSON, default=list)
    read_by: Mapped[list] = mapped_column(JSON, default=list)     # per-user read state
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)


class Document(Base):
    __tablename__ = "documents"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    storage_key: Mapped[str] = mapped_column(String(512))          # Supabase object path or local path
    storage_backend: Mapped[str] = mapped_column(String(24), default="local")  # supabase | local
    content_type: Mapped[str] = mapped_column(String(120), default="application/octet-stream")
    size_bytes: Mapped[int] = mapped_column(Integer, default=0)
    size_label: Mapped[str] = mapped_column(String(24), default="0 B")
    icon: Mapped[str] = mapped_column(String(48), default="fa-file")
    color: Mapped[str] = mapped_column(String(24), default="gray")
    uploaded_by: Mapped[str | None] = mapped_column(String(160))
    uploaded_by_id: Mapped[str | None] = mapped_column(String(64), index=True)
    department: Mapped[str | None] = mapped_column(String(96), index=True)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class PasswordResetToken(Base):
    __tablename__ = "password_reset_tokens"

    token: Mapped[str] = mapped_column(String(128), primary_key=True)
    email: Mapped[str] = mapped_column(String(255), index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    used: Mapped[bool] = mapped_column(Boolean, default=False)


class SavedReport(Base):
    __tablename__ = "saved_reports"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    type: Mapped[str] = mapped_column(String(96))
    scope: Mapped[str] = mapped_column(String(120), default="Entire Organization")
    content: Mapped[str] = mapped_column(Text, default="")
    stats: Mapped[dict] = mapped_column(JSON, default=dict)
    generated_by: Mapped[str | None] = mapped_column(String(160))
    generated_by_id: Mapped[str | None] = mapped_column(String(64), index=True)
    generated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)


class Message(Base):
    """A direct message between two members.

    Deliberately simple: sender, recipient, body, read flag. Threads are
    reconstructed by pairing sender/recipient rather than stored, which keeps
    the schema small and avoids a conversations table nobody queries directly.
    """
    __tablename__ = "messages"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    sender_id: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    sender_name: Mapped[str | None] = mapped_column(String(160))
    recipient_id: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    recipient_name: Mapped[str | None] = mapped_column(String(160))
    body: Mapped[str] = mapped_column(Text, nullable=False)
    is_read: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, index=True)
