// WT-1 visual + behavioural: header [data-account-link] href + data-state
// flip with auth state. Two screenshots saved to ./temporary screenshots/.
//
// We import js/auth.js via the homepage (which loads it through a tiny
// inline <script type=module> hook we add for the test). Since the spec
// puts the auto-mount inside js/auth.js itself, any page that loads the
// module gets the swap for free. For this test we load auth.js by
// injecting it after the page navigates.

import puppeteer from 'puppeteer';
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8')
    .split('\n').filter(Boolean)
    .map(l => l.split('=').map(s => s.trim()))
    .map(([k, ...v]) => [k, v.join('=')])
);
const URL = env.SUPABASE_URL;
const SVC = env.SUPABASE_SERVICE_ROLE_KEY;
const admin = createClient(URL, SVC, { auth: { persistSession: false } });

const dir = path.join(process.cwd(), 'temporary screenshots');
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
function nextShot(label) {
  const existing = fs.readdirSync(dir).filter(f => f.endsWith('.png'));
  const nums = existing.map(f => parseInt(f.match(/screenshot-(\d+)/)?.[1] || '0')).filter(Boolean);
  const next = nums.length ? Math.max(...nums) + 1 : 1;
  return path.join(dir, `screenshot-${next}-${label}.png`);
}

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
const email = `headerswap-${stamp}@example.test`;
const password = 'Test-Pass-123!';

let failed = false;
function step(name, ok, detail = '') {
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) failed = true;
}

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });

let userId;

async function loadHomeWithAuth() {
  await page.goto('http://localhost:3000/index.html', { waitUntil: 'networkidle0', timeout: 30000 });
  await page.evaluate(() => new Promise(resolve => {
    if (document.querySelector('[data-account-link]')) return resolve();
    document.addEventListener('crf:layout-ready', () => resolve(), { once: true });
  }));
  // Inject js/auth.js so its auto-mount runs even before WT-2 wires it into pages.
  await page.addScriptTag({ url: 'http://localhost:3000/js/auth.js', type: 'module' });
  // Give the IIFE a tick to settle.
  await new Promise(r => setTimeout(r, 400));
}

try {
  // SIGNED OUT
  await loadHomeWithAuth();
  const out = await page.evaluate(() => {
    const a = document.querySelector('[data-account-link]');
    return { href: a?.getAttribute('href'), state: a?.dataset?.state, label: a?.getAttribute('aria-label') };
  });
  step('signed-out href = /login.html', out.href === '/login.html', `got ${out.href}`);
  step('signed-out data-state = signed-out', out.state === 'signed-out', `got ${out.state}`);
  step('signed-out aria-label = Sign in', out.label === 'Sign in');
  await page.screenshot({ path: nextShot('header-signed-out'), fullPage: false });

  // SIGNED IN — create + confirm user + sign in via auth.js
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw new Error(created.error.message);
  userId = created.data.user.id;

  await page.evaluate(async (email, password) => {
    const m = await import('/js/auth.js');
    await m.signInWithPassword({ email, password });
  }, email, password);
  // Wait one tick for onAuthChange → paint
  await new Promise(r => setTimeout(r, 300));

  // Reload so the page starts already-signed-in (covers both flows)
  await loadHomeWithAuth();
  const inn = await page.evaluate(() => {
    const a = document.querySelector('[data-account-link]');
    return { href: a?.getAttribute('href'), state: a?.dataset?.state, label: a?.getAttribute('aria-label') };
  });
  step('signed-in href = /account.html', inn.href === '/account.html', `got ${inn.href}`);
  step('signed-in data-state = signed-in', inn.state === 'signed-in', `got ${inn.state}`);
  step('signed-in aria-label = My account', inn.label === 'My account');
  await page.screenshot({ path: nextShot('header-signed-in'), fullPage: false });
} catch (e) {
  failed = true;
  console.error('Test threw:', e.message);
} finally {
  if (userId) await admin.auth.admin.deleteUser(userId).catch(() => {});
  await browser.close();
}

if (failed) {
  console.error('\n❌ header account-swap test failed');
  process.exit(1);
}
console.log('\n✅ header [data-account-link] swaps with auth state');
