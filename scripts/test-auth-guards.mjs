// WT-1 unit: requireAuth redirects when no session; requireGuest redirects
// when a session exists. We intercept the location.replace call via a
// patched window.location.replace stub so the probe page never actually
// navigates away.

import puppeteer from 'puppeteer';
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8')
    .split('\n').filter(Boolean)
    .map(l => l.split('=').map(s => s.trim()))
    .map(([k, ...v]) => [k, v.join('=')])
);
const URL = env.SUPABASE_URL;
const SVC = env.SUPABASE_SERVICE_ROLE_KEY;
const admin = createClient(URL, SVC, { auth: { persistSession: false } });

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
const email = `guard-${stamp}@example.test`;
const password = 'Test-Pass-123!';

let failed = false;
function step(name, ok, detail = '') {
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) failed = true;
}

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1024, height: 768 });

let userId;

try {
  // Intercept navigations triggered by location.replace by aborting them.
  await page.setRequestInterception(true);
  const seenRedirects = [];
  page.on('request', req => {
    if (req.isNavigationRequest() && req.frame() === page.mainFrame()) {
      const url = req.url();
      // Allow the probe pages themselves (guard probe + the auth probe used to
      // sign in between cases). Anything else reaching a main-frame navigation
      // is a guard redirect (e.g. /login.html, /account.html) → record + abort.
      if (url.includes('/scripts/__probe-')) return req.continue();
      seenRedirects.push(url);
      return req.abort();
    }
    return req.continue();
  });

  // Case 1: signed-out, requireAuth → should attempt /login.html?next=...
  await page.goto('http://localhost:3000/scripts/__probe-guard.html?g=auth', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__guardDone === true, { timeout: 5000 }).catch(() => {});
  // Either guardDone fired with null, OR we aborted on the redirect
  const sawLogin = seenRedirects.some(u => u.includes('/login.html'));
  step('requireAuth without session redirects to /login.html', sawLogin,
       `redirects=${JSON.stringify(seenRedirects)}`);

  // Create + confirm a user, sign them in via the probe, then test requireGuest
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw new Error(created.error.message);
  userId = created.data.user.id;

  seenRedirects.length = 0;

  // Use the auth probe to sign in (writes localStorage on origin)
  await page.goto('http://localhost:3000/scripts/__probe-auth.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__auth);
  await page.evaluate(async (email, password) => {
    await window.__auth.signInWithPassword({ email, password });
  }, email, password);

  seenRedirects.length = 0;

  // Case 2: signed-in, requireGuest → should redirect to /account.html
  await page.goto('http://localhost:3000/scripts/__probe-guard.html?g=guest', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__guardDone === true, { timeout: 5000 }).catch(() => {});
  const sawAccount = seenRedirects.some(u => u.includes('/account.html'));
  step('requireGuest with session redirects to /account.html', sawAccount,
       `redirects=${JSON.stringify(seenRedirects)}`);

  seenRedirects.length = 0;

  // Case 3: signed-in, requireAuth → no redirect, returns a session
  await page.goto('http://localhost:3000/scripts/__probe-guard.html?g=auth', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__guardDone === true, { timeout: 5000 });
  const guardResult = await page.evaluate(() => !!window.__guardResult);
  step('requireAuth with session does NOT redirect', seenRedirects.length === 0,
       `redirects=${JSON.stringify(seenRedirects)}`);
  step('requireAuth with session returns a session', guardResult);
} catch (e) {
  failed = true;
  console.error('Test threw:', e.message);
} finally {
  if (userId) await admin.auth.admin.deleteUser(userId).catch(() => {});
  await browser.close();
}

if (failed) {
  console.error('\n❌ guard test failed');
  process.exit(1);
}
console.log('\n✅ requireAuth / requireGuest behave correctly');
