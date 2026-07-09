// Phase 2 GOLD-STANDARD e2e: a real Stripe test-card purchase through the hosted
// Checkout page → webhook (via `stripe listen`) flips OUR order to paid + writes a
// payment + clears the cart. Requires: serve.mjs :3000, deployed functions, and
// `stripe listen --forward-to <deployed webhook>` running.
import puppeteer from 'puppeteer';
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8').split('\n').filter(Boolean)
    .map(l => l.split('=').map(s => s.trim())).map(([k, ...v]) => [k, v.join('=')]));
const URL = env.SUPABASE_URL, ANON = env.SUPABASE_ANON_KEY, SVC = env.SUPABASE_SERVICE_ROLE_KEY;
const admin = createClient(URL, SVC, { auth: { persistSession: false } });

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const email = `buy-${stamp}@example.test`, password = 'Test-Pass-123!';
let failed = false;
const step = (n, ok, d = '') => { console.log(`${ok ? '✔' : '✘'} ${n}${d ? '  — ' + d : ''}`); if (!ok) failed = true; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function typeInto(page, selectors, value) {
  for (const sel of selectors) {
    const el = await page.$(sel);
    if (el) { await el.click({ clickCount: 3 }).catch(() => {}); await el.type(value, { delay: 15 }); return true; }
  }
  return false;
}

let user, orderId, browser;
try {
  user = (await admin.auth.admin.createUser({ email, password, email_confirm: true })).data.user;
  await admin.from('carts').upsert({ user_id: user.id, updated_at: new Date().toISOString(),
    items: [{ id: 'x', item_type_id: 'formal-suit-2-piece', fabric_design_id: 'vbc-wool-grey-herringbone', price_thb: 20000, qty: 1, customizations: {}, added_at: new Date().toISOString() }] }, { onConflict: 'user_id' });

  // Sign in + create the checkout session via the deployed function (real Stripe URL + our order_id).
  const anon = createClient(URL, ANON, { auth: { persistSession: false } });
  const token = (await anon.auth.signInWithPassword({ email, password })).data.session.access_token;
  const res = await fetch(`${URL}/functions/v1/create-checkout-session`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${token}` }, body: '{}' });
  const { url, order_id } = await res.json();
  orderId = order_id;
  step('checkout session created', !!url && !!orderId, orderId);

  browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'networkidle0', timeout: 45000 });

  // This THB checkout offers multiple payment methods (PromptPay + Card) as an
  // accordion; the card fields only render once the "Card" item is opened.
  const cardBtn = await page.$('[data-testid="card-accordion-item-button"], #payment-method-accordion-item-title-card');
  if (cardBtn) await cardBtn.click();
  await page.waitForSelector('#cardNumber, input[name="cardNumber"]', { timeout: 15000 }).catch(() => {});

  // Fill the Stripe hosted checkout form (test card 4242…). Selectors are resilient
  // across Stripe's field id/name variants.
  await typeInto(page, ['#email', 'input[name="email"]'], email);
  await typeInto(page, ['#cardNumber', 'input[name="cardNumber"]'], '4242424242424242');
  await typeInto(page, ['#cardExpiry', 'input[name="cardExpiry"]'], '12' + String(new Date().getFullYear() + 2).slice(2));
  await typeInto(page, ['#cardCvc', 'input[name="cardCvc"]'], '123');
  await typeInto(page, ['#billingName', 'input[name="billingName"]'], 'Test Buyer');
  await typeInto(page, ['#billingPostalCode', 'input[name="billingPostalCode"]'], '10110');
  await sleep(400);
  const paid = await page.$('[data-testid="hosted-payment-submit-button"], .SubmitButton, button[type="submit"]');
  if (paid) await paid.click();
  step('submitted payment form', !!paid);

  // Wait for the webhook (via stripe listen) to flip the order to paid.
  let status = null;
  for (let i = 0; i < 25; i++) {
    await sleep(1200);
    status = (await admin.from('orders').select('status').eq('id', orderId).single()).data?.status;
    if (status === 'paid') break;
  }
  step('order marked paid by webhook', status === 'paid', `status=${status}`);
  const pay = (await admin.from('payments').select('amount_thb,status').eq('order_id', orderId)).data;
  step('payment recorded (20000 THB, succeeded)', pay?.length === 1 && pay[0].amount_thb === 20000 && pay[0].status === 'succeeded', JSON.stringify(pay));
  const cart = (await admin.from('carts').select('items').eq('user_id', user.id).single()).data;
  step('server cart cleared', Array.isArray(cart?.items) && cart.items.length === 0);

  if (failed) { await page.screenshot({ path: 'temporary screenshots/e2e-purchase-fail.png' }).catch(() => {}); }
} catch (e) { failed = true; console.error('threw:', e.message); }
finally {
  if (browser) await browser.close().catch(() => {});
  if (user) { await admin.from('orders').delete().eq('user_id', user.id).then(() => {}, () => {}); await admin.auth.admin.deleteUser(user.id).then(() => {}, () => {}); }
}
if (failed) { console.error('\n❌ purchase e2e failed'); process.exit(1); }
console.log('\n✅ REAL purchase → webhook → order paid + payment + cart cleared');
