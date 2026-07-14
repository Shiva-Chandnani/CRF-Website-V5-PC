// Task 10 — consolidated RLS audit across EVERY user-data table.
// Seeds two users (A, B) via the service-role admin API, signs in as each
// with the anon key, and proves owner-only isolation + write-locking for:
//   profiles, the 4 customer_* measurement tables (+ their v_latest_* views),
//   carts, orders, payments, newsletter_subscribers.
// Run twice in a row to confirm idempotency (unique emails + full teardown).

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

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const password = 'Test-Pass-123!';
const emailA = `rls-audit-a-${stamp}@test.countryroadfashions.com`;
const emailB = `rls-audit-b-${stamp}@test.countryroadfashions.com`;
const newsletterEmail = `rls-audit-nl-${stamp}@test.countryroadfashions.com`;

let failCount = 0;
function step(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? '  (' + detail + ')' : ''}`);
  if (!ok) failCount++;
}

// Number of rows a SELECT (or a write with a chained .select()) returned.
const rowsVisible = (res) => res.data?.length ?? 0;

// Write-lock PASS for a forge INSERT of a row the ATTACKER OWNS: the insert
// MUST carry a chained .select(). On a leak, the attacker's own SELECT policy
// returns the just-inserted row (length ≥ 1 → FAIL); on a block it errors or
// returns [] (→ PASS). Never call this on a bare write — data would be null
// and the check would pass vacuously.
const forgeBlocked = (res) => !!res.error || rowsVisible(res) === 0;

const MEASUREMENT_TABLES = [
  { table: 'customer_body_measurements', col: 'chest_in' },
  { table: 'customer_jacket_reference', col: 'collar_in' },
  { table: 'customer_shirt_reference', col: 'collar_in' },
  { table: 'customer_pants_reference', col: 'waist_in' },
];

const LATEST_VIEWS = [
  'v_latest_body_measurements',
  'v_latest_jacket_reference',
  'v_latest_shirt_reference',
  'v_latest_pants_reference',
];

function sampleOrderItems(price) {
  return [{
    item_type_id: 'formal-suit-2-piece',
    fabric_design_id: 'vbc-wool-grey-herringbone',
    unit_price_thb: price,
    qty: 1,
    line_total_thb: price,
    customizations: {},
  }];
}

let userA, userB, orderIdA, orderIdB;

try {
  // ── Seed two users ───────────────────────────────────────────────────
  const a = await admin.auth.admin.createUser({ email: emailA, password, email_confirm: true });
  if (a.error) throw new Error(`create A: ${a.error.message}`);
  userA = a.data.user;
  const b = await admin.auth.admin.createUser({ email: emailB, password, email_confirm: true });
  if (b.error) throw new Error(`create B: ${b.error.message}`);
  userB = b.data.user;
  step('created users A and B', !!userA && !!userB, `A=${userA?.id?.slice(0, 8)} B=${userB?.id?.slice(0, 8)}`);

  const anonA = createClient(URL, ANON, { auth: { persistSession: false } });
  const anonB = createClient(URL, ANON, { auth: { persistSession: false } });
  const siA = await anonA.auth.signInWithPassword({ email: emailA, password });
  if (siA.error) throw new Error(`sign in A: ${siA.error.message}`);
  const siB = await anonB.auth.signInWithPassword({ email: emailB, password });
  if (siB.error) throw new Error(`sign in B: ${siB.error.message}`);
  step('signed in as A and B', !!siA.data.session && !!siB.data.session);

  // ── 1. profiles ──────────────────────────────────────────────────────
  const profA = await anonA.from('profiles').select('id, email');
  step('profiles: A sees only own row', profA.data?.length === 1 && profA.data[0]?.id === userA.id, `len=${profA.data?.length}`);

  const profAFilteredB = await anonA.from('profiles').select('id').eq('id', userB.id);
  step('profiles: A filtered to B id → 0 rows', (profAFilteredB.data?.length ?? 0) === 0, `len=${profAFilteredB.data?.length}`);

  const updProfB = await anonA.from('profiles').update({ full_name: 'HACKED' }).eq('id', userB.id);
  const bFullNameAfter = (await admin.from('profiles').select('full_name').eq('id', userB.id).single()).data?.full_name;
  step('profiles: A cannot update B row',
    !!updProfB.error || bFullNameAfter !== 'HACKED',
    updProfB.error ? 'blocked' : `full_name=${bFullNameAfter}`);

  // ── 2. measurement tables (owner-only insert/select) ────────────────
  for (const { table, col } of MEASUREMENT_TABLES) {
    const insA = await anonA.from(table).insert({ customer_id: userA.id, [col]: 40 }).select('id').single();
    step(`${table}: A inserts own row`, !insA.error, insA.error?.message);
    const insB = await anonB.from(table).insert({ customer_id: userB.id, [col]: 42 }).select('id').single();
    step(`${table}: B inserts own row`, !insB.error, insB.error?.message);

    const aRows = await anonA.from(table).select('id, customer_id');
    step(`${table}: A sees only own row`, aRows.data?.length === 1 && aRows.data[0]?.customer_id === userA.id, `len=${aRows.data?.length}`);

    const aFilteredB = await anonA.from(table).select('id').eq('customer_id', userB.id);
    step(`${table}: A filtered to B customer_id → 0 rows`, (aFilteredB.data?.length ?? 0) === 0, `len=${aFilteredB.data?.length}`);
  }

  // ── 3. v_latest_* views — security_invoker leak guard ───────────────
  for (const v of LATEST_VIEWS) {
    const aView = await anonA.from(v).select('customer_id');
    step(`${v}: A sees only own latest row`, aView.data?.length === 1 && aView.data[0]?.customer_id === userA.id, `len=${aView.data?.length}`);

    const aViewFilteredB = await anonA.from(v).select('customer_id').eq('customer_id', userB.id);
    step(`${v}: A filtered to B customer_id → 0 rows`, (aViewFilteredB.data?.length ?? 0) === 0, `len=${aViewFilteredB.data?.length}`);
  }

  // ── 4. carts ─────────────────────────────────────────────────────────
  const upA = await anonA.from('carts').upsert(
    { user_id: userA.id, items: [], updated_at: new Date().toISOString() },
    { onConflict: 'user_id' });
  step('carts: A upserts own cart', !upA.error, upA.error?.message);
  const upB = await anonB.from('carts').upsert(
    { user_id: userB.id, items: [], updated_at: new Date().toISOString() },
    { onConflict: 'user_id' });
  step('carts: B upserts own cart', !upB.error, upB.error?.message);

  const cartsA = await anonA.from('carts').select('user_id');
  step('carts: A sees only own cart', cartsA.data?.length === 1 && cartsA.data[0]?.user_id === userA.id, `len=${cartsA.data?.length}`);

  const cartsAFilteredB = await anonA.from('carts').select('user_id').eq('user_id', userB.id);
  step('carts: A filtered to B user_id → 0 rows', (cartsAFilteredB.data?.length ?? 0) === 0, `len=${cartsAFilteredB.data?.length}`);

  // Cross-owner upsert: RETURNING is filtered by A's own SELECT policy, so a
  // successful malicious write would still return []. Prove the block via an
  // ADMIN readback of B's cart — it must be untouched by A's attempt.
  const badCartWrite = await anonA.from('carts').upsert(
    { user_id: userB.id, items: [{ forged: true }], updated_at: new Date().toISOString() },
    { onConflict: 'user_id' });
  const bCartAfter = (await admin.from('carts').select('items').eq('user_id', userB.id).single()).data?.items;
  const bCartUntouched = Array.isArray(bCartAfter) && bCartAfter.length === 0;
  step('carts: A cannot upsert B cart',
    !!badCartWrite.error || bCartUntouched,
    badCartWrite.error ? 'blocked' : `B.items=${JSON.stringify(bCartAfter)}`);

  // ── 5. orders — seeded by service role (mimics the Edge Function) ──
  const insOrdA = await admin.from('orders').insert({
    user_id: userA.id, status: 'pending', total_thb: 20000, items: sampleOrderItems(20000),
  }).select('id').single();
  step('orders: service_role inserts order A', !insOrdA.error, insOrdA.error?.message);
  orderIdA = insOrdA.data?.id;

  const insOrdB = await admin.from('orders').insert({
    user_id: userB.id, status: 'pending', total_thb: 15000, items: sampleOrderItems(15000),
  }).select('id').single();
  step('orders: service_role inserts order B', !insOrdB.error, insOrdB.error?.message);
  orderIdB = insOrdB.data?.id;

  const ordersA = await anonA.from('orders').select('id, user_id');
  step('orders: A sees only own order', ordersA.data?.length === 1 && ordersA.data[0]?.id === orderIdA, `len=${ordersA.data?.length}`);

  const ordersAFilteredB = await anonA.from('orders').select('id').eq('id', orderIdB);
  step('orders: A filtered to B order id → 0 rows', (ordersAFilteredB.data?.length ?? 0) === 0, `len=${ordersAFilteredB.data?.length}`);

  // Forge INSERT of an A-OWNED order: chain .select() so a leak (row created)
  // is visible to A's SELECT policy → length ≥ 1 → FAIL. Block → error/[] → PASS.
  const forgeOrder = await anonA.from('orders')
    .insert({ user_id: userA.id, status: 'pending', total_thb: 1, items: [] })
    .select('id');
  step('orders: client INSERT rejected (no policy)',
    forgeBlocked(forgeOrder),
    forgeOrder.error ? 'blocked' : `visible=${rowsVisible(forgeOrder)}`);

  const tamperOrder = await anonA.from('orders').update({ status: 'paid' }).eq('id', orderIdA);
  const stillPending = (await admin.from('orders').select('status').eq('id', orderIdA).single()).data?.status;
  step('orders: client UPDATE cannot flip status',
    !!tamperOrder.error || stillPending === 'pending',
    `status=${stillPending}`);

  // ── 6. payments — seeded by service role, joined via orders ────────
  const insPayA = await admin.from('payments').insert({
    order_id: orderIdA, stripe_event_id: `evt_audit_a_${stamp}`, amount_thb: 20000, status: 'succeeded',
  });
  step('payments: service_role inserts payment A', !insPayA.error, insPayA.error?.message);

  const insPayB = await admin.from('payments').insert({
    order_id: orderIdB, stripe_event_id: `evt_audit_b_${stamp}`, amount_thb: 15000, status: 'succeeded',
  });
  step('payments: service_role inserts payment B', !insPayB.error, insPayB.error?.message);

  const paymentsA = await anonA.from('payments').select('id, order_id');
  step('payments: A sees only own payment', paymentsA.data?.length === 1 && paymentsA.data[0]?.order_id === orderIdA, `len=${paymentsA.data?.length}`);

  const paymentsAFilteredB = await anonA.from('payments').select('id').eq('order_id', orderIdB);
  step('payments: A filtered to B order_id → 0 rows', (paymentsAFilteredB.data?.length ?? 0) === 0, `len=${paymentsAFilteredB.data?.length}`);

  // Forge INSERT against A's OWN order: A's join-based SELECT policy would
  // return the row on a leak, so .select() makes the check able to fail.
  const forgePayment = await anonA.from('payments')
    .insert({ order_id: orderIdA, stripe_event_id: `evt_audit_forge_${stamp}`, amount_thb: 1, status: 'succeeded' })
    .select('id');
  step('payments: client INSERT rejected (no policy)',
    forgeBlocked(forgePayment),
    forgePayment.error ? 'blocked' : `visible=${rowsVisible(forgePayment)}`);

  // ── 7. newsletter_subscribers — anon can insert only, no enumeration ─
  const anonAnon = createClient(URL, ANON, { auth: { persistSession: false } });

  const insNl = await anonAnon.from('newsletter_subscribers').insert({ email: newsletterEmail, source: 'footer' });
  step('newsletter: anon INSERT new email succeeds', !insNl.error, insNl.error?.message);

  const selNl = await anonAnon.from('newsletter_subscribers').select('email');
  step('newsletter: anon SELECT blocked (no enumeration)',
    !!selNl.error || (selNl.data?.length ?? 0) === 0,
    selNl.error ? 'blocked' : `len=${selNl.data?.length}`);

  const updNl = await anonAnon.from('newsletter_subscribers').update({ source: 'hacked' }).eq('email', newsletterEmail);
  const sourceAfter = (await admin.from('newsletter_subscribers').select('source').eq('email', newsletterEmail).single()).data?.source;
  step('newsletter: anon UPDATE blocked',
    !!updNl.error || sourceAfter === 'footer',
    `source=${sourceAfter}`);

  const insNlA = await admin.from('newsletter_subscribers').insert({ email: emailA, profile_id: userA.id, source: 'signup' });
  step('newsletter: admin seeds A row', !insNlA.error, insNlA.error?.message);

  const nlOwnA = await anonA.from('newsletter_subscribers').select('email').eq('email', emailA);
  step('newsletter: A sees own row', nlOwnA.data?.length === 1, `len=${nlOwnA.data?.length}`);

  const nlOtherA = await anonA.from('newsletter_subscribers').select('email').eq('email', newsletterEmail);
  step('newsletter: A filtered to other email → 0 rows', (nlOtherA.data?.length ?? 0) === 0, `len=${nlOtherA.data?.length}`);

  await anonA.auth.signOut().catch(() => {});
  await anonB.auth.signOut().catch(() => {});
} catch (e) {
  failCount++;
  console.error('threw:', e.message);
} finally {
  // Teardown — must run even on failure.
  // orders.user_id is ON DELETE SET NULL (not cascade), so orders must be
  // deleted explicitly; payments cascade from orders.
  if (orderIdA) await admin.from('orders').delete().eq('id', orderIdA).then(() => {}, () => {});
  if (orderIdB) await admin.from('orders').delete().eq('id', orderIdB).then(() => {}, () => {});
  // newsletter_subscribers.profile_id is ON DELETE SET NULL, so rows survive
  // user deletion and must be cleaned up explicitly.
  await admin.from('newsletter_subscribers').delete().eq('email', newsletterEmail).then(() => {}, () => {});
  await admin.from('newsletter_subscribers').delete().eq('email', emailA).then(() => {}, () => {});
  // Deleting auth.users cascades profiles → measurements/carts.
  if (userA) await admin.auth.admin.deleteUser(userA.id).catch(() => {});
  if (userB) await admin.auth.admin.deleteUser(userB.id).catch(() => {});
}

if (failCount > 0) {
  console.error(`\n❌ RLS audit failed: ${failCount} check(s) did not pass`);
  process.exit(1);
}
console.log('\n✅ RLS audit passed — owner-only isolation confirmed across all user-data tables');
