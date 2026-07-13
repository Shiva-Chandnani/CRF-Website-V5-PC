// Generate sitemap.xml from static pages + canonical (item x fabric) PDP URLs.
// Reads v_products via the anon key in .env.local. Run: node scripts/generate-sitemap.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const ORIGIN = 'https://countryroadfashions.com';

// --- minimal .env.local reader (no dotenv dependency, matching repo convention) ---
const env = {};
for (const line of fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const SUPABASE_URL = env.SUPABASE_URL || 'https://fzgsogdceptjvuahukbn.supabase.co';
const ANON = env.SUPABASE_ANON_KEY;

const STATIC_PATHS = [
  { loc: '/', priority: '1.0', changefreq: 'weekly' },
  { loc: '/shop.html', priority: '0.9', changefreq: 'weekly' },
  { loc: '/book-appointment.html', priority: '0.7', changefreq: 'monthly' },
  { loc: '/in-store.html', priority: '0.6', changefreq: 'monthly' },
  { loc: '/privacy.html', priority: '0.2', changefreq: 'yearly' },
];

const today = new Date().toISOString().slice(0, 10);

async function main() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/v_products?select=item_type_id,fabric_type_id`,
    { headers: { apikey: ANON, Authorization: `Bearer ${ANON}` } }
  );
  if (!res.ok) throw new Error(`v_products fetch failed: ${res.status}`);
  const rows = await res.json();

  // Dedupe to canonical (item x fabric) — no design param.
  const seen = new Set();
  const productPaths = [];
  for (const r of rows) {
    const key = `${r.item_type_id}__${r.fabric_type_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    productPaths.push(`/product.html?item=${r.item_type_id}&fabric=${r.fabric_type_id}`);
  }
  productPaths.sort();

  const urls = [
    ...STATIC_PATHS.map(s => ({ loc: s.loc, priority: s.priority, changefreq: s.changefreq })),
    ...productPaths.map(p => ({ loc: p, priority: '0.8', changefreq: 'monthly' })),
  ];

  const body = urls.map(u => `  <url>
    <loc>${ORIGIN}${u.loc.replace(/&/g, '&amp;')}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`).join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</urlset>
`;
  fs.writeFileSync(path.join(ROOT, 'sitemap.xml'), xml);
  console.log(`Wrote sitemap.xml with ${urls.length} URLs (${productPaths.length} products).`);
}
main().catch(e => { console.error(e); process.exit(1); });
