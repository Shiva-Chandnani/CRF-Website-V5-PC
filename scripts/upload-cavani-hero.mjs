#!/usr/bin/env node
// Upload the 2 Cavani Wool Suit hero photos to Supabase Storage.
// Reads creds from .env.local; writes to bucket crf-products under:
//   hero/formal-suit-2-piece__cavani-wool/01.png  (default — full body)
//   hero/formal-suit-2-piece__cavani-wool/02.png  (hover — closeup)

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
const headers = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };

const SOURCE_DIR = 'Cavani Designs/Cavani Hero photos';
const TARGET_PREFIX = 'hero/formal-suit-2-piece__cavani-wool';

const FILES = [
  { src: 'Man in black pinstripe suit.png',   target: `${TARGET_PREFIX}/01.png`, role: 'default (full body)' },
  { src: 'Man in black pinstripe suit 2.png', target: `${TARGET_PREFIX}/02.png`, role: 'hover (closeup)' },
];

console.log(`Uploading ${FILES.length} hero photos to crf-products/${TARGET_PREFIX}/…`);

for (const f of FILES) {
  const fp = path.join(SOURCE_DIR, f.src);
  if (!fs.existsSync(fp)) { console.error(`✗ Missing: ${fp}`); process.exit(1); }
  const buf = fs.readFileSync(fp);
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/crf-products/${f.target}`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'image/png', 'x-upsert': 'true' },
    body: buf,
  });
  if (!r.ok) { console.error(`✗ ${f.target}: HTTP ${r.status}`, await r.text()); process.exit(1); }
  console.log(`  ✓ ${f.target}  (${f.role}, ${(buf.length/1024/1024).toFixed(1)} MB)`);
}

// Smoke-test
console.log(`\nSmoke-testing public URLs…`);
for (const f of FILES) {
  const url = `${SUPABASE_URL}/storage/v1/object/public/crf-products/${f.target}`;
  const r = await fetch(url, { method: 'HEAD' });
  console.log(`  ${r.ok ? '✓' : '✗'} ${f.target}  HTTP ${r.status}`);
}
console.log('\n✅ Hero photos in Storage.');
