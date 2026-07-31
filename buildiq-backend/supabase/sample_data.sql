-- ============================================================================
-- BuildIQ — sample_data.sql
--
-- A small, REALISTIC dataset you can paste straight into the Supabase SQL
-- Editor to see the app working end to end:
--
--   9 departments · 8 users (one per role) · 3 clients
--   4 projects · 6 tasks · 5 complaints · attendance · audit logs
--
-- Every password is  Demo1234!  stored as a real bcrypt hash, so these
-- accounts genuinely log in. Passwords are NEVER stored in readable form --
-- that is why you see $2b$12$... in the users table.
--
-- HOW TO RUN
--   Supabase dashboard -> SQL Editor -> New query -> paste -> Run.
--   Run 0001_schema.sql FIRST if you have not already created the tables.
--
-- Idempotent: re-running updates rows instead of duplicating them, so it is
-- safe to run twice.
--
-- WARNING: these are demo credentials. Delete or change them before letting
-- real users near this deployment:
--     delete from public.users where email like '%@buildiq.et';
-- ============================================================================

begin;

-- ---------------------------------------------------------------- departments
insert into public.departments (id, name, head, description, scope, budget) values
  ('dep_1','Site Operations','Meron Tadesse','Runs day-to-day construction activity across all active sites.',
   '["Site scheduling","Crew coordination","Daily progress tracking"]'::jsonb, 2400000),
  ('dep_2','Engineering & Design','Saba Tesfaye','Structural, architectural and MEP design.',
   '["Structural drawings","BIM modeling","Design change control"]'::jsonb, 1800000),
  ('dep_3','Quality Control','Marta Wolde','Inspection and compliance against national standards.',
   '["Material testing","Site inspections","Defect tracking"]'::jsonb, 900000),
  ('dep_4','Procurement','Unassigned','Sourcing, supplier contracts and material logistics.',
   '["Supplier management","Purchase orders","Delivery scheduling"]'::jsonb, 3100000),
  ('dep_5','Finance','Unassigned','Budgeting, payments and cost control.',
   '["Budget planning","Invoice processing","Cost reporting"]'::jsonb, 1200000),
  ('dep_6','Human Resources','Unassigned','Recruitment, records and staff welfare.',
   '["Recruitment","Payroll","Training"]'::jsonb, 700000),
  ('dep_7','Compliance','Nardos Fikru','Regulatory compliance and internal audit.',
   '["Permit tracking","Audit response","Policy enforcement"]'::jsonb, 650000),
  ('dep_8','Client Relations','Unassigned','Primary liaison with clients.',
   '["Client communication","Handover coordination"]'::jsonb, 550000),
  ('dep_9','Workforce & Attendance','Girma Assefa','Daily attendance for all staff and daily workers.',
   '["Attendance register","Absence review","Daily worker roster"]'::jsonb, 480000)
on conflict (id) do update set
  name = excluded.name, head = excluded.head, description = excluded.description,
  scope = excluded.scope, budget = excluded.budget;

-- --------------------------------------------------------------------- clients
insert into public.clients (id, company, contact_name, email, phone, avatar_color) values
  ('client_1','Wolaita Development PLC','Abebe Kebede','client@buildiq.et','+251911234567','blue'),
  ('client_2','Rift Valley Holdings','Sara Girma','sara@riftvalley.et','+251911234568','teal'),
  ('client_3','Addis Retail Group','Daniel Bekele','daniel@addisretail.et','+251911234569','purple')
on conflict (id) do update set
  company = excluded.company, contact_name = excluded.contact_name, email = excluded.email;

-- ----------------------------------------------------------------------- users
-- Password for every account below: Demo1234!
insert into public.users
  (id, email, hashed_password, full_name, role, roles, department, job_title,
   org_name, phone, status, experience_years)
values
  ('mem_1','admin@buildiq.et','$2b$12$63TrS.NGaQeUx3vUqTau5umTP05JcHpaZshhrIhEZFHIka.lzsLxy','Admin User','Super Admin',
   '["Super Admin"]'::jsonb,'Executive','System Administrator','Wolaita Construction Group','+251911000001','Active',12),

  ('mem_2','gm@buildiq.et','$2b$12$iHTmfPXYK7RCf6gQkK0d/u8KsOlpFOP270Rbof2MHeQIxh4luMyGO','Tsegaye Worku','General Manager',
   '["General Manager"]'::jsonb,'Executive','General Manager','Wolaita Construction Group','+251911000002','Active',18),

  -- Holds two roles: the sidebar role switcher appears for this account.
  ('mem_dm_1','meron.tadesse@buildiq.et','$2b$12$mxG3F9umhTAdUKezWG4UaOog1Zd4DsfQdvvO/JOLbN/g86We0YD8.','Meron Tadesse','Department Manager',
   '["Department Manager","Project Manager"]'::jsonb,'Site Operations','Site Operations Manager',
   'Wolaita Construction Group','+251911000003','Active',10),

  ('mem_pm_1','pm@buildiq.et','$2b$12$FE94a5sHzvxSeMdOdWR9GOKsdCQ2yei2McjedqsY1XkRuysR4ZtoC','Bruk Haile','Project Manager',
   '["Project Manager"]'::jsonb,'Site Operations','Project Manager','Wolaita Construction Group','+251911000004','Active',8),

  ('mem_6','engineer@buildiq.et','$2b$12$4Z2Aw./kYNH1x7Oa9kw57.fduXaNUupPbmKMrW91PbLxzkL0Ew3C6','Samuel Alemayehu','Engineer',
   '["Engineer"]'::jsonb,'Site Operations','Site Engineer','Wolaita Construction Group','+251911000005','Active',5),

  ('mem_5','auditor@buildiq.et','$2b$12$YogtIASSDoUCH56RyiR5BOkGO/zSSDsodmqiV11wocADD3TD7EDcu','Nardos Fikru','Auditor',
   '["Auditor"]'::jsonb,'Compliance','Internal Auditor','Wolaita Construction Group','+251911000006','Active',9),

  -- Only this department may take attendance -- not even Super Admin can.
  ('mem_wf_1','girma.assefa@buildiq.et','$2b$12$xAJDWWlznrHsV9.EgyVr3uXgphDatOY3ZW/PrCxnHhRS.I6Zt.CcG','Girma Assefa','Department Manager',
   '["Department Manager"]'::jsonb,'Workforce & Attendance','Workforce Manager',
   'Wolaita Construction Group','+251911000007','Active',7),

  ('mem_cl_1','client@buildiq.et','$2b$12$abQylmp0e1ARpyCQ7mZTaObZtkAqRj3eBSL8DuFFWlO/FbHXqGFfK','Abebe Kebede','Client',
   '["Client"]'::jsonb,null,null,'Wolaita Development PLC','+251911234567','Active',null)
on conflict (id) do update set
  email = excluded.email, hashed_password = excluded.hashed_password,
  full_name = excluded.full_name, role = excluded.role, roles = excluded.roles,
  department = excluded.department, job_title = excluded.job_title;

-- Link the client login to its company record.
update public.users set client_id = 'client_1' where id = 'mem_cl_1';

-- -------------------------------------------------------------------- projects
insert into public.projects
  (id, title, type, region, department, manager_id, manager_name, manager_role,
   client_id, client_name, status, progress, expected_progress, delay_risk,
   budget, spent, deadline, description)
values
  ('proj_1','Sodo Tower Complex','Commercial','Wolaita Sodo','Site Operations',
   'mem_dm_1','Meron Tadesse','Department Manager','client_1','Wolaita Development PLC',
   'In Progress',62,70,'MEDIUM',48000000,29500000,'2026-11-30','Mixed-use commercial tower, 12 floors.'),

  ('proj_2','Highland Logistics Hub','Industrial','Hawassa','Site Operations',
   'mem_pm_1','Bruk Haile','Project Manager','client_2','Rift Valley Holdings',
   'In Progress',34,55,'HIGH',72000000,26000000,'2027-03-15','Regional distribution and warehousing hub.'),

  ('proj_3','Sunrise Business Center','Commercial','Addis Ababa','Engineering & Design',
   'mem_pm_1','Bruk Haile','Project Manager','client_3','Addis Retail Group',
   'In Progress',88,85,'LOW',35000000,30100000,'2026-09-30','Eight-floor office and retail centre.'),

  ('proj_4','Adama Industrial Park','Industrial','Adama','Quality Control',
   'mem_dm_1','Meron Tadesse','Department Manager','client_2','Rift Valley Holdings',
   'Planning',8,10,'LOW',95000000,7200000,'2028-01-31','Phase 1 industrial park infrastructure.')
on conflict (id) do update set
  title = excluded.title, progress = excluded.progress,
  delay_risk = excluded.delay_risk, manager_id = excluded.manager_id;

-- ----------------------------------------------------------------------- tasks
insert into public.tasks
  (id, title, note, category, project_id, project_title, assignee_id, assignee_name,
   assignee_type, assigned_by, assigned_by_role, status, blocking, due_date)
values
  ('task_1','Pour level 6 slab','Concrete pour for the sixth floor slab.','Construction','proj_1','Sodo Tower Complex',
   'mem_6','Samuel Alemayehu','staff','Meron Tadesse','Department Manager','In Progress',true,'2026-08-12'),
  ('task_2','Rebar inspection','Verify reinforcement before the level 6 pour.','Quality','proj_1','Sodo Tower Complex',
   'mem_6','Samuel Alemayehu','staff','Meron Tadesse','Department Manager','To Do',true,'2026-08-08'),
  ('task_3','Steel delivery follow-up','Chase the delayed structural steel order.','Procurement','proj_2','Highland Logistics Hub',
   'mem_6','Samuel Alemayehu','staff','Bruk Haile','Project Manager','To Do',true,'2026-08-05'),
  ('task_4','Update site drawings','Issue revision C of the foundation drawings.','Design','proj_2','Highland Logistics Hub',
   'mem_6','Samuel Alemayehu','staff','Bruk Haile','Project Manager','In Progress',false,'2026-08-20'),
  ('task_5','Snag list walkthrough','Record outstanding defects before handover.','Quality','proj_3','Sunrise Business Center',
   'mem_6','Samuel Alemayehu','staff','Bruk Haile','Project Manager','To Do',false,'2026-08-25'),
  ('task_6','Permit renewal','Renew the environmental permit.','Compliance','proj_4','Adama Industrial Park',
   'mem_6','Samuel Alemayehu','staff','Nardos Fikru','Auditor','Done',false,'2026-07-20')
on conflict (id) do update set
  status = excluded.status, blocking = excluded.blocking, due_date = excluded.due_date;

-- ------------------------------------------------------------------ complaints
insert into public.complaints
  (id, category, text, severity, status, department, project,
   customer_name, submitted_by, created_at)
values
  ('cmp_1','Project Delay','Steel delivery is three weeks late, blocking the frame.',
   'HIGH','pending','Procurement','Highland Logistics Hub','Sara Girma','mem_cl_1', now() - interval '4 days'),
  ('cmp_2','Quality Issue','Visible honeycombing on the level 3 columns.',
   'MEDIUM','in_progress','Quality Control','Sodo Tower Complex','Abebe Kebede','mem_cl_1', now() - interval '9 days'),
  ('cmp_3','Safety Concern','Scaffolding on the east face is missing guard rails.',
   'HIGH','pending','Site Operations','Sodo Tower Complex','Abebe Kebede','mem_cl_1', now() - interval '2 days'),
  ('cmp_4','Billing Dispute','Invoice 2026-114 double-charges for formwork.',
   'MEDIUM','resolved','Finance','Sunrise Business Center','Daniel Bekele','mem_cl_1', now() - interval '21 days'),
  ('cmp_5','Communication','No weekly progress report for two consecutive weeks.',
   'LOW','pending','Client Relations','Adama Industrial Park','Sara Girma','mem_cl_1', now() - interval '6 days')
on conflict (id) do update set
  status = excluded.status, severity = excluded.severity;

-- --------------------------------------------------------------- daily workers
insert into public.daily_workers (id, full_name, trade, phone, daily_rate, department) values
  ('dw_1','Tadesse Bekele','Mason','+251912000001',450,'Site Operations'),
  ('dw_2','Almaz Hailu','Carpenter','+251912000002',480,'Site Operations'),
  ('dw_3','Yonas Tesfa','Steel Fixer','+251912000003',520,'Site Operations'),
  ('dw_4','Hirut Mekonnen','Painter','+251912000004',400,'Site Operations')
on conflict (id) do update set
  full_name = excluded.full_name, daily_rate = excluded.daily_rate;

-- ------------------------------------------------------------------ attendance
-- Five working days for one engineer and two daily workers, including an
-- absence with an approved reason so the review workflow has something to show.
insert into public.attendance (id, person_id, person_name, person_type, date, status, department)
select
  'att_' || p.pid || '_' || to_char(d.day, 'YYYYMMDD'),
  p.pid, p.pname, p.ptype, d.day,
  case when p.pid = 'mem_6' and d.day = current_date - 2 then 'Absent' else 'Present' end,
  'Site Operations'
from (values
        ('mem_6','Samuel Alemayehu','staff'),
        ('dw_1','Tadesse Bekele','daily_worker'),
        ('dw_2','Almaz Hailu','daily_worker')
     ) as p(pid, pname, ptype)
cross join (
  select (current_date - offs)::date as day
  from generate_series(1, 5) as offs
) as d
on conflict (id) do nothing;

-- The absence above, explained and approved.
update public.attendance
   set reason_category     = 'Medical Appointment',
       reason              = 'Hospital appointment, documentation provided.',
       reason_status       = 'approved',
       reason_reviewed_by  = 'mem_wf_1',
       reason_submitted_at = now() - interval '1 day',
       reason_reviewed_at  = now() - interval '12 hours'
 where person_id = 'mem_6' and status = 'Absent';

-- ----------------------------------------------------------------- audit logs
insert into public.audit_logs
  (id, "user", user_role, action, resource, audit_type, risk_level,
   anomaly_score, is_flagged, timestamp)
values
  ('log_1','Admin User','Super Admin','LOGIN','auth/login','SECURITY','LOW',0.05,false, now() - interval '2 hours'),
  ('log_2','Meron Tadesse','Department Manager','UPDATE_RECORD','projects/proj_1','DATA_INTEGRITY','LOW',0.11,false, now() - interval '5 hours'),
  ('log_3','Nardos Fikru','Auditor','EXPORT_DATA','reports/financial','REPORT_DOCUMENT','MEDIUM',0.44,false, now() - interval '1 day'),
  ('log_4','Bruk Haile','Project Manager','DELETE_RECORD','materials/mat_18','FINANCIAL','HIGH',0.81,true, now() - interval '2 days'),
  ('log_5','Samuel Alemayehu','Engineer','LOGIN','auth/login','SECURITY','HIGH',0.76,true, now() - interval '3 days')
on conflict (id) do update set
  anomaly_score = excluded.anomaly_score, is_flagged = excluded.is_flagged;

commit;

-- ============================================================================
-- Verify
-- ============================================================================
--   select role, count(*) from public.users group by role order by role;
--   select title, progress, delay_risk from public.projects order by title;
--   select status, count(*) from public.attendance group by status;
--
-- Then sign in at your frontend with  admin@buildiq.et / Demo1234!
-- ============================================================================
