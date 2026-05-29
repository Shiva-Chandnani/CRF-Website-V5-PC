// Quick smoke test for the per-design hero photo rail on the PDP.
// Loads the suit PDP, screenshots the rail, switches design, screenshots again.

import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';

const dir = path.join(process.cwd(), 'temporary screenshots');
function next(label) {
  const existing = fs.readdirSync(dir).filter(f => f.endsWith('.png'));
  const nums = existing.map(f => parseInt(f.match(/screenshot-(\d+)/)?.[1] || '0')).filter(Boolean);
  const n = nums.length ? Math.max(...nums) + 1 : 1;
  return path.join(dir, `screenshot-${n}-${label}.png`);
}

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1100 });

const PDP1 = 'http://localhost:3000/product.html?item=formal-suit-2-piece&fabric=vbc-wool&design=vbc-wool-grey-herringbone';

console.log('[1/3] Loading Grey Herringbone PDP…');
await page.goto(PDP1, { waitUntil: 'networkidle0', timeout: 30000 });
await new Promise(r => setTimeout(r, 1000));

// Inspect rail thumbs
const railInfo = await page.evaluate(() => {
  const rail = document.getElementById('thumbRail');
  const btns = [...rail.querySelectorAll('button')];
  return btns.map(b => ({
    type: b.dataset.photoType,
    title: b.title,
    photo: b.dataset.photo || '',
    design: b.dataset.design || '',
    active: b.classList.contains('is-active'),
  }));
});
console.log('  Rail thumbs:', JSON.stringify(railInfo, null, 2));

await page.screenshot({ path: next('rail-grey-herringbone'), fullPage: false });

console.log('[2/3] Clicking hero #1 thumb to swap main image…');
await page.click('#thumbRail button[data-photo-type="hero"]:nth-of-type(1)');
await new Promise(r => setTimeout(r, 700));
await page.screenshot({ path: next('rail-hero1-active'), fullPage: false });

console.log('[3/3] Selecting a different design (Blue Sharkskin)…');
await page.click('.swatch-btn[data-design="vbc-wool-blue-sharkskin"]');
await new Promise(r => setTimeout(r, 800));

const railInfo2 = await page.evaluate(() => {
  const rail = document.getElementById('thumbRail');
  const btns = [...rail.querySelectorAll('button')];
  return btns.map(b => ({
    type: b.dataset.photoType,
    title: b.title,
    active: b.classList.contains('is-active'),
  }));
});
console.log('  Rail thumbs after switch:', JSON.stringify(railInfo2, null, 2));

await page.screenshot({ path: next('rail-blue-sharkskin'), fullPage: false });

await browser.close();
console.log('\n✅ Done');
