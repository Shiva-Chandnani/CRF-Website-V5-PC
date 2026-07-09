// Phase 2: create-checkout-session ignores the client cart price and re-prices
// server-side; rejects empty carts + unauthenticated callers.
// Runs against the deployed Edge Function (no local Docker runtime available).
// Override the endpoint with FUNCTIONS_URL=... if needed.
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
const FN   = env.FUNCTIONS_URL || `${URL}/functions/v1`;

const admin = createClient(URL, SVC, { auth: { persistSession: false } });

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const password = 'Test-Pass-123!';

let failed = false;
function step(name, ok, detail = '') {
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) failed = true;
}

async function invoke(token, path = 'create-checkout-session') {
  const res = await fetch(`${FN}/${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: ANON,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: '{}',
  });
  let body = null;
  try { body = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, body };
}

let user;
try {
  // Unauthenticated → 401
  const noauth = await invoke(null);
  step('unauthenticated rejected', noauth.status === 401, `status=${noauth.status}`);

  user = (await admin.auth.admin.createUser({ email: `co-${stamp}@example.test`, password, email_confirm: true })).data.user;
  const anon = createClient(URL, ANON, { auth: { persistSession: false } });
  const { data: sess } = await anon.auth.signInWithPassword({ email: `co-${stamp}@example.test`, password });
  const token = sess.session.access_token;

  // Empty cart → 400 cart_empty
  const empty = await invoke(token);
  step('empty cart rejected', empty.status === 400 && empty.body?.error === 'cart_empty', JSON.stringify(empty.body));

  // TAMPERED price: client says 1 THB, catalogue is 20000.
  await admin.from('carts').upsert({
    user_id: user.id, updated_at: new Date().toISOString(),
    items: [{
      id: 'crfln_x', item_type_id: 'formal-suit-2-piece', fabric_design_id: 'vbc-wool-grey-herringbone',
      price_thb: 1, qty: 1, customizations: {}, added_at: new Date().toISOString(),
    }],
  }, { onConflict: 'user_id' });

  const ok = await invoke(token);
  step('session created', ok.status === 200 && !!ok.body?.url, JSON.stringify(ok.body));

  const { data: order } = await admin.from('orders').select('total_thb,items,status').eq('id', ok.body.order_id).single();
  step('server re-priced (ignored client 1 THB)', order?.total_thb === 20000, `total=${order?.total_thb}`);
  step('order starts pending', order?.status === 'pending');

  // cleanup the order created by the successful call
  if (ok.body?.order_id) await admin.from('orders').delete().eq('id', ok.body.order_id).then(() => {}, () => {});
} catch (e) {
  failed = true;
  console.error('threw:', e.message);
} finally {
  if (user) await admin.auth.admin.deleteUser(user.id).then(() => {}, () => {});
}

if (failed) { console.error('\n❌ price-resolution test failed'); process.exit(1); }
console.log('\n✅ create-checkout-session re-prices server-side + guards auth/empty');
