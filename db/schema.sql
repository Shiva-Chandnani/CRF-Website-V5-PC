-- =============================================================================
-- Country Road Fashions — Product Catalogue Schema
-- Target: Supabase (Postgres 15+)
-- Run this in Supabase SQL Editor on a fresh project.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. Enum types
-- -----------------------------------------------------------------------------
create type pattern_t as enum (
  'solid','pinstripe','chalk-stripe','check','windowpane',
  'herringbone','houndstooth','glen-plaid','twill','other'
);

create type availability_t as enum (
  'in_stock','low_stock','made_to_order','out_of_stock'
);

create type item_status_t as enum ('active','draft','archived');

create type season_t as enum (
  'all-season','spring','summer','autumn','winter'
);

create type occasion_t as enum (
  'formal','business','casual','wedding','black-tie','resort'
);

-- -----------------------------------------------------------------------------
-- 1. Tables
-- -----------------------------------------------------------------------------

create table categories (
  id            text primary key,
  name          text not null,
  description   text,
  display_order int  not null default 0,
  hero_image    text,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

create table subcategories (
  id            text primary key,
  category_id   text not null references categories(id) on delete restrict,
  name          text not null,
  description   text,
  display_order int  not null default 0,
  hero_image    text,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);
create index on subcategories(category_id);

create table item_types (
  id              text primary key,
  subcategory_id  text not null references subcategories(id) on delete restrict,
  name            text not null,
  description     text,
  season          season_t[]   not null default '{}',
  occasion        occasion_t[] not null default '{}',
  status          item_status_t not null default 'draft',
  display_order   int  not null default 0,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);
create index on item_types(subcategory_id);
create index on item_types(status);

create table fabric_types (
  id            text primary key,
  brand         text not null,
  family        text not null,
  display_name  text generated always as (brand || ' : ' || family) stored,
  description   text,
  composition   text,
  weight_gsm    int,
  origin        text,
  season        season_t[] not null default '{}',
  display_order int  not null default 0,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now(),
  unique (brand, family)
);
create index on fabric_types(brand);
create index on fabric_types(family);

create table fabric_designs (
  id              text primary key,
  fabric_type_id  text not null references fabric_types(id) on delete restrict,
  fabric_number   text not null unique,
  name            text not null,
  color           text[] not null default '{}',
  pattern         pattern_t not null default 'solid',
  availability    availability_t not null default 'in_stock',
  display_order   int  not null default 0,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now(),
  constraint fabric_number_format
    check (fabric_number ~ '^(WL|LN|CT|SLK|TWD|BLD)-[0-9]{4,}$')
);
create index on fabric_designs(fabric_type_id);
create index on fabric_designs(availability);
create index on fabric_designs(pattern);

create table item_type_fabrics (
  item_type_id    text not null references item_types(id)   on delete cascade,
  fabric_type_id  text not null references fabric_types(id) on delete restrict,
  price           int  not null check (price >= 0),
  primary key (item_type_id, fabric_type_id)
);
create index on item_type_fabrics(fabric_type_id);

create table fabric_design_price_overrides (
  item_type_id      text not null references item_types(id)     on delete cascade,
  fabric_design_id  text not null references fabric_designs(id) on delete cascade,
  price             int  not null check (price >= 0),
  primary key (item_type_id, fabric_design_id)
);

create table fabric_design_photos (
  id                bigserial primary key,
  fabric_design_id  text not null references fabric_designs(id) on delete cascade,
  image_path        text not null,
  alt_text          text,
  is_primary        boolean not null default false,
  display_order     int not null default 0,
  created_at        timestamptz default now()
);
create index on fabric_design_photos(fabric_design_id);
create unique index on fabric_design_photos(fabric_design_id) where is_primary;

create table item_type_photos (
  id            bigserial primary key,
  item_type_id  text not null references item_types(id) on delete cascade,
  image_path    text not null,
  alt_text      text,
  is_primary    boolean not null default false,
  display_order int not null default 0,
  created_at    timestamptz default now()
);
create index on item_type_photos(item_type_id);
create unique index on item_type_photos(item_type_id) where is_primary;

-- -----------------------------------------------------------------------------
-- 2. v_products view — the customer-facing product = item_type × fabric_design
-- -----------------------------------------------------------------------------
create view v_products as
select
  itf.item_type_id || '__' || fd.id                  as product_id,
  itf.item_type_id,
  it.name                                            as item_type_name,
  it.subcategory_id,
  sc.category_id,
  fd.fabric_type_id,
  ft.brand                                           as fabric_brand,
  ft.family                                          as fabric_family,
  ft.display_name                                    as fabric_type_name,
  fd.id                                              as fabric_design_id,
  fd.name                                            as design_name,
  fd.fabric_number,
  fd.color,
  fd.pattern,
  fd.availability,
  coalesce(o.price, itf.price)                       as price,
  (o.price is not null)                              as has_design_override,
  (select image_path from fabric_design_photos
    where fabric_design_id = fd.id and is_primary limit 1) as primary_photo_path,
  ft.display_name || ' — ' || fd.name || ' — ' || it.name as display_name,
  it.status                                          as item_status,
  it.season                                          as item_season,
  it.occasion                                        as item_occasion,
  ft.season                                          as fabric_season
from item_type_fabrics itf
join item_types     it on it.id = itf.item_type_id
join subcategories  sc on sc.id = it.subcategory_id
join fabric_designs fd on fd.fabric_type_id = itf.fabric_type_id
join fabric_types   ft on ft.id = fd.fabric_type_id
left join fabric_design_price_overrides o
  on o.item_type_id     = itf.item_type_id
 and o.fabric_design_id = fd.id;

-- -----------------------------------------------------------------------------
-- 3. updated_at auto-touch trigger
-- -----------------------------------------------------------------------------
create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

create trigger trg_categories_updated     before update on categories     for each row execute procedure set_updated_at();
create trigger trg_subcategories_updated  before update on subcategories  for each row execute procedure set_updated_at();
create trigger trg_item_types_updated     before update on item_types     for each row execute procedure set_updated_at();
create trigger trg_fabric_types_updated   before update on fabric_types   for each row execute procedure set_updated_at();
create trigger trg_fabric_designs_updated before update on fabric_designs for each row execute procedure set_updated_at();

-- -----------------------------------------------------------------------------
-- 4. Row-Level Security: public read, authenticated write
-- -----------------------------------------------------------------------------
alter table categories                     enable row level security;
alter table subcategories                  enable row level security;
alter table item_types                     enable row level security;
alter table fabric_types                   enable row level security;
alter table fabric_designs                 enable row level security;
alter table item_type_fabrics              enable row level security;
alter table fabric_design_price_overrides  enable row level security;
alter table fabric_design_photos           enable row level security;
alter table item_type_photos               enable row level security;

create policy "public read" on categories                    for select using (true);
create policy "public read" on subcategories                 for select using (true);
create policy "public read" on item_types                    for select using (status = 'active');
create policy "public read" on fabric_types                  for select using (true);
create policy "public read" on fabric_designs                for select using (true);
create policy "public read" on item_type_fabrics             for select using (true);
create policy "public read" on fabric_design_price_overrides for select using (true);
create policy "public read" on fabric_design_photos          for select using (true);
create policy "public read" on item_type_photos              for select using (true);

create policy "authed write" on categories                    for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authed write" on subcategories                 for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authed write" on item_types                    for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authed write" on fabric_types                  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authed write" on fabric_designs                for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authed write" on item_type_fabrics             for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authed write" on fabric_design_price_overrides for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authed write" on fabric_design_photos          for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authed write" on item_type_photos              for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
