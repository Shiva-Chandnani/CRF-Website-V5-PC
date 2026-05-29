#!/usr/bin/env node
// Batch upload Cavani Wool designs:
//   1) INSERT 23 rows into fabric_designs
//   2) Upload 23 photos to Supabase Storage at crf-fabrics/{fabric_number}/01.jpg
//   3) INSERT 23 rows into fabric_design_photos
//   4) Smoke-test public URLs, verify v_products count
//
// Requires: .env.local with SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
// Run from project root: node scripts/upload-cavani-batch.mjs

import fs from 'node:fs';
import path from 'node:path';

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8')
    .split('\n').filter(Boolean)
    .map(l => l.split('=').map(s => s.trim()))
    .map(([k, ...v]) => [k, v.join('=')])
);
const SUPABASE_URL = env.SUPABASE_URL;
const SERVICE_KEY  = env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}
const PHOTO_DIR = 'Cavani Designs';

const headers = {
  'apikey': SERVICE_KEY,
  'Authorization': `Bearer ${SERVICE_KEY}`,
};

// ----- 23 designs: filename → all metadata -----
// filename is matched against the actual on-disk filename in 'Cavani Designs/'
const DESIGNS = [
  { file: 'Cavani - Gray Pinstripe.jpg',              num: 'WL-1106', id: 'cavani-wool-grey-pinstripe',              name: 'Grey Pinstripe',               color: ['grey'],        pattern: 'pinstripe',  order: 40 },
  { file: 'Cavani - Plain Dark Green.jpg',            num: 'WL-1107', id: 'cavani-wool-dark-green-solid',            name: 'Dark Green Solid',             color: ['green'],       pattern: 'solid',      order: 50 },
  { file: 'Cavani - Plain Maroon.jpg',                num: 'WL-1108', id: 'cavani-wool-maroon-solid',                name: 'Maroon Solid',                 color: ['burgundy'],    pattern: 'solid',      order: 60 },
  { file: 'Cavani - Heathered Gray, Blue.jpg',        num: 'WL-1109', id: 'cavani-wool-heathered-grey-blue',         name: 'Heathered Grey & Blue',        color: ['grey','blue'], pattern: 'solid',      order: 70 },
  { file: 'Cavani - Heathered Gray,Black.jpg',        num: 'WL-1110', id: 'cavani-wool-heathered-grey-black',        name: 'Heathered Grey & Black',       color: ['grey','black'],pattern: 'solid',      order: 80 },
  { file: 'Cavani - Plain Ash Black.jpg',             num: 'WL-1111', id: 'cavani-wool-ash-black-solid',             name: 'Ash Black Solid',              color: ['black'],       pattern: 'solid',      order: 90 },
  { file: 'Cavani  - black pinstripe.jpg',            num: 'WL-1112', id: 'cavani-wool-black-pinstripe',             name: 'Black Pinstripe',              color: ['black'],       pattern: 'pinstripe',  order: 100 },
  { file: 'Cavavni - Plain Kakhi.jpg',                num: 'WL-1113', id: 'cavani-wool-khaki-solid',                 name: 'Khaki Solid',                  color: ['tan'],         pattern: 'solid',      order: 110 },
  { file: 'Cavani - Gray, black Windowpane.jpg',      num: 'WL-1114', id: 'cavani-wool-grey-black-windowpane',       name: 'Grey & Black Windowpane',      color: ['grey','black'],pattern: 'windowpane', order: 120 },
  { file: 'Cavani - Plain Cream.jpg',                 num: 'WL-1115', id: 'cavani-wool-cream-solid',                 name: 'Cream Solid',                  color: ['cream'],       pattern: 'solid',      order: 130 },
  { file: 'Cavani - Plain Dark Gray.jpg',             num: 'WL-1116', id: 'cavani-wool-dark-grey-solid',             name: 'Dark Grey Solid',              color: ['grey'],        pattern: 'solid',      order: 140 },
  { file: 'Cavani - Black, Blue Prince of Whales.jpg',num: 'WL-1117', id: 'cavani-wool-black-blue-prince-of-wales',  name: 'Black & Blue Prince of Wales', color: ['black','blue'],pattern: 'glen-plaid', order: 150 },
  { file: 'Cavani - Plain Ash Grey.jpg',              num: 'WL-1118', id: 'cavani-wool-ash-grey-solid',              name: 'Ash Grey Solid',               color: ['grey'],        pattern: 'solid',      order: 160 },
  { file: 'Cavani - Plain Midnight Blue.jpg',         num: 'WL-1119', id: 'cavani-wool-midnight-blue-solid',         name: 'Midnight Blue Solid',          color: ['navy'],        pattern: 'solid',      order: 170 },
  { file: 'Cavani - Plain Black.jpg',                 num: 'WL-1120', id: 'cavani-wool-black-solid',                 name: 'Black Solid',                  color: ['black'],       pattern: 'solid',      order: 180 },
  { file: 'Cavani - Brown plain.jpg',                 num: 'WL-1121', id: 'cavani-wool-brown-solid',                 name: 'Brown Solid',                  color: ['brown'],       pattern: 'solid',      order: 190 },
  { file: 'Cavani - White Plain.jpg',                 num: 'WL-1122', id: 'cavani-wool-white-solid',                 name: 'White Solid',                  color: ['white'],       pattern: 'solid',      order: 200 },
  { file: 'Cavani - Gray Sharkskin.jpg',              num: 'WL-1123', id: 'cavani-wool-grey-sharkskin',              name: 'Grey Sharkskin',               color: ['grey'],        pattern: 'twill',      order: 210 },
  { file: 'Cavani - Dark Blue Plain.jpg',             num: 'WL-1124', id: 'cavani-wool-dark-blue-solid',             name: 'Dark Blue Solid',              color: ['navy'],        pattern: 'solid',      order: 220 },
  { file: 'Cavani - Black:Blue Checks.jpg',           num: 'WL-1125', id: 'cavani-wool-black-blue-check',            name: 'Black & Blue Check',           color: ['black','blue'],pattern: 'check',      order: 230 },
  { file: 'Cavani - Dark blue Windowpane.jpg',        num: 'WL-1126', id: 'cavani-wool-dark-blue-windowpane',        name: 'Dark Blue Windowpane',         color: ['navy'],        pattern: 'windowpane', order: 240 },
  { file: 'Cavani - Dark Grey Pinstripe.jpg',         num: 'WL-1127', id: 'cavani-wool-dark-grey-pinstripe',         name: 'Dark Grey Pinstripe',          color: ['grey'],        pattern: 'pinstripe',  order: 250 },
  { file: 'Cavani - Dark Grey Windowpane.jpg',        num: 'WL-1128', id: 'cavani-wool-dark-grey-windowpane',        name: 'Dark Grey Windowpane',         color: ['grey'],        pattern: 'windowpane', order: 260 },
];

// --- 0. Verify every source file exists on disk ---
console.log(`\n[0/5] Verifying ${DESIGNS.length} source files on disk…`);
const missing = [];
for (const d of DESIGNS) {
  const fp = path.join(PHOTO_DIR, d.file);
  if (!fs.existsSync(fp)) missing.push(d.file);
}
if (missing.length) {
  console.error(`Missing files (${missing.length}):`);
  missing.forEach(m => console.error('  ✗', m));
  process.exit(1);
}
console.log(`✓ All ${DESIGNS.length} source files present.`);

// --- 1. INSERT fabric_designs (one batch POST) ---
console.log(`\n[1/5] INSERTing ${DESIGNS.length} rows into fabric_designs…`);
const fabricRows = DESIGNS.map(d => ({
  id: d.id,
  fabric_type_id: 'cavani-wool',
  fabric_number: d.num,
  name: d.name,
  color: d.color,
  pattern: d.pattern,
  display_order: d.order,
}));
const r1 = await fetch(`${SUPABASE_URL}/rest/v1/fabric_designs`, {
  method: 'POST',
  headers: { ...headers, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
  body: JSON.stringify(fabricRows),
});
if (!r1.ok) {
  console.error('  ✗ FAIL', r1.status, await r1.text());
  process.exit(1);
}
console.log(`✓ Inserted ${DESIGNS.length} fabric_designs rows (HTTP ${r1.status})`);

// --- 2. Upload photos to Storage ---
console.log(`\n[2/5] Uploading ${DESIGNS.length} photos to crf-fabrics/…`);
async function uploadOne(d) {
  const fp = path.join(PHOTO_DIR, d.file);
  const buf = fs.readFileSync(fp);
  const target = `${d.num}/01.jpg`;
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/crf-fabrics/${target}`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'image/jpeg', 'x-upsert': 'true' },
    body: buf,
  });
  if (!r.ok) throw new Error(`${d.num}: HTTP ${r.status} ${await r.text()}`);
  return { num: d.num, bytes: buf.length };
}
const uploadResults = await Promise.allSettled(DESIGNS.map(uploadOne));
const uploadFails = uploadResults.filter(x => x.status === 'rejected');
if (uploadFails.length) {
  console.error(`  ✗ ${uploadFails.length} uploads failed:`);
  uploadFails.forEach(f => console.error('   ', f.reason.message));
  process.exit(1);
}
const totalBytes = uploadResults.reduce((sum, r) => sum + r.value.bytes, 0);
console.log(`✓ Uploaded ${DESIGNS.length} files (${(totalBytes/1024/1024).toFixed(1)} MB total)`);

// --- 3. INSERT fabric_design_photos (one batch POST) ---
console.log(`\n[3/5] INSERTing ${DESIGNS.length} rows into fabric_design_photos…`);
const photoRows = DESIGNS.map(d => ({
  fabric_design_id: d.id,
  image_path: `${d.num}/01.jpg`,
  alt_text: `${d.name} — Cavani Wool fabric ${d.num}`,
  is_primary: true,
  display_order: 10,
}));
const r3 = await fetch(`${SUPABASE_URL}/rest/v1/fabric_design_photos`, {
  method: 'POST',
  headers: { ...headers, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
  body: JSON.stringify(photoRows),
});
if (!r3.ok) {
  console.error('  ✗ FAIL', r3.status, await r3.text());
  process.exit(1);
}
console.log(`✓ Inserted ${DESIGNS.length} fabric_design_photos rows (HTTP ${r3.status})`);

// --- 4. Smoke-test public URLs ---
console.log(`\n[4/5] Smoke-testing public photo URLs…`);
const smokeResults = await Promise.all(DESIGNS.map(async d => {
  const url = `${SUPABASE_URL}/storage/v1/object/public/crf-fabrics/${d.num}/01.jpg`;
  const r = await fetch(url, { method: 'HEAD' });
  return { num: d.num, status: r.status, ok: r.ok };
}));
const smokeFails = smokeResults.filter(r => !r.ok);
if (smokeFails.length) {
  console.error(`  ✗ ${smokeFails.length} URLs failed:`);
  smokeFails.forEach(f => console.error(`    ${f.num} → HTTP ${f.status}`));
} else {
  console.log(`✓ All ${DESIGNS.length} URLs return 200`);
}

// --- 5. Verify final counts ---
console.log(`\n[5/5] Verifying catalogue counts…`);
const r5a = await fetch(`${SUPABASE_URL}/rest/v1/fabric_designs?fabric_type_id=eq.cavani-wool&select=fabric_number`, { headers });
const designs = await r5a.json();
const r5b = await fetch(`${SUPABASE_URL}/rest/v1/v_products?fabric_type_id=eq.cavani-wool&select=product_id`, { headers });
const products = await r5b.json();
console.log(`  Cavani designs in DB:        ${designs.length}   (expect 26)`);
console.log(`  Cavani products in v_products: ${products.length}   (expect 78 = 26 × 3 item types)`);

const expectedDesigns = 26, expectedProducts = 78;
const ok = designs.length === expectedDesigns && products.length === expectedProducts && smokeFails.length === 0;
console.log(`\n${ok ? '✅ Done — catalogue ready.' : '⚠️  Counts off — investigate above.'}`);
process.exit(ok ? 0 : 1);
