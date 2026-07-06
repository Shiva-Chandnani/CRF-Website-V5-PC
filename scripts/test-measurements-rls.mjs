// Phase 1 WT-3 RLS isolation test.
// Creates two users via service-role, seeds one row in EACH of the 4
// measurement tables for EACH user (8 rows total), then signs in as user A
// and confirms that user A's anon-key REST queries return only A's row
// (count = 1) for every table — never B's. Repeats from user B's session
// for symmetry. Cleans up both users at the end.

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

// ── service-role helpers ────────────────────────────────────────────────
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
async function userSelectCount(table, accessToken) {
  const r = await fetch(`${URL}/rest/v1/${table}?select=id`, {
    headers: { apikey: ANON, Authorization: `Bearer ${accessToken}` },
  });
  if (!r.ok) throw new Error(`select ${table} ${r.status} ${await r.text()}`);
  return (await r.json()).length;
}

// ── pg helper for direct seeding ───────────────────────────────────────
const client = new pg.Client({
  host: env.PGHOST, port: +env.PGPORT, database: env.PGDATABASE,
  user: env.PGUSER, password: env.PGPASSWORD, ssl: { rejectUnauthorized: false },
});

const STAMP = Date.now();
const EMAIL_A = `wt3-rls-a-${STAMP}@example.com`;
const EMAIL_B = `wt3-rls-b-${STAMP}@example.com`;
const PASS    = 'WT3-test-password-9X!';

let userA, userB;

try {
  await client.connect();

  // 1. Create both users (handle_new_user trigger inserts profiles rows)
  userA = await adminCreateUser(EMAIL_A, PASS);
  userB = await adminCreateUser(EMAIL_B, PASS);
  step('created two users', !!userA && !!userB, `A=${userA?.slice(0,8)} B=${userB?.slice(0,8)}`);

  // 2. Service-role seed: 1 row per user per table = 8 rows total
  for (const t of TABLES) {
    await client.query(`insert into ${t} (customer_id) values ($1), ($2)`, [userA, userB]);
  }
  step('seeded 1 row per user in each of 4 tables', true);

  // 3. Sign in as A; confirm SELECT returns exactly 1 row per table (only A's)
  const tokenA = await signIn(EMAIL_A, PASS);
  for (const t of TABLES) {
    const n = await userSelectCount(t, tokenA);
    step(`A sees only own row in ${t} (got ${n}, expected 1)`, n === 1);
  }

  // 4. Sign in as B; same check (symmetry)
  const tokenB = await signIn(EMAIL_B, PASS);
  for (const t of TABLES) {
    const n = await userSelectCount(t, tokenB);
    step(`B sees only own row in ${t} (got ${n}, expected 1)`, n === 1);
  }

  // 5. Cross-check via the v_latest_* views — RLS inherited
  for (const v of ['v_latest_body_measurements','v_latest_jacket_reference','v_latest_shirt_reference','v_latest_pants_reference']) {
    const n = await userSelectCount(v, tokenA);
    step(`A sees only own row in ${v} (got ${n}, expected 1)`, n === 1);
  }
} catch (e) {
  failed = true;
  console.error('Test threw:', e.message);
} finally {
  // Cleanup: deleting auth.users cascades to profiles → cascades to measurements
  if (userA) await adminDeleteUser(userA).catch(() => {});
  if (userB) await adminDeleteUser(userB).catch(() => {});
  await client.end().catch(() => {});
}

if (failed) {
  console.error('\n❌ measurements RLS test failed');
  process.exit(1);
}
console.log('\n✅ measurements RLS isolation passes (4 tables × 2 users + 4 views)');
