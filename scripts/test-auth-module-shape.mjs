// WT-1 unit test: js/auth.js exports the spec §6.1 surface and getSession()
// returns null in a fresh session.
// Hits a tiny throwaway HTML page served by serve.mjs that just imports auth.js
// and exposes the module on window for inspection.

import puppeteer from 'puppeteer';

const PROBE_URL = 'http://localhost:3000/scripts/__probe-auth.html';

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1024, height: 768 });

let failed = false;
function step(name, ok, detail = '') {
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) failed = true;
}

try {
  await page.goto(PROBE_URL, { waitUntil: 'networkidle0', timeout: 30000 });

  await page.waitForFunction(() => !!window.__auth, { timeout: 10000 });

  const surface = await page.evaluate(() => {
    const m = window.__auth;
    const wanted = [
      'getSession','getUser','onAuthChange',
      'signUp','signInWithPassword','signOut',
      'resetPasswordForEmail','updatePassword',
      'requireAuth','requireGuest',
      'deleteAccount',
    ];
    const out = {};
    for (const k of wanted) out[k] = typeof m[k];
    return out;
  });

  for (const [name, type] of Object.entries(surface)) {
    step(`exports ${name} as function`, type === 'function', `got ${type}`);
  }

  // getSession() in a fresh tab with no auth token in localStorage
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForFunction(() => !!window.__auth);
  const sess = await page.evaluate(async () => await window.__auth.getSession());
  step('getSession() returns null without a session', sess === null, `got ${JSON.stringify(sess)}`);
} catch (e) {
  failed = true;
  console.error('Test threw:', e.message);
} finally {
  await browser.close();
}

if (failed) {
  console.error('\n❌ auth module shape test failed');
  process.exit(1);
}
console.log('\n✅ js/auth.js exports full spec §6.1 surface');
