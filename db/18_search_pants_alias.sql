-- db/18_search_pants_alias.sql — keep "pants" as a HIDDEN search alias.
-- After 17_rename_pants_to_trousers.sql, all display names read "Trousers", so a
-- shopper searching the American term "pants" got zero hits. This re-creates
-- search_products with one change: rows in the (still-id'd) 'pants' category get
-- the token "pants" appended to their search document only — never to any
-- displayed field. So "pants" and "trousers" both resolve trouser products.
-- Idempotent. Apply with: node scripts/run-sql.mjs db/18_search_pants_alias.sql

create extension if not exists pg_trgm;

create or replace function search_products(
  search_query     text,
  p_category_id    text default null,
  p_subcategory_id text default null,
  p_fabric_type_id text default null,
  p_pattern        text default null,
  p_color          text default null
) returns setof v_products
language sql
stable
security invoker
as $func$
  with q as (
    select nullif(btrim(coalesce(search_query, '')), '') as raw
  ),
  toks as (
    select raw,
           array(
             select tok
             from unnest(regexp_split_to_array(
                    lower(regexp_replace(coalesce(raw, ''), '[^a-z0-9]+', ' ', 'gi')), '\s+')) as tok
             where tok <> ''
           ) as words
    from q
  ),
  tsq as (
    select raw, words,
           case when raw is null or array_length(words, 1) is null then null
                else to_tsquery('simple',
                       array_to_string(array(select w || ':*' from unnest(words) as w), ' & '))
           end as query
    from toks
  ),
  -- column filters applied once, ahead of any search-text scoring
  filtered as (
    select p.*
    from v_products p
    where (p_category_id    is null or p.category_id    = p_category_id)
      and (p_subcategory_id is null or p.subcategory_id = p_subcategory_id)
      and (p_fabric_type_id is null or p.fabric_type_id = p_fabric_type_id)
      and (p_pattern        is null or p.pattern::text  = p_pattern)
      and (p_color          is null or p.color @> array[p_color])
  ),
  scored as (
    select f.*,
           lower(concat_ws(' ',
             f.display_name, f.item_type_name, f.fabric_brand, f.fabric_family,
             f.fabric_type_name, f.design_name, f.fabric_number, f.pattern,
             array_to_string(f.color, ' '), f.item_occasion,
             -- hidden alias: American "pants" keeps matching British "trousers"
             case when f.category_id = 'pants' then 'pants' end)) as doc
    from filtered f
  ),
  normed as (
    -- punctuation collapsed to spaces so hyphenated tokens (e.g. fabric
    -- numbers like "wl-1102") tokenize the same way the query does
    select s.*,
           to_tsvector('simple', regexp_replace(s.doc, '[^a-z0-9]+', ' ', 'g')) as tsv
    from scored s
  ),
  prefix_matches as (
    select n.*,
           case when tsq.query is not null then ts_rank(n.tsv, tsq.query) else 0::real end as rnk
    from normed n
    cross join tsq
    where tsq.raw is null
       or (tsq.query is not null and n.tsv @@ tsq.query)
  ),
  fuzzy_matches as (
    -- only used when the prefix/tsvector pass above found nothing at all —
    -- keeps typo-tolerance from polluting a clean prefix match (e.g. "sui"
    -- must not also fuzzy-match unrelated rows via short-string trigram noise)
    select n.*,
           word_similarity(tsq.raw, n.doc) as rnk
    from normed n
    cross join tsq
    where tsq.raw is not null
      and not exists (select 1 from prefix_matches)
      and word_similarity(tsq.raw, n.doc) > 0.2
  ),
  combined as (
    select * from prefix_matches
    union all
    select * from fuzzy_matches
  )
  select product_id, item_type_id, item_type_name, subcategory_id, category_id,
         fabric_type_id, fabric_brand, fabric_family, fabric_type_name,
         fabric_design_id, design_name, fabric_number, color, pattern,
         availability, price, has_design_override, primary_photo_path,
         display_name, item_status, item_season, item_occasion, fabric_season,
         hero_image_path, hero_image_hover_path, design_hero_paths
  from combined
  order by rnk desc, display_name asc;
$func$;

grant execute on function search_products(text, text, text, text, text, text) to anon, authenticated;
