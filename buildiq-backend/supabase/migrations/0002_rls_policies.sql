-- ============================================================================
-- BuildIQ — 0002_rls_policies.sql
-- Row Level Security: lock every table down by default.
--
-- HOW THIS FITS THE ARCHITECTURE
-- ------------------------------
-- The API is the only thing that talks to this database, and it connects with
-- the Postgres role from DATABASE_URL (the `postgres` superuser, or Supabase's
-- `service_role`). Both BYPASS RLS. Authorization for normal traffic is
-- therefore enforced in Python — see app/security.py and app/deps.py, where
-- every query is scoped by role.
--
-- So why enable RLS at all? Because the `anon` and `authenticated` keys are
-- public by design: they ship in browsers and mobile apps. Without RLS,
-- anyone holding the anon key could read every row in this project straight
-- from the PostgREST endpoint, completely bypassing the API. Supabase's own
-- linter flags unprotected public tables for exactly this reason.
--
-- The stance below is deny-by-default: RLS on everywhere, with no permissive
-- policies for anon/authenticated. Effect:
--
--   * The API (service_role)      → full access, unaffected.
--   * The anon / authenticated    → zero rows, every table.
--     keys, including PostgREST
--     and the JS client
--
-- If you later add features that talk to Supabase directly from the browser,
-- see 0003_rls_supabase_auth.sql for ready-made policies to enable per table.
--
-- Apply with:
--   psql "$DATABASE_URL" -f supabase/migrations/0002_rls_policies.sql
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. Enable RLS on every application table.
--
-- FORCE also applies RLS to the table's owner. It deliberately does NOT apply
-- to service_role/superuser (which have BYPASSRLS), so the API keeps working.
-- ----------------------------------------------------------------------------
do $$
declare
    t text;
    tables text[] := array[
        'users', 'clients', 'departments', 'projects', 'project_members',
        'materials', 'tasks', 'daily_workers', 'attendance', 'complaints',
        'audit_logs', 'notifications', 'documents', 'password_reset_tokens',
        'saved_reports', 'messages', 'shifts', 'overtime'
    ];
begin
    foreach t in array tables loop
        execute format('alter table public.%I enable row level security', t);
        execute format('alter table public.%I force row level security', t);
    end loop;
end $$;

-- ----------------------------------------------------------------------------
-- 2. Revoke the blanket grants Supabase gives anon/authenticated.
--
-- RLS alone returns zero rows, but revoking privileges is clearer and stops
-- INSERTs from even being attempted.
-- ----------------------------------------------------------------------------
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;

-- New tables created later inherit the same restriction.
alter default privileges in schema public
    revoke all on tables    from anon, authenticated;
alter default privileges in schema public
    revoke all on sequences from anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. Explicit deny-all policies.
--
-- Belt and braces: with RLS enabled and no permissive policy, access is
-- already denied. These make the intent unmistakable to anyone reading the
-- schema, and to Supabase's advisor.
-- ----------------------------------------------------------------------------
do $$
declare
    t text;
    tables text[] := array[
        'users', 'clients', 'departments', 'projects', 'project_members',
        'materials', 'tasks', 'daily_workers', 'attendance', 'complaints',
        'audit_logs', 'notifications', 'documents', 'password_reset_tokens',
        'saved_reports', 'messages', 'shifts', 'overtime'
    ];
begin
    foreach t in array tables loop
        execute format('drop policy if exists deny_anon_all on public.%I', t);
        execute format($f$
            create policy deny_anon_all on public.%I
                as restrictive
                for all
                to anon, authenticated
                using (false)
                with check (false)
        $f$, t);
    end loop;
end $$;

-- ----------------------------------------------------------------------------
-- 4. Extra protection for credential material.
--
-- password_reset_tokens and users.hashed_password must never be reachable by
-- a non-service role under any circumstance, including a future policy added
-- carelessly. Revoking column privileges is independent of RLS.
-- ----------------------------------------------------------------------------
revoke all on public.password_reset_tokens from anon, authenticated;
revoke select (hashed_password) on public.users from anon, authenticated;

-- ----------------------------------------------------------------------------
-- 5. Storage — the documents bucket is private.
--
-- The API creates the bucket on first boot (services/storage.py) and streams
-- downloads through /documents/{id}/download so role checks apply. This
-- guarantees the bucket is private even if it was created by hand.
-- ----------------------------------------------------------------------------
update storage.buckets set public = false where id = 'buildiq-documents';

-- Deny direct object access to anon/authenticated; the API uses service_role.
drop policy if exists buildiq_documents_deny_anon on storage.objects;
create policy buildiq_documents_deny_anon on storage.objects
    as restrictive
    for all
    to anon, authenticated
    using (bucket_id <> 'buildiq-documents')
    with check (bucket_id <> 'buildiq-documents');

commit;

-- ============================================================================
-- Verification
-- ----------------------------------------------------------------------------
-- Confirm RLS is on everywhere (expect rowsecurity = true for all 15 rows):
--
--   select tablename, rowsecurity, forcerowsecurity
--   from pg_tables where schemaname = 'public' order by tablename;
--
-- Confirm the anon key really is blocked — this should return no rows:
--
--   curl "$SUPABASE_URL/rest/v1/users?select=*" \
--        -H "apikey: $SUPABASE_ANON_KEY"
--
-- Confirm the API still works (it uses service_role, so it must):
--
--   curl http://localhost:8000/health
-- ============================================================================
