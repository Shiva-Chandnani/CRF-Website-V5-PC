// WT-1 end-to-end: signup → admin auto-confirm → signInWithPassword →
// getSession returns user → signOut → getSession returns null.
// Driven through the real js/auth.js module loaded into the probe page.

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

const PROBE_URL = 'http://localhost:3000/scripts/__probe-auth.html';

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
// example.com/.test are on Supabase's reserved-domain blocklist (400 "invalid").
// This subdomain passes format validation; with "Confirm email" disabled no mail
// is sent, so the address never needs to be deliverable. See HANDOFF.md.
const email = `roundtrip-${stamp}@test.countryroadfashions.com`;
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
  await page.goto(PROBE_URL, { waitUntil: 'networkidle0', timeout: 30000 });
  await page.waitForFunction(() => !!window.__auth);
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForFunction(() => !!window.__auth);

  // Sign up via auth.js
  const signupRes = await page.evaluate(async (email, password) => {
    const r = await window.__auth.signUp({ email, password, full_name: 'Roundtrip User', opted_in_newsletter: false });
    return { ok: !r.error, error: r.error?.message ?? null, hasUser: !!r.data?.user };
  }, email, password);
  step('signUp returned no error', signupRes.ok, signupRes.error);
  step('signUp returned data.user', signupRes.hasUser);

  // Find the user via admin and confirm them (bypass email click)
  const lookup = await admin.auth.admin.listUsers();
  const found = lookup.data?.users?.find(u => u.email === email);
  step('user exists in auth.users', !!found);
  if (!found) throw new Error('aborting: no user');
  userId = found.id;

  if (!found.email_confirmed_at) {
    const upd = await admin.auth.admin.updateUserById(userId, { email_confirm: true });
    step('admin confirmed email', !upd.error, upd.error?.message);
  }

  // signInWithPassword
  const signInRes = await page.evaluate(async (email, password) => {
    const r = await window.__auth.signInWithPassword({ email, password });
    return { ok: !r.error, error: r.error?.message ?? null, hasSession: !!r.data?.session };
  }, email, password);
  step('signInWithPassword no error', signInRes.ok, signInRes.error);
  step('signInWithPassword returned session', signInRes.hasSession);

  // getSession should now return a user
  const sess = await page.evaluate(async () => {
    const s = await window.__auth.getSession();
    return s ? { hasUser: !!s.user, email: s.user?.email } : null;
  });
  step('getSession returns a session post-signin', !!sess);
  step('session.user.email matches', sess?.email === email, `got ${sess?.email}`);

  // signOut
  const signOutRes = await page.evaluate(async () => {
    const r = await window.__auth.signOut();
    return { ok: !r.error, error: r.error?.message ?? null };
  });
  step('signOut no error', signOutRes.ok, signOutRes.error);

  // getSession null again
  const after = await page.evaluate(async () => await window.__auth.getSession());
  step('getSession returns null post-signout', after === null, `got ${JSON.stringify(after)}`);
} catch (e) {
  failed = true;
  console.error('Test threw:', e.message);
} finally {
  if (userId) await admin.auth.admin.deleteUser(userId).catch(() => {});
  await browser.close();
}

if (failed) {
  console.error('\n❌ auth roundtrip failed');
  process.exit(1);
}
console.log('\n✅ auth roundtrip: signup → confirm → signIn → signOut');
