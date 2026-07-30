-- ============================================================================
-- BuildIQ — 0001_schema.sql
-- Core tables, constraints and indexes.
--
-- This mirrors app/models.py exactly. The API can create these itself with
-- SQLAlchemy's create_all() on first boot, but running this file gives you:
--   * a reviewable, version-controlled schema
--   * CHECK constraints and FK indexes that the ORM doesn't declare
--   * a base for real migrations
--
-- Apply with either:
--   psql "$DATABASE_URL" -f supabase/migrations/0001_schema.sql
--   supabase db push
--
-- Idempotent: safe to run more than once.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- clients
-- ----------------------------------------------------------------------------
create table if not exists public.clients (
    id            varchar(64) primary key,
    company       varchar(160) not null,
    contact_name  varchar(160),
    email         varchar(255),
    phone         varchar(40),
    avatar_color  varchar(16)
);
create index if not exists ix_clients_company on public.clients (company);
create index if not exists ix_clients_email   on public.clients (email);

-- ----------------------------------------------------------------------------
-- users — internal staff and external clients both authenticate here.
--
-- `role` is the currently-active role; `roles` is every role the person holds.
-- That pair is what powers multi-role switching.
-- ----------------------------------------------------------------------------
create table if not exists public.users (
    id                varchar(64)  primary key,
    email             varchar(255) not null unique,
    hashed_password   varchar(255) not null,
    full_name         varchar(160) not null,
    role              varchar(48)  not null,
    roles             jsonb        not null default '[]'::jsonb,
    role_contexts     jsonb        not null default '{}'::jsonb,
    department        varchar(96),
    job_title         varchar(120),
    org_name          varchar(160),
    org_type          varchar(96),
    phone             varchar(40),
    status            varchar(24)  not null default 'Active',
    experience_years  integer      not null default 0,
    skills            jsonb        not null default '[]'::jsonb,
    projects_count    integer      not null default 0,
    on_time_pct       integer      not null default 90,
    avatar_color      varchar(16),
    client_id         varchar(64)  references public.clients (id) on delete set null,
    linked_project    varchar(200),
    joined            timestamptz  not null default now(),

    constraint ck_users_role check (role in (
        'Super Admin','General Manager','Department Manager',
        'Project Manager','Engineer','Auditor','Client')),
    constraint ck_users_status check (status in ('Active','Inactive','On Leave')),
    constraint ck_users_on_time_pct check (on_time_pct between 0 and 100)
);
create index if not exists ix_users_email      on public.users (email);
create index if not exists ix_users_role       on public.users (role);
create index if not exists ix_users_department on public.users (department);
create index if not exists ix_users_status     on public.users (status);
create index if not exists ix_users_client_id  on public.users (client_id);
-- Membership tests like `roles ? 'Project Manager'` hit this.
create index if not exists ix_users_roles_gin  on public.users using gin (roles);

-- ----------------------------------------------------------------------------
-- departments
-- ----------------------------------------------------------------------------
create table if not exists public.departments (
    id           varchar(64) primary key,
    name         varchar(96) not null unique,
    head         varchar(160),
    head_id      varchar(64),
    description  text,
    scope        jsonb  not null default '[]'::jsonb,
    budget       double precision not null default 0
);
create index if not exists ix_departments_name on public.departments (name);

-- ----------------------------------------------------------------------------
-- projects — every project has exactly one accountable manager.
-- ----------------------------------------------------------------------------
create table if not exists public.projects (
    id                    varchar(64) primary key,
    title                 varchar(200) not null,
    type                  varchar(48),
    region                varchar(96),
    department            varchar(96),
    manager_id            varchar(64) references public.users (id)   on delete set null,
    manager_name          varchar(160),
    manager_role          varchar(48),
    client_id             varchar(64) references public.clients (id) on delete set null,
    client_name           varchar(160),
    status                varchar(32) not null default 'Planning',
    progress              integer     not null default 0,
    expected_progress     integer     not null default 0,
    delay_risk            varchar(16) not null default 'LOW',
    budget                double precision not null default 0,
    spent                 double precision not null default 0,
    deadline              timestamptz,
    tasks_total           integer not null default 0,
    tasks_done            integer not null default 0,
    delay_reasons         jsonb   not null default '[]'::jsonb,
    description           text,
    materials_total_cost  double precision not null default 0,

    constraint ck_projects_progress          check (progress between 0 and 100),
    constraint ck_projects_expected_progress check (expected_progress between 0 and 100),
    constraint ck_projects_delay_risk        check (delay_risk in ('LOW','MEDIUM','HIGH','CRITICAL')),
    constraint ck_projects_status            check (status in ('Planning','In Progress','Completed','On Hold'))
);
create index if not exists ix_projects_title      on public.projects (title);
create index if not exists ix_projects_department on public.projects (department);
create index if not exists ix_projects_manager_id on public.projects (manager_id);
create index if not exists ix_projects_client_id  on public.projects (client_id);
create index if not exists ix_projects_status     on public.projects (status);
create index if not exists ix_projects_delay_risk on public.projects (delay_risk);

-- ----------------------------------------------------------------------------
-- project_members — a project's assigned team.
-- ----------------------------------------------------------------------------
create table if not exists public.project_members (
    id          bigint generated always as identity primary key,
    project_id  varchar(64) not null references public.projects (id) on delete cascade,
    user_id     varchar(64) not null references public.users (id)    on delete cascade,
    constraint uq_project_member unique (project_id, user_id)
);
create index if not exists ix_project_members_project_id on public.project_members (project_id);
create index if not exists ix_project_members_user_id    on public.project_members (user_id);

-- ----------------------------------------------------------------------------
-- materials — purchased materials per project.
-- ----------------------------------------------------------------------------
create table if not exists public.materials (
    id            varchar(64) primary key,
    project_id    varchar(64) not null references public.projects (id) on delete cascade,
    name          varchar(200) not null,
    unit          varchar(32)  not null default 'unit',
    quantity      double precision not null default 0,
    unit_price    double precision not null default 0,
    total_cost    double precision not null default 0,
    supplier      varchar(160),
    purchased_at  timestamptz not null default now(),
    purchased_by  varchar(160),

    constraint ck_materials_quantity   check (quantity >= 0),
    constraint ck_materials_unit_price check (unit_price >= 0)
);
create index if not exists ix_materials_project_id on public.materials (project_id);

-- ----------------------------------------------------------------------------
-- tasks
-- ----------------------------------------------------------------------------
create table if not exists public.tasks (
    id                varchar(64) primary key,
    title             varchar(200) not null,
    category          varchar(48),
    -- Not a FK: an assignee may be a staff user OR a daily worker.
    assignee_id       varchar(64),
    assignee_name     varchar(160),
    assignee_type     varchar(24) not null default 'staff',
    department        varchar(96),
    project_id        varchar(64) references public.projects (id) on delete set null,
    project_title     varchar(200),
    project_risk      varchar(16) not null default 'LOW',
    status            varchar(32) not null default 'To Do',
    blocking          boolean     not null default false,
    estimated_hours   double precision not null default 2,
    due_date          timestamptz,
    created_at        timestamptz not null default now(),
    assigned_by       varchar(160),
    assigned_by_role  varchar(48),
    note              text not null default '',

    constraint ck_tasks_status        check (status in ('To Do','In Progress','Done','Blocked')),
    constraint ck_tasks_assignee_type check (assignee_type in ('staff','daily_worker'))
);
create index if not exists ix_tasks_assignee_id on public.tasks (assignee_id);
create index if not exists ix_tasks_department  on public.tasks (department);
create index if not exists ix_tasks_project_id  on public.tasks (project_id);
create index if not exists ix_tasks_status      on public.tasks (status);
create index if not exists ix_tasks_due_date    on public.tasks (due_date);

-- ----------------------------------------------------------------------------
-- daily_workers — casual/day labour, distinct from staff in `users`.
-- ----------------------------------------------------------------------------
create table if not exists public.daily_workers (
    id             varchar(64) primary key,
    full_name      varchar(160) not null,
    trade          varchar(96),
    project_id     varchar(64) references public.projects (id) on delete set null,
    project_title  varchar(200),
    department     varchar(96),
    daily_rate     double precision not null default 0,
    phone          varchar(40),
    status         varchar(24) not null default 'Active',
    avatar_color   varchar(16),
    joined         timestamptz not null default now()
);
create index if not exists ix_daily_workers_project_id on public.daily_workers (project_id);
create index if not exists ix_daily_workers_department on public.daily_workers (department);

-- ----------------------------------------------------------------------------
-- attendance — one row per person per day, plus the absence-reason workflow.
-- ----------------------------------------------------------------------------
create table if not exists public.attendance (
    id                   varchar(64) primary key,
    -- Not a FK: person_id may reference users OR daily_workers.
    person_id            varchar(64) not null,
    person_name          varchar(160),
    person_type          varchar(24) not null default 'staff',
    department           varchar(96),
    project_id           varchar(64),
    project_title        varchar(200),
    date                 varchar(10) not null,          -- YYYY-MM-DD
    status               varchar(16) not null default 'Present',
    check_in             varchar(8),
    recorded_by          varchar(160),
    reason               text,
    reason_category      varchar(64),
    reason_submitted_at  timestamptz,
    reason_status        varchar(24),
    reason_reviewed_by   varchar(160),
    reason_reviewed_at   timestamptz,
    reason_review_note   text,

    -- The rule that keeps the register unambiguous.
    constraint uq_attendance_person_date unique (person_id, date),
    constraint ck_attendance_status      check (status in ('Present','Absent')),
    constraint ck_attendance_person_type check (person_type in ('staff','daily_worker')),
    constraint ck_attendance_reason_status check (
        reason_status is null or
        reason_status in ('Not Submitted','Pending','Accepted','Rejected')),
    -- A Present day can never carry an absence reason.
    constraint ck_attendance_reason_only_when_absent check (
        status = 'Absent' or reason is null)
);
create index if not exists ix_attendance_person_id on public.attendance (person_id);
create index if not exists ix_attendance_date      on public.attendance (date);
create index if not exists ix_attendance_department on public.attendance (department);
create index if not exists ix_attendance_dept_date on public.attendance (department, date);
-- Speeds up the reviewer queue.
create index if not exists ix_attendance_reason_status on public.attendance (reason_status)
    where reason_status is not null;

-- ----------------------------------------------------------------------------
-- complaints
-- ----------------------------------------------------------------------------
create table if not exists public.complaints (
    id                 varchar(64) primary key,
    submitted_by       varchar(64),
    submitted_by_type  varchar(24) not null default 'member',
    customer_name      varchar(160),
    category           varchar(64),
    severity           varchar(16) not null default 'medium',
    status             varchar(24) not null default 'pending',
    department         varchar(96),
    project            varchar(200),
    text               text not null,
    sentiment          varchar(32),
    ai_summary         text,
    confidence         integer not null default 80,
    assignee           varchar(160),
    resolution_note    text not null default '',
    created_at         timestamptz not null default now(),
    resolved_at        timestamptz,

    constraint ck_complaints_severity check (severity in ('low','medium','high','critical')),
    constraint ck_complaints_status   check (status in ('pending','in_progress','resolved')),
    constraint ck_complaints_confidence check (confidence between 0 and 100)
);
create index if not exists ix_complaints_submitted_by on public.complaints (submitted_by);
create index if not exists ix_complaints_category     on public.complaints (category);
create index if not exists ix_complaints_severity     on public.complaints (severity);
create index if not exists ix_complaints_status       on public.complaints (status);
create index if not exists ix_complaints_department   on public.complaints (department);
create index if not exists ix_complaints_created_at   on public.complaints (created_at);

-- ----------------------------------------------------------------------------
-- audit_logs — every entry is classified into one of the seven audit types.
-- ----------------------------------------------------------------------------
create table if not exists public.audit_logs (
    id             varchar(64) primary key,
    "user"         varchar(160),
    user_role      varchar(48),
    action         varchar(48) not null,
    action_label   varchar(96),
    audit_type     varchar(32) not null default 'USER_ACTIVITY',
    ml_role        varchar(64),
    resource       varchar(255),
    timestamp      timestamptz not null default now(),
    anomaly_score  double precision not null default 0,
    risk_level     varchar(16) not null default 'LOW',
    is_flagged     boolean     not null default false,
    context        varchar(255),
    explanation    text,
    review_status  varchar(32) not null default 'Cleared',

    constraint ck_audit_type check (audit_type in (
        'SECURITY','FINANCIAL','COMPLIANCE','USER_ACTIVITY',
        'DATA_INTEGRITY','PROJECT_RESOURCE','REPORT_DOCUMENT')),
    constraint ck_audit_risk_level    check (risk_level in ('LOW','MEDIUM','HIGH','CRITICAL')),
    constraint ck_audit_anomaly_score check (anomaly_score between 0 and 1)
);
create index if not exists ix_audit_logs_user       on public.audit_logs ("user");
create index if not exists ix_audit_logs_action     on public.audit_logs (action);
create index if not exists ix_audit_logs_audit_type on public.audit_logs (audit_type);
create index if not exists ix_audit_logs_timestamp  on public.audit_logs (timestamp desc);
create index if not exists ix_audit_logs_risk_level on public.audit_logs (risk_level);
create index if not exists ix_audit_logs_is_flagged on public.audit_logs (is_flagged);
-- The Anomalies tab reads flagged rows worst-first.
create index if not exists ix_audit_logs_flagged_score
    on public.audit_logs (anomaly_score desc) where is_flagged;

-- ----------------------------------------------------------------------------
-- notifications — read state is per user, held in `read_by`.
-- ----------------------------------------------------------------------------
create table if not exists public.notifications (
    id                  varchar(64) primary key,
    title               varchar(200) not null,
    body                text not null,
    icon                varchar(48) not null default 'fa-bell',
    type                varchar(24) not null default 'info',
    link                varchar(120),
    target_user_ids     jsonb not null default '[]'::jsonb,
    target_roles        jsonb not null default '[]'::jsonb,
    target_departments  jsonb not null default '[]'::jsonb,
    read_by             jsonb not null default '[]'::jsonb,
    created_at          timestamptz not null default now()
);
create index if not exists ix_notifications_created_at on public.notifications (created_at desc);
-- Targeting is a containment test against these arrays.
create index if not exists ix_notifications_target_users on public.notifications using gin (target_user_ids);
create index if not exists ix_notifications_target_roles on public.notifications using gin (target_roles);
create index if not exists ix_notifications_target_depts on public.notifications using gin (target_departments);

-- ----------------------------------------------------------------------------
-- documents — metadata only; bytes live in Supabase Storage.
-- ----------------------------------------------------------------------------
create table if not exists public.documents (
    id               varchar(64) primary key,
    name             varchar(255) not null,
    storage_key      varchar(512) not null,
    storage_backend  varchar(24)  not null default 'local',
    content_type     varchar(120) not null default 'application/octet-stream',
    size_bytes       integer      not null default 0,
    size_label       varchar(24)  not null default '0 B',
    icon             varchar(48)  not null default 'fa-file',
    color            varchar(24)  not null default 'gray',
    uploaded_by      varchar(160),
    uploaded_by_id   varchar(64),
    department       varchar(96),
    uploaded_at      timestamptz  not null default now(),

    constraint ck_documents_backend check (storage_backend in ('supabase','local'))
);
create index if not exists ix_documents_uploaded_by_id on public.documents (uploaded_by_id);
create index if not exists ix_documents_department     on public.documents (department);

-- ----------------------------------------------------------------------------
-- password_reset_tokens — single-use, time-limited.
-- ----------------------------------------------------------------------------
create table if not exists public.password_reset_tokens (
    token       varchar(128) primary key,
    email       varchar(255) not null,
    expires_at  timestamptz  not null,
    used        boolean      not null default false
);
create index if not exists ix_password_reset_tokens_email on public.password_reset_tokens (email);

-- ----------------------------------------------------------------------------
-- saved_reports
-- ----------------------------------------------------------------------------
create table if not exists public.saved_reports (
    id                varchar(64) primary key,
    name              varchar(200) not null,
    type              varchar(96)  not null,
    scope             varchar(120) not null default 'Entire Organization',
    content           text  not null default '',
    stats             jsonb not null default '{}'::jsonb,
    generated_by      varchar(160),
    generated_by_id   varchar(64),
    generated_at      timestamptz not null default now()
);
create index if not exists ix_saved_reports_generated_by_id on public.saved_reports (generated_by_id);
create index if not exists ix_saved_reports_generated_at    on public.saved_reports (generated_at desc);

commit;
