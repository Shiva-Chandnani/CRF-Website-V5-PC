// Verify: clicking a design swatch on the right sets main image = hero #2
// and marks the hero #2 thumb active in the left rail. Then clicking the
// fabric thumb in the left rail returns main image to the fabric closeup.

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

const PDP = 'http://localhost:3000/product.html?item=formal-suit-2-piece&fabric=vbc-wool&design=vbc-wool-grey-herringbone';

const waitForImg = async () => {
  await page.evaluate(async () => {
    const img = document.getElementById('mainImage');
    if (img.complete && img.naturalWidth) return;
    await new Promise(r => img.addEventListener('load', r, { once: true }));
  });
};

console.log('[1/4] Loading PDP (initial = Grey Herringbone, fabric photo)…');
await page.goto(PDP, { waitUntil: 'networkidle0', timeout: 30000 });
await waitForImg();
await new Promise(r => setTimeout(r, 400));

const inspect = async () => page.evaluate(() => {
  const main = document.getElementById('mainImage');
  const rail = document.getElementById('thumbRail');
  const active = rail.querySelector('.is-active');
  return {
    mainSrc: (main.src || '').match(/hero-\d+\.png|01\.jpg/)?.[0] || '(unknown)',
    activeType: active?.dataset.photoType || null,
    activeTitle: active?.title || null,
  };
});

console.log('  initial:', JSON.stringify(await inspect()));
await page.screenshot({ path: next('swhero-1-initial'), fullPage: false });

console.log('[2/4] Clicking Blue Sharkskin swatch → expect main = hero-02…');
await page.click('.swatch-btn[data-design="vbc-wool-blue-sharkskin"]');
await waitForImg();
await new Promise(r => setTimeout(r, 600));
console.log('  after swatch:', JSON.stringify(await inspect()));
await page.screenshot({ path: next('swhero-2-swatch-blue-sharkskin'), fullPage: false });

console.log('[3/4] Clicking Dark Blue Houndstooth swatch → expect hero-02 again…');
await page.click('.swatch-btn[data-design="vbc-wool-dark-blue-houndstooth"]');
await waitForImg();
await new Promise(r => setTimeout(r, 600));
console.log('  after swatch:', JSON.stringify(await inspect()));
await page.screenshot({ path: next('swhero-3-swatch-dark-blue'), fullPage: false });

console.log('[4/4] Clicking the fabric thumb in left rail → expect main = fabric…');
await page.click('#thumbRail button[data-photo-type="design"]');
await waitForImg();
await new Promise(r => setTimeout(r, 600));
console.log('  after fabric thumb:', JSON.stringify(await inspect()));
await page.screenshot({ path: next('swhero-4-fabric-thumb'), fullPage: false });

await browser.close();
console.log('\n✅ Done');
