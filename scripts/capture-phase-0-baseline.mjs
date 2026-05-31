// One-off: capture before/ screenshots for Phase 0 visual gate.
// 6 pages × 2 widths (1440 + 375) = 12 PNGs into temporary screenshots/phase-0/before/
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const OUT_DIR = path.join(process.cwd(), 'temporary screenshots', 'phase-0', 'before');
fs.mkdirSync(OUT_DIR, { recursive: true });

const PAGES = [
  ['index',            'http://localhost:3000/index.html'],
  ['shop',             'http://localhost:3000/shop.html'],
  ['product',          'http://localhost:3000/product.html?item=formal-suit-2-piece&fabric=vbc-wool&design=vbc-wool-grey-herringbone'],
  ['cart',             'http://localhost:3000/cart.html'],
  ['book-appointment', 'http://localhost:3000/book-appointment.html'],
  ['in-store',         'http://localhost:3000/in-store.html'],
];
const WIDTHS = [1440, 375];

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
for (const [name, url] of PAGES) {
  for (const w of WIDTHS) {
    const page = await browser.newPage();
    try {
      await page.setViewport({ width: w, height: w === 1440 ? 900 : 812 });
      await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
      await new Promise(r => setTimeout(r, 800));
      const file = path.join(OUT_DIR, `${w}-${name}.png`);
      await page.screenshot({ path: file, fullPage: true });
      console.log(`✔ ${file}`);
    } finally {
      await page.close();
    }
  }
}
await browser.close();
console.log('Done. 12 baseline screenshots saved.');
