#!/usr/bin/env node
// Pad each VBC per-design hero PNG so it matches the site's standard hero
// aspect ratio (1054 / 1656 ≈ 0.6364) — same ratio used by the shop card's
// `.product-card.has-hero` rule. The hero 01 photos are already at this
// aspect; the hero 02 photos are noticeably wider and need top/bottom
// padding to match.
//
// Padding strategy: extend the canvas top/bottom only, replicating the top
// row and bottom row of the original photo so the studio backdrop's gradient
// continues seamlessly into the new margin. ~64% of the new padding goes to
// the top (matches the bias used by scripts/pad-hero-photos.mjs).
//
// Output: PNGs written to assets/.padded-design-heroes/ (gitignored — local
// scratch), then re-uploaded to crf-fabrics/{fabric_number}/hero-{01,02}.png
// with x-upsert: true (overwrites the previously-uploaded unpadded versions).

import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer';

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8').split('\n').filter(Boolean)
    .map(l => l.split('=').map(s => s.trim()))
    .map(([k, ...v]) => [k, v.join('=')])
);
const SUPABASE_URL = env.SUPABASE_URL;
const SERVICE_KEY  = env.SUPABASE_SERVICE_ROLE_KEY;

const SOURCE_DIR  = 'Vitale Barberis Canonico/new hero photos';
const PADDED_DIR  = 'Vitale Barberis Canonico/new hero photos/padded';
const TARGET_ASPECT = 1054 / 1656;  // 0.63647
const TOP_BIAS = 0.64;              // ~64% of total padding goes above the model

// (disk file prefix) → (fabric_number)
const DESIGNS = [
  { disk: 'VBC - Gray Herringbone',       num: 'WL-1129' },
  { disk: 'VBC - Dark Blue Hound Stooth', num: 'WL-1130' },
  { disk: 'VBC - Blue Hound Stooth',      num: 'WL-1131' },
  { disk: 'VBC - Black Hound Stooth',     num: 'WL-1132' },
  { disk: 'VBC - Blue Chalk Stripe',      num: 'WL-1133' },
  { disk: 'VBC - Dark Grey Pinstripe',    num: 'WL-1134' },
  { disk: 'VBC - Ash Grey Pinstripe',     num: 'WL-1135' },
  { disk: 'VBC - Grey Pinstripe',         num: 'WL-1136' },
  { disk: 'VBC - Blue Sharkskin',         num: 'WL-1137' },
];

// Flatten to 18 files
const FILES = DESIGNS.flatMap(d => ['01', '02'].map(slot => ({
  src: `${d.disk} - hero ${slot}.png`,
  target: `${d.num}/hero-${slot}.png`,
  label: `${d.num}/hero-${slot}`,
})));

if (!fs.existsSync(PADDED_DIR)) fs.mkdirSync(PADDED_DIR, { recursive: true });

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });

for (const f of FILES) {
  const page = await browser.newPage();
  const srcPath = path.join(SOURCE_DIR, f.src);
  const outPath = path.join(PADDED_DIR,  f.src);
  const buf = fs.readFileSync(srcPath);
  const b64 = buf.toString('base64');

  await page.setContent(`
    <canvas id=src style="display:none"></canvas>
    <canvas id=out style="display:none"></canvas>
    <script>
      window._done = false;
      const img = new Image();
      img.onload = () => {
        const srcC = document.getElementById('src');
        const outC = document.getElementById('out');
        srcC.width = img.width;  srcC.height = img.height;
        const srcCtx = srcC.getContext('2d');
        srcCtx.drawImage(img, 0, 0);

        const targetAspect = ${TARGET_ASPECT};
        const currentAspect = img.width / img.height;
        const newW = img.width;
        let topPad = 0, botPad = 0;

        if (currentAspect > targetAspect) {
          // Too wide → grow height
          const desiredH = Math.round(img.width / targetAspect);
          const totalPad = desiredH - img.height;
          topPad = Math.round(totalPad * ${TOP_BIAS});
          botPad = totalPad - topPad;
        }
        const newH = img.height + topPad + botPad;

        outC.width = newW; outC.height = newH;
        const outCtx = outC.getContext('2d');

        // Replicate the existing top row into the new top margin.
        if (topPad > 0) outCtx.drawImage(srcC, 0, 0, newW, 1, 0, 0, newW, topPad);
        // Replicate the existing bottom row into the new bottom margin.
        if (botPad > 0) outCtx.drawImage(srcC, 0, img.height-1, newW, 1, 0, topPad + img.height, newW, botPad);
        // Paste the original photo in between.
        outCtx.drawImage(srcC, 0, topPad);

        outC.toBlob(blob => {
          const reader = new FileReader();
          reader.onload = () => {
            window._result = reader.result;
            window._dims = { w: newW, h: newH, topPad, botPad,
                              srcW: img.width, srcH: img.height,
                              srcAspect: currentAspect, newAspect: newW/newH };
            window._done = true;
          };
          reader.readAsDataURL(blob);
        }, 'image/png');
      };
      img.src = 'data:image/png;base64,${b64}';
    </script>
  `);
  await page.waitForFunction(() => window._done, { timeout: 30000 });
  const dataUrl = await page.evaluate(() => window._result);
  const dims    = await page.evaluate(() => window._dims);
  const out = Buffer.from(dataUrl.split(',')[1], 'base64');
  fs.writeFileSync(outPath, out);
  console.log(`  ✓ ${f.label}  ${dims.srcW}×${dims.srcH} (${dims.srcAspect.toFixed(4)}) → ${dims.w}×${dims.h} (${dims.newAspect.toFixed(4)})  +${dims.topPad}/-${dims.botPad}px`);

  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/crf-fabrics/${f.target}`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'image/png',
      'x-upsert': 'true',
    },
    body: out,
  });
  if (!r.ok) {
    console.error(`    ✗ upload failed: HTTP ${r.status}`, await r.text());
    process.exit(1);
  }
  await page.close();
}

await browser.close();

// Smoke-test
console.log('\nSmoke-testing public URLs…');
let allOk = true;
for (const f of FILES) {
  const url = `${SUPABASE_URL}/storage/v1/object/public/crf-fabrics/${f.target}`;
  const r = await fetch(url, { method: 'HEAD' });
  if (!r.ok) { console.error(`  ✗ ${f.target}  HTTP ${r.status}`); allOk = false; }
}
if (allOk) console.log(`  ✓ all ${FILES.length} URLs return 200`);

console.log(`\n${allOk ? '✅' : '⚠️'} Done. Target aspect: ${TARGET_ASPECT.toFixed(4)} (1054/1656).`);
