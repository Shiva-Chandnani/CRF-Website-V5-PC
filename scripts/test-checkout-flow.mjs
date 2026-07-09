// Phase 2: signed-out checkout → login redirect; signed-in checkout → invoke
// returns a Stripe URL and the browser navigates to checkout.stripe.com.
// Requires serve.mjs on :3000 and the DEPLOYED create-checkout-session function.
import puppeteer from 'puppeteer';
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8')
    .split('\n').filter(Boolean)
    .map(l => l.split('=').map(s => s.trim()))
    .map(([k, ...v]) => [k, v.join('=')])
);
const URL = env.SUPABASE_URL, ANON = env.SUPABASE_ANON_KEY, SVC = env.SUPABASE_SERVICE_ROLE_KEY;
const admin = createClient(URL, SVC, { auth: { persistSession: false } });

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const password = 'Test-Pass-123!';
const email = `flow-${stamp}@example.test`;
let failed = false;
const step = (n, ok, d = '') => { console.log(`${ok ? '✔' : '✘'} ${n}${d ? '  — ' + d : ''}`); if (!ok) failed = true; };

const line = { item_type_id: 'formal-suit-2-piece', fabric_design_id: 'vbc-wool-grey-herringbone', price_thb: 20000, qty: 1, customizations: {} };

let user, browser;
try {
  user = (await admin.auth.admin.createUser({ email, password, email_confirm: true })).data.user;
  await admin.from('carts').upsert({ user_id: user.id, updated_at: new Date().toISOString(),
    items: [{ ...line, id: 'x', added_at: new Date().toISOString() }] }, { onConflict: 'user_id' });

  browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();

  // Signed-OUT: guest cart with an item → checkout bounces to /login.html
  await page.goto('http://localhost:3000/cart.html', { waitUntil: 'networkidle0' });
  await page.evaluate((l) => localStorage.setItem('crf.cart.v1', JSON.stringify({
    items: [{ id: 'x', ...l, added_at: new Date().toISOString() }], updated_at: new Date().toISOString(),
  })), line);
  await page.reload({ waitUntil: 'networkidle0' });
  await page.click('[data-checkout-button]');
  await page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {});
  step('signed-out → login redirect', page.url().includes('/login.html'), page.url());

  // Signed-IN: log in, then checkout → Stripe URL
  await page.goto('http://localhost:3000/login.html', { waitUntil: 'networkidle0' });
  await page.type('#email', email);
  await page.type('#password', password);
  await Promise.all([ page.waitForNavigation({ waitUntil: 'networkidle0' }).catch(() => {}), page.click('button[type="submit"]') ]);
  await page.goto('http://localhost:3000/cart.html', { waitUntil: 'networkidle0' });
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {}),
    page.click('[data-checkout-button]'),
  ]);
  step('signed-in → Stripe checkout', /checkout\.stripe\.com|stripe/.test(page.url()), page.url());
} catch (e) { failed = true; console.error('threw:', e.message); }
finally {
  if (browser) await browser.close().catch(() => {});
  if (user) {
    await admin.from('orders').delete().eq('user_id', user.id).then(() => {}, () => {});
    await admin.auth.admin.deleteUser(user.id).then(() => {}, () => {});
  }
}
if (failed) { console.error('\n❌ checkout flow test failed'); process.exit(1); }
console.log('\n✅ checkout flow: guest→login, signed-in→Stripe');
