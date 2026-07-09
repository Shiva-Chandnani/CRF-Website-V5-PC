-- Phase 2 — orders + payments. Written ONLY by Edge Functions (service_role).
-- Clients get owner-only SELECT; no client write policies exist.
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  status text not null default 'pending'
    check (status in ('pending','paid','failed','canceled')),
  currency text not null default 'thb',
  total_thb integer not null check (total_thb >= 0),
  items jsonb not null default '[]'::jsonb,
  stripe_checkout_session_id text,
  stripe_payment_intent_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  stripe_payment_intent_id text,
  stripe_event_id text unique,
  amount_thb integer not null check (amount_thb >= 0),
  currency text not null default 'thb',
  status text not null check (status in ('succeeded','failed','refunded')),
  raw jsonb,
  created_at timestamptz not null default now()
);

create index if not exists orders_user_id_idx on public.orders (user_id);
create index if not exists orders_session_idx on public.orders (stripe_checkout_session_id);
create index if not exists payments_order_id_idx on public.payments (order_id);

alter table public.orders enable row level security;
alter table public.payments enable row level security;

-- Owner-only SELECT. No INSERT/UPDATE/DELETE policies → clients cannot write.
drop policy if exists "orders_select_own" on public.orders;
create policy "orders_select_own" on public.orders
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "payments_select_own" on public.payments;
create policy "payments_select_own" on public.payments
  for select to authenticated using (
    auth.uid() = (select o.user_id from public.orders o where o.id = payments.order_id)
  );
