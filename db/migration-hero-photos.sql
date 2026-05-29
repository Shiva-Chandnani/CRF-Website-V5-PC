-- =============================================================================
-- Migration: hero photos for (item_type × fabric_type) combos
-- =============================================================================
-- Adds two nullable columns to item_type_fabrics, recreates v_products view
-- to surface them, and sets the Cavani Wool × Formal Suit row to point at
-- the 2 model photos we just uploaded.
-- =============================================================================

-- 1. Add the columns (nullable so other combos default to fabric-design photos)
alter table item_type_fabrics
  add column if not exists hero_image_path       text,
  add column if not exists hero_image_hover_path text;

-- 2. Recreate v_products to surface the new fields
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
  itf.hero_image_hover_path                          as hero_image_hover_path
from item_type_fabrics itf
join item_types     it on it.id = itf.item_type_id
join subcategories  sc on sc.id = it.subcategory_id
join fabric_designs fd on fd.fabric_type_id = itf.fabric_type_id
join fabric_types   ft on ft.id = fd.fabric_type_id
left join fabric_design_price_overrides o
  on o.item_type_id     = itf.item_type_id
 and o.fabric_design_id = fd.id;

-- 3. Set the hero paths on the Cavani Wool × Formal Suit row (only)
update item_type_fabrics
   set hero_image_path       = 'hero/formal-suit-2-piece__cavani-wool/01.png',
       hero_image_hover_path = 'hero/formal-suit-2-piece__cavani-wool/02.png'
 where item_type_id   = 'formal-suit-2-piece'
   and fabric_type_id = 'cavani-wool';

-- Verify
select item_type_id, fabric_type_id, hero_image_path, hero_image_hover_path
  from item_type_fabrics
 where fabric_type_id = 'cavani-wool';
-- expect 3 rows; only formal-suit-2-piece has the two paths populated.
