-- =============================================================================
-- Migration: Wire VBC hero photos to the Suit row
-- =============================================================================
-- Sets hero_image_path / hero_image_hover_path on the (Suit × VBC Wool) row in
-- item_type_fabrics. Photos were uploaded by scripts/pad-vbc-hero-photos.mjs.
-- The shop card and PDP will start using these automatically.
-- =============================================================================

update item_type_fabrics
   set hero_image_path       = 'hero/formal-suit-2-piece__vbc-wool/01.png',
       hero_image_hover_path = 'hero/formal-suit-2-piece__vbc-wool/02.png'
 where item_type_id   = 'formal-suit-2-piece'
   and fabric_type_id = 'vbc-wool';

-- Sanity check
select item_type_id, fabric_type_id, price, hero_image_path, hero_image_hover_path
  from item_type_fabrics
 where fabric_type_id = 'vbc-wool'
 order by item_type_id;
