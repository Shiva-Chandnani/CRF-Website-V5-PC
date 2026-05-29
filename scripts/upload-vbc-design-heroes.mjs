#!/usr/bin/env node
// Per-design hero photos for the Vitale Barberis Canonico Wool fabric.
// Each design gets two model photos (hero 01 + hero 02), used by the PDP's
// left thumb rail.
//
//   1) Upload 18 PNGs to crf-fabrics/{fabric_number}/hero-01.png  /  hero-02.png
//   2) INSERT 18 rows into fabric_design_photos with photo_type='hero'
//   3) Smoke-test public URLs
//   4) Verify the v_products view exposes design_hero_paths for VBC rows
//
// Run from project root: node scripts/upload-vbc-design-heroes.mjs

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
const SRC_DIR = 'Vitale Barberis Canonico/new hero photos';

const headers = {
  'apikey': SERVICE_KEY,
  'Authorization': `Bearer ${SERVICE_KEY}`,
};

// (file-name prefix on disk)  →  (fabric_design_id, fabric_number, design_name)
// The disk filenames use "Gray" / "Hound Stooth"; our DB uses "Grey" /
// "Houndstooth". The disk side is authoritative here — the keys must match.
const DESIGNS = [
  { disk: 'VBC - Gray Herringbone',       id: 'vbc-wool-grey-herringbone',      num: 'WL-1129', name: 'Grey Herringbone' },
  { disk: 'VBC - Dark Blue Hound Stooth', id: 'vbc-wool-dark-blue-houndstooth', num: 'WL-1130', name: 'Dark Blue Houndstooth' },
  { disk: 'VBC - Blue Hound Stooth',      id: 'vbc-wool-blue-houndstooth',      num: 'WL-1131', name: 'Blue Houndstooth' },
  { disk: 'VBC - Black Hound Stooth',     id: 'vbc-wool-black-houndstooth',     num: 'WL-1132', name: 'Black Houndstooth' },
  { disk: 'VBC - Blue Chalk Stripe',      id: 'vbc-wool-blue-chalk-stripe',     num: 'WL-1133', name: 'Blue Chalk Stripe' },
  { disk: 'VBC - Dark Grey Pinstripe',    id: 'vbc-wool-dark-grey-pinstripe',   num: 'WL-1134', name: 'Dark Grey Pinstripe' },
  { disk: 'VBC - Ash Grey Pinstripe',     id: 'vbc-wool-ash-grey-pinstripe',    num: 'WL-1135', name: 'Ash Grey Pinstripe' },
  { disk: 'VBC - Grey Pinstripe',         id: 'vbc-wool-grey-pinstripe',        num: 'WL-1136', name: 'Grey Pinstripe' },
  { disk: 'VBC - Blue Sharkskin',         id: 'vbc-wool-blue-sharkskin',        num: 'WL-1137', name: 'Blue Sharkskin' },
];

// Build 18 photo records: 2 heroes per design
const PHOTOS = DESIGNS.flatMap(d => [
  { ...d, slot: '01', display_order: 5 },
  { ...d, slot: '02', display_order: 6 },
]);

// ----- 0. Verify all 18 source files exist on disk -----
console.log(`\n[0/4] Verifying ${PHOTOS.length} source files on disk…`);
const missing = [];
for (const p of PHOTOS) {
  const fp = path.join(SRC_DIR, `${p.disk} - hero ${p.slot}.png`);
  if (!fs.existsSync(fp)) missing.push(fp);
}
if (missing.length) {
  console.error(`Missing files (${missing.length}):`);
  missing.forEach(m => console.error('  ✗', m));
  process.exit(1);
}
console.log(`✓ All ${PHOTOS.length} source files present.`);

// ----- 1. Upload photos to crf-fabrics/{fabric_number}/hero-{01,02}.png -----
console.log(`\n[1/4] Uploading ${PHOTOS.length} photos to crf-fabrics/…`);
async function uploadOne(p) {
  const fp = path.join(SRC_DIR, `${p.disk} - hero ${p.slot}.png`);
  const buf = fs.readFileSync(fp);
  const target = `${p.num}/hero-${p.slot}.png`;
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/crf-fabrics/${target}`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'image/png', 'x-upsert': 'true' },
    body: buf,
  });
  if (!r.ok) throw new Error(`${p.num}/hero-${p.slot}: HTTP ${r.status} ${await r.text()}`);
  return { path: target, bytes: buf.length };
}
const uploads = await Promise.allSettled(PHOTOS.map(uploadOne));
const upFails = uploads.filter(x => x.status === 'rejected');
if (upFails.length) {
  console.error(`✗ ${upFails.length} uploads failed:`);
  upFails.forEach(f => console.error('   ', f.reason.message));
  process.exit(1);
}
const totalBytes = uploads.reduce((s, r) => s + r.value.bytes, 0);
console.log(`✓ Uploaded ${PHOTOS.length} files (${(totalBytes / 1024 / 1024).toFixed(1)} MB total)`);

// ----- 2. INSERT fabric_design_photos rows with photo_type='hero' -----
console.log(`\n[2/4] INSERTing ${PHOTOS.length} rows into fabric_design_photos…`);
const photoRows = PHOTOS.map(p => ({
  fabric_design_id: p.id,
  image_path: `${p.num}/hero-${p.slot}.png`,
  alt_text: `${p.name} — Vitale Barberis Canonico Wool · look ${p.slot}`,
  is_primary: false,
  display_order: p.display_order,
  photo_type: 'hero',
}));
const r2 = await fetch(`${SUPABASE_URL}/rest/v1/fabric_design_photos`, {
  method: 'POST',
  headers: { ...headers, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
  body: JSON.stringify(photoRows),
});
if (!r2.ok) {
  console.error('  ✗ FAIL', r2.status, await r2.text());
  process.exit(1);
}
console.log(`✓ Inserted ${PHOTOS.length} hero photo rows (HTTP ${r2.status})`);

// ----- 3. Smoke-test public URLs -----
console.log(`\n[3/4] Smoke-testing public photo URLs…`);
const smokes = await Promise.all(PHOTOS.map(async p => {
  const url = `${SUPABASE_URL}/storage/v1/object/public/crf-fabrics/${p.num}/hero-${p.slot}.png`;
  const r = await fetch(url, { method: 'HEAD' });
  return { path: `${p.num}/hero-${p.slot}.png`, status: r.status, ok: r.ok };
}));
const smokeFails = smokes.filter(s => !s.ok);
if (smokeFails.length) {
  console.error(`✗ ${smokeFails.length} URLs failed:`);
  smokeFails.forEach(f => console.error(`    ${f.path} → HTTP ${f.status}`));
} else {
  console.log(`✓ All ${PHOTOS.length} URLs return 200`);
}

// ----- 4. Verify v_products row count + array length -----
console.log(`\n[4/4] Verifying v_products design_hero_paths…`);
const r4 = await fetch(
  `${SUPABASE_URL}/rest/v1/v_products?fabric_type_id=eq.vbc-wool&item_type_id=eq.formal-suit-2-piece&select=fabric_design_id,design_hero_paths`,
  { headers }
);
const rows = await r4.json();
const withHeroes = rows.filter(r => Array.isArray(r.design_hero_paths) && r.design_hero_paths.length === 2);
console.log(`  VBC Suit rows: ${rows.length}   (expect 9)`);
console.log(`  Rows with 2 heroes: ${withHeroes.length}   (expect 9)`);
if (rows.length !== 9 || withHeroes.length !== 9) {
  console.log('\n⚠️  Mismatch — inspecting:');
  console.log(JSON.stringify(rows.slice(0, 3), null, 2));
  process.exit(1);
}
console.log('\n✅ Done — per-design hero photos live.');
