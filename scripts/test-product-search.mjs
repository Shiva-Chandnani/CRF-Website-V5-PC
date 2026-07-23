// Phase 3 verification: search_products RPC — prefix, fuzzy, fabric-number,
// item-type, combined query+filter, blank query, ranking order.
// Reads .env.local manually (project convention; no dotenv). Uses the ANON key
// so the test exercises the same grants the browser will (public SELECT on v_products).
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8').split('\n').filter(Boolean)
    .map(l => l.split('=').map(s => s.trim())).map(([k, ...v]) => [k, v.join('=')])
);
const URL = env.SUPABASE_URL, ANON = env.SUPABASE_ANON_KEY;
if (!URL || !ANON) { console.error('missing env'); process.exit(2); }
const db = createClient(URL, ANON, { auth: { persistSession: false } });

let failed = false;
const step = (name, ok, detail = '') => {
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) failed = true;
};
const rpc = (args) => db.rpc('search_products', args);

try {
  // prefix / partial word: "sui" must find suits
  {
    const { data, error } = await rpc({ search_query: 'sui' });
    step('prefix "sui" returns suit rows', !error && data.length > 0 &&
      data.every(r => /suit/i.test(r.item_type_name + ' ' + r.display_name)), error?.message);
  }
  // fabric family term
  {
    const { data, error } = await rpc({ search_query: 'wool' });
    step('"wool" returns wool rows', !error && data.length > 0 &&
      data.every(r => /wool/i.test(r.fabric_family + ' ' + r.display_name)), error?.message);
  }
  // fuzzy / typo: "wollen" (pg_trgm similarity) should still find wool
  {
    const { data, error } = await rpc({ search_query: 'wollen' });
    step('fuzzy "wollen" finds wool via trigram', !error && data.length > 0, error?.message);
  }
  // fabric number exact
  {
    const { data, error } = await rpc({ search_query: 'WL-1102' });
    step('fabric number "WL-1102" resolves', !error && data.length > 0 &&
      data.every(r => r.fabric_number === 'WL-1102'), error?.message);
  }
  // combined query + filter (AND): "wool" + a fabric_type filter narrows
  {
    const all = (await rpc({ search_query: 'wool' })).data || [];
    const anyFabric = all[0]?.fabric_type_id;
    const { data, error } = await rpc({ search_query: 'wool', p_fabric_type_id: anyFabric });
    step('combined query+filter ANDs', !error && data.length > 0 &&
      data.every(r => r.fabric_type_id === anyFabric) && data.length <= all.length, error?.message);
  }
  // blank query = filter-only, ordered by display_name
  {
    const { data, error } = await rpc({ search_query: '   ' });
    const sorted = [...data].sort((a, b) => a.display_name.localeCompare(b.display_name));
    step('blank query returns all, display_name-ordered',
      !error && data.length > 0 && JSON.stringify(data.map(r => r.product_id)) === JSON.stringify(sorted.map(r => r.product_id)),
      error?.message);
  }
  // ranking: exact-ish term ranks a matching row at the top
  {
    const { data, error } = await rpc({ search_query: 'pinstripe' });
    step('"pinstripe" top result mentions pinstripe', !error && data.length > 0 &&
      /pinstripe/i.test((data[0].pattern || '') + ' ' + data[0].display_name), error?.message);
  }
  // garbage / punctuation-only must not throw
  {
    const { data, error } = await rpc({ search_query: '!!!' });
    step('punctuation-only query does not error', !error && Array.isArray(data), error?.message);
  }
  // hidden "pants" alias: American term still resolves trousers (18_search_pants_alias),
  // parity with "trousers", and the alias never leaks into a displayed name
  {
    const pants = (await rpc({ search_query: 'pants' })).data || [];
    const trousers = (await rpc({ search_query: 'trousers' })).data || [];
    step('"pants" alias resolves trousers with parity',
      pants.length > 0 && pants.length === trousers.length &&
      pants.every(r => r.category_id === 'pants') &&
      pants.every(r => !/pant/i.test(r.display_name)),
      `pants=${pants.length} trousers=${trousers.length}`);
  }
} catch (e) {
  step('unexpected exception', false, e.message);
}
process.exit(failed ? 1 : 0);
