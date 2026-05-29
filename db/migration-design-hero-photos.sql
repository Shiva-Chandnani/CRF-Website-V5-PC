-- =============================================================================
-- Migration: per-design hero photos
-- =============================================================================
-- 1. Adds a `photo_type` column to fabric_design_photos so a single design can
--    own multiple photos differentiated by purpose ('fabric' closeup vs 'hero'
--    model photo).
-- 2. Recreates v_products to surface the aggregated array of hero photo paths
--    for the current design — `design_hero_paths text[]` — ordered by
--    display_order. The PDP's left thumb rail renders this array.
-- =============================================================================

begin;

-- 1. Add photo_type, default 'fabric' (existing 35 rows stay correctly labelled)
alter table fabric_design_photos
  add column if not exists photo_type text not null default 'fabric'
    check (photo_type in ('fabric', 'hero'));

create index if not exists fabric_design_photos_photo_type_idx
  on fabric_design_photos(fabric_design_id, photo_type);

-- 2. Recreate v_products to include design_hero_paths (an ordered array of
--    relative storage paths in crf-fabrics/, e.g. {'WL-1129/hero-01.png',
--    'WL-1129/hero-02.png'}).
-- Order of existing columns must be preserved for CREATE OR REPLACE VIEW.
-- The new design_hero_paths column is appended at the end.
create or replace view v_products as
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
  ft.season                                          as fabric_season,
  itf.hero_image_path                                as hero_image_path,
  itf.hero_image_hover_path                          as hero_image_hover_path,
  (select coalesce(array_agg(image_path order by display_order), '{}')
    from fabric_design_photos
    where fabric_design_id = fd.id and photo_type = 'hero')  as design_hero_paths
from item_type_fabrics itf
join item_types     it on it.id = itf.item_type_id
join subcategories  sc on sc.id = it.subcategory_id
join fabric_designs fd on fd.fabric_type_id = itf.fabric_type_id
join fabric_types   ft on ft.id = fd.fabric_type_id
left join fabric_design_price_overrides o
  on o.item_type_id     = itf.item_type_id
 and o.fabric_design_id = fd.id;

commit;

-- Sanity
select 'fabric_design_photos by type' as t, photo_type, count(*) from fabric_design_photos group by photo_type
union all
select 'sample row check', null, count(*) from v_products
  where fabric_design_id = 'vbc-wool-grey-herringbone' and item_type_id = 'formal-suit-2-piece';
