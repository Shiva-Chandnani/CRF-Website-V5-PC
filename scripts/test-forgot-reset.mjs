// WT-2 — forgot → admin-fetched recovery link → reset-password.html → new
// password → sign in. Uses admin.generateLink so the test does not depend on
// email delivery (the built-in mailer is rate-limited).
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
const ANON = env.SUPABASE_ANON_KEY;
if (!URL || !SVC || !ANON) { console.error('missing env'); process.exit(2); }

const admin = createClient(URL, SVC, { auth: { persistSession: false } });
const anon  = createClient(URL, ANON, { auth: { persistSession: false } });

const email  = `wt2-reset-${Date.now()}@example.com`;
const oldPw  = 'Old-Pass-Word-9!';
const newPw  = 'New-Pass-Word-9!';

let failures = 0;
const must = (cond, msg) => { if (!cond) { console.error('✘', msg); failures++; } else console.log('✓', msg); };

const { data: created, error: cErr } =
  await admin.auth.admin.createUser({ email, password: oldPw, email_confirm: true });
must(!cErr && created?.user?.id, `seed user → ${cErr?.message || 'ok'}`);

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();

try {
  // 1. submit forgot form → constant-time banner
  await page.goto('http://localhost:3000/forgot-password.html', { waitUntil: 'networkidle0' });
  await page.type('input[name="email"]', email);
  await page.click('button[type="submit"]');
  await page.waitForSelector('[data-status="sent"]:not([hidden])', { timeout: 10000 });
  must(true, 'forgot-password constant-time banner shown');

  // 2. Fetch a real recovery link via admin API (does not send an email).
  const { data: link, error: lErr } = await admin.auth.admin.generateLink({
    type: 'recovery',
    email,
    options: { redirectTo: 'http://localhost:3000/reset-password.html' },
  });
  must(!lErr && link?.properties?.action_link, `generateLink → ${lErr?.message || 'ok'}`);
  const actionLink = link.properties.action_link;

  // 3. Visit the recovery link → Supabase verify endpoint redirects to
  //    reset-password.html with the recovery token; auth.js creates a session.
  await page.goto(actionLink, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => location.pathname.endsWith('/reset-password.html'), { timeout: 15000 });
  await page.waitForSelector('input[name="password"]', { visible: true });
  await page.type('input[name="password"]', newPw);
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle0' }),
    page.click('button[type="submit"]'),
  ]);
  must(page.url().includes('/login.html?reset=1'), `final landing → ${page.url()}`);

  // 4. Sign in with the new password via the anon client to prove it really changed.
  const { data: sess, error: sErr } = await anon.auth.signInWithPassword({ email, password: newPw });
  must(!sErr && sess?.session, `sign in with new password → ${sErr?.message || 'ok'}`);
} finally {
  await browser.close();
  if (created?.user?.id) await admin.auth.admin.deleteUser(created.user.id);
}

if (failures) { console.error(`\n❌ ${failures} failure(s)`); process.exit(1); }
console.log('\n✅ test-forgot-reset clean');
