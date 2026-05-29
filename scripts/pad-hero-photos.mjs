#!/usr/bin/env node
// Re-process the Cavani hero photos so the model has breathing room.
// The source photos have the model touching the top/bottom edge with no
// margin. We extend the canvas by ~6% on each side (top/bottom only) and
// fill the new pixels by replicating the existing top/bottom row — that
// stretches the studio backdrop's natural gradient seamlessly into the
// new margin, so there's no visible seam.
//
// Output: writes padded versions back to disk, then uploads to Supabase
// Storage (overwriting the originals at the same paths).

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

const SOURCE_DIR  = 'Cavani Designs/Cavani Hero photos';
const PADDED_DIR  = 'Cavani Designs/Cavani Hero photos/padded';
const TOP_PCT     = 0.07;   // 7% extra above
const BOT_PCT     = 0.04;   // 4% extra below

const FILES = [
  { src: 'Man in black pinstripe suit.png',   target: 'hero/formal-suit-2-piece__cavani-wool/01.png' },
  { src: 'Man in black pinstripe suit 2.png', target: 'hero/formal-suit-2-piece__cavani-wool/02.png' },
];

if (!fs.existsSync(PADDED_DIR)) fs.mkdirSync(PADDED_DIR, { recursive: true });

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });

for (const f of FILES) {
  const page = await browser.newPage();   // fresh page per file — no state leak
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

        const topPad = Math.round(img.height * ${TOP_PCT});
        const botPad = Math.round(img.height * ${BOT_PCT});
        const newW = img.width;
        const newH = img.height + topPad + botPad;

        outC.width = newW; outC.height = newH;
        const outCtx = outC.getContext('2d');

        // Stretch the existing top row upward into the new top margin.
        // This faithfully reproduces the backdrop's gradient at that y-position.
        outCtx.drawImage(srcC, 0, 0, newW, 1,    0, 0,        newW, topPad);
        // Stretch the bottom row downward.
        outCtx.drawImage(srcC, 0, img.height-1, newW, 1,
                                0, topPad + img.height, newW, botPad);
        // Paste the original photo in between.
        outCtx.drawImage(srcC, 0, topPad);

        outC.toBlob(blob => {
          const reader = new FileReader();
          reader.onload = () => {
            window._result = reader.result;
            window._dims = { w: newW, h: newH };
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
  console.log(`  ✓ ${f.src}  →  ${outPath}  (${dims.w}×${dims.h}, ${(out.length/1024/1024).toFixed(1)} MB)`);

  // Upload to Supabase Storage (overwriting the existing object)
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/crf-products/${f.target}`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'image/png',
      'x-upsert': 'true',
    },
    body: out,
  });
  console.log(`    → uploaded to crf-products/${f.target}  HTTP ${r.status}`);
  await page.close();
}

await browser.close();
console.log('\n✅ Padded photos written & uploaded.');
