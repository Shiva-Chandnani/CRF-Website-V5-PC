// Phase 2 verification: orders/payments are owner-read-only and clients cannot write them.
// 1. Create users A + B (admin API, auto-confirmed).
// 2. Insert an order for A via service_role (simulating the Edge Function).
// 3. Assert A can SELECT it, B cannot, and neither can INSERT/UPDATE an order.
// 4. Insert a payment for A's order; assert same isolation via the join policy.
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
const password = 'Test-Pass-123!';

let failed = false;
function step(name, ok, detail = '') {
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) failed = true;
}

let userA, userB, orderId;
try {
  userA = (await admin.auth.admin.createUser({ email: `ord-a-${stamp}@example.test`, password, email_confirm: true })).data.user;
  userB = (await admin.auth.admin.createUser({ email: `ord-b-${stamp}@example.test`, password, email_confirm: true })).data.user;

  // Edge Function role: service_role inserts A's order.
  const ins = await admin.from('orders').insert({
    user_id: userA.id, status: 'pending', total_thb: 20000,
    items: [{ item_type_id: 'formal-suit-2-piece', fabric_design_id: 'vbc-wool-grey-herringbone', unit_price_thb: 20000, qty: 1, line_total_thb: 20000, customizations: {} }],
  }).select('id').single();
  step('service_role inserts order', !ins.error, ins.error?.message);
  if (ins.error) throw new Error(`order insert: ${ins.error.message}`);
  orderId = ins.data?.id;

  const pay = await admin.from('payments').insert({
    order_id: orderId, stripe_event_id: `evt_test_${stamp}`, amount_thb: 20000, status: 'succeeded',
  });
  step('service_role inserts payment', !pay.error, pay.error?.message);

  // Webhook idempotency guard: a second payment with the SAME stripe_event_id
  // must be rejected by the UNIQUE constraint.
  const dupPay = await admin.from('payments').insert({
    order_id: orderId, stripe_event_id: `evt_test_${stamp}`, amount_thb: 1, status: 'succeeded',
  });
  step('duplicate stripe_event_id rejected', !!dupPay.error, dupPay.error ? 'blocked' : 'LEAK');

  const anonA = createClient(URL, ANON, { auth: { persistSession: false } });
  const anonB = createClient(URL, ANON, { auth: { persistSession: false } });
  await anonA.auth.signInWithPassword({ email: `ord-a-${stamp}@example.test`, password });
  await anonB.auth.signInWithPassword({ email: `ord-b-${stamp}@example.test`, password });

  const aSees = await anonA.from('orders').select('id').eq('id', orderId);
  step('A sees own order', aSees.data?.length === 1, `len=${aSees.data?.length}`);
  const bSees = await anonB.from('orders').select('id').eq('id', orderId);
  step('B cannot see A order', (bSees.data?.length ?? 0) === 0);
  const aPay = await anonA.from('payments').select('id').eq('order_id', orderId);
  step('A sees own payment', aPay.data?.length === 1);
  const bPay = await anonB.from('payments').select('id').eq('order_id', orderId);
  step('B cannot see A payment', (bPay.data?.length ?? 0) === 0);

  const forge = await anonB.from('orders').insert({ user_id: userB.id, status: 'paid', total_thb: 1, items: [] });
  step('client INSERT blocked (no policy)', !!forge.error, forge.error ? 'blocked' : 'LEAK');
  const tamper = await anonA.from('orders').update({ status: 'paid' }).eq('id', orderId);
  const stillPending = (await admin.from('orders').select('status').eq('id', orderId).single()).data?.status;
  step('client UPDATE cannot flip status', stillPending === 'pending', `status=${stillPending}`);
} catch (e) { failed = true; console.error('threw:', e.message); }
finally {
  if (orderId) await admin.from('orders').delete().eq('id', orderId).then(() => {}, () => {});
  if (userA) await admin.auth.admin.deleteUser(userA.id).then(() => {}, () => {});
  if (userB) await admin.auth.admin.deleteUser(userB.id).then(() => {}, () => {});
}
if (failed) { console.error('\n❌ orders RLS test failed'); process.exit(1); }
console.log('\n✅ orders/payments owner-read-only + write-locked');
