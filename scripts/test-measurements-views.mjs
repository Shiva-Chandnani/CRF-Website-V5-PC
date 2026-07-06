// Phase 1 WT-3 view semantics test.
// Inserts 3 successive customer_body_measurements rows for one user with
// distinct captured_at timestamps (T-2h, T-1h, T-0), then asserts that
// v_latest_body_measurements returns exactly 1 row whose chest_in matches
// the third (newest) insert. Repeats the same shape for the other 3 view
// pairs (jacket / shirt / pants) using a representative numeric field.
// Cleans up the user at the end (cascade clears measurement rows).

import fs from 'node:fs';
import pg from 'pg';

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8')
    .split('\n').filter(Boolean)
    .map(l => l.split('=').map(s => s.trim()))
    .map(([k, ...v]) => [k, v.join('=')])
);

const URL    = env.SUPABASE_URL || 'https://fzgsogdceptjvuahukbn.supabase.co';
const ANON   = env.SUPABASE_ANON_KEY;
const SVCROL = env.SUPABASE_SERVICE_ROLE_KEY;

let failed = false;
function step(name, ok, detail = '') {
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) failed = true;
}

async function adminCreateUser(email, password) {
  const r = await fetch(`${URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: SVCROL, Authorization: `Bearer ${SVCROL}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  if (!r.ok) throw new Error(`admin create user ${r.status} ${await r.text()}`);
  return (await r.json()).id;
}
async function adminDeleteUser(userId) {
  await fetch(`${URL}/auth/v1/admin/users/${userId}`, {
    method: 'DELETE',
    headers: { apikey: SVCROL, Authorization: `Bearer ${SVCROL}` },
  });
}
async function signIn(email, password) {
  const r = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!r.ok) throw new Error(`sign-in ${r.status} ${await r.text()}`);
  return (await r.json()).access_token;
}
async function userSelectAll(viewOrTable, accessToken, params = '') {
  const r = await fetch(`${URL}/rest/v1/${viewOrTable}?select=*${params}`, {
    headers: { apikey: ANON, Authorization: `Bearer ${accessToken}` },
  });
  if (!r.ok) throw new Error(`select ${viewOrTable} ${r.status} ${await r.text()}`);
  return r.json();
}

const client = new pg.Client({
  host: env.PGHOST, port: +env.PGPORT, database: env.PGDATABASE,
  user: env.PGUSER, password: env.PGPASSWORD, ssl: { rejectUnauthorized: false },
});

const EMAIL = `wt3-views-${Date.now()}@example.com`;
const PASS  = 'WT3-test-password-9X!';
let userId;

try {
  await client.connect();
  userId = await adminCreateUser(EMAIL, PASS);
  step('created test user', !!userId);

  // Seed 3 body-measurement rows at T-2h, T-1h, T-0 with distinct chest_in
  const now = new Date();
  const t2h = new Date(now.getTime() - 2 * 3600 * 1000).toISOString();
  const t1h = new Date(now.getTime() - 1 * 3600 * 1000).toISOString();
  const t0  = now.toISOString();
  await client.query(
    `insert into customer_body_measurements (customer_id, chest_in, captured_at) values
       ($1, 40.00, $2),
       ($1, 41.00, $3),
       ($1, 42.50, $4)`,
    [userId, t2h, t1h, t0]
  );
  // Seed 2 rows per other table — only newest should appear in latest view
  await client.query(
    `insert into customer_jacket_reference (customer_id, collar_in, captured_at) values
       ($1, 15.50, $2),
       ($1, 16.25, $3)`,
    [userId, t1h, t0]
  );
  await client.query(
    `insert into customer_shirt_reference (customer_id, collar_in, captured_at) values
       ($1, 14.50, $2),
       ($1, 15.00, $3)`,
    [userId, t1h, t0]
  );
  await client.query(
    `insert into customer_pants_reference (customer_id, waist_in, captured_at) values
       ($1, 32.00, $2),
       ($1, 33.00, $3)`,
    [userId, t1h, t0]
  );
  step('seeded multi-row history in all 4 tables', true);

  // Sign in and query the four latest views
  const token = await signIn(EMAIL, PASS);

  const bodyBase = await userSelectAll('customer_body_measurements', token);
  step('base table has 3 body rows', bodyBase.length === 3, `got ${bodyBase.length}`);

  const bodyLatest = await userSelectAll('v_latest_body_measurements', token);
  step('v_latest_body_measurements returns exactly 1 row', bodyLatest.length === 1, `got ${bodyLatest.length}`);
  step('latest body row has chest_in = 42.50 (newest)',
       Number(bodyLatest[0]?.chest_in) === 42.50,
       `got ${bodyLatest[0]?.chest_in}`);

  const jacketLatest = await userSelectAll('v_latest_jacket_reference', token);
  step('v_latest_jacket_reference returns exactly 1 row', jacketLatest.length === 1, `got ${jacketLatest.length}`);
  step('latest jacket row has collar_in = 16.25 (newest)',
       Number(jacketLatest[0]?.collar_in) === 16.25,
       `got ${jacketLatest[0]?.collar_in}`);

  const shirtLatest = await userSelectAll('v_latest_shirt_reference', token);
  step('v_latest_shirt_reference returns exactly 1 row', shirtLatest.length === 1, `got ${shirtLatest.length}`);
  step('latest shirt row has collar_in = 15.00 (newest)',
       Number(shirtLatest[0]?.collar_in) === 15.00,
       `got ${shirtLatest[0]?.collar_in}`);

  const pantsLatest = await userSelectAll('v_latest_pants_reference', token);
  step('v_latest_pants_reference returns exactly 1 row', pantsLatest.length === 1, `got ${pantsLatest.length}`);
  step('latest pants row has waist_in = 33.00 (newest)',
       Number(pantsLatest[0]?.waist_in) === 33.00,
       `got ${pantsLatest[0]?.waist_in}`);
} catch (e) {
  failed = true;
  console.error('Test threw:', e.message);
} finally {
  if (userId) await adminDeleteUser(userId).catch(() => {});
  await client.end().catch(() => {});
}

if (failed) {
  console.error('\n❌ measurements views test failed');
  process.exit(1);
}
console.log('\n✅ v_latest_* views return newest row per customer');
