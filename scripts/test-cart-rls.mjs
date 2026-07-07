// Phase 2 verification: carts RLS isolates one user's cart from another's,
// and the row cascades when the profile is deleted.
// 1. Create user A + user B via the service-role admin API (auto-confirmed).
// 2. Sign in as each with the anon key; each upserts their own carts row.
// 3. Assert A sees exactly A's cart, cannot see or write B's.
// 4. Delete A's auth user → assert A's carts row is gone (cascade).

import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8')
    .split('\n').filter(Boolean)
    .map(l => l.split('=').map(s => s.trim()))
    .map(([k, ...v]) => [k, v.join('=')])
);

const URL  = env.SUPABASE_URL;
const ANON = env.SUPABASE_ANON_KEY;
const SVC  = env.SUPABASE_SERVICE_ROLE_KEY;

const admin = createClient(URL, SVC, { auth: { persistSession: false } });

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
const emailA = `cart-a-${stamp}@example.test`;
const emailB = `cart-b-${stamp}@example.test`;
const password = 'Test-Pass-123!';

let failed = false;
function step(name, ok, detail = '') {
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) failed = true;
}

const sampleItem = (design) => ({
  id: 'crfln_' + Math.random().toString(36).slice(2, 10),
  item_type_id: 'formal-suit-2-piece',
  fabric_design_id: design,
  price_thb: 20000,
  qty: 1,
  customizations: { 'jacket-lapel': 'jacket-lapel-notch' },
  added_at: new Date().toISOString(),
});

let userA, userB;
try {
  const a = await admin.auth.admin.createUser({ email: emailA, password, email_confirm: true });
  if (a.error) throw new Error(`create A: ${a.error.message}`);
  userA = a.data.user;
  const b = await admin.auth.admin.createUser({ email: emailB, password, email_confirm: true });
  if (b.error) throw new Error(`create B: ${b.error.message}`);
  userB = b.data.user;

  const anonA = createClient(URL, ANON, { auth: { persistSession: false } });
  const anonB = createClient(URL, ANON, { auth: { persistSession: false } });
  const si = await anonA.auth.signInWithPassword({ email: emailA, password });
  if (si.error) throw new Error(`sign in A: ${si.error.message}`);
  const sib = await anonB.auth.signInWithPassword({ email: emailB, password });
  if (sib.error) throw new Error(`sign in B: ${sib.error.message}`);

  // Each user upserts their own cart
  const upA = await anonA.from('carts').upsert(
    { user_id: userA.id, items: [sampleItem('vbc-wool-grey-herringbone')], updated_at: new Date().toISOString() },
    { onConflict: 'user_id' });
  step('A upsert own cart', !upA.error, upA.error?.message);
  const upB = await anonB.from('carts').upsert(
    { user_id: userB.id, items: [sampleItem('cavani-wool-navy-pinstripe')], updated_at: new Date().toISOString() },
    { onConflict: 'user_id' });
  step('B upsert own cart', !upB.error, upB.error?.message);

  // A selects carts → exactly one row (own)
  const { data: visible, error: selErr } = await anonA.from('carts').select('user_id, items');
  step('A select carts succeeded', !selErr, selErr?.message);
  step('A sees exactly one cart (own)', visible?.length === 1, `len=${visible?.length}`);
  step('A sees own user_id', visible?.[0]?.user_id === userA.id);

  // A cannot write B's cart (RLS with-check on user_id)
  const badWrite = await anonA.from('carts').upsert(
    { user_id: userB.id, items: [], updated_at: new Date().toISOString() },
    { onConflict: 'user_id' });
  step('A cannot upsert B cart (RLS blocks)', !!badWrite.error, badWrite.error ? 'blocked' : 'LEAK');

  // A cannot read B's cart (RLS select filter, explicit cross-user probe)
  const { data: probeB } = await anonA.from('carts').select('user_id').eq('user_id', userB.id);
  step('A SELECT WHERE user_id=B → empty', (probeB?.length ?? 0) === 0);

  // Cascade: delete A's auth user → A's carts row gone
  await admin.auth.admin.deleteUser(userA.id);
  userA = null;
  const { data: gone } = await admin.from('carts').select('user_id').eq('user_id', si.data.user.id);
  step('A cart cascaded on profile delete', (gone?.length ?? 0) === 0, `remaining=${gone?.length ?? 0}`);

  await anonA.auth.signOut().catch(() => {});
  await anonB.auth.signOut().catch(() => {});
} catch (e) {
  failed = true;
  console.error('Test threw:', e.message);
} finally {
  if (userA) await admin.auth.admin.deleteUser(userA.id).catch(() => {});
  if (userB) await admin.auth.admin.deleteUser(userB.id).catch(() => {});
}

if (failed) { console.error('\n❌ carts RLS test failed'); process.exit(1); }
console.log('\n✅ carts RLS isolates users + cascades');
