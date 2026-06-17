-- Phase 1 WT-1 — Identity foundation.
-- - public.profiles mirror table for auth.users (email duplicated to avoid
--   cross-schema joins inside RLS-filtered queries).
-- - touch_updated_at() generic helper used by profiles_set_updated_at.
-- - handle_new_user() trigger on auth.users: creates profiles row, backfills
--   newsletter_subscribers.profile_id if the signup email was already captured
--   anonymously, and inserts a newsletter_subscribers row if the user opted in
--   at signup.
-- - delete_my_account() RPC: caller-scoped delete from auth.users; the cascade
--   on profiles.id and the future measurements tables (WT-3) does the rest.
-- - newsletter_subscribers.profile_id FK altered from ON DELETE SET NULL stays
--   ON DELETE SET NULL (already the Phase 0 default — re-asserted here as the
--   canonical Phase 1 statement and as a safety re-apply).
--
-- All statements are idempotent: drop-if-exists policies/triggers, create-or-
-- replace functions, create-table-if-not-exists. Re-running this file against
-- an already-migrated database is a no-op.

begin;

-- ---------------------------------------------------------------------------
-- 1. profiles table
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  id                   uuid primary key references auth.users(id) on delete cascade,
  email                text not null,
  full_name            text,
  phone                text,
  role                 text not null default 'customer' check (role in ('customer','staff','admin')),
  opted_in_newsletter  boolean not null default false,
  marketing_consent_at timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists profiles_email_idx on public.profiles (email);
create index if not exists profiles_role_idx  on public.profiles (role);

alter table public.profiles enable row level security;

drop policy if exists "profiles_owner_select" on public.profiles;
create policy "profiles_owner_select"
  on public.profiles for select
  to authenticated
  using (auth.uid() = id);

drop policy if exists "profiles_owner_update" on public.profiles;
create policy "profiles_owner_update"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Intentionally NO insert policy: only the handle_new_user trigger inserts.
-- Intentionally NO delete policy: the on-delete cascade from auth.users does it.

-- ---------------------------------------------------------------------------
-- 2. updated_at trigger function (generic, reusable by WT-3)
-- ---------------------------------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row
  execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 3. handle_new_user() — fires on auth.users insert
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, opted_in_newsletter, marketing_consent_at)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    coalesce((new.raw_user_meta_data->>'opted_in_newsletter')::boolean, false),
    case
      when (new.raw_user_meta_data->>'opted_in_newsletter')::boolean then now()
      else null
    end
  );

  -- Backfill: if an anonymous newsletter row already exists for this email,
  -- link it to the new profile.
  update public.newsletter_subscribers
     set profile_id = new.id
   where email = new.email
     and profile_id is null;

  -- If they opted in at signup AND there is no existing newsletter row, create one.
  if coalesce((new.raw_user_meta_data->>'opted_in_newsletter')::boolean, false) then
    insert into public.newsletter_subscribers (email, profile_id, source, opted_in_at)
    values (new.email, new.id, 'signup', now())
    on conflict (email) do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- 4. delete_my_account() RPC
-- ---------------------------------------------------------------------------

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  delete from auth.users where id = auth.uid();
end;
$$;

revoke all on function public.delete_my_account() from public;
grant execute on function public.delete_my_account() to authenticated;

-- ---------------------------------------------------------------------------
-- 5. newsletter_subscribers.profile_id FK — re-assert ON DELETE SET NULL
--    (Phase 0 already declared this; we re-apply defensively in case of drift.)
-- ---------------------------------------------------------------------------

do $$
declare
  fk_name text;
begin
  select conname into fk_name
    from pg_constraint
   where conrelid = 'public.newsletter_subscribers'::regclass
     and contype  = 'f'
     and (select array_agg(attname::text) from pg_attribute
            where attrelid = conrelid and attnum = any(conkey)) = array['profile_id'];

  if fk_name is not null then
    execute format('alter table public.newsletter_subscribers drop constraint %I', fk_name);
  end if;

  alter table public.newsletter_subscribers
    add constraint newsletter_subscribers_profile_id_fkey
    foreign key (profile_id) references auth.users(id) on delete set null;
end $$;

commit;
