// WT-1 verification: profiles RLS isolates one user from another.
// 1. Create user A + user B via the service-role admin API (auto-confirmed).
// 2. The handle_new_user trigger auto-inserts a profiles row for each.
// 3. Sign in as A using the anon key, SELECT from profiles, assert exactly
//    one row returned (A's own) and that A cannot see B.
// 4. Clean up both users (cascade removes their profiles rows).

import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8')
    .split('\n').filter(Boolean)
    .map(l => l.split('=').map(s => s.trim()))
    .map(([k, ...v]) => [k, v.join('=')])
);

const URL   = env.SUPABASE_URL;
const ANON  = env.SUPABASE_ANON_KEY;
const SVC   = env.SUPABASE_SERVICE_ROLE_KEY;

const admin = createClient(URL, SVC, { auth: { persistSession: false } });

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
const emailA = `rls-a-${stamp}@example.test`;
const emailB = `rls-b-${stamp}@example.test`;
const password = 'Test-Pass-123!';

let failed = false;
function step(name, ok, detail = '') {
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) failed = true;
}

let userA, userB;

try {
  // Create both users
  const a = await admin.auth.admin.createUser({ email: emailA, password, email_confirm: true });
  if (a.error) throw new Error(`create A: ${a.error.message}`);
  userA = a.data.user;
  const b = await admin.auth.admin.createUser({ email: emailB, password, email_confirm: true });
  if (b.error) throw new Error(`create B: ${b.error.message}`);
  userB = b.data.user;

  // Trigger should have created both profiles
  const { data: bothProfiles } = await admin.from('profiles').select('id,email').in('id', [userA.id, userB.id]);
  step('trigger created both profiles', bothProfiles?.length === 2,
       `found ${bothProfiles?.length ?? 0}`);

  // Sign in as A with the anon client
  const anonA = createClient(URL, ANON, { auth: { persistSession: false } });
  const signIn = await anonA.auth.signInWithPassword({ email: emailA, password });
  if (signIn.error) throw new Error(`sign in A: ${signIn.error.message}`);
  step('A signed in', !!signIn.data.session);

  // A selects from profiles: must see exactly A's row
  const { data: visible, error: selErr } = await anonA.from('profiles').select('id,email');
  step('A select profiles succeeded', !selErr, selErr?.message);
  step('A sees exactly one row (own)', visible?.length === 1, `len=${visible?.length}`);
  step('A sees row id === A.id', visible?.[0]?.id === userA.id);
  step('A cannot see B', !visible?.some(r => r.id === userB.id));

  // Direct probe for B by id: must return empty
  const { data: probeB } = await anonA.from('profiles').select('id').eq('id', userB.id);
  step('A SELECT WHERE id=B → empty', (probeB?.length ?? 0) === 0);

  await anonA.auth.signOut();
} catch (e) {
  failed = true;
  console.error('Test threw:', e.message);
} finally {
  if (userA) await admin.auth.admin.deleteUser(userA.id).catch(() => {});
  if (userB) await admin.auth.admin.deleteUser(userB.id).catch(() => {});
}

if (failed) {
  console.error('\n❌ profile RLS test failed');
  process.exit(1);
}
console.log('\n✅ profile RLS isolates users');
