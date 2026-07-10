// Pure-Node drift guard: every MEASUREMENT_SCHEMA field key must exist as a
// numeric column in the matching db/09_measurements.sql table, and every
// numeric column must be surfaced in the UI schema. No server needed.
import fs from 'node:fs';
import { MEASUREMENT_SCHEMA, fieldKeysForKind } from '../js/measurement-schema.js';

// Mirror of js/profile.js MEASUREMENT_KINDS / TABLE_BY_KIND (kept in sync by this test).
const TABLE_BY_KIND = {
  body:             'customer_body_measurements',
  jacket_reference: 'customer_jacket_reference',
  shirt_reference:  'customer_shirt_reference',
  pants_reference:  'customer_pants_reference',
};
const VALID_KINDS = new Set(Object.keys(TABLE_BY_KIND));

const sql = fs.readFileSync('db/09_measurements.sql', 'utf8');

function numericColumns(table) {
  const start = sql.indexOf(`create table if not exists ${table}`);
  if (start === -1) throw new Error(`table not found in SQL: ${table}`);
  const end = sql.indexOf(');', start);
  const block = sql.slice(start, end);
  const cols = [];
  for (const line of block.split('\n')) {
    const m = line.match(/^\s{2,}([a-z_]+)\s+numeric/);
    if (m) cols.push(m[1]);
  }
  return cols;
}

let failures = 0;
const must = (c, m) => { if (!c) { console.error('✘', m); failures++; } else console.log('✓', m); };

must(MEASUREMENT_SCHEMA.length === 4, `schema has 4 kinds (got ${MEASUREMENT_SCHEMA.length})`);

for (const def of MEASUREMENT_SCHEMA) {
  must(VALID_KINDS.has(def.kind), `kind "${def.kind}" is a valid profile.js MEASUREMENT_KIND`);
  const table = TABLE_BY_KIND[def.kind];
  if (!table) continue;
  const cols = new Set(numericColumns(table));
  const keys = fieldKeysForKind(def.kind);
  const keySet = new Set(keys);
  must(keys.length === new Set(keys).size, `${def.kind}: no duplicate keys`);
  for (const key of keys) must(cols.has(key), `${def.kind}: schema key "${key}" exists in ${table}`);
  for (const col of cols)  must(keySet.has(col), `${def.kind}: column "${col}" surfaced in UI schema`);
}

if (failures) { console.error(`\n❌ ${failures} failure(s)`); process.exit(1); }
console.log('\n✅ test-measurement-schema clean');
