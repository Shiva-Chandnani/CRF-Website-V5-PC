-- =============================================================================
-- Seed: Customization catalogue for the Formal Two-Piece Suit
-- =============================================================================
-- 21 categories (11 jacket + 10 pants), 64 options, 21 junction rows linking
-- every category to item_type_id = 'formal-suit-2-piece'.
--
-- Per-fabric tuxedo-only filtering (`is_tuxedo_only`) is set on the relevant
-- categories but not yet enforced in the UI — V1 always shows them.
--
-- svg_path values point at files emitted by
-- scripts/generate-customization-svgs.mjs (one .svg per option, named after
-- the option's id).
-- =============================================================================

begin;

-- =============================================================================
-- 1. Categories (21 rows)
-- =============================================================================
insert into customization_categories
  (id, name, group_name, display_order, is_advanced, is_tuxedo_only, description) values
  -- Jacket (11)
  ('jacket-construction',     'Jacket Construction',      'jacket',  10, false, false, 'How the jacket is built. Construction determines the jacket''s drape, structure, and longevity.'),
  ('jacket-style',            'Jacket Style',             'jacket',  20, false, false, 'Button count and silhouette.'),
  ('jacket-lapel',            'Lapel',                    'jacket',  30, false, false, 'Choose the lapel shape.'),
  ('jacket-interior-style',   'Jacket Interior Style',    'jacket',  40, false, false, 'How much of the jacket is lined.'),
  ('jacket-rear-vent',        'Jacket Rear Vent Style',   'jacket',  50, false, false, 'Vents at the back of the jacket affect movement and silhouette.'),
  ('jacket-exterior-pocket',  'Jacket Exterior Pockets',  'jacket',  60, false, false, 'Pocket style on the front of the jacket.'),
  ('jacket-buttons',          'Buttons',                  'jacket',  70, false, false, 'Material and finish of the front buttons.'),
  ('jacket-monogram',         'Jacket Monogram',          'jacket',  80, false, false, 'A discreet personal monogram on the interior. Adds 2-3 days to production.'),
  ('jacket-interior-lining',  'Jacket Interior Lining',   'jacket',  90, true,  false, 'Inside lining fabric and color.'),
  ('jacket-sleeve-buttons',   'Jacket Sleeve Buttons',    'jacket', 100, true,  false, 'Style of the buttons on the jacket cuff.'),
  ('jacket-tuxedo-contrast',  'Jacket Tuxedo Contrast',   'jacket', 110, true,  true,  'Satin or grosgrain trim — only applicable to tuxedo make-ups.'),
  -- Pants (10)
  ('pants-pleats',            'Pants Pleats',             'pants',  200, false, false, 'Front pleats add room through the thigh.'),
  ('pants-waistband',         'Pants Waistband',          'pants',  210, false, false, 'How the waistband is finished.'),
  ('pants-back-pockets',      'Pants Back Pockets',       'pants',  220, false, false, 'Pocket count and placement on the back.'),
  ('pants-waist-closure',     'Pants Waist Closure',      'pants',  230, false, false, 'The fastening at the front of the waistband.'),
  ('pants-hem',               'Pants Hem',                'pants',  240, false, false, 'Cuffed or plain trouser hem.'),
  ('pants-buttons',           'Pants Buttons',            'pants',  250, true,  false, 'Finish of the buttons on the fly and waistband.'),
  ('pants-suspender-buttons', 'Pants Suspender Buttons',  'pants',  260, true,  false, 'Hidden interior buttons for braces / suspenders.'),
  ('pants-front-pockets',     'Pants Front Pockets',      'pants',  270, true,  false, 'Pocket style on the front of the trouser.'),
  ('pants-knee-lining',       'Pants Knee Lining',        'pants',  280, true,  false, 'An interior lining at the knee. Extends garment life.'),
  ('pants-tuxedo-contrast',   'Pants Tuxedo Contrast',    'pants',  290, true,  true,  'Side stripe — only applicable to tuxedo make-ups.');

-- =============================================================================
-- 2. Options (64 rows)
-- =============================================================================
-- svg_path is uniform: assets/customization/svg/{option_id}.svg
-- price_delta_thb defaults to 0; all V1 options are included in the base price.

insert into customization_options
  (id, category_id, name, description, svg_path, is_default, display_order) values

  -- Jacket Construction (3)
  ('jacket-construction-half-canvas',    'jacket-construction', 'Half Canvas',
   'A floating canvas in the chest only. Our standard — balances structure and softness.',
   'assets/customization/svg/jacket-construction-half-canvas.svg', true,  10),
  ('jacket-construction-full-canvas',    'jacket-construction', 'Full Canvas',
   'A floating canvas through the entire front. Drapes elegantly and ages beautifully.',
   'assets/customization/svg/jacket-construction-full-canvas.svg', false, 20),
  ('jacket-construction-unconstructed',  'jacket-construction', 'Unconstructed',
   'No canvas or shoulder pad. Softest, most relaxed silhouette — best for warm-weather fabrics.',
   'assets/customization/svg/jacket-construction-unconstructed.svg', false, 30),

  -- Jacket Style (4)
  ('jacket-style-sb-1-button',  'jacket-style', 'Single-Breasted, 1 Button',
   'A lean, formal silhouette favoured by Italian tailoring.',
   'assets/customization/svg/jacket-style-sb-1-button.svg', false, 10),
  ('jacket-style-sb-2-button',  'jacket-style', 'Single-Breasted, 2 Button',
   'The most versatile suit silhouette. Our default.',
   'assets/customization/svg/jacket-style-sb-2-button.svg', true,  20),
  ('jacket-style-sb-3-button',  'jacket-style', 'Single-Breasted, 3 Button',
   'A classic with a taller stance. Sharper on tall frames.',
   'assets/customization/svg/jacket-style-sb-3-button.svg', false, 30),
  ('jacket-style-db-6x2',       'jacket-style', 'Double-Breasted, 6×2',
   'Six buttons, two fastened. A bolder, more formal cut.',
   'assets/customization/svg/jacket-style-db-6x2.svg', false, 40),

  -- Lapel (3)
  ('jacket-lapel-notch', 'jacket-lapel', 'Notch Lapel',
   'A V-shaped notch at the gorge. Versatile and timeless. Our default.',
   'assets/customization/svg/jacket-lapel-notch.svg', true,  10),
  ('jacket-lapel-peak',  'jacket-lapel', 'Peak Lapel',
   'Pointed tips that flare upward. Strong, formal, and a touch dressy.',
   'assets/customization/svg/jacket-lapel-peak.svg', false, 20),
  ('jacket-lapel-shawl', 'jacket-lapel', 'Shawl Lapel',
   'A continuous curve. Reserved for tuxedos and smoking jackets.',
   'assets/customization/svg/jacket-lapel-shawl.svg', false, 30),

  -- Jacket Interior Style (3)
  ('jacket-interior-style-standard', 'jacket-interior-style', 'Standard Interior',
   'Lined body, unlined sleeves. A balanced default.',
   'assets/customization/svg/jacket-interior-style-standard.svg', true,  10),
  ('jacket-interior-style-fully-lined', 'jacket-interior-style', 'Fully Lined',
   'Full body and sleeve lining. Smoothest hand and structure.',
   'assets/customization/svg/jacket-interior-style-fully-lined.svg', false, 20),
  ('jacket-interior-style-half-lined', 'jacket-interior-style', 'Half Lined',
   'Lining only through the upper body. Lighter, breathes well in warm weather.',
   'assets/customization/svg/jacket-interior-style-half-lined.svg', false, 30),

  -- Jacket Rear Vent (3)
  ('jacket-rear-vent-side',   'jacket-rear-vent', 'Side Vents',
   'Two vents on the sides. The most flattering and modern choice. Our default.',
   'assets/customization/svg/jacket-rear-vent-side.svg', true,  10),
  ('jacket-rear-vent-center', 'jacket-rear-vent', 'Center Vent',
   'A single vent at the centre back. Traditional and clean.',
   'assets/customization/svg/jacket-rear-vent-center.svg', false, 20),
  ('jacket-rear-vent-none',   'jacket-rear-vent', 'No Vent',
   'A smooth, ventless back. Italian-influenced, very formal.',
   'assets/customization/svg/jacket-rear-vent-none.svg', false, 30),

  -- Jacket Exterior Pocket (5)
  ('jacket-exterior-pocket-flap',          'jacket-exterior-pocket', 'Flap Pockets',
   'Flapped welts at the hip. The most common and versatile choice.',
   'assets/customization/svg/jacket-exterior-pocket-flap.svg', true,  10),
  ('jacket-exterior-pocket-jetted',        'jacket-exterior-pocket', 'Jetted Pockets',
   'A clean horizontal slit, no flap. More formal — typical of tuxedos.',
   'assets/customization/svg/jacket-exterior-pocket-jetted.svg', false, 20),
  ('jacket-exterior-pocket-patch',         'jacket-exterior-pocket', 'Patch Pockets',
   'Pockets sewn onto the outside of the jacket. Casual and Italian in feel.',
   'assets/customization/svg/jacket-exterior-pocket-patch.svg', false, 30),
  ('jacket-exterior-pocket-flap-ticket',   'jacket-exterior-pocket', 'Flap Pockets with Ticket Pocket',
   'A small extra pocket above the right flap. A subtle nod to British tailoring.',
   'assets/customization/svg/jacket-exterior-pocket-flap-ticket.svg', false, 40),
  ('jacket-exterior-pocket-jetted-ticket', 'jacket-exterior-pocket', 'Jetted Pockets with Ticket Pocket',
   'Jetted pockets with a small ticket pocket above the right.',
   'assets/customization/svg/jacket-exterior-pocket-jetted-ticket.svg', false, 50),

  -- Jacket Buttons (5)
  ('jacket-buttons-horn',   'jacket-buttons', 'Light Brown Horn',
   'Genuine horn, hand-polished. Subtle marbling — our default.',
   'assets/customization/svg/jacket-buttons-horn.svg', true,  10),
  ('jacket-buttons-dark',   'jacket-buttons', 'Dark Horn',
   'A deeper, near-black horn. Pairs well with charcoal and navy.',
   'assets/customization/svg/jacket-buttons-dark.svg', false, 20),
  ('jacket-buttons-brown',  'jacket-buttons', 'Brown',
   'Solid brown. Warm and traditional.',
   'assets/customization/svg/jacket-buttons-brown.svg', false, 30),
  ('jacket-buttons-black',  'jacket-buttons', 'Black',
   'Solid black. Sharpest with darker fabrics.',
   'assets/customization/svg/jacket-buttons-black.svg', false, 40),
  ('jacket-buttons-formal', 'jacket-buttons', 'Formal Satin',
   'A high-shine satin finish. Tuxedo-appropriate.',
   'assets/customization/svg/jacket-buttons-formal.svg', false, 50),

  -- Jacket Monogram (2)
  ('jacket-monogram-none', 'jacket-monogram', 'No Monogram',
   'A clean interior with no embroidery.',
   'assets/customization/svg/jacket-monogram-none.svg', true,  10),
  ('jacket-monogram-add',  'jacket-monogram', 'Add Monogram',
   'Up to three letters embroidered on the interior. Choose thread colour in the next step.',
   'assets/customization/svg/jacket-monogram-add.svg', false, 20),

  -- Jacket Interior Lining (2)
  ('jacket-interior-lining-standard', 'jacket-interior-lining', 'Standard Lining',
   'A tonal lining matched to the suit fabric.',
   'assets/customization/svg/jacket-interior-lining-standard.svg', true,  10),
  ('jacket-interior-lining-contrast', 'jacket-interior-lining', 'Contrast Lining',
   'A lining in a complementary or contrasting colour. Selected at your consultation.',
   'assets/customization/svg/jacket-interior-lining-contrast.svg', false, 20),

  -- Jacket Sleeve Buttons (3)
  ('jacket-sleeve-buttons-non-functional', 'jacket-sleeve-buttons', 'Non-Functional',
   'Decorative buttons sewn flat against the cuff. Standard.',
   'assets/customization/svg/jacket-sleeve-buttons-non-functional.svg', true,  10),
  ('jacket-sleeve-buttons-functional',     'jacket-sleeve-buttons', 'Functional (Surgeon Cuffs)',
   'Working buttonholes on the cuff. A discreet hallmark of bespoke tailoring.',
   'assets/customization/svg/jacket-sleeve-buttons-functional.svg', false, 20),
  ('jacket-sleeve-buttons-kissing',        'jacket-sleeve-buttons', 'Kissing Buttons',
   'Buttons placed so they overlap. A Neapolitan signature.',
   'assets/customization/svg/jacket-sleeve-buttons-kissing.svg', false, 30),

  -- Jacket Tuxedo Contrast (3)
  ('jacket-tuxedo-contrast-none',     'jacket-tuxedo-contrast', 'No Contrast',
   'No tuxedo trim. Use for business suits.',
   'assets/customization/svg/jacket-tuxedo-contrast-none.svg', true,  10),
  ('jacket-tuxedo-contrast-satin',    'jacket-tuxedo-contrast', 'Satin Lapel',
   'A satin facing on the lapel. Classic black-tie.',
   'assets/customization/svg/jacket-tuxedo-contrast-satin.svg', false, 20),
  ('jacket-tuxedo-contrast-grosgrain','jacket-tuxedo-contrast', 'Grosgrain Trim',
   'A ribbed grosgrain facing. A softer, more matte alternative to satin.',
   'assets/customization/svg/jacket-tuxedo-contrast-grosgrain.svg', false, 30),

  -- Pants Pleats (3)
  ('pants-pleats-none',   'pants-pleats', 'No Pleats',
   'A flat front. The modern, slimming default.',
   'assets/customization/svg/pants-pleats-none.svg', true,  10),
  ('pants-pleats-single', 'pants-pleats', 'Single Pleat',
   'One pleat per side. Room through the thigh, still trim.',
   'assets/customization/svg/pants-pleats-single.svg', false, 20),
  ('pants-pleats-double', 'pants-pleats', 'Double Pleats',
   'Two pleats per side. Most relaxed; classical tailoring.',
   'assets/customization/svg/pants-pleats-double.svg', false, 30),

  -- Pants Waistband (4)
  ('pants-waistband-belt-loops',     'pants-waistband', 'Belt Loops',
   'Fabric loops around the waist to hold a belt. The standard choice.',
   'assets/customization/svg/pants-waistband-belt-loops.svg', true,  10),
  ('pants-waistband-side-tabs',      'pants-waistband', 'Side Tabs',
   'Hidden buckle adjusters at each side. Beltless and clean.',
   'assets/customization/svg/pants-waistband-side-tabs.svg', false, 20),
  ('pants-waistband-belt-and-tabs',  'pants-waistband', 'Belt Loops + Side Tabs',
   'Both — wear a belt or adjust internally.',
   'assets/customization/svg/pants-waistband-belt-and-tabs.svg', false, 30),
  ('pants-waistband-none',           'pants-waistband', 'None',
   'Plain waistband, no loops or tabs.',
   'assets/customization/svg/pants-waistband-none.svg', false, 40),

  -- Pants Back Pockets (2)
  ('pants-back-pockets-two', 'pants-back-pockets', 'Two Pockets',
   'A welted button-through pocket on each side. The standard.',
   'assets/customization/svg/pants-back-pockets-two.svg', true,  10),
  ('pants-back-pockets-one', 'pants-back-pockets', 'One Pocket',
   'A single welt on the right side.',
   'assets/customization/svg/pants-back-pockets-one.svg', false, 20),

  -- Pants Waist Closure (5)
  ('pants-waist-closure-standard', 'pants-waist-closure', 'Standard Button Tab',
   'A single button at the waistband.',
   'assets/customization/svg/pants-waist-closure-standard.svg', true,  10),
  ('pants-waist-closure-extended-round',  'pants-waist-closure', 'Extended Round',
   'A rounded extended tab — a discreet bespoke detail.',
   'assets/customization/svg/pants-waist-closure-extended-round.svg', false, 20),
  ('pants-waist-closure-extended-arrow',  'pants-waist-closure', 'Extended Arrow',
   'A pointed extended tab.',
   'assets/customization/svg/pants-waist-closure-extended-arrow.svg', false, 30),
  ('pants-waist-closure-extended-square', 'pants-waist-closure', 'Extended Square',
   'A square-cut extended tab.',
   'assets/customization/svg/pants-waist-closure-extended-square.svg', false, 40),
  ('pants-waist-closure-double-button',   'pants-waist-closure', 'Double Button',
   'Two buttons at the waistband. Heritage detailing.',
   'assets/customization/svg/pants-waist-closure-double-button.svg', false, 50),

  -- Pants Hem (2)
  ('pants-hem-no-cuff',   'pants-hem', 'No Cuff',
   'A clean, plain hem. Versatile across all fits.',
   'assets/customization/svg/pants-hem-no-cuff.svg', true,  10),
  ('pants-hem-with-cuff', 'pants-hem', 'Cuffed Hem',
   'A turned-up cuff (typically 1.5 inches). Adds weight; pairs well with pleats.',
   'assets/customization/svg/pants-hem-with-cuff.svg', false, 20),

  -- Pants Buttons (3)
  ('pants-buttons-standard',         'pants-buttons', 'Standard',
   'Tonal buttons matched to the trouser fabric.',
   'assets/customization/svg/pants-buttons-standard.svg', true,  10),
  ('pants-buttons-matching-jacket',  'pants-buttons', 'Matching Jacket',
   'The same buttons selected for the jacket front.',
   'assets/customization/svg/pants-buttons-matching-jacket.svg', false, 20),
  ('pants-buttons-contrast',         'pants-buttons', 'Contrast',
   'A different colour from the jacket — selected at your consultation.',
   'assets/customization/svg/pants-buttons-contrast.svg', false, 30),

  -- Pants Suspender Buttons (2)
  ('pants-suspender-buttons-none', 'pants-suspender-buttons', 'No Suspender Buttons',
   'Standard interior; no buttons for braces.',
   'assets/customization/svg/pants-suspender-buttons-none.svg', true,  10),
  ('pants-suspender-buttons-add',  'pants-suspender-buttons', 'Add Suspender Buttons',
   'Six hidden buttons inside the waistband for braces / suspenders.',
   'assets/customization/svg/pants-suspender-buttons-add.svg', false, 20),

  -- Pants Front Pockets (2)
  ('pants-front-pockets-slanted', 'pants-front-pockets', 'Slanted (Quarter-Top)',
   'A diagonal pocket opening. The standard.',
   'assets/customization/svg/pants-front-pockets-slanted.svg', true,  10),
  ('pants-front-pockets-on-seam', 'pants-front-pockets', 'On-Seam',
   'A vertical opening tucked into the side seam. Cleanest line.',
   'assets/customization/svg/pants-front-pockets-on-seam.svg', false, 20),

  -- Pants Knee Lining (3)
  ('pants-knee-lining-none',  'pants-knee-lining', 'No Knee Lining',
   'A standard unlined interior.',
   'assets/customization/svg/pants-knee-lining-none.svg', true,  10),
  ('pants-knee-lining-front', 'pants-knee-lining', 'Front Knee Lining',
   'A lining extending to the knee on the front leg. Prolongs the trouser''s life.',
   'assets/customization/svg/pants-knee-lining-front.svg', false, 20),
  ('pants-knee-lining-full',  'pants-knee-lining', 'Full Lining',
   'A full leg lining. Smoothest hand; warmest.',
   'assets/customization/svg/pants-knee-lining-full.svg', false, 30),

  -- Pants Tuxedo Contrast (3)
  ('pants-tuxedo-contrast-none',      'pants-tuxedo-contrast', 'No Stripe',
   'A plain trouser leg. Use for business suits.',
   'assets/customization/svg/pants-tuxedo-contrast-none.svg', true,  10),
  ('pants-tuxedo-contrast-satin',     'pants-tuxedo-contrast', 'Satin Side Stripe',
   'A satin stripe down the outer leg. Black-tie standard.',
   'assets/customization/svg/pants-tuxedo-contrast-satin.svg', false, 20),
  ('pants-tuxedo-contrast-grosgrain', 'pants-tuxedo-contrast', 'Grosgrain Side Stripe',
   'A grosgrain stripe — a softer, matte alternative to satin.',
   'assets/customization/svg/pants-tuxedo-contrast-grosgrain.svg', false, 30);

-- =============================================================================
-- 3. Junction: link all 21 categories to formal-suit-2-piece
-- =============================================================================
insert into item_type_customization_categories (item_type_id, category_id)
select 'formal-suit-2-piece', id from customization_categories;

commit;

-- Sanity checks
select 'categories'   as t, count(*)::text from customization_categories
union all
select 'options',                count(*)::text from customization_options
union all
select 'junction (suit)',        count(*)::text from item_type_customization_categories where item_type_id = 'formal-suit-2-piece'
union all
select 'catalog rows (suit)',    count(*)::text from v_customization_catalog where item_type_id = 'formal-suit-2-piece'
union all
select 'options w/ default',     count(*)::text from customization_options where is_default
union all
select 'categories w/ default',  count(distinct category_id)::text from customization_options where is_default;
