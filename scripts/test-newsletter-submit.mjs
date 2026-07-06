// Phase 0 smoke test: submit a unique email via the footer form on index.html,
// poll Supabase REST for the row, then re-submit the same email and assert
// idempotency (success state, single row in DB, opted_in_at preserved on
// re-submit because client uses ignoreDuplicates / ON CONFLICT DO NOTHING).
// Cleans up the row at the end using the service-role key.

import puppeteer from 'puppeteer';
import fs from 'node:fs';

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8')
    .split('\n').filter(Boolean)
    .map(l => l.split('=').map(s => s.trim()))
    .map(([k, ...v]) => [k, v.join('=')])
);
const SVCROL = env.SUPABASE_SERVICE_ROLE_KEY;
const URL    = 'https://fzgsogdceptjvuahukbn.supabase.co';
const REST   = `${URL}/rest/v1/newsletter_subscribers`;

const TEST_EMAIL = `phase0-test-${Date.now()}-${Math.random().toString(36).slice(2,8)}@example.com`;

async function fetchRow(email) {
  const r = await fetch(`${REST}?email=eq.${encodeURIComponent(email)}&select=email,source,opted_in_at`, {
    headers: { apikey: SVCROL, Authorization: `Bearer ${SVCROL}` },
  });
  if (!r.ok) throw new Error(`REST ${r.status} ${await r.text()}`);
  return (await r.json())[0] || null;
}

async function deleteRow(email) {
  await fetch(`${REST}?email=eq.${encodeURIComponent(email)}`, {
    method: 'DELETE',
    headers: { apikey: SVCROL, Authorization: `Bearer ${SVCROL}`, Prefer: 'return=minimal' },
  });
}

async function waitLayoutReady(page) {
  const ready = await page.evaluate(() => new Promise(resolve => {
    if (document.querySelector('[data-newsletter-form]')) return resolve(true);
    document.addEventListener('crf:layout-ready', () => resolve(true), { once: true });
    setTimeout(() => resolve(false), 8000);
  }));
  if (!ready) throw new Error('crf:layout-ready never fired');
  await page.waitForSelector('[data-newsletter-form] input[type="email"]', { timeout: 5000 });
  // Wait until js/newsletter.js has actually BOUND its submit handler — it sets
  // form.dataset.newsletterBound = '1' in init(). Dispatching submit before the
  // handler binds lets the native form submission navigate the page (the footer
  // unmounts, no .newsletter-success ever appears) — the source of this test's
  // intermittent 8s timeouts.
  await page.waitForFunction(
    () => document.querySelector('[data-newsletter-form]')?.dataset.newsletterBound === '1',
    { timeout: 5000 }
  );
}

async function submitEmail(page, email) {
  await page.evaluate((email) => {
    const form  = document.querySelector('[data-newsletter-form]');
    const input = form.querySelector('input[type="email"]');
    input.value = email;
    form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
  }, email);

  const handle = await page.waitForFunction(
    () => document.querySelector('.newsletter-success') || document.querySelector('.newsletter-error'),
    { timeout: 8000 }
  );
  return handle.evaluate(el => el.className);
}

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });

let failed = false;
function step(name, ok, detail = '') {
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) failed = true;
}

try {
  // Submit 1
  await page.goto('http://localhost:3000/index.html', { waitUntil: 'networkidle0' });
  await waitLayoutReady(page);
  const result1 = await submitEmail(page, TEST_EMAIL);
  step('submit 1 produced success', result1 === 'newsletter-success', result1);

  // Poll REST for the row (up to ~3s)
  let row = null;
  for (let i = 0; i < 10 && !row; i++) {
    row = await fetchRow(TEST_EMAIL);
    if (!row) await new Promise(r => setTimeout(r, 300));
  }
  step('row exists in newsletter_subscribers', !!row, row ? `source=${row.source}` : 'not found');
  step('row source = "footer"', row?.source === 'footer');
  const originalOptedInAt = row?.opted_in_at;

  // Submit 2 (idempotency) — reload page, submit same email
  await page.goto('http://localhost:3000/index.html', { waitUntil: 'networkidle0' });
  await waitLayoutReady(page);
  const result2 = await submitEmail(page, TEST_EMAIL);
  step('submit 2 (same email) produced success', result2 === 'newsletter-success', result2);

  // After second submit, opted_in_at should be PRESERVED (not refreshed) because
  // client uses ignoreDuplicates -> INSERT ON CONFLICT DO NOTHING.
  const row2 = await fetchRow(TEST_EMAIL);
  step('opted_in_at preserved on re-submit', row2?.opted_in_at === originalOptedInAt,
    `original=${originalOptedInAt} after=${row2?.opted_in_at}`);
} catch (e) {
  failed = true;
  console.error('Test threw:', e.message);
} finally {
  await deleteRow(TEST_EMAIL).catch(() => {});
  await browser.close();
}

if (failed) {
  console.error('\n❌ newsletter submit test failed');
  process.exit(1);
}
console.log('\n✅ newsletter submit + idempotency pass');
