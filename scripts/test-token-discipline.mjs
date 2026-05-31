// Phase 0 lint: forbid legacy button class attribute use, hardcoded #000/#fff
// outside token definitions, and `transition: all` anywhere across pages + base.css.

import fs from 'node:fs';

const PAGES = [
  'index.html', 'shop.html', 'product.html', 'cart.html',
  'book-appointment.html', 'in-store.html',
];
const BASE_CSS = 'css/base.css';

let failures = 0;
function fail(file, line, msg) {
  console.error(`✘ ${file}:${line}  ${msg}`);
  failures++;
}

function checkFile(file, rules) {
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const r of rules) {
      if (r.pattern.test(line) && !(r.allow && r.allow.test(line))) {
        fail(file, i + 1, r.message + ' → ' + line.trim().slice(0, 100));
      }
    }
  }
}

// Rules for HTML pages
const htmlRules = [
  { pattern: /class="[^"]*\bbtn-primary\b/,       message: 'legacy .btn-primary class — use .btn--primary' },
  { pattern: /class="[^"]*\bbtn-dark\b/,          message: 'legacy .btn-dark class — use .btn--primary' },
  { pattern: /class="[^"]*\bbtn-outline\b/,       message: 'legacy .btn-outline class — use .btn--ghost' },
  { pattern: /class="[^"]*\bbtn-light\b/,         message: 'legacy .btn-light class — use .btn--light' },
  { pattern: /class="[^"]*\bbtn-outline-light\b/, message: 'legacy .btn-outline-light class — use .btn--ghost-light' },
  { pattern: /transition:\s*all\b/,               message: 'transition: all is forbidden — name specific properties' },
  {
    pattern: /(?:background(?:-color)?|color|border(?:-color)?|fill|stroke)\s*:\s*#(?:000(?:000)?)\b/i,
    allow: /^\s*--color-jet\s*:\s*#0E0F11\s*;?\s*$/,
    message: 'hardcoded #000 / #000000 — use var(--color-jet)',
  },
  {
    pattern: /(?:background(?:-color)?|color|border(?:-color)?|fill|stroke)\s*:\s*#(?:fff(?:fff)?)\b/i,
    allow: /^\s*--color-(?:white|off-white)\s*:\s*#(?:FFFFFF|FAF8F4)\s*;?\s*$/,
    message: 'hardcoded #fff / #ffffff — use var(--color-white) or var(--color-off-white)',
  },
];

// Rules for base.css — same minus the legacy class checks
const cssRules = [
  { pattern: /transition:\s*all\b/, message: 'transition: all is forbidden' },
];

for (const f of PAGES) checkFile(f, htmlRules);
checkFile(BASE_CSS, cssRules);

if (failures) {
  console.error(`\n❌ ${failures} token-discipline violation(s)`);
  process.exit(1);
}
console.log(`✅ token discipline clean across ${PAGES.length + 1} files`);
