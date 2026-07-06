-- Phase 1 WT-3 measurements schema.
-- Four narrow typed tables (body + 3 reference garments), owner-only RLS,
-- cascade delete from profiles, append-only via js/profile.js (WT-2). The
-- UPDATE policy is intentionally permissive per spec §5.2 — kept so Phase 2
-- can support narrow corrections (e.g., editing `notes` on the latest row)
-- without re-saving the whole set. Schema does not strictly enforce
-- append-only; that's intentional flexibility.
--
-- All measurement columns are numeric(5,2) (range 0–999.99, two decimals)
-- and nullable so partial saves are valid. Units per spec §3 Q4a:
-- inches for body+reference measurements; cm for height; kg for weight.

begin;

-- ─────────────────────────────────────────────────────────────────────────
-- 1. customer_body_measurements
--    Jacket+coat body fields, trouser body fields, height_cm, weight_kg, notes.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists customer_body_measurements (
  id                    uuid primary key default gen_random_uuid(),
  customer_id           uuid not null references profiles(id) on delete cascade,
  -- Jacket+coat body
  chest_in              numeric(5,2),
  stomach_in            numeric(5,2),
  hips_in               numeric(5,2),
  shoulders_in          numeric(5,2),
  arm_length_in         numeric(5,2),
  bicep_in              numeric(5,2),
  arm_hole_in           numeric(5,2),
  front_in              numeric(5,2),
  back_in               numeric(5,2),
  length_in             numeric(5,2),
  neck_in               numeric(5,2),
  -- Trouser body
  trouser_waist_in      numeric(5,2),
  trouser_hips_in       numeric(5,2),
  trouser_crotch_in     numeric(5,2),
  trouser_thigh_in      numeric(5,2),
  trouser_knee_in       numeric(5,2),
  trouser_calf_in       numeric(5,2),
  trouser_cuff_in       numeric(5,2),
  trouser_length_in     numeric(5,2),
  -- Common
  height_cm             numeric(5,2),
  weight_kg             numeric(5,2),
  notes                 text,
  captured_at           timestamptz not null default now(),
  created_at            timestamptz not null default now()
);
create index if not exists customer_body_measurements_customer_idx
  on customer_body_measurements (customer_id, captured_at desc);

alter table customer_body_measurements enable row level security;

drop policy if exists "owner_select" on customer_body_measurements;
create policy "owner_select" on customer_body_measurements
  for select using (auth.uid() = customer_id);

drop policy if exists "owner_insert" on customer_body_measurements;
create policy "owner_insert" on customer_body_measurements
  for insert with check (auth.uid() = customer_id);

drop policy if exists "owner_update" on customer_body_measurements;
create policy "owner_update" on customer_body_measurements
  for update using (auth.uid() = customer_id);

drop policy if exists "owner_delete" on customer_body_measurements;
create policy "owner_delete" on customer_body_measurements
  for delete using (auth.uid() = customer_id);

-- ─────────────────────────────────────────────────────────────────────────
-- 2. customer_jacket_reference
--    15 fields + notes (spec §5.2).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists customer_jacket_reference (
  id                    uuid primary key default gen_random_uuid(),
  customer_id           uuid not null references profiles(id) on delete cascade,
  collar_in             numeric(5,2),
  shoulder_in           numeric(5,2),
  half_armhole_in       numeric(5,2),
  sleeve_length_in      numeric(5,2),
  sleeve_inseam_in      numeric(5,2),
  sleeve_width_in       numeric(5,2),
  length_lower_in       numeric(5,2),
  length_upper_in       numeric(5,2),
  back_length_in        numeric(5,2),
  half_chest_in         numeric(5,2),
  half_waist_in         numeric(5,2),
  bottom_hem_in         numeric(5,2),
  yoke_in               numeric(5,2),
  half_girth_in         numeric(5,2),
  half_back_width_in    numeric(5,2),
  notes                 text,
  captured_at           timestamptz not null default now(),
  created_at            timestamptz not null default now()
);
create index if not exists customer_jacket_reference_customer_idx
  on customer_jacket_reference (customer_id, captured_at desc);

alter table customer_jacket_reference enable row level security;

drop policy if exists "owner_select" on customer_jacket_reference;
create policy "owner_select" on customer_jacket_reference
  for select using (auth.uid() = customer_id);

drop policy if exists "owner_insert" on customer_jacket_reference;
create policy "owner_insert" on customer_jacket_reference
  for insert with check (auth.uid() = customer_id);

drop policy if exists "owner_update" on customer_jacket_reference;
create policy "owner_update" on customer_jacket_reference
  for update using (auth.uid() = customer_id);

drop policy if exists "owner_delete" on customer_jacket_reference;
create policy "owner_delete" on customer_jacket_reference
  for delete using (auth.uid() = customer_id);

-- ─────────────────────────────────────────────────────────────────────────
-- 3. customer_shirt_reference
--    10 fields + notes (spec §5.2).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists customer_shirt_reference (
  id                    uuid primary key default gen_random_uuid(),
  customer_id           uuid not null references profiles(id) on delete cascade,
  collar_in             numeric(5,2),
  chest_in              numeric(5,2),
  waist_in              numeric(5,2),
  hips_in               numeric(5,2),
  length_in             numeric(5,2),
  sleeve_length_in      numeric(5,2),
  shoulders_in          numeric(5,2),
  armhole_in            numeric(5,2),
  bicep_in              numeric(5,2),
  cuff_in               numeric(5,2),
  notes                 text,
  captured_at           timestamptz not null default now(),
  created_at            timestamptz not null default now()
);
create index if not exists customer_shirt_reference_customer_idx
  on customer_shirt_reference (customer_id, captured_at desc);

alter table customer_shirt_reference enable row level security;

drop policy if exists "owner_select" on customer_shirt_reference;
create policy "owner_select" on customer_shirt_reference
  for select using (auth.uid() = customer_id);

drop policy if exists "owner_insert" on customer_shirt_reference;
create policy "owner_insert" on customer_shirt_reference
  for insert with check (auth.uid() = customer_id);

drop policy if exists "owner_update" on customer_shirt_reference;
create policy "owner_update" on customer_shirt_reference
  for update using (auth.uid() = customer_id);

drop policy if exists "owner_delete" on customer_shirt_reference;
create policy "owner_delete" on customer_shirt_reference
  for delete using (auth.uid() = customer_id);

-- ─────────────────────────────────────────────────────────────────────────
-- 4. customer_pants_reference
--    8 fields + notes (spec §5.2).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists customer_pants_reference (
  id                    uuid primary key default gen_random_uuid(),
  customer_id           uuid not null references profiles(id) on delete cascade,
  waist_in              numeric(5,2),
  hips_in               numeric(5,2),
  length_in             numeric(5,2),
  crotch_front_in       numeric(5,2),
  crotch_back_in        numeric(5,2),
  thigh_in              numeric(5,2),
  calf_in               numeric(5,2),
  bottom_in             numeric(5,2),
  notes                 text,
  captured_at           timestamptz not null default now(),
  created_at            timestamptz not null default now()
);
create index if not exists customer_pants_reference_customer_idx
  on customer_pants_reference (customer_id, captured_at desc);

alter table customer_pants_reference enable row level security;

drop policy if exists "owner_select" on customer_pants_reference;
create policy "owner_select" on customer_pants_reference
  for select using (auth.uid() = customer_id);

drop policy if exists "owner_insert" on customer_pants_reference;
create policy "owner_insert" on customer_pants_reference
  for insert with check (auth.uid() = customer_id);

drop policy if exists "owner_update" on customer_pants_reference;
create policy "owner_update" on customer_pants_reference
  for update using (auth.uid() = customer_id);

drop policy if exists "owner_delete" on customer_pants_reference;
create policy "owner_delete" on customer_pants_reference
  for delete using (auth.uid() = customer_id);

-- ─────────────────────────────────────────────────────────────────────────
-- 5. Four "latest" views — distinct on (customer_id) ordered by captured_at desc.
--    security_invoker = true (PG15+) makes each view execute with the QUERYING
--    user's privileges, so the base table's owner-only RLS applies transparently.
--    Without it, views run as the view owner and bypass RLS entirely, leaking
--    every customer's row to any authenticated caller.
-- ─────────────────────────────────────────────────────────────────────────
create or replace view v_latest_body_measurements
  with (security_invoker = true) as
  select distinct on (customer_id) *
    from customer_body_measurements
    order by customer_id, captured_at desc;

create or replace view v_latest_jacket_reference
  with (security_invoker = true) as
  select distinct on (customer_id) *
    from customer_jacket_reference
    order by customer_id, captured_at desc;

create or replace view v_latest_shirt_reference
  with (security_invoker = true) as
  select distinct on (customer_id) *
    from customer_shirt_reference
    order by customer_id, captured_at desc;

create or replace view v_latest_pants_reference
  with (security_invoker = true) as
  select distinct on (customer_id) *
    from customer_pants_reference
    order by customer_id, captured_at desc;

commit;
