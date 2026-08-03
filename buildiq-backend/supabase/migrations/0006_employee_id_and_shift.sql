-- 0006 — employee numbers and shifts
--
-- The attendance register showed people by name only. A readable staff
-- number (EMP-2026-0001) is what payroll, ID cards and paper registers
-- actually use, and it disambiguates two people with the same name.
--
-- Shift is free text rather than an enum so an organisation can name its own
-- shifts without needing a migration for each one.
--
-- Safe to run more than once. Both columns are nullable: existing rows
-- predate them and are numbered by _backfill_employee_ids() in app/main.py
-- on the next boot.

alter table public.users
    add column if not exists employee_id varchar(32);
alter table public.users
    add column if not exists shift varchar(64);

alter table public.daily_workers
    add column if not exists employee_id varchar(32);
alter table public.daily_workers
    add column if not exists shift varchar(64);

-- UNIQUE, not just indexed: two people sharing a staff number defeats the
-- point of having one. Partial, so the many pre-backfill NULLs do not
-- collide with each other.
create unique index if not exists uq_users_employee_id
    on public.users (employee_id) where employee_id is not null;

create unique index if not exists uq_daily_workers_employee_id
    on public.daily_workers (employee_id) where employee_id is not null;
