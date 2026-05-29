-- =============================================================================
-- Country Road Fashions — Seed data
-- Run AFTER schema.sql on a fresh Supabase project.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Full category taxonomy (from the product spec)
-- -----------------------------------------------------------------------------
insert into categories (id, name, display_order) values
  ('suits',            'Suits',                          10),
  ('shirts',           'Shirts',                         20),
  ('pants',            'Pants',                          30),
  ('coats',            'Coats',                          40),
  ('jackets-blazers',  'Jackets & Blazers',              50),
  ('mandarin-collar',  'Mandarin Collar Suits & Vests',  60),
  ('accessories',      'Accessories',                    70);

insert into subcategories (id, category_id, name, display_order) values
  -- Suits
  ('formal-suits',     'suits',           'Formal Suits',    10),
  ('summer-suits',     'suits',           'Summer Suits',    20),
  ('winter-suits',     'suits',           'Winter Suits',    30),
  ('tuxedos',          'suits',           'Tuxedos',         40),
  -- Shirts
  ('dress-shirts',     'shirts',          'Dress Shirts',    10),
  ('casual-shirts',    'shirts',          'Casual Shirts',   20),
  ('linen-shirts',     'shirts',          'Linen Shirts',    30),
  ('all-fabrics',      'shirts',          'All Fabrics',     40),
  -- Pants
  ('dress-pants',      'pants',           'Dress Pants',     10),
  ('chinos',           'pants',           'Chinos',          20),
  ('linen-pants',      'pants',           'Linen Pants',     30),
  ('shorts',           'pants',           'Shorts',          40),
  -- Coats
  ('peacoats',         'coats',           'Peacoats',        10),
  ('overcoats',        'coats',           'Overcoats',       20),
  -- Jackets & Blazers
  ('formal-jackets',   'jackets-blazers', 'Formal Jackets',  10),
  ('summer-jackets',   'jackets-blazers', 'Summer Jackets',  20),
  ('hopsack-jackets',  'jackets-blazers', 'Hopsack Jackets', 30),
  -- Mandarin Collar
  ('mandarin-vests',   'mandarin-collar', 'Mandarin Collar Vests', 10),
  ('mandarin-suits',   'mandarin-collar', 'Mandarin Collar Suits', 20),
  -- Accessories
  ('cufflinks',        'accessories',     'Cufflinks',       10),
  ('ties',             'accessories',     'Ties',            20),
  ('pocket-squares',   'accessories',     'Pocket Squares',  30);

-- -----------------------------------------------------------------------------
-- 2. Item types — Cavani example uses 3
-- -----------------------------------------------------------------------------
insert into item_types (id, subcategory_id, name, season, occasion, status, display_order) values
  ('formal-suit-2-piece', 'formal-suits',   'Formal Suit — Two Piece', '{all-season}', '{formal,business,wedding}', 'active', 10),
  ('formal-jacket',       'formal-jackets', 'Formal Jacket',           '{all-season}', '{formal,business}',         'active', 10),
  ('dress-pants',         'dress-pants',    'Dress Pants',             '{all-season}', '{formal,business}',         'active', 10);

-- -----------------------------------------------------------------------------
-- 3. Fabric type: Cavani Wool
-- -----------------------------------------------------------------------------
insert into fabric_types (id, brand, family, composition, origin, season, display_order) values
  ('cavani-wool', 'Cavani', 'Wool', '100% Wool', 'Italy', '{all-season}', 10);

-- -----------------------------------------------------------------------------
-- 4. Prices — the matrix. 3 rows = 3 prices that govern every Cavani Wool product.
-- -----------------------------------------------------------------------------
insert into item_type_fabrics (item_type_id, fabric_type_id, price) values
  ('formal-suit-2-piece', 'cavani-wool', 15000),
  ('formal-jacket',       'cavani-wool',  9000),
  ('dress-pants',         'cavani-wool',  6000);

-- -----------------------------------------------------------------------------
-- 5. Fabric designs (3 of ~20 — add more rows as you photograph them)
-- -----------------------------------------------------------------------------
insert into fabric_designs (id, fabric_type_id, fabric_number, name, color, pattern) values
  ('cavani-wool-black-pinstripe',      'cavani-wool', 'WL-1101', 'Black Pinstripe',      '{black,white}', 'pinstripe'),
  ('cavani-wool-navy-pinstripe',       'cavani-wool', 'WL-1102', 'Navy Pinstripe',       '{navy,white}',  'pinstripe'),
  ('cavani-wool-ash-grey-herringbone', 'cavani-wool', 'WL-1103', 'Ash Grey Herringbone', '{grey}',        'herringbone');

-- -----------------------------------------------------------------------------
-- 6. Design photos (upload the actual images into the crf-fabrics bucket at
--    matching paths: WL-1101/01.jpg, WL-1101/02.jpg, etc.)
-- -----------------------------------------------------------------------------
insert into fabric_design_photos (fabric_design_id, image_path, alt_text, is_primary, display_order) values
  ('cavani-wool-black-pinstripe',      'WL-1101/01.jpg', 'Cavani Wool Black Pinstripe close-up',    true,  10),
  ('cavani-wool-black-pinstripe',      'WL-1101/02.jpg', 'Cavani Wool Black Pinstripe drape',       false, 20),
  ('cavani-wool-navy-pinstripe',       'WL-1102/01.jpg', 'Cavani Wool Navy Pinstripe close-up',     true,  10),
  ('cavani-wool-ash-grey-herringbone', 'WL-1103/01.jpg', 'Cavani Wool Ash Grey Herringbone weave',  true,  10);

-- -----------------------------------------------------------------------------
-- 7. Verify
-- -----------------------------------------------------------------------------
--   select count(*) from v_products;   -- expect 9 (3 item types × 3 designs)
--   select product_id, display_name, price, primary_photo_path
--     from v_products order by item_type_id, design_name;
