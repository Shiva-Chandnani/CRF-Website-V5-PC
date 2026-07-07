// WT-2 — Two guard rules:
//   1. signed-out visit to /account.html  → /login.html?next=/account.html
//   2. signed-in  visit to /login.html    → /account.html
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
const URL = env.SUPABASE_URL;
const SVC = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !SVC) { console.error('missing env'); process.exit(2); }
const admin = createClient(URL, SVC, { auth: { persistSession: false } });

const email = `wt2-guards-${Date.now()}@example.com`;
const pw    = 'Correct-Horse-Battery-9!';

let failures = 0;
const must = (cond, msg) => { if (!cond) { console.error('✘', msg); failures++; } else console.log('✓', msg); };

const { data: created } =
  await admin.auth.admin.createUser({ email, password: pw, email_confirm: true });

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
const page    = await browser.newPage();
try {
  // 1. signed-out → /account.html → /login.html?next=/account.html
  await page.goto('http://localhost:3000/account.html', { waitUntil: 'networkidle0' });
  must(/\/login\.html\?.*next=%2Faccount\.html/.test(page.url()) ||
       page.url().endsWith('/login.html?next=/account.html'),
       `signed-out account → ${page.url()}`);

  // 2. sign in via the form on the redirected page
  await page.type('input[name="email"]', email);
  await page.type('input[name="password"]', pw);
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle0' }),
    page.click('button[type="submit"]'),
  ]);
  must(page.url().endsWith('/account.html'), `?next= honored → ${page.url()}`);

  // 3. signed-in visit to /login.html → /account.html
  await page.goto('http://localhost:3000/login.html', { waitUntil: 'networkidle0' });
  must(page.url().endsWith('/account.html'), `signed-in login → ${page.url()}`);
} finally {
  await browser.close();
  if (created?.user?.id) await admin.auth.admin.deleteUser(created.user.id);
}

if (failures) { console.error(`\n❌ ${failures} failure(s)`); process.exit(1); }
console.log('\n✅ test-route-guards clean');
