// WT-2 — sign in → /account.html → edit name/phone/newsletter → save → reload → assert persisted.
// Reads .env.local manually (project convention; dotenv isn't a dependency).
import fs from 'node:fs';
import puppeteer from 'puppeteer';
import { createClient } from '@supabase/supabase-js';

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8')
    .split('\n').filter(Boolean)
    .map(l => l.split('=').map(s => s.trim()))
    .map(([k, ...v]) => [k, v.join('=')])
);
const URL  = env.SUPABASE_URL;
const SVC  = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !SVC) { console.error('missing env'); process.exit(2); }
const admin = createClient(URL, SVC, { auth: { persistSession: false } });

const email = `wt2-account-${Date.now()}@example.com`;
const pw    = 'Correct-Horse-Battery-9!';

let failures = 0;
const must = (cond, msg) => { if (!cond) { console.error('✘', msg); failures++; } else console.log('✓', msg); };

const { data: created } =
  await admin.auth.admin.createUser({ email, password: pw, email_confirm: true,
    user_metadata: { full_name: 'Initial Name', opted_in_newsletter: false } });

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
const page    = await browser.newPage();
try {
  // sign in
  await page.goto('http://localhost:3000/login.html', { waitUntil: 'networkidle0' });
  await page.type('input[name="email"]', email);
  await page.type('input[name="password"]', pw);
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle0' }),
    page.click('button[type="submit"]'),
  ]);
  must(page.url().endsWith('/account.html'), `landed on /account.html → ${page.url()}`);

  // edit profile
  await page.waitForSelector('input[name="full_name"]', { visible: true });
  await page.$eval('input[name="full_name"]', el => { el.value = ''; });
  await page.type('input[name="full_name"]', 'Edited Name');
  await page.$eval('input[name="phone"]', el => { el.value = ''; });
  await page.type('input[name="phone"]', '+66 81 999 1234');
  const checked = await page.$eval('input[name="opted_in_newsletter"]', el => el.checked);
  if (!checked) await page.click('input[name="opted_in_newsletter"]');
  await page.click('#save-profile');
  await page.waitForSelector('#profile-saved:not([hidden])');
  must(true, 'save confirmation visible');

  // reload and assert
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('input[name="full_name"]', { visible: true });
  const fn = await page.$eval('input[name="full_name"]', el => el.value);
  const ph = await page.$eval('input[name="phone"]', el => el.value);
  const nl = await page.$eval('input[name="opted_in_newsletter"]', el => el.checked);
  must(fn === 'Edited Name', `full_name persisted → "${fn}"`);
  must(ph === '+66 81 999 1234', `phone persisted → "${ph}"`);
  must(nl === true, `opted_in_newsletter persisted → ${nl}`);
} finally {
  await browser.close();
  if (created?.user?.id) await admin.auth.admin.deleteUser(created.user.id);
}

if (failures) { console.error(`\n❌ ${failures} failure(s)`); process.exit(1); }
console.log('\n✅ test-account-profile-crud clean');
