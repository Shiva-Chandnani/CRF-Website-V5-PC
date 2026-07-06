// Phase 1 WT-3 cascade-delete test.
// Seeds 2 rows per table for one user, then deletes the auth.users row via
// the admin API. Confirms the full cascade chain empties everything:
//   auth.users → (on delete cascade) → profiles → (on delete cascade) → measurements
//
// We capture the user id up front and query by that id via service-role pg
// (which bypasses RLS) after the delete — simplest reliable way to observe
// the post-delete state once the user's JWT is gone.

import fs from 'node:fs';
import pg from 'pg';

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8')
    .split('\n').filter(Boolean)
    .map(l => l.split('=').map(s => s.trim()))
    .map(([k, ...v]) => [k, v.join('=')])
);

const URL    = env.SUPABASE_URL || 'https://fzgsogdceptjvuahukbn.supabase.co';
const SVCROL = env.SUPABASE_SERVICE_ROLE_KEY;

const TABLES = [
  'customer_body_measurements',
  'customer_jacket_reference',
  'customer_shirt_reference',
  'customer_pants_reference',
];

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
  const r = await fetch(`${URL}/auth/v1/admin/users/${userId}`, {
    method: 'DELETE',
    headers: { apikey: SVCROL, Authorization: `Bearer ${SVCROL}` },
  });
  if (!r.ok && r.status !== 404) {
    throw new Error(`admin delete user ${r.status} ${await r.text()}`);
  }
}

const client = new pg.Client({
  host: env.PGHOST, port: +env.PGPORT, database: env.PGDATABASE,
  user: env.PGUSER, password: env.PGPASSWORD, ssl: { rejectUnauthorized: false },
});

const EMAIL = `wt3-cascade-${Date.now()}@example.com`;
const PASS  = 'WT3-test-password-9X!';
let userId;         // nulled after delete so finally doesn't re-delete
let capturedId;     // retained through the delete for post-delete queries

try {
  await client.connect();
  userId = await adminCreateUser(EMAIL, PASS);
  capturedId = userId;
  step('created test user', !!userId);

  // Seed 2 rows per table = 8 rows total
  for (const t of TABLES) {
    await client.query(`insert into ${t} (customer_id) values ($1), ($1)`, [userId]);
  }

  // Pre-delete: service-role pg (bypasses RLS) sees the seed + the profiles row
  for (const t of TABLES) {
    const r = await client.query(`select count(*)::int as n from ${t} where customer_id = $1`, [userId]);
    step(`pre-delete ${t} has 2 rows`, r.rows[0].n === 2, `got ${r.rows[0].n}`);
  }
  const profPre = await client.query(`select count(*)::int as n from profiles where id = $1`, [userId]);
  step('pre-delete profiles has the user', profPre.rows[0].n === 1, `got ${profPre.rows[0].n}`);

  // Delete the auth.users row — this triggers the cascade
  await adminDeleteUser(userId);
  userId = null;

  // Post-delete cascade assertions (query by the captured id)
  const auth = await client.query(`select count(*)::int as n from auth.users where id = $1`, [capturedId]);
  step('auth.users row gone', auth.rows[0].n === 0, `got ${auth.rows[0].n}`);

  const prof = await client.query(`select count(*)::int as n from profiles where id = $1`, [capturedId]);
  step('profiles row gone (cascade from auth.users)', prof.rows[0].n === 0, `got ${prof.rows[0].n}`);

  for (const t of TABLES) {
    const r = await client.query(`select count(*)::int as n from ${t} where customer_id = $1`, [capturedId]);
    step(`${t} empty for deleted user (cascade from profiles)`, r.rows[0].n === 0, `got ${r.rows[0].n}`);
  }
} catch (e) {
  failed = true;
  console.error('Test threw:', e.message);
} finally {
  if (userId) await adminDeleteUser(userId).catch(() => {});
  await client.end().catch(() => {});
}

if (failed) {
  console.error('\n❌ measurements cascade test failed');
  process.exit(1);
}
console.log('\n✅ cascade: auth.users → profiles → all 4 measurement tables');
