import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const url = process.argv[2] || 'http://localhost:3000';
const label = process.argv[3] || '';

const dir = path.join(__dirname, 'temporary screenshots');
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const existing = fs.readdirSync(dir).filter(f => f.endsWith('.png'));
const nums = existing.map(f => parseInt(f.match(/screenshot-(\d+)/)?.[1] || '0')).filter(Boolean);
const next = nums.length ? Math.max(...nums) + 1 : 1;
const filename = label ? `screenshot-${next}-${label}.png` : `screenshot-${next}.png`;
const outPath = path.join(dir, filename);

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
// Scroll through page to trigger IntersectionObserver for all sections
const pageHeight = await page.evaluate(() => document.body.scrollHeight);
for (let y = 0; y < pageHeight; y += 600) {
  await page.evaluate((scrollY) => window.scrollTo(0, scrollY), y);
  await new Promise(r => setTimeout(r, 80));
}
await page.evaluate(() => window.scrollTo(0, 0));
await new Promise(r => setTimeout(r, 400));
await page.screenshot({ path: outPath, fullPage: true });
await browser.close();
console.log(`Saved: ${outPath}`);
