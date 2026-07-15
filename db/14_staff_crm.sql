-- Phase 5 — internal staff CRM (sub-project A).
-- Additive staff-read RLS (owner-only policies stay; SELECT policies OR-combine),
-- POS integration seam on profiles, and staff-only notes + tags.
-- Idempotent + transaction-wrapped. Apply via: node scripts/run-sql.mjs db/14_staff_crm.sql
begin;

-- 1. is_staff(): SECURITY DEFINER so it reads the caller's own role WITHOUT
--    tripping RLS recursion on profiles. search_path pinned for safety.
create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('staff','admin')
  );
$$;
revoke all on function public.is_staff() from public;
grant execute on function public.is_staff() to authenticated;

-- 2. Staff-read policies (additive; owner-only policies remain untouched).
drop policy if exists "profiles_staff_select" on public.profiles;
create policy "profiles_staff_select" on public.profiles
  for select to authenticated using (public.is_staff());

drop policy if exists "orders_staff_select" on public.orders;
create policy "orders_staff_select" on public.orders
  for select to authenticated using (public.is_staff());

drop policy if exists "payments_staff_select" on public.payments;
create policy "payments_staff_select" on public.payments
  for select to authenticated using (public.is_staff());

drop policy if exists "cbm_staff_select" on public.customer_body_measurements;
create policy "cbm_staff_select" on public.customer_body_measurements
  for select to authenticated using (public.is_staff());
drop policy if exists "cjr_staff_select" on public.customer_jacket_reference;
create policy "cjr_staff_select" on public.customer_jacket_reference
  for select to authenticated using (public.is_staff());
drop policy if exists "csr_staff_select" on public.customer_shirt_reference;
create policy "csr_staff_select" on public.customer_shirt_reference
  for select to authenticated using (public.is_staff());
drop policy if exists "cpr_staff_select" on public.customer_pants_reference;
create policy "cpr_staff_select" on public.customer_pants_reference
  for select to authenticated using (public.is_staff());

-- 3. POS integration seam on profiles (bridge to the future central POS).
alter table public.profiles add column if not exists pos_customer_id text unique;
alter table public.profiles add column if not exists source text not null default 'website'
  check (source in ('website','pos','manual','import'));
alter table public.profiles add column if not exists last_synced_at timestamptz;

-- 4. Staff notes (richer than the POS single-text field; connector ingests POS notes as source='pos').
create table if not exists public.customer_notes (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles(id) on delete cascade,
  author_id   uuid references public.profiles(id) on delete set null,
  body        text not null,
  source      text not null default 'website' check (source in ('website','pos','manual','import')),
  created_at  timestamptz not null default now()
);
create index if not exists customer_notes_customer_idx on public.customer_notes (customer_id, created_at desc);
alter table public.customer_notes enable row level security;
drop policy if exists "customer_notes_staff_select" on public.customer_notes;
create policy "customer_notes_staff_select" on public.customer_notes
  for select to authenticated using (public.is_staff());
drop policy if exists "customer_notes_staff_insert" on public.customer_notes;
create policy "customer_notes_staff_insert" on public.customer_notes
  for insert to authenticated with check (public.is_staff() and author_id = auth.uid());

-- 5. Staff tags (freeform, no catalog in V1).
create table if not exists public.customer_tags (
  customer_id uuid not null references public.profiles(id) on delete cascade,
  tag         text not null check (char_length(tag) between 1 and 40),
  author_id   uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  primary key (customer_id, tag)
);
alter table public.customer_tags enable row level security;
drop policy if exists "customer_tags_staff_select" on public.customer_tags;
create policy "customer_tags_staff_select" on public.customer_tags
  for select to authenticated using (public.is_staff());
drop policy if exists "customer_tags_staff_insert" on public.customer_tags;
create policy "customer_tags_staff_insert" on public.customer_tags
  for insert to authenticated with check (public.is_staff() and author_id = auth.uid());
drop policy if exists "customer_tags_staff_delete" on public.customer_tags;
create policy "customer_tags_staff_delete" on public.customer_tags
  for delete to authenticated using (public.is_staff());

commit;
