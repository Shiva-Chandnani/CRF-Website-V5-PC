// scripts/test-csp-compliance.mjs
// Phase 1 WT-4: assert zero CSP violations on every page that exists after WT-4 ships.
// WT-2 extends this list with its 6 new auth pages (signup, login, forgot-password,
// reset-password, account) and re-runs this script as part of its own gates.

import puppeteer from 'puppeteer';
import process from 'node:process';

const BASE = process.env.CRF_BASE_URL || 'http://localhost:3000';

// Every page that carries the Phase 1 CSP <meta>. WT-2 added the 5 auth pages.
const PAGES = [
  '/index.html',
  '/shop.html',
  '/product.html',
  '/cart.html',
  '/book-appointment.html',
  '/in-store.html',
  '/privacy.html',
  '/signup.html',
  '/login.html',
  '/forgot-password.html',
  '/reset-password.html',
  '/account.html',
  '/order-confirmation.html',
];

function isCspViolation(text) {
  if (!text) return false;
  return (
    text.includes('Content Security Policy') ||
    text.startsWith('Refused to') ||
    text.includes("violates the following Content Security Policy directive")
  );
}

async function checkPage(browser, path) {
  const page = await browser.newPage();
  const violations = [];

  page.on('console', (msg) => {
    const text = msg.text();
    if (isCspViolation(text)) violations.push({ kind: 'console', text });
  });
  page.on('pageerror', (err) => {
    const text = err?.message ?? String(err);
    if (isCspViolation(text)) violations.push({ kind: 'pageerror', text });
  });
  page.on('requestfailed', (req) => {
    const failure = req.failure();
    if (failure && isCspViolation(failure.errorText)) {
      violations.push({ kind: 'requestfailed', text: `${req.url()} — ${failure.errorText}` });
    }
  });

  const url = `${BASE}${path}`;
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
  // Allow late-firing inline scripts / layout-ready hooks to complete.
  await new Promise((r) => setTimeout(r, 750));

  await page.close();
  return { path, violations };
}

async function main() {
  const browser = await puppeteer.launch({ headless: 'new' });
  let failed = 0;
  try {
    for (const path of PAGES) {
      const result = await checkPage(browser, path);
      if (result.violations.length === 0) {
        console.log(`OK   ${path}`);
      } else {
        failed++;
        console.error(`FAIL ${path} — ${result.violations.length} CSP violation(s):`);
        for (const v of result.violations) {
          console.error(`     [${v.kind}] ${v.text}`);
        }
      }
    }
  } finally {
    await browser.close();
  }
  if (failed > 0) {
    console.error(`\n${failed} page(s) failed CSP compliance.`);
    process.exit(1);
  }
  console.log(`\nAll ${PAGES.length} pages clean.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
