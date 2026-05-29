/* Screenshot a page with the mega menu open.
   Usage: node scripts/screenshot-mega-open.mjs <url> [label] */
import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const url = process.argv[2] || 'http://localhost:3000';
const label = process.argv[3] || 'mega-open';

const dir = path.join(projectRoot, 'temporary screenshots');
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
const existing = fs.readdirSync(dir).filter(f => f.endsWith('.png'));
const nums = existing.map(f => parseInt(f.match(/screenshot-(\d+)/)?.[1] || '0')).filter(Boolean);
const next = nums.length ? Math.max(...nums) + 1 : 1;
const outPath = path.join(dir, `screenshot-${next}-${label}.png`);

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1000 });
page.on('console', msg => { if (msg.type() === 'error') console.error('PAGE ERR:', msg.text()); });
page.on('pageerror', err => console.error('PAGE EXCEPTION:', err.message));
await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });

// Open the mega menu (use click — open() is bound to both hover and click)
const opened = await page.evaluate(() => {
  const a = Array.from(document.querySelectorAll('.nav-left a'))
    .find(x => x.textContent.trim().toLowerCase() === 'shop');
  if (!a) return false;
  a.click();
  return true;
});
if (!opened) { console.error('Could not find Shop link'); await browser.close(); process.exit(1); }
await new Promise(r => setTimeout(r, 350));   // wait for open animation

await page.screenshot({ path: outPath, fullPage: false });
await browser.close();
console.log(`Saved: ${outPath}`);
