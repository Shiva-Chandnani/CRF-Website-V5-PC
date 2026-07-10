// e2e: guest bounce, sub-nav switch, save round-trip, append-only, partial save.
// Reads .env.local manually (project convention; no dotenv). Admin createUser
// bypasses the reserved-domain blocklist, so @example.com is fine.
import fs from 'node:fs';
import puppeteer from 'puppeteer';
import { createClient } from '@supabase/supabase-js';

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8').split('\n').filter(Boolean)
    .map(l => l.split('=').map(s => s.trim())).map(([k, ...v]) => [k, v.join('=')])
);
const URL = env.SUPABASE_URL, SVC = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !SVC) { console.error('missing env'); process.exit(2); }
const admin = createClient(URL, SVC, { auth: { persistSession: false } });

const email = `measure-${Date.now()}@example.com`;
const pw = 'Correct-Horse-Battery-9!';
let failures = 0;
const must = (c, m) => { if (!c) { console.error('✘', m); failures++; } else console.log('✓', m); };

const { data: created } = await admin.auth.admin.createUser({ email, password: pw, email_confirm: true });
const uid = created?.user?.id;

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
try {
  // 1. Guest bounce
  await page.goto('http://localhost:3000/measurements.html', { waitUntil: 'networkidle0' });
  must(page.url().includes('/login.html'), `guest bounced to login → ${page.url()}`);

  // sign in
  await page.type('input[name="email"]', email);
  await page.type('input[name="password"]', pw);
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), page.click('button[type="submit"]')]);

  // 2. Load measurements page + wait for render
  await page.goto('http://localhost:3000/measurements.html#body', { waitUntil: 'networkidle0' });
  await page.waitForSelector('body[data-measurements-ready="1"]');
  await page.waitForSelector('#form-body input[name="chest_in"]', { visible: true });
  must(true, 'body form rendered');

  // empty state visible for a fresh user
  const emptyShown = await page.$eval('#empty-body', el => !el.hidden);
  must(emptyShown, 'empty-state note shown for fresh user');

  // 3. Fill a few body fields (partial save — most left blank) + notes, save
  await page.type('#form-body input[name="chest_in"]', '40.5');
  await page.type('#form-body input[name="shoulders_in"]', '18.25');
  await page.type('#form-body textarea[name="notes"]', 'left shoulder slightly lower');
  await page.click('#save-body');
  await page.waitForSelector('#status-body.measure-status--ok:not([hidden])');
  must(true, 'save confirmation shown');

  // 4. Reload → values persist (round-trip through v_latest view)
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('body[data-measurements-ready="1"]');
  await page.waitForSelector('#form-body input[name="chest_in"]');
  // give lazy prefill a tick
  await page.waitForFunction(() => document.querySelector('#form-body input[name="chest_in"]').value !== '');
  const chest = await page.$eval('#form-body input[name="chest_in"]', el => el.value);
  const notes = await page.$eval('#form-body textarea[name="notes"]', el => el.value);
  must(parseFloat(chest) === 40.5, `chest persisted → "${chest}"`);
  must(notes === 'left shoulder slightly lower', `notes persisted → "${notes}"`);

  // 5. Sub-nav switch to a reference kind renders its form
  await page.click('[data-kind-link="jacket_reference"]');
  await page.waitForSelector('#form-jacket_reference input[name="collar_in"]', { visible: true });
  const bodyHidden = await page.$eval('#panel-body', el => el.hidden);
  must(bodyHidden, 'switching kinds hides the body panel');

  // 6. Append-only: second body save creates a new row (2 rows total)
  await page.goto('http://localhost:3000/measurements.html#body', { waitUntil: 'networkidle0' });
  await page.waitForSelector('body[data-measurements-ready="1"]');
  await page.waitForFunction(() => document.querySelector('#form-body input[name="chest_in"]').value !== '');
  await page.$eval('#form-body input[name="chest_in"]', el => { el.value = ''; });
  await page.type('#form-body input[name="chest_in"]', '41');
  await page.click('#save-body');
  await page.waitForSelector('#status-body.measure-status--ok:not([hidden])');

  const { count } = await admin.from('customer_body_measurements')
    .select('id', { count: 'exact', head: true }).eq('customer_id', uid);
  must(count === 2, `append-only: 2 body rows after 2 saves → ${count}`);
} finally {
  await browser.close();
  if (uid) await admin.auth.admin.deleteUser(uid);   // cascade clears measurement rows
}

if (failures) { console.error(`\n❌ ${failures} failure(s)`); process.exit(1); }
console.log('\n✅ test-measurements-page clean');
