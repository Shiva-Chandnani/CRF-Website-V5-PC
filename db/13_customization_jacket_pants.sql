-- Phase 4 — customization expansion.
-- Enable the existing customization catalogue for standalone formal-jacket
-- (all 11 jacket-group categories) and dress-pants (all 10 pants-group
-- categories). Idempotent: junction PK is (item_type_id, category_id).
-- No new categories, options, or SVGs — pure reuse.

insert into item_type_customization_categories (item_type_id, category_id)
select 'formal-jacket', id from customization_categories where group_name = 'jacket'
on conflict do nothing;

insert into item_type_customization_categories (item_type_id, category_id)
select 'dress-pants', id from customization_categories where group_name = 'pants'
on conflict do nothing;

-- Verification (printed by run-sql):
select item_type_id, count(*) as categories
from item_type_customization_categories
where item_type_id in ('formal-jacket','dress-pants')
group by item_type_id
order by item_type_id;
