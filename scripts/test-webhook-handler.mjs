// Phase 2: stripe-webhook marks the order paid, writes a payment, clears the
// cart, and is idempotent on replay. Uses the Stripe SDK to sign a fake event
// with the shared STRIPE_WEBHOOK_SECRET, POSTed directly to the deployed webhook
// (verify_jwt=false → publicly reachable, like a real Stripe delivery).
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import fs from 'node:fs';

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8')
    .split('\n').filter(Boolean)
    .map(l => l.split('=').map(s => s.trim()))
    .map(([k, ...v]) => [k, v.join('=')])
);

const URL   = env.SUPABASE_URL;
const SVC   = env.SUPABASE_SERVICE_ROLE_KEY;
const WHSEC = env.STRIPE_WEBHOOK_SECRET;
const FN    = env.FUNCTIONS_URL || `${URL}/functions/v1`;

const admin  = createClient(URL, SVC, { auth: { persistSession: false } });
const stripe = new Stripe('sk_test_dummy'); // only for generateTestHeaderString

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const password = 'Test-Pass-123!';

let failed = false;
function step(name, ok, detail = '') {
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) failed = true;
}

async function post(payloadObj) {
  const payload = JSON.stringify(payloadObj);
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret: WHSEC });
  const res = await fetch(`${FN}/stripe-webhook`, {
    method: 'POST',
    headers: { 'Stripe-Signature': header, 'Content-Type': 'application/json' },
    body: payload,
  });
  return { status: res.status, text: await res.text() };
}

let user, orderId;
try {
  user = (await admin.auth.admin.createUser({ email: `wh-${stamp}@example.test`, password, email_confirm: true })).data.user;
  await admin.from('carts').upsert({
    user_id: user.id,
    items: [{ item_type_id: 'formal-suit-2-piece', fabric_design_id: 'vbc-wool-grey-herringbone', price_thb: 20000, qty: 1, customizations: {} }],
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' });
  orderId = (await admin.from('orders').insert({ user_id: user.id, status: 'pending', total_thb: 20000, items: [] }).select('id').single()).data.id;

  const evtId = `evt_test_${stamp}`;
  const event = {
    id: evtId, object: 'event', type: 'checkout.session.completed',
    data: { object: {
      object: 'checkout.session', metadata: { order_id: orderId },
      payment_intent: `pi_${stamp}`, amount_total: 2000000, currency: 'thb', client_reference_id: user.id,
    } },
  };

  const badSig = await fetch(`${FN}/stripe-webhook`, { method: 'POST', headers: { 'Stripe-Signature': 't=1,v1=deadbeef' }, body: JSON.stringify(event) });
  step('bad signature rejected', badSig.status === 400, `status=${badSig.status}`);

  const r1 = await post(event);
  step('valid event accepted', r1.status === 200, r1.text);
  const o1 = (await admin.from('orders').select('status,stripe_payment_intent_id').eq('id', orderId).single()).data;
  step('order marked paid', o1?.status === 'paid', `status=${o1?.status}`);
  const pays = (await admin.from('payments').select('id,amount_thb').eq('order_id', orderId)).data;
  step('payment row written (20000 THB)', pays?.length === 1 && pays[0].amount_thb === 20000, JSON.stringify(pays));
  const cart = (await admin.from('carts').select('items').eq('user_id', user.id).single()).data;
  step('cart cleared', Array.isArray(cart?.items) && cart.items.length === 0);

  const r2 = await post(event); // replay
  step('replay is idempotent', r2.status === 200 && r2.text === 'duplicate', r2.text);
  const pays2 = (await admin.from('payments').select('id').eq('order_id', orderId)).data;
  step('no duplicate payment', pays2?.length === 1, `count=${pays2?.length}`);
} catch (e) {
  failed = true;
  console.error('threw:', e.message);
} finally {
  if (orderId) await admin.from('orders').delete().eq('id', orderId).then(() => {}, () => {});
  if (user) await admin.auth.admin.deleteUser(user.id).then(() => {}, () => {});
}

if (failed) { console.error('\n❌ webhook handler test failed'); process.exit(1); }
console.log('\n✅ webhook: paid + payment + cart clear, idempotent');
