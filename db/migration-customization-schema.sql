-- =============================================================================
-- Migration: Customization catalogue schema
-- =============================================================================
-- Three new tables that hold the catalogue of customization options shown in
-- the "Customize Your Suit" drawer on the PDP, plus a view that joins them
-- for the drawer's one-shot fetch. Selections themselves live in the
-- customer's browser (localStorage cart) — this schema only describes the
-- *available* options.
-- =============================================================================

begin;

-- 1. Categories (e.g. "Lapel", "Jacket Rear Vent Style", "Pants Pleats").
create table customization_categories (
  id              text primary key,
  name            text not null,
  group_name      text not null check (group_name in ('jacket','pants')),
  display_order   int  not null default 0,
  is_advanced     bool not null default false,   -- if true, hidden under "Show More"
  is_tuxedo_only  bool not null default false,   -- v2: only visible for tuxedo fabrics
  description     text,                          -- one-line help shown at top of detail panel
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);
create index on customization_categories(group_name);
create index on customization_categories(display_order);

-- 2. Options under each category (e.g. "Notch", "Peak", "Shawl" under "Lapel").
create table customization_options (
  id              text primary key,
  category_id     text not null references customization_categories(id) on delete cascade,
  name            text not null,
  description     text,
  svg_path        text,                        -- relative path under repo, e.g. "assets/customization/svg/jacket-lapel-notch.svg"
  price_delta_thb int  not null default 0 check (price_delta_thb >= 0),
  is_default      bool not null default false,
  display_order   int  not null default 0,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);
create index on customization_options(category_id);
-- Exactly one default option per category.
create unique index customization_options_one_default_per_category
  on customization_options(category_id) where is_default;

-- 3. Which categories apply to which item type (Suit/Jacket/Trouser).
create table item_type_customization_categories (
  item_type_id text not null references item_types(id)                   on delete cascade,
  category_id  text not null references customization_categories(id)     on delete cascade,
  primary key (item_type_id, category_id)
);
create index on item_type_customization_categories(category_id);

-- 4. Convenience view: one row per (item_type, category, option), ordered for rendering.
create or replace view v_customization_catalog as
select
  ic.item_type_id,
  cc.id              as category_id,
  cc.name            as category_name,
  cc.group_name      as category_group,
  cc.display_order   as category_display_order,
  cc.is_advanced,
  cc.is_tuxedo_only,
  cc.description     as category_description,
  co.id              as option_id,
  co.name            as option_name,
  co.description     as option_description,
  co.svg_path,
  co.price_delta_thb,
  co.is_default,
  co.display_order   as option_display_order
from item_type_customization_categories ic
join customization_categories cc on cc.id = ic.category_id
join customization_options    co on co.category_id = cc.id;

-- 5. updated_at triggers (matching existing pattern in db/schema.sql:193-197).
create trigger trg_customization_categories_updated before update on customization_categories
  for each row execute procedure set_updated_at();
create trigger trg_customization_options_updated before update on customization_options
  for each row execute procedure set_updated_at();

-- 6. RLS — public SELECT, authenticated write (matching db/schema.sql:212-230).
alter table customization_categories               enable row level security;
alter table customization_options                  enable row level security;
alter table item_type_customization_categories     enable row level security;

create policy "public read" on customization_categories            for select using (true);
create policy "public read" on customization_options               for select using (true);
create policy "public read" on item_type_customization_categories  for select using (true);

create policy "authed write" on customization_categories
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authed write" on customization_options
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authed write" on item_type_customization_categories
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

commit;

-- Sanity: should print zero rows in all three tables.
select 'customization_categories' as t, count(*) from customization_categories
union all
select 'customization_options',           count(*) from customization_options
union all
select 'item_type_customization_categories', count(*) from item_type_customization_categories;
