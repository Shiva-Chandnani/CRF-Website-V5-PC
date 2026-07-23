-- Site-review fix: relabel "Pants" → "Trousers" in all USER-FACING display names.
-- Bespoke house uses British terminology; also fixes search (search_products
-- reads these names via v_products, so "trousers" now matches).
-- IDENTIFIERS ARE UNTOUCHED: category id 'pants', item_type/subcategory ids
-- 'dress-pants'/'linen-pants', customization_categories ids 'pants-*',
-- group_name 'pants' all stay — only .name display strings change.
-- Idempotent + transaction-wrapped.
begin;

update public.categories
   set name = 'Trousers'
 where id = 'pants';

update public.item_types
   set name = 'Dress Trousers'
 where id = 'dress-pants';

update public.subcategories
   set name = replace(name, 'Pants', 'Trousers')
 where name like '%Pants%';

update public.customization_categories
   set name = replace(name, 'Pants ', 'Trouser ')
 where group_name = 'pants' and name like 'Pants %';

-- Verify
select 'categories' as tbl, id, name from public.categories where id = 'pants'
union all select 'item_types', id, name from public.item_types where id = 'dress-pants'
union all select 'subcategories', id, name from public.subcategories where id in ('dress-pants','linen-pants')
union all select 'customization', id, name from public.customization_categories where group_name = 'pants'
order by tbl, id;

commit;
