-- 0005 — audit type on complaints
--
-- Records which of the seven audit types a complaint belongs to, predicted
-- from its wording by the TF-IDF classifier in train_model/. This lets the
-- audit dashboard count free-text complaints alongside structured events,
-- which previously had no shared dimension.
--
-- Safe to run more than once. Both columns are nullable, so existing rows and
-- the self-healing check in app/main.py both cope without a backfill.

alter table public.complaints
    add column if not exists audit_type varchar(32);

alter table public.complaints
    add column if not exists audit_type_confidence double precision;

-- The classifier can only emit these seven, and a wrong value would silently
-- break the dashboard's grouping. Rejecting at the database is cheaper than
-- discovering it in a chart.
do $$
begin
    if not exists (
        select 1 from pg_constraint where conname = 'ck_complaints_audit_type'
    ) then
        alter table public.complaints
            add constraint ck_complaints_audit_type
            check (audit_type is null or audit_type in (
                'SECURITY', 'FINANCIAL', 'COMPLIANCE', 'USER_ACTIVITY',
                'DATA_INTEGRITY', 'PROJECT_RESOURCE', 'REPORT_DOCUMENT'
            ));
    end if;
end $$;

-- NOTE the casing: these are UPPERCASE, matching projects.delay_risk and
-- audit_logs.risk_level. complaints.severity in the same table is lowercase.
-- That inconsistency is pre-existing; do not "fix" one without the others.

create index if not exists ix_complaints_audit_type
    on public.complaints (audit_type);
