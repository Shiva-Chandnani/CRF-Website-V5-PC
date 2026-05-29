#!/usr/bin/env node
// Batch upload Vitale Barberis Canonico Wool designs:
//   1) INSERT 9 rows into fabric_designs
//   2) Upload 9 photos to Supabase Storage at crf-fabrics/{fabric_number}/01.jpg
//   3) INSERT 9 rows into fabric_design_photos
//   4) Smoke-test public URLs, verify v_products count
//
// Requires: .env.local with SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
// Run from project root: node scripts/upload-vbc-batch.mjs

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
const PHOTO_DIR = 'Vitale Barberis Canonico';

const headers = {
  'apikey': SERVICE_KEY,
  'Authorization': `Bearer ${SERVICE_KEY}`,
};

// ----- 9 designs: filename → all metadata -----
// filename matches the on-disk filename in 'Vitale Barberis Canonico/'
const DESIGNS = [
  { file: 'VBC - Gray Herringbone.jpg',       num: 'WL-1129', id: 'vbc-wool-grey-herringbone',      name: 'Grey Herringbone',     color: ['grey'],  pattern: 'herringbone',  order: 10 },
  { file: 'VBC - Dark Blue Hound Stooth.jpg', num: 'WL-1130', id: 'vbc-wool-dark-blue-houndstooth', name: 'Dark Blue Houndstooth', color: ['navy'],  pattern: 'houndstooth',  order: 20 },
  { file: 'VBC - Blue Hound Stooth.jpg',      num: 'WL-1131', id: 'vbc-wool-blue-houndstooth',      name: 'Blue Houndstooth',      color: ['blue'],  pattern: 'houndstooth',  order: 30 },
  { file: 'VBC - Black Hound Stooth.jpg',     num: 'WL-1132', id: 'vbc-wool-black-houndstooth',     name: 'Black Houndstooth',     color: ['black'], pattern: 'houndstooth',  order: 40 },
  { file: 'VBC - Blue Chalk Stripe.jpg',      num: 'WL-1133', id: 'vbc-wool-blue-chalk-stripe',     name: 'Blue Chalk Stripe',     color: ['blue'],  pattern: 'chalk-stripe', order: 50 },
  { file: 'VBC - Dark Grey Pinstripe.jpg',    num: 'WL-1134', id: 'vbc-wool-dark-grey-pinstripe',   name: 'Dark Grey Pinstripe',   color: ['grey'],  pattern: 'pinstripe',    order: 60 },
  { file: 'VBC - Ash Grey Pinstripe.jpg',     num: 'WL-1135', id: 'vbc-wool-ash-grey-pinstripe',    name: 'Ash Grey Pinstripe',    color: ['grey'],  pattern: 'pinstripe',    order: 70 },
  { file: 'VBC - Grey Pinstripe.jpg',         num: 'WL-1136', id: 'vbc-wool-grey-pinstripe',        name: 'Grey Pinstripe',        color: ['grey'],  pattern: 'pinstripe',    order: 80 },
  { file: 'VBC - Blue Sharkskin.jpg',         num: 'WL-1137', id: 'vbc-wool-blue-sharkskin',        name: 'Blue Sharkskin',        color: ['blue'],  pattern: 'twill',        order: 90 },
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
  fabric_type_id: 'vbc-wool',
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
  alt_text: `${d.name} — Vitale Barberis Canonico Wool fabric ${d.num}`,
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
const r5a = await fetch(`${SUPABASE_URL}/rest/v1/fabric_designs?fabric_type_id=eq.vbc-wool&select=fabric_number`, { headers });
const designs = await r5a.json();
const r5b = await fetch(`${SUPABASE_URL}/rest/v1/v_products?fabric_type_id=eq.vbc-wool&select=product_id`, { headers });
const products = await r5b.json();
console.log(`  VBC designs in DB:          ${designs.length}   (expect 9)`);
console.log(`  VBC products in v_products: ${products.length}   (expect 27 = 9 × 3 item types)`);

const expectedDesigns = 9, expectedProducts = 27;
const ok = designs.length === expectedDesigns && products.length === expectedProducts && smokeFails.length === 0;
console.log(`\n${ok ? '✅ Done — VBC catalogue ready.' : '⚠️  Counts off — investigate above.'}`);
process.exit(ok ? 0 : 1);
