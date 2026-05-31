-- Phase 0 newsletter capture table.
-- email is PK so submit-twice is naturally idempotent via INSERT ... ON CONFLICT DO NOTHING
-- (client uses `ignoreDuplicates: true`).
-- profile_id nullable; Phase 1 backfills it when a signup uses an already-captured email.
-- RLS: anon can INSERT only — no SELECT (prevents email enumeration), no UPDATE
-- (prevents anon mass-mutation of unsubscribed_at). Phase 6 will introduce a
-- tokenized unsubscribe flow via a SECURITY DEFINER function.

begin;

create table if not exists newsletter_subscribers (
  email           text primary key,
  profile_id      uuid references auth.users(id) on delete set null,
  source          text not null default 'footer',
  opted_in_at     timestamptz not null default now(),
  unsubscribed_at timestamptz,
  created_at      timestamptz not null default now()
);

alter table newsletter_subscribers enable row level security;

drop policy if exists "anon can insert" on newsletter_subscribers;
create policy "anon can insert"
  on newsletter_subscribers for insert
  to anon, authenticated
  with check (email is not null);

-- Intentionally NO update policy for anon. Re-submissions land as
-- ON CONFLICT DO NOTHING and surface to the user as success.
drop policy if exists "anon can upsert" on newsletter_subscribers;

drop policy if exists "owners can read their own row" on newsletter_subscribers;
create policy "owners can read their own row"
  on newsletter_subscribers for select
  to authenticated
  using (profile_id = auth.uid());

create index if not exists newsletter_subscribers_source_idx
  on newsletter_subscribers (source);

commit;
