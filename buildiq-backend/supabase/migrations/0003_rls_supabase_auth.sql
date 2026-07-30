-- ============================================================================
-- BuildIQ — 0003_rls_supabase_auth.sql   [OPTIONAL — NOT APPLIED BY DEFAULT]
--
-- The current architecture routes every request through the FastAPI backend,
-- which holds the service_role key and enforces authorization in Python.
-- 0002 therefore denies anon/authenticated everything, and that is the
-- recommended setup.
--
-- This file is for a different future: if you ever let the browser query
-- Supabase directly (realtime subscriptions, an offline-first mobile client,
-- Supabase Auth replacing the backend's JWTs), you need RLS policies that
-- reproduce the role rules at the database level.
--
-- These policies are written and ready but NOT applied — the whole file is
-- guarded. Read it, decide, then remove the guard for the tables you need.
--
-- PREREQUISITE
-- ------------
-- These assume users authenticate through Supabase Auth and that
-- public.users.id matches auth.uid(). Today the backend issues its own JWTs
-- and generates its own ids, so you would need to migrate identities first.
-- ============================================================================

do $$
begin
    raise exception using
        message = 'This migration is optional and intentionally not applied.',
        detail  = 'It only applies if the browser talks to Supabase directly. '
               || 'The default architecture routes everything through the API, '
               || 'which uses service_role and enforces roles in Python.',
        hint    = 'Read the policies below, then delete this guard block to apply them.';
end $$;

begin;

-- ----------------------------------------------------------------------------
-- Helper functions — mirror app/security.py so the rules stay recognisable.
-- SECURITY DEFINER lets them read public.users without recursing through the
-- very policies they support.
-- ----------------------------------------------------------------------------
create or replace function public.current_role_name()
returns text language sql stable security definer set search_path = public as $$
    select role from public.users where id = auth.uid()::text
$$;

create or replace function public.current_department()
returns text language sql stable security definer set search_path = public as $$
    select department from public.users where id = auth.uid()::text
$$;

create or replace function public.current_client_id()
returns text language sql stable security definer set search_path = public as $$
    select coalesce(client_id, id) from public.users where id = auth.uid()::text
$$;

-- Super Admin and General Manager see everything.
create or replace function public.is_org_wide()
returns boolean language sql stable security definer set search_path = public as $$
    select public.current_role_name() in ('Super Admin','General Manager')
$$;

-- Full project visibility also extends to Auditor (read-only oversight).
create or replace function public.has_full_project_access()
returns boolean language sql stable security definer set search_path = public as $$
    select public.current_role_name() in ('Super Admin','General Manager','Auditor')
$$;

-- Taking attendance belongs solely to the Workforce & Attendance department.
create or replace function public.can_take_attendance()
returns boolean language sql stable security definer set search_path = public as $$
    select public.current_department() = 'Workforce & Attendance'
       and public.current_role_name() <> 'Client'
$$;

create or replace function public.manages_project(p_project_id text)
returns boolean language sql stable security definer set search_path = public as $$
    select exists (
        select 1 from public.projects
        where id = p_project_id and manager_id = auth.uid()::text)
$$;

create or replace function public.works_on_project(p_project_id text)
returns boolean language sql stable security definer set search_path = public as $$
    select exists (
        select 1 from public.project_members
        where project_id = p_project_id and user_id = auth.uid()::text)
    or public.manages_project(p_project_id)
$$;

revoke all on function
    public.current_role_name(), public.current_department(), public.current_client_id(),
    public.is_org_wide(), public.has_full_project_access(), public.can_take_attendance(),
    public.manages_project(text), public.works_on_project(text)
from public, anon;

grant execute on function
    public.current_role_name(), public.current_department(), public.current_client_id(),
    public.is_org_wide(), public.has_full_project_access(), public.can_take_attendance(),
    public.manages_project(text), public.works_on_project(text)
to authenticated;

-- ----------------------------------------------------------------------------
-- users — you see yourself; managers see their department; admins see all.
-- ----------------------------------------------------------------------------
drop policy if exists users_select on public.users;
create policy users_select on public.users
    for select to authenticated
    using (
        id = auth.uid()::text
        or public.is_org_wide()
        or (public.current_role_name() = 'Department Manager'
            and department = public.current_department())
    );

drop policy if exists users_update_self on public.users;
create policy users_update_self on public.users
    for update to authenticated
    using (id = auth.uid()::text)
    with check (id = auth.uid()::text);

-- ----------------------------------------------------------------------------
-- projects — the same scoping the API applies.
--   Admin/GM/Auditor : everything
--   Dept Manager     : their department, plus anything they manage
--   Project Manager  : only what they manage
--   Engineer         : only what they're on
--   Client           : only their own linked projects
-- ----------------------------------------------------------------------------
drop policy if exists projects_select on public.projects;
create policy projects_select on public.projects
    for select to authenticated
    using (
        public.has_full_project_access()
        or (public.current_role_name() = 'Department Manager'
            and (department = public.current_department() or manager_id = auth.uid()::text))
        or (public.current_role_name() = 'Project Manager' and manager_id = auth.uid()::text)
        or (public.current_role_name() = 'Engineer' and public.works_on_project(id))
        or (public.current_role_name() = 'Client' and client_id = public.current_client_id())
    );

-- Only Admin/GM create or delete projects.
drop policy if exists projects_insert on public.projects;
create policy projects_insert on public.projects
    for insert to authenticated with check (public.is_org_wide());

drop policy if exists projects_delete on public.projects;
create policy projects_delete on public.projects
    for delete to authenticated using (public.is_org_wide());

-- The project's own manager and the owning dept manager may update it.
drop policy if exists projects_update on public.projects;
create policy projects_update on public.projects
    for update to authenticated
    using (
        public.is_org_wide()
        or manager_id = auth.uid()::text
        or (public.current_role_name() = 'Department Manager'
            and department = public.current_department())
    );

-- ----------------------------------------------------------------------------
-- materials — visible with the project; editable by admin, its manager, or
-- the owning department's manager.
-- ----------------------------------------------------------------------------
drop policy if exists materials_select on public.materials;
create policy materials_select on public.materials
    for select to authenticated
    using (exists (select 1 from public.projects p where p.id = project_id));

drop policy if exists materials_write on public.materials;
create policy materials_write on public.materials
    for all to authenticated
    using (
        public.is_org_wide()
        or public.manages_project(project_id)
        or exists (select 1 from public.projects p
                   where p.id = project_id
                     and public.current_role_name() = 'Department Manager'
                     and p.department = public.current_department())
    )
    with check (
        public.is_org_wide()
        or public.manages_project(project_id)
        or exists (select 1 from public.projects p
                   where p.id = project_id
                     and public.current_role_name() = 'Department Manager'
                     and p.department = public.current_department())
    );

-- ----------------------------------------------------------------------------
-- tasks — your own, your department's, or your projects'.
-- ----------------------------------------------------------------------------
drop policy if exists tasks_select on public.tasks;
create policy tasks_select on public.tasks
    for select to authenticated
    using (
        public.is_org_wide()
        or public.current_role_name() = 'Auditor'
        or assignee_id = auth.uid()::text
        or (public.current_role_name() = 'Department Manager'
            and department = public.current_department())
        or (public.current_role_name() = 'Project Manager'
            and project_id is not null and public.manages_project(project_id))
    );

drop policy if exists tasks_write on public.tasks;
create policy tasks_write on public.tasks
    for all to authenticated
    using (
        public.is_org_wide()
        or assignee_id = auth.uid()::text
        or (public.current_role_name() = 'Department Manager'
            and department = public.current_department())
        or (project_id is not null and public.manages_project(project_id))
    )
    with check (
        public.current_role_name() in
            ('Super Admin','General Manager','Department Manager','Project Manager','Auditor')
        or assignee_id = auth.uid()::text
    );

-- ----------------------------------------------------------------------------
-- attendance — everyone reads their own row. Only the Workforce & Attendance
-- department may write the register; everyone may explain their own absence.
-- ----------------------------------------------------------------------------
drop policy if exists attendance_select on public.attendance;
create policy attendance_select on public.attendance
    for select to authenticated
    using (
        person_id = auth.uid()::text                       -- always see your own days
        or public.is_org_wide()
        or public.current_role_name() = 'Auditor'
        or public.can_take_attendance()
        or (public.current_role_name() = 'Department Manager'
            and department = public.current_department())
    );

-- Taking the register: Workforce & Attendance only. Note this excludes even
-- Super Admin, matching the product rule.
drop policy if exists attendance_insert on public.attendance;
create policy attendance_insert on public.attendance
    for insert to authenticated with check (public.can_take_attendance());

-- Two distinct update paths: the register itself, or your own reason.
drop policy if exists attendance_update on public.attendance;
create policy attendance_update on public.attendance
    for update to authenticated
    using (
        public.can_take_attendance()                        -- edit the register
        or person_id = auth.uid()::text                     -- explain your own absence
        or public.is_org_wide()                             -- review a submitted reason
        or (public.current_role_name() = 'Department Manager'
            and department = public.current_department())
    );

-- ----------------------------------------------------------------------------
-- complaints — submitters see their own; resolvers see their scope.
-- Auditors have no complaint access at all.
-- ----------------------------------------------------------------------------
drop policy if exists complaints_select on public.complaints;
create policy complaints_select on public.complaints
    for select to authenticated
    using (
        public.current_role_name() <> 'Auditor'
        and (
            submitted_by = auth.uid()::text
            or public.is_org_wide()
            or (public.current_role_name() = 'Department Manager'
                and department = public.current_department())
            or (public.current_role_name() = 'Project Manager'
                and project in (select title from public.projects
                                where manager_id = auth.uid()::text))
        )
    );

drop policy if exists complaints_insert on public.complaints;
create policy complaints_insert on public.complaints
    for insert to authenticated
    with check (submitted_by = auth.uid()::text
                and public.current_role_name() <> 'Auditor');

drop policy if exists complaints_update on public.complaints;
create policy complaints_update on public.complaints
    for update to authenticated
    using (
        public.is_org_wide()
        or (public.current_role_name() = 'Department Manager'
            and department = public.current_department())
        or (public.current_role_name() = 'Project Manager'
            and project in (select title from public.projects
                            where manager_id = auth.uid()::text))
    );

-- ----------------------------------------------------------------------------
-- audit_logs — read-only, and only for oversight roles. Nobody edits history
-- from a client; the API writes it with service_role.
-- ----------------------------------------------------------------------------
drop policy if exists audit_logs_select on public.audit_logs;
create policy audit_logs_select on public.audit_logs
    for select to authenticated
    using (public.is_org_wide() or public.current_role_name() = 'Auditor');

-- ----------------------------------------------------------------------------
-- notifications — you see only what targets you.
-- ----------------------------------------------------------------------------
drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications
    for select to authenticated
    using (
        target_user_ids ? auth.uid()::text
        or target_roles ? public.current_role_name()
        or (public.current_department() is not null
            and target_departments ? public.current_department())
    );

-- Marking read edits read_by, so the same visibility test applies.
drop policy if exists notifications_update on public.notifications;
create policy notifications_update on public.notifications
    for update to authenticated
    using (
        target_user_ids ? auth.uid()::text
        or target_roles ? public.current_role_name()
        or (public.current_department() is not null
            and target_departments ? public.current_department())
    );

-- ----------------------------------------------------------------------------
-- documents
-- ----------------------------------------------------------------------------
drop policy if exists documents_select on public.documents;
create policy documents_select on public.documents
    for select to authenticated
    using (
        public.is_org_wide()
        or public.current_role_name() = 'Auditor'
        or uploaded_by_id = auth.uid()::text
        or (public.current_role_name() <> 'Client'
            and (department is null or department = public.current_department()))
    );

drop policy if exists documents_insert on public.documents;
create policy documents_insert on public.documents
    for insert to authenticated
    with check (uploaded_by_id = auth.uid()::text
                and public.current_role_name() <> 'Auditor');

drop policy if exists documents_delete on public.documents;
create policy documents_delete on public.documents
    for delete to authenticated
    using (
        public.is_org_wide()
        or uploaded_by_id = auth.uid()::text
        or (public.current_role_name() = 'Department Manager'
            and department = public.current_department())
    );

-- ----------------------------------------------------------------------------
-- Reference data — readable by any signed-in user, writable by admins only.
-- ----------------------------------------------------------------------------
drop policy if exists departments_select on public.departments;
create policy departments_select on public.departments
    for select to authenticated using (public.current_role_name() <> 'Client');

drop policy if exists departments_write on public.departments;
create policy departments_write on public.departments
    for all to authenticated using (public.is_org_wide()) with check (public.is_org_wide());

drop policy if exists clients_select on public.clients;
create policy clients_select on public.clients
    for select to authenticated
    using (public.is_org_wide() or id = public.current_client_id());

drop policy if exists project_members_select on public.project_members;
create policy project_members_select on public.project_members
    for select to authenticated
    using (user_id = auth.uid()::text or public.works_on_project(project_id) or public.is_org_wide());

drop policy if exists daily_workers_select on public.daily_workers;
create policy daily_workers_select on public.daily_workers
    for select to authenticated
    using (
        public.is_org_wide()
        or public.current_role_name() = 'Auditor'
        or public.can_take_attendance()
        or (public.current_role_name() = 'Department Manager'
            and department = public.current_department())
        or (project_id is not null and public.manages_project(project_id))
    );

drop policy if exists saved_reports_select on public.saved_reports;
create policy saved_reports_select on public.saved_reports
    for select to authenticated
    using (generated_by_id = auth.uid()::text or public.is_org_wide());

-- password_reset_tokens stays server-only under every configuration.
-- No policy is defined, so RLS denies all client access.

commit;
