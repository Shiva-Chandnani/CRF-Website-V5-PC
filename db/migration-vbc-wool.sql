-- =============================================================================
-- Migration: Add Vitale Barberis Canonico Wool fabric type
-- =============================================================================
-- Inserts the second fabric type (Italian Super 110's wool) and its pricing
-- for the three currently-active item types. Designs and photos are loaded
-- separately by scripts/upload-vbc-batch.mjs. Hero photo paths on the Suit
-- row are populated later by db/migration-vbc-hero.sql.
-- =============================================================================

begin;

insert into fabric_types (id, brand, family, composition, origin, season, display_order)
values (
  'vbc-wool',
  'Vitale Barberis Canonico',
  'Wool',
  '100% Wool (Super 110''s)',
  'Italy',
  '{all-season}',
  20
);

insert into item_type_fabrics (item_type_id, fabric_type_id, price) values
  ('formal-suit-2-piece', 'vbc-wool', 20000),
  ('formal-jacket',       'vbc-wool', 14000),
  ('dress-pants',         'vbc-wool',  6000);

commit;

-- Sanity check (will print 0 — designs come in Step 2)
select count(*) as vbc_products_so_far
  from v_products
 where fabric_type_id = 'vbc-wool';
