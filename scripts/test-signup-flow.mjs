// WT-2 — signup end-to-end against the CURRENT project config, where email
// confirmation is DISABLED (mailer_autoconfirm=true, set in WT-1). In that mode
// signUp() returns a live session, so signup.html signs the user in and lands
// them on /account.html. We also verify the handle_new_user trigger created the
// profile row + a newsletter row (opt-in), and that login.html's status banners
// render from their query params (used by the reset flow + the confirmation flow
// once confirmation is re-enabled before launch).
//
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

const email = `wt2-signup-${Date.now()}@example.com`;
const pw    = 'Correct-Horse-Battery-9!';
const name  = 'Signup Test';

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
const page    = await browser.newPage();
let failures  = 0;
const must    = (cond, msg) => { if (!cond) { console.error('✘', msg); failures++; } else console.log('✓', msg); };
let userId;

try {
  // 1. signup.html exists and the form posts
  const r1 = await page.goto('http://localhost:3000/signup.html', { waitUntil: 'networkidle0' });
  must(r1.status() === 200, `GET /signup.html → ${r1.status()}`);

  await page.type('input[name="full_name"]', name);
  await page.type('input[name="email"]', email);
  await page.type('input[name="password"]', pw);
  await page.click('input[name="opted_in_newsletter"]');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle0' }),
    page.click('button[type="submit"]'),
  ]);
  // Confirmation off → signed in → lands on /account.html
  must(page.url().endsWith('/account.html'), `signup lands signed-in on /account.html → ${page.url()}`);

  // 2. Trigger side effects: profile row + newsletter opt-in row
  const { data: list } = await admin.auth.admin.listUsers();
  const u = list.users.find(x => x.email === email);
  must(!!u, 'user row exists in auth.users');
  userId = u?.id;

  const { data: prof } = await admin.from('profiles').select('full_name, opted_in_newsletter').eq('id', userId).maybeSingle();
  must(prof?.full_name === name, `profile.full_name populated by trigger → "${prof?.full_name}"`);
  must(prof?.opted_in_newsletter === true, 'profile.opted_in_newsletter = true (checkbox honored)');

  const { data: news } = await admin.from('newsletter_subscribers').select('email, source').eq('email', email).maybeSingle();
  must(!!news, 'newsletter_subscribers row created on opt-in');
  must(news?.source === 'signup', `newsletter source = "signup" → "${news?.source}"`);

  // 3. login.html status banners render from query params (config-independent).
  //    Clear the persisted session first, else requireGuest() bounces us to /account.
  await page.evaluate(() => localStorage.clear());
  await page.goto('http://localhost:3000/login.html?check_email=1', { waitUntil: 'networkidle0' });
  const b1 = await page.$eval('[data-status="check_email"]', el => (el.hidden ? '' : el.textContent) || '');
  must(/email/i.test(b1), `check_email banner visible → "${b1.trim()}"`);

  await page.goto('http://localhost:3000/login.html?confirmed=1', { waitUntil: 'networkidle0' });
  const b2 = await page.$eval('[data-status="confirmed"]', el => (el.hidden ? '' : el.textContent) || '');
  must(/confirmed|verified/i.test(b2), `confirmed banner visible → "${b2.trim()}"`);

} finally {
  if (userId) await admin.auth.admin.deleteUser(userId).catch(() => {});
  // trigger set newsletter.profile_id → SET NULL on user delete; remove the row too.
  // (Supabase query builder is a thenable but has no .catch() — use try/catch.)
  try { await admin.from('newsletter_subscribers').delete().eq('email', email); } catch {}
  await browser.close();
}

if (failures) { console.error(`\n❌ ${failures} failure(s)`); process.exit(1); }
console.log('\n✅ test-signup-flow clean');
