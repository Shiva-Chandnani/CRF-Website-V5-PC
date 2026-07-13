# SEO Baseline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a production-ready SEO baseline — real HTML meta/OG/canonical + JSON-LD on static pages, `setMeta()`-driven meta on dynamic pages, `robots.txt` + `sitemap.xml`, and `noindex` on private pages.

**Architecture:** Hybrid (approach C). Static indexable pages carry hardcoded `<head>` meta + literal JSON-LD (crawler + social-scraper robust, no JS). `js/meta.js` becomes a real tag-upsert utility used by the dynamic pages (`product.html`, `shop.html?q=`) to update title/description/canonical/OG and inject `Product`/`BreadcrumbList` JSON-LD after catalogue data loads. Private pages get `robots noindex`. A generator script emits a committed `sitemap.xml`.

**Tech Stack:** Static HTML + vanilla ES modules, Supabase JS (`v_products`), Node `http` dev server (`serve.mjs`), Puppeteer for e2e tests. No build step.

**Spec:** `docs/superpowers/specs/2026-07-13-seo-baseline-design.md`

**Key constants (used throughout):**
- `SITE_ORIGIN = 'https://countryroadfashions.com'`
- `DEFAULT_OG_IMAGE = 'https://fzgsogdceptjvuahukbn.supabase.co/storage/v1/render/image/public/crf-products/hero/formal-suit-2-piece__vbc-wool/01.png?width=1200'`
  - (Verify this exact object path resolves 200 during Task 1 Step 0; it is the VBC suit hero used on the shop card.)

---

## Task 1: Implement `js/meta.js` (tag-upsert utility)

**Files:**
- Modify: `js/meta.js` (replace the no-op body)

- [ ] **Step 0: Verify the default OG image path resolves**

Run:
```bash
curl -s -o /dev/null -w "%{http_code}\n" "https://fzgsogdceptjvuahukbn.supabase.co/storage/v1/render/image/public/crf-products/hero/formal-suit-2-piece__vbc-wool/01.png?width=1200"
```
Expected: `200`. If not, list the bucket (`node -e` with the service key, or check PROJECT.md §3 Storage) and substitute the correct hero object path in `DEFAULT_OG_IMAGE` before continuing.

- [ ] **Step 1: Replace `js/meta.js` with the real implementation**

```js
// =============================================================================
// Country Road Fashions — SEO + structured-data meta helper
// =============================================================================
// setMeta() upserts <title>, meta description, canonical, Open Graph, Twitter,
// and JSON-LD into <head>. Every managed tag carries a data-meta marker so
// repeat calls UPDATE the existing node instead of appending duplicates.
//
// Static indexable pages hardcode their meta directly in HTML (crawler +
// social-scraper robust). Dynamic pages (product.html, shop.html?q=) call
// setMeta() after their catalogue data loads.
// =============================================================================

export const SITE_ORIGIN = 'https://countryroadfashions.com';
export const SITE_NAME = 'Country Road Fashions';
export const DEFAULT_OG_IMAGE =
  'https://fzgsogdceptjvuahukbn.supabase.co/storage/v1/render/image/public/crf-products/hero/formal-suit-2-piece__vbc-wool/01.png?width=1200';

/** Absolute URL for a site-relative path+query (e.g. '/shop.html?category=suits'). */
export function canonicalFor(pathAndQuery) {
  if (!pathAndQuery) return SITE_ORIGIN + '/';
  return SITE_ORIGIN + (pathAndQuery.startsWith('/') ? pathAndQuery : '/' + pathAndQuery);
}

// Upsert a <meta> tag by its identifying attribute (`name` or `property`).
// Adopts an existing hardcoded tag if present (updates in place + stamps the
// data-meta marker) so a static page's baked-in tags are never duplicated;
// otherwise creates a fresh managed tag. The marker keeps later calls idempotent.
function upsertMeta(attr, key, content) {
  if (content == null) return;
  let el = document.head.querySelector(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute('data-meta', '');
  el.setAttribute('content', content);
}

const upsertMetaByName = (name, content) => upsertMeta('name', name, content);
const upsertMetaByProperty = (property, content) => upsertMeta('property', property, content);

function upsertCanonical(href) {
  if (href == null) return;
  let el = document.head.querySelector('link[rel="canonical"]');
  if (!el) {
    el = document.createElement('link');
    el.setAttribute('rel', 'canonical');
    document.head.appendChild(el);
  }
  el.setAttribute('data-meta', '');
  el.setAttribute('href', href);
}

/**
 * @param {object} opts
 * @param {string} [opts.title]
 * @param {string} [opts.description]
 * @param {string} [opts.canonical]     absolute URL (use canonicalFor())
 * @param {string} [opts.ogImage]       absolute URL; falls back to DEFAULT_OG_IMAGE
 * @param {string} [opts.ogType]        default 'website'
 * @param {object|object[]} [opts.jsonLd]  one or more schema.org objects
 * @param {string} [opts.robots]        e.g. 'noindex, nofollow'
 */
export function setMeta(opts = {}) {
  const { title, description, canonical, ogImage, ogType = 'website', jsonLd, robots } = opts;

  if (title != null) document.title = title;
  if (description != null) upsertMetaByName('description', description);
  if (robots != null) upsertMetaByName('robots', robots);
  if (canonical != null) upsertCanonical(canonical);

  // Open Graph
  if (title != null) upsertMetaByProperty('og:title', title);
  if (description != null) upsertMetaByProperty('og:description', description);
  if (canonical != null) upsertMetaByProperty('og:url', canonical);
  upsertMetaByProperty('og:type', ogType);
  upsertMetaByProperty('og:site_name', SITE_NAME);
  upsertMetaByProperty('og:locale', 'en_US');
  upsertMetaByProperty('og:image', ogImage || DEFAULT_OG_IMAGE);

  // Twitter
  upsertMetaByName('twitter:card', 'summary_large_image');
  if (title != null) upsertMetaByName('twitter:title', title);
  if (description != null) upsertMetaByName('twitter:description', description);
  upsertMetaByName('twitter:image', ogImage || DEFAULT_OG_IMAGE);

  // JSON-LD: clear prior managed blocks, then append one <script> per entry
  if (jsonLd != null) {
    document.head
      .querySelectorAll('script[type="application/ld+json"][data-meta-jsonld]')
      .forEach((n) => n.remove());
    const list = Array.isArray(jsonLd) ? jsonLd : [jsonLd];
    for (const obj of list) {
      const s = document.createElement('script');
      s.setAttribute('type', 'application/ld+json');
      s.setAttribute('data-meta-jsonld', '');
      s.textContent = JSON.stringify(obj);
      document.head.appendChild(s);
    }
  }
}
```

- [ ] **Step 2: Sanity-check the module parses**

Run: `node --input-type=module -e "import('./js/meta.js').then(m=>console.log(typeof m.setMeta, m.SITE_ORIGIN))"`
Expected: `function https://countryroadfashions.com` (the `document` refs are inside functions, so top-level import in Node does not touch the DOM).

- [ ] **Step 3: Commit**

```bash
git add js/meta.js
git commit -m "feat(seo): implement setMeta tag-upsert utility (#11)"
```

---

## Task 2: robots.txt, serve.mjs MIME, and noindex on private pages

**Files:**
- Create: `robots.txt`
- Modify: `serve.mjs:9-24` (MIME map)
- Modify (add one `<meta>` line to `<head>`): `login.html`, `signup.html`, `forgot-password.html`, `reset-password.html`, `account.html`, `measurements.html`, `cart.html`, `order-confirmation.html`

- [ ] **Step 1: Create `robots.txt`**

```
User-agent: *
Allow: /
Disallow: /account.html
Disallow: /cart.html
Disallow: /login.html
Disallow: /signup.html
Disallow: /forgot-password.html
Disallow: /reset-password.html
Disallow: /measurements.html
Disallow: /order-confirmation.html

Sitemap: https://countryroadfashions.com/sitemap.xml
```

- [ ] **Step 2: Add `.txt` and `.xml` to the `serve.mjs` MIME map**

In `serve.mjs`, add these two entries to the `MIME` object (after the `.json` line):
```js
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
```

- [ ] **Step 3: Add the noindex meta to each of the 8 private pages**

In the `<head>` of each listed private page, immediately AFTER the existing `<meta name="viewport" ...>` line, add:
```html
<meta name="robots" content="noindex, nofollow" />
```
(Do this for all 8: login, signup, forgot-password, reset-password, account, measurements, cart, order-confirmation.)

- [ ] **Step 4: Restart the dev server and verify robots.txt + a noindex page**

Run:
```bash
# restart serve.mjs if running, then:
curl -s -o /dev/null -w "%{http_code} %{content_type}\n" http://localhost:3000/robots.txt
curl -s http://localhost:3000/login.html | grep -c 'name="robots" content="noindex'
```
Expected: `200 text/plain; charset=utf-8` and `1`.

- [ ] **Step 5: Commit**

```bash
git add robots.txt serve.mjs login.html signup.html forgot-password.html reset-password.html account.html measurements.html cart.html order-confirmation.html
git commit -m "feat(seo): robots.txt + text/xml MIME + noindex on 8 private pages (#11)"
```

---

## Task 3: Static-page `<head>` meta + JSON-LD

**Files (modify `<head>` only):** `index.html`, `shop.html`, `book-appointment.html`, `in-store.html`, `privacy.html`

For **each** page, insert — immediately AFTER the existing `<title>...</title>` line — the block of meta below with that page's values. Keep the existing `<title>` (do not duplicate it). All canonical/OG URLs are absolute on `https://countryroadfashions.com`.

Per-page values:

| Page | canonical | `<title>` (leave as-is or set to) | description |
|---|---|---|---|
| `index.html` | `https://countryroadfashions.com/` | `Country Road Fashions — Bespoke Tailoring Since 1951` | `Bespoke tailoring house in Bangkok since 1951. Suits, jackets and trousers cut to your measurements in fine Cavani and Vitale Barberis Canonico wool. Book a consultation.` |
| `shop.html` | `https://countryroadfashions.com/shop.html` | `The Bespoke Collection — Country Road Fashions` | `Browse made-to-measure suits, jackets and trousers in premium wool. Hand-finished in our Bangkok atelier, cut to your measurements.` |
| `book-appointment.html` | `https://countryroadfashions.com/book-appointment.html` | `Book a Consultation — Country Road Fashions` | `Reserve an in-person fitting at our Bangkok atelier or an online consultation. Bespoke tailoring, measured and made for you.` |
| `in-store.html` | `https://countryroadfashions.com/in-store.html` | `Visit the Atelier — Country Road Fashions` | `Visit the Country Road Fashions atelier in Bangkok, or meet us at a trunk show. Bespoke tailoring since 1951.` |
| `privacy.html` | `https://countryroadfashions.com/privacy.html` | `Privacy Notice — Country Road Fashions` | `How Country Road Fashions collects, uses and protects your personal data under Thailand's PDPA.` |

- [ ] **Step 1: Add the shared meta block to each static page**

Template (substitute `{{CANONICAL}}`, `{{TITLE}}`, `{{DESCRIPTION}}` from the table; set the existing `<title>` text to the table's title):
```html
<meta name="description" content="{{DESCRIPTION}}" />
<link rel="canonical" href="{{CANONICAL}}" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="Country Road Fashions" />
<meta property="og:locale" content="en_US" />
<meta property="og:title" content="{{TITLE}}" />
<meta property="og:description" content="{{DESCRIPTION}}" />
<meta property="og:url" content="{{CANONICAL}}" />
<meta property="og:image" content="https://fzgsogdceptjvuahukbn.supabase.co/storage/v1/render/image/public/crf-products/hero/formal-suit-2-piece__vbc-wool/01.png?width=1200" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="{{TITLE}}" />
<meta name="twitter:description" content="{{DESCRIPTION}}" />
<meta name="twitter:image" content="https://fzgsogdceptjvuahukbn.supabase.co/storage/v1/render/image/public/crf-products/hero/formal-suit-2-piece__vbc-wool/01.png?width=1200" />
```

- [ ] **Step 2: Add `ClothingStore` + `WebSite` JSON-LD to `index.html`**

Append inside `index.html` `<head>` (after the meta block):
```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "ClothingStore",
  "name": "Country Road Fashions",
  "description": "Bespoke tailoring house in Bangkok, crafting made-to-measure suits, jackets and trousers since 1951.",
  "url": "https://countryroadfashions.com/",
  "logo": "https://countryroadfashions.com/brand_assets/CRF%20Logo.png",
  "image": "https://fzgsogdceptjvuahukbn.supabase.co/storage/v1/render/image/public/crf-products/hero/formal-suit-2-piece__vbc-wool/01.png?width=1200",
  "email": "Countryroadfashions@gmail.com",
  "priceRange": "฿฿฿",
  "foundingDate": "1951",
  "founder": { "@type": "Person", "name": "Tourmal Chandnani" },
  "areaServed": "TH",
  "address": {
    "@type": "PostalAddress",
    "streetAddress": "120/91 Ratchaprarop Road, Thanon Phaya Thai",
    "addressLocality": "Ratchathewi",
    "addressRegion": "Bangkok",
    "postalCode": "10400",
    "addressCountry": "TH"
  }
}
</script>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "WebSite",
  "name": "Country Road Fashions",
  "url": "https://countryroadfashions.com/",
  "potentialAction": {
    "@type": "SearchAction",
    "target": {
      "@type": "EntryPoint",
      "urlTemplate": "https://countryroadfashions.com/shop.html?q={search_term_string}"
    },
    "query-input": "required name=search_term_string"
  }
}
</script>
```

- [ ] **Step 3: Add the `ClothingStore` JSON-LD to `in-store.html`**

Append the same `ClothingStore` `<script type="application/ld+json">` block from Step 2 (identical content) inside `in-store.html` `<head>`.

- [ ] **Step 4: Verify raw HTML (no JS) carries the tags**

Run:
```bash
curl -s http://localhost:3000/ | grep -c 'rel="canonical" href="https://countryroadfashions.com/"'
curl -s http://localhost:3000/ | grep -c '"@type": "ClothingStore"'
curl -s http://localhost:3000/shop.html | grep -c 'property="og:title"'
curl -s http://localhost:3000/privacy.html | grep -c 'name="description"'
```
Expected: each prints `1` (or more).

- [ ] **Step 5: Commit**

```bash
git add index.html shop.html book-appointment.html in-store.html privacy.html
git commit -m "feat(seo): static-page meta + OG + ClothingStore/WebSite JSON-LD (#11)"
```

---

## Task 4: Dynamic-page `setMeta` wiring (PDP + shop)

**Files:**
- Modify: `product.html` (module script — import + call in `init()`)
- Modify: `shop.html` (module script — import + call in `init()` and `refresh()`)

- [ ] **Step 1: product.html — import meta helpers**

In `product.html`, change the import at line 787 from:
```js
  import { fabricImageUrl, productImageUrl, supabase } from './js/data-loader.js';
```
to add the meta import on the next line:
```js
  import { fabricImageUrl, productImageUrl, supabase } from './js/data-loader.js';
  import { setMeta, canonicalFor, SITE_ORIGIN } from './js/meta.js';
```

- [ ] **Step 2: product.html — add a `setMeta` call in `init()`**

In `product.html` `init()`, immediately AFTER the line `renderAccordion(state.current, state.fabric, state.separates);` (currently line 1051) and BEFORE the `crf:pdp-ready` dispatch, insert:
```js
      applyPdpMeta(state.current);
```

Then add this function alongside the other render helpers (e.g. right after `renderHeader`, ~line 863):
```js
  function applyPdpMeta(current) {
    const kind = ITEM_KIND[current.category_id] || current.item_type_name;
    const name = `The ${current.fabric_brand} ${current.fabric_family} ${kind}`;
    const title = `${name} — Country Road Fashions`;
    const description =
      `${name} — a bespoke ${current.item_type_name.toLowerCase()} in ${current.fabric_brand} ` +
      `${current.fabric_family}, cut to your measurements and hand-finished in our Bangkok atelier. ` +
      `From ${fmtTHB(current.price)}.`;
    // Canonical is design-stripped: consolidate all design variants onto item x fabric.
    const canonical = canonicalFor(`/product.html?item=${encodeURIComponent(itemTypeId)}&fabric=${encodeURIComponent(fabricTypeId)}`);
    const heroPath = (current.design_hero_paths && current.design_hero_paths[0]) || current.primary_photo_path;
    const ogImage = fabricImageUrl(heroPath, { width: 1200 }) || undefined;

    const productLd = {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name,
      description,
      image: ogImage,
      sku: `${itemTypeId}__${fabricTypeId}`,
      brand: { '@type': 'Brand', name: `${current.fabric_brand} ${current.fabric_family}` },
      offers: {
        '@type': 'Offer',
        price: String(current.price),
        priceCurrency: 'THB',
        availability: 'https://schema.org/InStock',
        url: canonical,
      },
    };
    const breadcrumbLd = {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'House', item: SITE_ORIGIN + '/' },
        { '@type': 'ListItem', position: 2, name: 'Shop', item: SITE_ORIGIN + '/shop.html' },
        { '@type': 'ListItem', position: 3, name: current.item_type_name, item: canonical },
      ],
    };

    setMeta({ title, description, canonical, ogImage, ogType: 'product', jsonLd: [productLd, breadcrumbLd] });
  }
```
(Note: `renderHeader` still sets `document.title`; `applyPdpMeta` runs after it and overrides with the canonical title — leave `renderHeader`'s line as-is, it is harmless.)

- [ ] **Step 3: shop.html — import meta helpers**

In `shop.html`, inside the module import block starting at line 525, add to the import list from `./js/meta.js`. Add this line after the existing data-loader import:
```js
  import { setMeta, canonicalFor, SITE_ORIGIN } from './js/meta.js';
```

- [ ] **Step 4: shop.html — add a `setMeta` call reflecting category + query**

Add this helper near `pageTitleFor` (~line 591):
```js
  function applyShopMeta() {
    const cat = state.categories.find(c => c.id === state.categoryId);
    const label = cat ? cat.name : 'The Bespoke Collection';
    let title, description, canonical;
    if (state.query) {
      title = `Search: ${state.query} — Country Road Fashions`;
      description = `Search results for "${state.query}" across the Country Road Fashions bespoke collection.`;
      canonical = canonicalFor('/shop.html'); // search pages consolidate to the base
    } else {
      title = `${label} — Country Road Fashions`;
      description = cat
        ? `Made-to-measure ${cat.name.toLowerCase()} in premium wool, hand-finished in our Bangkok atelier.`
        : 'Browse made-to-measure suits, jackets and trousers in premium wool. Hand-finished in our Bangkok atelier, cut to your measurements.';
      canonical = canonicalFor('/shop.html' + (state.categoryId ? `?category=${encodeURIComponent(state.categoryId)}` : ''));
    }
    const breadcrumbLd = {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'House', item: SITE_ORIGIN + '/' },
        { '@type': 'ListItem', position: 2, name: 'Shop', item: SITE_ORIGIN + '/shop.html' },
      ],
    };
    setMeta({ title, description, canonical, jsonLd: breadcrumbLd });
  }
```

Then call it at the end of `init()` (after line 615, `$('#searchInput').value = state.query;`):
```js
    applyShopMeta();
```
And call it at the end of `refresh()` (after the `$('#crumb-leaf').textContent = t.leaf;` line ~765):
```js
    applyShopMeta();
```

- [ ] **Step 5: Verify with Puppeteer (manual smoke)**

Run:
```bash
node -e "const p=require('puppeteer');(async()=>{const b=await p.launch();const pg=await b.newPage();await pg.goto('http://localhost:3000/product.html?item=formal-suit-2-piece&fabric=vbc-wool',{waitUntil:'networkidle0'});console.log(await pg.title());console.log(await pg.\$eval('link[rel=canonical]',e=>e.href));console.log(await pg.\$\$eval('script[data-meta-jsonld]',ns=>ns.map(n=>JSON.parse(n.textContent)['@type'])));await b.close();})()"
```
Expected: a title containing `Vitale Barberis Canonico Wool Suit — Country Road Fashions`, canonical `https://countryroadfashions.com/product.html?item=formal-suit-2-piece&fabric=vbc-wool` (no `design=`), and `[ 'Product', 'BreadcrumbList' ]`.

- [ ] **Step 6: Commit**

```bash
git add product.html shop.html
git commit -m "feat(seo): setMeta + Product/BreadcrumbList JSON-LD on PDP + shop (#11)"
```

---

## Task 5: Sitemap generator + committed sitemap.xml + footer link

**Files:**
- Create: `scripts/generate-sitemap.mjs`
- Create (generated): `sitemap.xml`
- Modify: `components/footer.html` (repoint the Sitemap link)

- [ ] **Step 1: Create `scripts/generate-sitemap.mjs`**

```js
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
```

- [ ] **Step 2: Generate the sitemap**

Run: `node scripts/generate-sitemap.mjs`
Expected: `Wrote sitemap.xml with 11 URLs (6 products).` and a new `sitemap.xml` at repo root.

- [ ] **Step 3: Verify it serves + is well-formed**

Run:
```bash
curl -s -o /dev/null -w "%{http_code} %{content_type}\n" http://localhost:3000/sitemap.xml
curl -s http://localhost:3000/sitemap.xml | grep -c '<loc>'
curl -s http://localhost:3000/sitemap.xml | grep -c 'design='
```
Expected: `200 application/xml; charset=utf-8`, `11`, and `0` (no design params).

- [ ] **Step 4: Repoint the footer Sitemap link**

In `components/footer.html`, change:
```html
        <a href="index.html">Sitemap</a>
```
to:
```html
        <a href="/sitemap.xml">Sitemap</a>
```
(Leave the adjacent `Accessibility` link untouched — out of scope.)

- [ ] **Step 5: Commit**

```bash
git add scripts/generate-sitemap.mjs sitemap.xml components/footer.html
git commit -m "feat(seo): sitemap.xml generator + committed sitemap + footer link (#11)"
```

---

## Task 6: Test suite + CSP sweep + regression

**Files:**
- Create: `scripts/test-seo-meta.mjs`
- Modify: `scripts/test-csp-compliance.mjs` (only if its PAGES array is missing any page — verify)

- [ ] **Step 1: Write `scripts/test-seo-meta.mjs`**

```js
// SEO baseline e2e: static-page meta (raw HTML), dynamic-page setMeta, noindex,
// robots.txt, sitemap.xml. Requires serve.mjs on :3000.
import puppeteer from 'puppeteer';

const BASE = 'http://localhost:3000';
let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}: ${msg}`); if (!cond) failures++; };

async function rawHtml(p) {
  const res = await fetch(BASE + p);
  return { status: res.status, ct: res.headers.get('content-type') || '', text: await res.text() };
}

async function main() {
  // --- Static pages: meta present in RAW HTML (no JS) ---
  const staticPages = [
    { p: '/', canon: 'https://countryroadfashions.com/' },
    { p: '/shop.html', canon: 'https://countryroadfashions.com/shop.html' },
    { p: '/book-appointment.html', canon: 'https://countryroadfashions.com/book-appointment.html' },
    { p: '/in-store.html', canon: 'https://countryroadfashions.com/in-store.html' },
    { p: '/privacy.html', canon: 'https://countryroadfashions.com/privacy.html' },
  ];
  for (const s of staticPages) {
    const { text } = await rawHtml(s.p);
    ok(text.includes(`rel="canonical" href="${s.canon}"`), `${s.p} raw canonical`);
    ok(/name="description" content=".{20,}"/.test(text), `${s.p} raw description`);
    ok(text.includes('property="og:title"'), `${s.p} raw og:title`);
    ok(text.includes('name="twitter:card"'), `${s.p} raw twitter:card`);
  }
  // index JSON-LD
  const idx = (await rawHtml('/')).text;
  ok(idx.includes('"@type": "ClothingStore"'), '/ ClothingStore JSON-LD');
  ok(idx.includes('"@type": "WebSite"'), '/ WebSite JSON-LD');
  ok(idx.includes('SearchAction'), '/ SearchAction');
  ok((await rawHtml('/in-store.html')).text.includes('"@type": "ClothingStore"'), '/in-store ClothingStore JSON-LD');

  // --- Private pages: noindex in raw HTML ---
  for (const p of ['/login.html','/signup.html','/forgot-password.html','/reset-password.html','/account.html','/measurements.html','/cart.html','/order-confirmation.html']) {
    ok(/name="robots" content="noindex/.test((await rawHtml(p)).text), `${p} noindex`);
  }

  // --- robots.txt + sitemap.xml ---
  const robots = await rawHtml('/robots.txt');
  ok(robots.status === 200 && robots.ct.includes('text/plain'), 'robots.txt served as text/plain');
  ok(robots.text.includes('Sitemap: https://countryroadfashions.com/sitemap.xml'), 'robots.txt Sitemap line');
  ok(robots.text.includes('Disallow: /account.html'), 'robots.txt disallows account');
  const sm = await rawHtml('/sitemap.xml');
  ok(sm.status === 200 && sm.ct.includes('xml'), 'sitemap.xml served as xml');
  ok((sm.text.match(/<loc>/g) || []).length >= 11, 'sitemap has >=11 urls');
  ok(!sm.text.includes('design='), 'sitemap has no design params');
  ok(sm.text.includes('<loc>https://countryroadfashions.com/</loc>'), 'sitemap includes home');

  // --- Dynamic PDP: setMeta after data load ---
  const browser = await puppeteer.launch();
  try {
    const page = await browser.newPage();
    await page.goto(`${BASE}/product.html?item=formal-suit-2-piece&fabric=vbc-wool&design=vbc-wool-ash-grey-pinstripe`, { waitUntil: 'networkidle0' });
    const title = await page.title();
    ok(/Vitale Barberis Canonico Wool Suit — Country Road Fashions/.test(title), 'PDP title');
    const canon = await page.$eval('link[rel="canonical"]', e => e.getAttribute('href'));
    ok(canon === 'https://countryroadfashions.com/product.html?item=formal-suit-2-piece&fabric=vbc-wool', 'PDP canonical design-stripped');
    const ldTypes = await page.$$eval('script[data-meta-jsonld]', ns => ns.map(n => JSON.parse(n.textContent)['@type']));
    ok(ldTypes.includes('Product') && ldTypes.includes('BreadcrumbList'), 'PDP Product + BreadcrumbList JSON-LD');
    const product = await page.$$eval('script[data-meta-jsonld]', ns => ns.map(n => JSON.parse(n.textContent)).find(o => o['@type'] === 'Product'));
    ok(product.offers.priceCurrency === 'THB' && Number(product.offers.price) > 0, 'PDP Offer price/currency');
    // No duplicate managed tags after render
    const canonCount = await page.$$eval('link[rel="canonical"][data-meta]', ns => ns.length);
    ok(canonCount === 1, 'PDP single managed canonical (upsert, no dupes)');

    // Shop with ?q= → search-aware title + base canonical
    await page.goto(`${BASE}/shop.html?q=wool`, { waitUntil: 'networkidle0' });
    const stitle = await page.title();
    ok(/Search: wool/.test(stitle), 'shop ?q= title');
    const scanon = await page.$eval('link[rel="canonical"]', e => e.getAttribute('href'));
    ok(scanon === 'https://countryroadfashions.com/shop.html', 'shop ?q= canonical consolidates to base');
  } finally {
    await browser.close();
  }

  console.log(failures === 0 ? '\nALL SEO CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run the SEO test**

Run: `node scripts/test-seo-meta.mjs`
Expected: `ALL SEO CHECKS PASSED`, exit 0. Fix any FAIL before proceeding.

- [ ] **Step 3: Confirm the CSP sweep still passes (ld+json must not trip script-src)**

Run: `node scripts/test-csp-compliance.mjs`
Expected: zero violations across all pages. (No code change expected — this verifies the JSON-LD `<script>` blocks and injected meta don't cause CSP console errors. If a page was added that isn't in its PAGES array, add it.)

- [ ] **Step 4: Run core regression**

Run:
```bash
node scripts/test-layout-mount.mjs && \
node scripts/test-token-discipline.mjs && \
node scripts/test-product-search.mjs && \
node scripts/test-search-overlay.mjs && \
node scripts/test-shop-search.mjs
```
Expected: all pass. (These touch the pages/JS we modified.)

- [ ] **Step 5: Commit**

```bash
git add scripts/test-seo-meta.mjs
git commit -m "test(seo): e2e meta/JSON-LD/robots/sitemap + noindex coverage (#11)"
```

---

## Task 7: Docs + finish

**Files:**
- Modify: `PROJECT.md` (top banner + §4 layout + §7 backlog table)

- [ ] **Step 1: Update PROJECT.md**

- Top banner: note SEO baseline (#11) shipped — static-page meta/OG + JSON-LD, `js/meta.js` real `setMeta`, `robots.txt` + generated `sitemap.xml`, noindex on 8 private pages. Phase 3 remaining: **#14 CSP/RLS hardening** only.
- §4 layout: add `robots.txt`, `sitemap.xml`, `scripts/generate-sitemap.mjs`, `scripts/test-seo-meta.mjs`; update `js/meta.js` description (now real).
- §7 backlog table row #11 → ✅ done (baseline); §7 Phase 3 line → search + SEO shipped, #14 remains.

- [ ] **Step 2: Final full-suite verification**

Run the SEO + CSP + core regression commands from Task 6 Steps 2–4 once more; confirm all green.

- [ ] **Step 3: Commit**

```bash
git add PROJECT.md
git commit -m "docs: PROJECT.md — SEO baseline shipped (#11)"
```

- [ ] **Step 4: Finish the branch** — hand off to `superpowers:finishing-a-development-branch` (merge to `main`).

---

## Self-review notes

- **Spec coverage:** §3 tiers → Tasks 2/3/4; §4 meta.js → Task 1; §5 JSON-LD → Tasks 3 (ClothingStore/WebSite static) + 4 (Product/BreadcrumbList dynamic); §6 robots.txt → Task 2; §7 sitemap → Task 5; §8 tests → Task 6; §10 acceptance → Tasks 6/7. All covered.
- **Deviation from spec §5:** `Product.sku` uses the `item_type_id__fabric_type_id` composite (not per-design `fabric_number`) — consistent with the design-stripped canonical that consolidates design variants onto one product. Intentional; noted here.
- **Type consistency:** `applyPdpMeta`/`applyShopMeta` helper names, `setMeta({title,description,canonical,ogImage,ogType,jsonLd,robots})` signature, and `canonicalFor(pathAndQuery)` match across Tasks 1/4. `jsonLd` accepts object|array (Task 1) and PDP passes an array (Task 4) — consistent.
- **No placeholders:** every code step shows full content; per-page meta values are tabulated, not "TBD".
