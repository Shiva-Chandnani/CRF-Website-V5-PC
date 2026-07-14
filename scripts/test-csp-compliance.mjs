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
  '/measurements.html',
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

  // Phase 3: exercise the search overlay so its fetch/render is CSP-checked.
  const hasSearch = await page.$('[data-search-btn]');
  if (hasSearch) {
    await page.click('[data-search-btn]').catch(() => {});
    await page.waitForSelector('#search-overlay[data-open="1"]', { timeout: 3000 }).catch(() => {});
    await page.type('[data-search-input]', 'wool').catch(() => {});
    await new Promise((r) => setTimeout(r, 600)); // let debounced quickSearch fire + images load
  }

  await page.close();
  return { path, violations };
}

// Fetch raw HTML/headers over HTTP (Node's global fetch — no import needed).
async function getResponse(pathname) {
  const res = await fetch(`${BASE}${pathname}`);
  return { status: res.status, text: await res.text(), headers: res.headers };
}

// Phase 3 (#14): assert script-src no longer allows 'unsafe-inline' on any page.
async function checkScriptSrcTightened() {
  let bad = 0;
  for (const path of PAGES) {
    const { text } = await getResponse(path);
    // Strip HTML comments so the rationale comment (which mentions script-src / unsafe-inline)
    // is not mistaken for the actual CSP directive.
    const html = text.replace(/<!--[\s\S]*?-->/g, '');
    const m = html.match(/script-src([^;]*);/);
    if (!m) {
      console.error(`FAIL ${path}: no script-src directive found`);
      bad++;
      continue;
    }
    if (/unsafe-inline/.test(m[1])) {
      console.error(`FAIL ${path}: script-src still allows 'unsafe-inline' —${m[1]}`);
      bad++;
    }
  }
  if (bad === 0) console.log(`\nPASS: no page allows 'unsafe-inline' in script-src`);
  return bad;
}

// Phase 3 (#14): assert the dev server sends clickjacking + hardening headers.
async function checkSecurityHeaders() {
  const { headers } = await getResponse('/');
  const xfo = headers.get('x-frame-options');
  const cspHeader = headers.get('content-security-policy');
  const xcto = headers.get('x-content-type-options');
  const referrer = headers.get('referrer-policy');
  const ok =
    xfo === 'DENY' &&
    !!cspHeader && cspHeader.includes("frame-ancestors 'none'") &&
    xcto === 'nosniff' &&
    referrer === 'strict-origin-when-cross-origin';
  if (ok) {
    console.log('PASS: security response headers present (X-Frame-Options, CSP frame-ancestors, nosniff, Referrer-Policy)');
    return 0;
  }
  console.error('FAIL: missing/incorrect security headers', { xfo, cspHeader, xcto, referrer });
  return 1;
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

  // Static-policy + response-header assertions (Phase 3 #14 hardening).
  failed += await checkScriptSrcTightened();
  failed += await checkSecurityHeaders();

  if (failed > 0) {
    console.error(`\n${failed} check(s) failed CSP compliance.`);
    process.exit(1);
  }
  console.log(`\nAll ${PAGES.length} pages clean; script-src tightened; security headers present.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
