-- ============================================================================
-- BuildIQ — 0004_messages_and_avatars.sql
--
-- Run this on any database created BEFORE profile photos and direct messages
-- were added. Without it every login fails with
--
--     column users.avatar_url does not exist
--
-- because the ORM selects that column on each query.
--
-- 0001_schema.sql already contains both changes, so a NEW database does not
-- need this file. Running it twice is harmless.
--
--   Supabase -> SQL Editor -> New query -> paste -> Run
-- ============================================================================

begin;

-- ---------------------------------------------------------------- avatars
-- Storage key for an uploaded profile photo, prefixed with the backend that
-- holds it ("supabase:..." or "local:...").
alter table public.users
    add column if not exists avatar_url varchar(400);

-- --------------------------------------------------------------- messages
create table if not exists public.messages (
    id              varchar(64) primary key,
    sender_id       varchar(64) not null,
    sender_name     varchar(160),
    recipient_id    varchar(64) not null,
    recipient_name  varchar(160),
    body            text        not null,
    is_read         boolean     not null default false,
    created_at      timestamptz not null default now()
);

create index if not exists ix_messages_sender_id    on public.messages (sender_id);
create index if not exists ix_messages_recipient_id on public.messages (recipient_id);
create index if not exists ix_messages_created_at   on public.messages (created_at desc);
create index if not exists ix_messages_is_read      on public.messages (is_read);
-- The inbox pairs the two participants, so index them together.
create index if not exists ix_messages_pair
    on public.messages (sender_id, recipient_id, created_at desc);

-- Deny-by-default, matching every other table: the API uses service_role,
-- which bypasses RLS, while the public anon key can read nothing.
alter table public.messages enable row level security;
alter table public.messages force row level security;

commit;

-- ============================================================================
-- Verify
--   select column_name from information_schema.columns
--    where table_name = 'users' and column_name = 'avatar_url';
--   select count(*) from public.messages;
-- ============================================================================
