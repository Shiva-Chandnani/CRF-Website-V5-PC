-- Phase 2 · cart dual-mode: server-side cart mirror (offline-first).
-- One row per user; `items` mirrors the localStorage crf.cart.v1 items[] blob.
-- Idempotent: safe to re-run via scripts/run-sql.mjs.

create table if not exists public.carts (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  items      jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.carts enable row level security;

drop policy if exists carts_select_own on public.carts;
create policy carts_select_own on public.carts for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists carts_insert_own on public.carts;
create policy carts_insert_own on public.carts for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists carts_update_own on public.carts;
create policy carts_update_own on public.carts for update
  to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists carts_delete_own on public.carts;
create policy carts_delete_own on public.carts for delete
  to authenticated
  using (auth.uid() = user_id);
