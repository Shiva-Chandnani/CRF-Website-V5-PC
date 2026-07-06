// scripts/test-privacy-page.mjs
// Phase 1 WT-4: smoke-test privacy.html — anchor IDs, H1, brand voice, zero CSP violations.

import puppeteer from 'puppeteer';
import process from 'node:process';

const BASE = process.env.CRF_BASE_URL || 'http://localhost:3000';
const URL = `${BASE}/privacy.html`;

const REQUIRED_ANCHORS = [
  'header-banner',
  'intro',
  'who-we-are',
  'what-we-collect',
  'why-we-collect',
  'who-we-share-with',
  'how-long-we-keep',
  'your-rights',
  'cookies-and-local-storage',
  'cross-border-transfer',
  'changes-to-this-notice',
  'contact-us',
];

function isCspViolation(text) {
  if (!text) return false;
  return (
    text.includes('Content Security Policy') ||
    text.startsWith('Refused to') ||
    text.includes("violates the following Content Security Policy directive")
  );
}

async function main() {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  const cspViolations = [];

  page.on('console', (msg) => {
    if (isCspViolation(msg.text())) cspViolations.push(msg.text());
  });
  page.on('pageerror', (err) => {
    const t = err?.message ?? String(err);
    if (isCspViolation(t)) cspViolations.push(t);
  });

  const response = await page.goto(URL, { waitUntil: 'networkidle2', timeout: 30000 });
  if (!response || !response.ok()) {
    throw new Error(`privacy.html did not load: status ${response && response.status()}`);
  }

  // Anchor ID check
  const missing = [];
  for (const id of REQUIRED_ANCHORS) {
    const found = await page.$(`#${id}`);
    if (!found) missing.push(id);
  }
  if (missing.length > 0) {
    throw new Error(`Missing anchor IDs on privacy.html: ${missing.join(', ')}`);
  }

  // H1 text check
  const h1 = await page.$eval('h1', (el) => el.textContent.trim());
  if (!/privacy notice/i.test(h1)) {
    throw new Error(`H1 expected to contain "Privacy Notice"; got: "${h1}"`);
  }

  // Brand voice spot-checks — these specific copy strings must appear (sourced from spec §8.1).
  const bodyText = await page.$eval('body', (el) => el.textContent);
  const requiredCopyHits = [
    'PDPA',
    'Supabase',
    'Calendly',
    'localStorage',
    'Thai Revenue Code',
    'PDPC',
  ];
  const missingCopy = requiredCopyHits.filter((s) => !bodyText.includes(s));
  if (missingCopy.length > 0) {
    throw new Error(`Privacy page is missing required copy: ${missingCopy.join(', ')}`);
  }

  // Last-updated / Effective dates use <time datetime="...">
  const timeEls = await page.$$('time[datetime]');
  if (timeEls.length < 2) {
    throw new Error(`Expected at least 2 <time datetime="..."> elements (Last updated + Effective); found ${timeEls.length}`);
  }

  // Footer Privacy link points to /privacy.html
  await page.goto(`${BASE}/index.html`, { waitUntil: 'networkidle2' });
  const footerHref = await page.$eval(
    'footer a[href$="privacy.html"], footer a[href="/privacy.html"]',
    (a) => a.getAttribute('href'),
  );
  if (footerHref !== '/privacy.html') {
    throw new Error(`Footer Privacy link href is "${footerHref}"; expected "/privacy.html"`);
  }

  await browser.close();

  if (cspViolations.length > 0) {
    console.error('CSP violations on privacy.html:');
    for (const v of cspViolations) console.error(`  ${v}`);
    process.exit(1);
  }

  console.log(`OK   /privacy.html — all ${REQUIRED_ANCHORS.length} anchors, H1, brand voice, dates, footer link, zero CSP violations.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
