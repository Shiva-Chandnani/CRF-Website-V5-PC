// Phase 0 smoke test: header + footer mount on all 6 pages, console clean,
// .btn--primary computes a non-default background.

import puppeteer from 'puppeteer';

const PAGES = [
  'http://localhost:3000/index.html',
  'http://localhost:3000/shop.html',
  'http://localhost:3000/product.html?item=formal-suit-2-piece&fabric=vbc-wool&design=vbc-wool-grey-herringbone',
  'http://localhost:3000/cart.html',
  'http://localhost:3000/book-appointment.html',
  'http://localhost:3000/in-store.html',
];

let failures = 0;

function fail(url, msg) {
  console.error(`✘ ${url}\n  ${msg}`);
  failures++;
}

function pass(url, msg) {
  console.log(`✔ ${url}  ${msg}`);
}

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
for (const url of PAGES) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  const consoleErrors = [];
  page.on('console', m => {
    if (m.type() === 'error') {
      consoleErrors.push(`[${m.type()}] ${m.text()}`);
    }
  });
  page.on('pageerror', e => consoleErrors.push(`[pageerror] ${e.message}`));

  await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });

  const ready = await page.evaluate(() => new Promise(resolve => {
    const slot = document.querySelector('[data-layout="header"]');
    if (slot && slot.children.length) return resolve(true);
    document.addEventListener('crf:layout-ready', () => resolve(true), { once: true });
    setTimeout(() => resolve(false), 5000);
  }));

  if (!ready) {
    fail(url, 'crf:layout-ready never fired');
    await page.close();
    continue;
  }

  const checks = await page.evaluate(() => {
    const headerSlot = document.querySelector('[data-layout="header"]');
    const footerSlot = document.querySelector('[data-layout="footer"]');
    const brand = document.querySelector('.brand-wordmark');
    const newsletterForm = document.querySelector('[data-newsletter-form]');
    const cartBadge = document.querySelector('[data-cart-count]');

    let primaryBtnBg = null;
    const primary = document.querySelector('.btn--primary');
    if (primary) primaryBtnBg = getComputedStyle(primary).backgroundColor;

    return {
      headerInjected: !!(headerSlot && headerSlot.children.length),
      footerInjected: !!(footerSlot && footerSlot.children.length),
      hasBrand: !!brand,
      hasNewsletterForm: !!newsletterForm,
      hasCartBadge: !!cartBadge,
      primaryBtnBg,
    };
  });

  let pageOk = true;
  if (!checks.headerInjected) { fail(url, 'header slot is empty'); pageOk = false; }
  if (!checks.footerInjected) { fail(url, 'footer slot is empty'); pageOk = false; }
  if (!checks.hasBrand) { fail(url, '.brand-wordmark missing in header'); pageOk = false; }
  if (!checks.hasNewsletterForm) { fail(url, '[data-newsletter-form] missing in footer'); pageOk = false; }
  if (!checks.hasCartBadge) { fail(url, '[data-cart-count] missing in header'); pageOk = false; }
  if (checks.primaryBtnBg && !/14,\s*15,\s*17|rgb\(14,\s*15,\s*17\)/.test(checks.primaryBtnBg)) {
    fail(url, `.btn--primary background is ${checks.primaryBtnBg}, expected rgb(14, 15, 17)`);
    pageOk = false;
  }
  if (pageOk) pass(url, 'mounts clean');

  if (consoleErrors.length) {
    fail(url, `console: ${consoleErrors.join(' | ')}`);
  }

  await page.close();
}

await browser.close();

if (failures) {
  console.error(`\n❌ ${failures} failure(s)`);
  process.exit(1);
} else {
  console.log(`\n✅ All 6 pages mount cleanly`);
}
