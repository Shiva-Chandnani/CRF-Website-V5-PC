// One-off end-to-end smoke test for the customizer drawer + cart.
// Opens the PDP, clicks Customize, navigates the drawer, adds to cart, and
// screenshots each step. Useful for visual verification.

import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';

const dir = path.join(process.cwd(), 'temporary screenshots');
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

function nextScreenshotPath(label) {
  const existing = fs.readdirSync(dir).filter(f => f.endsWith('.png'));
  const nums = existing.map(f => parseInt(f.match(/screenshot-(\d+)/)?.[1] || '0')).filter(Boolean);
  const next = nums.length ? Math.max(...nums) + 1 : 1;
  return path.join(dir, `screenshot-${next}-${label}.png`);
}

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });

let failed = false;
function check(name, ok, detail = '') {
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) failed = true;
}
async function textOf(sel) {
  return page.$eval(sel, el => el.textContent.trim()).catch(() => null);
}

const PDP = 'http://localhost:3000/product.html?item=formal-suit-2-piece&fabric=vbc-wool&design=vbc-wool-grey-herringbone';

console.log('[1/6] Loading PDP…');
await page.goto(PDP, { waitUntil: 'networkidle0', timeout: 30000 });
await new Promise(r => setTimeout(r, 600));
await page.screenshot({ path: nextScreenshotPath('cz-1-pdp'), fullPage: false });

console.log('[2/6] Clicking Customize Your Suit…');
await page.waitForSelector('#customizeBtn:not([hidden])', { timeout: 5000 });
await page.click('#customizeBtn');
await new Promise(r => setTimeout(r, 700)); // wait for drawer slide-in
await page.screenshot({ path: nextScreenshotPath('cz-2-drawer-list'), fullPage: false });

console.log('[3/6] Clicking Lapel row…');
await page.waitForSelector('[data-cz-row="jacket-lapel"]', { timeout: 3000 });
await page.click('[data-cz-row="jacket-lapel"]');
await new Promise(r => setTimeout(r, 400));
await page.screenshot({ path: nextScreenshotPath('cz-3-lapel-detail'), fullPage: false });

console.log('[4/6] Selecting Peak Lapel…');
await page.click('[data-cz-option="jacket-lapel-peak"]');
await new Promise(r => setTimeout(r, 300));
await page.screenshot({ path: nextScreenshotPath('cz-4-peak-selected'), fullPage: false });

console.log('[5/6] Back → list → Add to Spec…');
await page.click('[data-cz-back]');
await new Promise(r => setTimeout(r, 400));
await page.screenshot({ path: nextScreenshotPath('cz-5-back-to-list'), fullPage: false });

await page.click('[data-cz-add-to-cart]');
await new Promise(r => setTimeout(r, 800)); // wait for drawer close + toast
await page.screenshot({ path: nextScreenshotPath('cz-6-toast'), fullPage: false });

console.log('[6/6] Navigating to cart.html…');
const ls = await page.evaluate(() => localStorage.getItem('crf.cart.v1'));
console.log('  localStorage cart:', ls ? `${JSON.parse(ls).items.length} items` : '(empty)');

await page.goto('http://localhost:3000/cart.html', { waitUntil: 'networkidle0' });
await new Promise(r => setTimeout(r, 1200)); // wait for v_products fetch + render
await page.screenshot({ path: nextScreenshotPath('cz-7-cart-with-item'), fullPage: false });

// Expand customizations disclosure
await page.evaluate(() => {
  const d = document.querySelector('.cart-spec');
  if (d) d.open = true;
});
await new Promise(r => setTimeout(r, 300));
await page.screenshot({ path: nextScreenshotPath('cz-8-cart-spec-open'), fullPage: true });

// ---- Phase 4: standalone Jacket + Trouser ----
async function drive(itemType, expectTitle, rowSel, optSel, expectGroupHeaders) {
  const url = `http://localhost:3000/product.html?item=${itemType}&fabric=vbc-wool&design=vbc-wool-grey-herringbone`;
  await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
  await new Promise(r => setTimeout(r, 500));

  await page.evaluate(() => localStorage.removeItem('crf.cart.v1'));
  await page.waitForSelector('#customizeBtn:not([hidden])', { timeout: 5000 });
  const btnText = await textOf('#customizeBtn');
  check(`${itemType}: button label`, btnText === `Customize Your ${expectTitle}`, btnText);

  await page.click('#customizeBtn');
  await new Promise(r => setTimeout(r, 600));
  const title = await textOf('.cz-title');
  check(`${itemType}: drawer title`, title === `Customize Your ${expectTitle}`, title);

  const headerCount = await page.$$eval('.cz-group', els => els.length);
  check(`${itemType}: ${expectGroupHeaders ? '2 group headers' : 'flat (no group header)'}`,
    expectGroupHeaders ? headerCount === 2 : headerCount === 0, `headers=${headerCount}`);

  await page.click(`[data-cz-row="${rowSel}"]`);
  await new Promise(r => setTimeout(r, 300));
  await page.click(`[data-cz-option="${optSel}"]`);
  await new Promise(r => setTimeout(r, 200));
  await page.click('[data-cz-back]');
  await new Promise(r => setTimeout(r, 200));
  await page.click('[data-cz-add-to-cart]');
  await new Promise(r => setTimeout(r, 600));

  const count = await page.evaluate(() => JSON.parse(localStorage.getItem('crf.cart.v1') || '{"items":[]}').items.length);
  check(`${itemType}: line added to cart`, count === 1, `items=${count}`);
}

await drive('formal-jacket', 'Jacket', 'jacket-lapel', 'jacket-lapel-peak', false);
await drive('dress-pants',   'Trousers', 'pants-pleats', 'pants-pleats-single', false);

// ---- Phase 4: mixed-cart spec renders all lines (guards the cart-index fix) ----
await page.evaluate(() => localStorage.setItem('crf.cart.v1', JSON.stringify({
  items: [
    { id: 'l1', item_type_id: 'dress-pants', fabric_design_id: 'vbc-wool-grey-herringbone',
      price_thb: 6000, qty: 1, customizations: { 'pants-pleats': 'pants-pleats-single' }, added_at: new Date().toISOString() },
    { id: 'l2', item_type_id: 'formal-suit-2-piece', fabric_design_id: 'vbc-wool-grey-herringbone',
      price_thb: 20000, qty: 1, customizations: { 'jacket-lapel': 'jacket-lapel-peak' }, added_at: new Date().toISOString() },
  ], updated_at: new Date().toISOString(),
})));
await page.goto('http://localhost:3000/cart.html', { waitUntil: 'networkidle0' });
await new Promise(r => setTimeout(r, 1400));
await page.evaluate(() => document.querySelectorAll('.cart-spec').forEach(d => d.open = true));
await new Promise(r => setTimeout(r, 300));
const specText = await page.$eval('#cartRoot', el => el.textContent).catch(() => '');
check('mixed cart: trouser pleats row rendered', /Single Pleat/.test(specText));
check('mixed cart: suit lapel row rendered (index-merge fix)', /Peak Lapel/.test(specText));

await browser.close();
console.log(failed ? '\n✘ FAILED' : '\n✅ PASS');
process.exit(failed ? 1 : 0);
