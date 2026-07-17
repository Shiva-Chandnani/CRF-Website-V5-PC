// Phase 5 e2e: non-staff is bounced from admin pages; staff sees the list,
// search filters, detail loads, and a note + tag round-trip in the UI.
import puppeteer from 'puppeteer';
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8').split('\n').filter(Boolean)
    .map(l => l.split('=').map(s => s.trim())).map(([k, ...v]) => [k, v.join('=')])
);
const URL = env.SUPABASE_URL, ANON = env.SUPABASE_ANON_KEY, SVC = env.SUPABASE_SERVICE_ROLE_KEY;
const BASE = 'http://localhost:3000';
const admin = createClient(URL, SVC, { auth: { persistSession: false } });
let failCount = 0;
const step = (n, ok, d = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} — ${n}${d ? '  (' + d + ')' : ''}`); if (!ok) failCount++; };
const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, pw = 'Test-Pass-123!';
const staffEmail = `admin-pg-staff-${stamp}@test.countryroadfashions.com`;
const custEmail = `admin-pg-cust-${stamp}@test.countryroadfashions.com`;

async function mkUser(email, role) {
  const { data, error } = await admin.auth.admin.createUser({ email, password: pw, email_confirm: true });
  if (error) throw error;
  if (role !== 'customer') await admin.from('profiles').update({ role }).eq('id', data.user.id);
  return data.user.id;
}
const idStaff = await mkUser(staffEmail, 'staff');
const idCust = await mkUser(custEmail, 'customer');
await admin.from('profiles').update({ full_name: `Zed Test ${stamp}` }).eq('id', idCust);

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });

async function loginAs(page, email) {
  // Sign in via the browser client and persist the session the app reads.
  await page.goto(`${BASE}/login.html`, { waitUntil: 'networkidle0' });
  await page.evaluate(async (email, pw, URL, ANON) => {
    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
    const c = createClient(URL, ANON);
    await c.auth.signInWithPassword({ email, password: pw });
  }, email, pw, URL, ANON);
}

async function loginViaForm(page, email) {
  // Fallback: drive the real login form so the app's own Supabase client
  // (not an esm.sh instance created inside page.evaluate) persists the
  // session to localStorage — avoids any client-instance/session mismatch.
  await page.goto(`${BASE}/login.html`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#email', { timeout: 8000 });
  await page.type('#email', email);
  await page.type('#password', pw);
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 10000 }).catch(() => {}),
    page.click('button[type=submit]'),
  ]);
}

// 1. customer is bounced from admin-customers
{
  const page = await browser.newPage();
  await loginAs(page, custEmail);
  await page.goto(`${BASE}/admin-customers.html`, { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 800));
  step('customer bounced from admin-customers', !page.url().includes('admin-customers'), page.url());
  await page.close();
}

// 2. staff sees the list, can search, open detail, add note + tag
{
  const page = await browser.newPage();
  await loginAs(page, staffEmail);
  await page.goto(`${BASE}/admin-customers.html`, { waitUntil: 'networkidle0' });
  let sawTable = await page.$('.crm-table', { timeout: 8000 }).catch(() => null);
  if (!sawTable || page.url().includes('login.html')) {
    // esm.sh-instantiated client's session wasn't visible to the page's own
    // client — fall back to signing in through the real login form.
    await loginViaForm(page, staffEmail);
    await page.goto(`${BASE}/admin-customers.html`, { waitUntil: 'networkidle0' });
  }
  await page.waitForSelector('.crm-table', { timeout: 8000 });
  step('staff sees customer table', await page.$('.crm-table') !== null);
  await page.type('#search', `Zed Test ${stamp}`);
  await new Promise(r => setTimeout(r, 700));
  const rowCount = await page.$$eval('tr[data-id]', els => els.length);
  step('search filters to the seeded customer', rowCount >= 1, `rows=${rowCount}`);

  await page.goto(`${BASE}/admin-customer.html?id=${idCust}`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#tagForm', { timeout: 8000 });
  await page.type('#tagInput', 'vip');
  await page.click('#tagForm button[type=submit]');
  await new Promise(r => setTimeout(r, 700));
  step('tag added + shown', (await page.$$eval('.cd-tag', els => els.map(e => e.textContent))).some(t => t.includes('vip')));

  await page.type('#noteInput', 'Called about wedding suit');
  await page.click('#noteForm button[type=submit]');
  await new Promise(r => setTimeout(r, 700));
  step('note added + shown', (await page.$eval('#notes', el => el.textContent)).includes('wedding suit'));
  await page.close();
}

await browser.close();
for (const id of [idStaff, idCust]) await admin.auth.admin.deleteUser(id);
console.log(failCount ? `\nFAIL — ${failCount} check(s)` : '\nPASS — all checks');
process.exit(failCount ? 1 : 0);
