// Phase 2 end-to-end: offline-first cart sync across guest→login, reload,
// logout, cross-device pull, and handoff dedupe. Requires `node serve.mjs`
// running on :3000. Creates a throwaway user via the admin API.

import puppeteer from 'puppeteer';
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8')
    .split('\n').filter(Boolean)
    .map(l => l.split('=').map(s => s.trim()))
    .map(([k, ...v]) => [k, v.join('=')])
);
const URL  = env.SUPABASE_URL;
const SVC  = env.SUPABASE_SERVICE_ROLE_KEY;
const admin = createClient(URL, SVC, { auth: { persistSession: false } });

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
const email = `cart-e2e-${stamp}@example.test`;
const password = 'Test-Pass-123!';
const ORIGIN = 'http://localhost:3000';

let failed = false;
function step(name, ok, detail = '') {
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) failed = true;
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const LINE = {
  id: 'crfln_seed01',
  item_type_id: 'formal-suit-2-piece',
  fabric_design_id: 'vbc-wool-grey-herringbone',
  price_thb: 20000,
  qty: 1,
  customizations: { 'jacket-lapel': 'jacket-lapel-peak' },
  added_at: '2026-07-07T10:00:00.000Z',
};

async function serverItems(userId) {
  const { data } = await admin.from('carts').select('items').eq('user_id', userId).maybeSingle();
  return Array.isArray(data?.items) ? data.items : [];
}
// Sign in inside the page using the app's own auth module.
async function signIn(page) {
  return page.evaluate(async (email, password) => {
    const auth = await import('/js/auth.js');
    const r = await auth.signInWithPassword({ email, password });
    return !!r.data?.session;
  }, email, password);
}
async function signOut(page) {
  return page.evaluate(async () => { const a = await import('/js/auth.js'); await a.signOut(); });
}
const readLS = (page) => page.evaluate(() => localStorage.getItem('crf.cart.v1'));
const setLS  = (page, cart) => page.evaluate((c) => {
  localStorage.setItem('crf.cart.v1', c);
  localStorage.setItem('crf.cart.owner', 'guest');
}, JSON.stringify(cart));

// Each "device" gets an ISOLATED browser context so localStorage + the auth
// session don't bleed across scenarios (puppeteer pages in one context share
// storage per origin). puppeteer 24.x: createBrowserContext() (incognito API
// was removed).
async function freshDevice(browser) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.goto(`${ORIGIN}/index.html`, { waitUntil: 'networkidle0' });
  return { ctx, page };
}

let user, browser;
try {
  const u = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (u.error) throw new Error(`create user: ${u.error.message}`);
  user = u.data.user;

  browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });

  // --- Scenario A: guest cart merges to server on login (device 1) ---
  const dev1 = await freshDevice(browser);
  const page = dev1.page;
  await setLS(page, { items: [LINE], updated_at: '2026-07-07T10:00:00.000Z' });
  await page.reload({ waitUntil: 'networkidle0' });          // re-init cart-sync with guest cart present
  step('signed in via app auth', await signIn(page));
  await sleep(2500);                                          // reconcile pull+merge+push
  let items = await serverItems(user.id);
  step('A: guest cart pushed to server on login', items.length === 1 && items[0].fabric_design_id === LINE.fabric_design_id,
       `server items=${items.length}`);

  // --- Scenario B: reload keeps cart, no duplication ---
  await page.reload({ waitUntil: 'networkidle0' });
  await sleep(2000);
  const lsB = JSON.parse(await readLS(page) || '{"items":[]}');
  step('B: local cart intact after reload', lsB.items.length === 1, `local=${lsB.items.length}`);
  items = await serverItems(user.id);
  step('B: server not duplicated after reload', items.length === 1, `server=${items.length}`);

  // --- Scenario C: logout clears local, preserves server ---
  await signOut(page);
  await sleep(1200);
  const lsC = JSON.parse(await readLS(page) || '{"items":[]}');
  step('C: local cart cleared on logout', lsC.items.length === 0, `local=${lsC.items.length}`);
  items = await serverItems(user.id);
  step('C: server cart preserved after logout', items.length === 1, `server=${items.length}`);

  // --- Scenario D: fresh "device" pulls server cart on login (device 2) ---
  const dev2 = await freshDevice(browser);   // isolated: empty localStorage, no session
  const page2 = dev2.page;
  step('D: signed in on fresh device', await signIn(page2));
  await sleep(2500);
  const lsD = JSON.parse(await readLS(page2) || '{"items":[]}');
  step('D: server cart pulled to fresh device', lsD.items.length === 1, `local=${lsD.items.length}`);

  // --- Scenario E: handoff dedupe (same config guest-local + server, device 3) ---
  const dev3 = await freshDevice(browser);   // isolated guest with an identical line
  const page3 = dev3.page;
  await setLS(page3, { items: [{ ...LINE, id: 'crfln_local9', qty: 1 }], updated_at: '2026-07-07T11:00:00.000Z' });
  await page3.reload({ waitUntil: 'networkidle0' });
  step('E: signed in for dedupe check', await signIn(page3));
  await sleep(2500);
  items = await serverItems(user.id);
  const deduped = items.length === 1 && items[0].qty === 2;
  step('E: identical guest+server line deduped to one, qty summed', deduped,
       `items=${items.length} qty=${items[0]?.qty}`);

} catch (e) {
  failed = true;
  console.error('Test threw:', e.message);
} finally {
  if (browser) await browser.close();
  if (user) await admin.auth.admin.deleteUser(user.id).catch(() => {});
}

if (failed) { console.error('\n❌ cart dual-mode e2e failed'); process.exit(1); }
console.log('\n✅ cart dual-mode: guest→login merge, reload, logout, cross-device, dedupe');
