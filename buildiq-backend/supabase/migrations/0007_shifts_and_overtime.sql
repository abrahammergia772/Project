-- 0007 — shift patterns and overtime
--
-- Shifts are named working patterns; people reference them by NAME (the
-- users.shift / daily_workers.shift columns added in 0006), which is why a
-- rename in the API also rewrites those columns.
--
-- Overtime is a separate table rather than columns on `attendance`. Attendance
-- answers "were they here"; overtime answers "how much extra, at what rate,
-- approved by whom". Folding them together would also collide with
-- attendance's unique (person_id, date) constraint the moment someone has two
-- overtime entries on one day.
--
-- Safe to run more than once.

create table if not exists public.shifts (
    id             varchar(64) primary key,
    name           varchar(64) not null unique,
    start_time     varchar(5)  not null default '08:00',
    end_time       varchar(5)  not null default '17:00',
    break_minutes  integer     not null default 60,
    -- Weekday numbers, Monday=0 .. Sunday=6. Default is a six-day week:
    -- Saturday is a working day on these sites, only Sunday is off.
    work_days      jsonb       not null default '[0,1,2,3,4,5]',
    color          varchar(16),
    is_default     boolean     not null default false,
    active         boolean     not null default true,
    created_at     timestamptz not null default now(),

    constraint ck_shifts_break check (break_minutes between 0 and 480)
);
create index if not exists ix_shifts_active     on public.shifts (active);
create index if not exists ix_shifts_is_default on public.shifts (is_default);

-- At most ONE default shift. Two defaults means a new joiner inherits
-- whichever row the query happened to return first.
create unique index if not exists uq_shifts_single_default
    on public.shifts (is_default) where is_default;

create table if not exists public.overtime (
    id              varchar(64) primary key,
    person_id       varchar(64) not null,
    person_name     varchar(160),
    person_type     varchar(24) not null default 'staff',
    department      varchar(96),
    date            varchar(10) not null,          -- YYYY-MM-DD
    hours           double precision not null default 0,
    -- 1.5 = time-and-a-half, 2.0 = double time. Per record, because the
    -- multiplier depends on when the hours fell.
    rate_multiplier double precision not null default 1.5,
    reason          text,
    status          varchar(24) not null default 'Pending',
    requested_by    varchar(160),
    reviewed_by     varchar(160),
    reviewed_at     timestamptz,
    review_note     text,
    created_at      timestamptz not null default now(),

    constraint ck_overtime_status check (status in ('Pending','Approved','Rejected')),
    constraint ck_overtime_person_type check (person_type in ('staff','daily_worker')),
    -- A day has 24 hours; more than 16 of OVERTIME is a data-entry error.
    constraint ck_overtime_hours check (hours > 0 and hours <= 16),
    constraint ck_overtime_rate check (rate_multiplier >= 1 and rate_multiplier <= 3)
);
create index if not exists ix_overtime_person_id   on public.overtime (person_id);
create index if not exists ix_overtime_date        on public.overtime (date);
create index if not exists ix_overtime_department  on public.overtime (department);
create index if not exists ix_overtime_status      on public.overtime (status);
create index if not exists ix_overtime_person_date on public.overtime (person_id, date);
