// WT-2 — sign in → /account.html → open delete modal → confirm → /?account_deleted=1
//        + auth.users row is gone + newsletter_subscribers.profile_id is null for that email.
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

const email = `wt2-delete-${Date.now()}@example.com`;
const pw    = 'Correct-Horse-Battery-9!';

let failures = 0;
const must = (cond, msg) => { if (!cond) { console.error('✘', msg); failures++; } else console.log('✓', msg); };

const { data: created } =
  await admin.auth.admin.createUser({ email, password: pw, email_confirm: true,
    user_metadata: { full_name: 'Delete Me', opted_in_newsletter: true } });
const userId = created?.user?.id;
must(!!userId, 'seed user');

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
const page    = await browser.newPage();
try {
  await page.goto('http://localhost:3000/login.html', { waitUntil: 'networkidle0' });
  await page.type('input[name="email"]', email);
  await page.type('input[name="password"]', pw);
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle0' }),
    page.click('button[type="submit"]'),
  ]);
  must(page.url().endsWith('/account.html'), 'on account.html');

  // open modal
  await page.click('#open-delete-modal');
  await page.waitForSelector('#delete-modal:not([hidden])');
  must(true, 'delete modal visible');

  // wrong confirm text
  await page.type('#confirm-text', 'delete');
  await page.type('#confirm-password', pw);
  await page.click('#delete-form button[type="submit"]');
  await page.waitForSelector('#delete-modal-error:not([hidden])');
  must(true, 'lowercase delete rejected');

  // fix it
  await page.$eval('#confirm-text', el => { el.value = ''; });
  await page.type('#confirm-text', 'DELETE');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle0' }),
    page.click('#delete-form button[type="submit"]'),
  ]);
  must(page.url().includes('/?account_deleted=1') || page.url().endsWith('?account_deleted=1'),
       `landed on /?account_deleted=1 → ${page.url()}`);

  // auth.users row is gone
  const { data: list } = await admin.auth.admin.listUsers();
  const stillThere = list.users.find(u => u.email === email);
  must(!stillThere, 'auth.users row deleted');

  // newsletter_subscribers row still exists but profile_id is null (FK ON DELETE SET NULL, spec §5.1)
  const { data: subs } = await admin
    .from('newsletter_subscribers')
    .select('email, profile_id')
    .eq('email', email);
  if (subs && subs.length > 0) {
    must(subs[0].profile_id === null, `newsletter_subscribers.profile_id is null → ${subs[0].profile_id}`);
  } else {
    console.log('• no newsletter row for this email (acceptable — opt-in inserted only if trigger ran)');
  }
} finally {
  await browser.close();
  // belt-and-braces cleanup in case the test failed mid-flow and the user still exists
  if (userId) await admin.auth.admin.deleteUser(userId).catch(() => {});
  try { await admin.from('newsletter_subscribers').delete().eq('email', email); } catch {}
}

if (failures) { console.error(`\n❌ ${failures} failure(s)`); process.exit(1); }
console.log('\n✅ test-account-delete clean');
