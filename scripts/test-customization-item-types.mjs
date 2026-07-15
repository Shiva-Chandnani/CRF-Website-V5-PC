// Phase 4: verify the customization catalogue is exposed for standalone
// formal-jacket (11 jacket categories) and dress-pants (10 pants categories),
// with group purity and exactly one default option per category.
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8')
    .split('\n').filter(Boolean)
    .map(l => l.split('=').map(s => s.trim()))
    .map(([k, ...v]) => [k, v.join('=')])
);
const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, { auth: { persistSession: false } });

let failed = false;
function step(name, ok, detail = '') {
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) failed = true;
}

async function catalogFor(itemTypeId) {
  const { data, error } = await supabase
    .from('v_customization_catalog')
    .select('category_id, category_group, option_id, is_default')
    .eq('item_type_id', itemTypeId);
  if (error) throw error;
  return data;
}

function byCategory(rows) {
  const m = new Map();
  for (const r of rows) {
    if (!m.has(r.category_id)) m.set(r.category_id, { group: r.category_group, options: [], defaults: 0 });
    const c = m.get(r.category_id);
    c.options.push(r.option_id);
    if (r.is_default) c.defaults += 1;
  }
  return m;
}

const jacket = byCategory(await catalogFor('formal-jacket'));
const pants  = byCategory(await catalogFor('dress-pants'));

step('formal-jacket exposes 11 categories', jacket.size === 11, `got ${jacket.size}`);
step('dress-pants exposes 10 categories', pants.size === 10, `got ${pants.size}`);
step('all jacket categories are group=jacket', [...jacket.values()].every(c => c.group === 'jacket'));
step('all pants categories are group=pants', [...pants.values()].every(c => c.group === 'pants'));
step('no jacket-* category leaks into dress-pants', ![...pants.keys()].some(id => id.startsWith('jacket-')));
step('no pants-* category leaks into formal-jacket', ![...jacket.keys()].some(id => id.startsWith('pants-')));
step('every jacket category has >=1 option and exactly one default',
  [...jacket.values()].every(c => c.options.length >= 1 && c.defaults === 1));
step('every pants category has >=1 option and exactly one default',
  [...pants.values()].every(c => c.options.length >= 1 && c.defaults === 1));

console.log(failed ? '\n✘ FAILED' : '\n✅ PASS');
process.exit(failed ? 1 : 0);
