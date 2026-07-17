-- Phase 5 — lock down profiles.role (privilege-escalation fix).
-- Phase 1's profiles_owner_update policy is column-blind (a customer may update
-- their own row). That was benign until Phase 5's is_staff() started keying
-- CRM authorization off profiles.role: a customer could `update({role:'staff'})`
-- and then read the entire customer base via the additive staff-read policies.
-- Fix: role is provisioned ONLY out-of-band (service_role / direct SQL via
-- scripts/run-sql.mjs, where auth.uid() is null). Block ANY authenticated API
-- caller — staff or customer — from changing a profile's role.
-- Idempotent + transaction-wrapped.
begin;

create or replace function public.guard_profile_role()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- auth.uid() is null for service_role and direct Postgres connections
  -- (the only sanctioned way to set roles). Any real end-user session has a
  -- non-null auth.uid() and must not be able to change role.
  if new.role is distinct from old.role and auth.uid() is not null then
    raise exception 'role cannot be changed via the API' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_role on public.profiles;
create trigger profiles_guard_role
  before update on public.profiles
  for each row execute function public.guard_profile_role();

commit;
