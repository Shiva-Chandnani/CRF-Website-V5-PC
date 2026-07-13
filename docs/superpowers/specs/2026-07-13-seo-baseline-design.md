# SEO Baseline — Design Spec

**Feature:** Backlog #11 — SEO optimisation (Phase 3 baseline)
**Date:** 2026-07-13
**Status:** Approved — ready for implementation plan
**Approach:** C (hybrid) — real HTML meta on static pages, `setMeta()` client-side on dynamic pages

---

## 1. Goal

Give Country Road Fashions a production-ready SEO baseline: crawlable, share-friendly pages with correct titles, descriptions, canonicals, social cards, and structured data; a `robots.txt` + `sitemap.xml`; and private pages kept out of the index. This is the "baseline" pass — continuous SEO polish (per-PR meta checks, content) continues after.

## 2. Context

- Static HTML / vanilla-JS site; no build step. Header/footer and catalogue data are fetched via JS at runtime (client-rendered).
- Current SEO state is a **blank slate**: no `meta description`, OG/Twitter tags, canonical, `robots.txt`, or `sitemap.xml` anywhere. `js/meta.js` `setMeta()` is a deliberate Phase-0 no-op skeleton.
- `js/meta.js` is currently imported by the 6 catalogue pages (index, shop, product, cart, book-appointment, in-store).
- Real business facts (source: `brand_assets/country_road_fashions_business_brand_summary.md`, `privacy.html`):
  - Bespoke tailoring house, Bangkok. Founded **1951** by **Tourmal Chandnani**.
  - Atelier address: **120/91 Ratchaprarop Road, Thanon Phaya Thai, Ratchathewi, Bangkok 10400, Thailand**.
  - Contact email: **Countryroadfashions@gmail.com**. (No public phone number known — omit `telephone`.)
  - Price range THB ~4,500–20,000+ → `priceRange` `฿฿฿`.
- Production domain (confirmed): `https://countryroadfashions.com` (non-www apex).

### Why approach C (hybrid)

Googlebot renders JS, but social scrapers (Facebook, LinkedIn, Slack, X) do **not** execute JS. Pure `setMeta()` injection (approach A) would break social link previews and weaken crawl robustness. Hardcoding every page (approach B) can't work for the query-param-driven dynamic pages (one `product.html` can't statically hold 105 products' meta). Hybrid gives the static marketing/discovery pages bulletproof HTML meta + social cards, and keeps the dynamic pages honest via `setMeta`.

**Accepted limitation:** social-scraper link previews for individual deep-linked PDPs remain generic (they read the static fallback head, not the JS-updated tags). The full fix is prerendering/SSR — out of scope for a baseline.

## 3. Page inventory — three tiers

| Tier | Pages | Treatment |
|---|---|---|
| **Static indexable** | `/` (index), `/shop.html`, `/book-appointment.html`, `/in-store.html`, `/privacy.html` | Real HTML `<head>`: `<title>` + `meta[name=description]` + `link[rel=canonical]` + Open Graph + Twitter, baked in. JSON-LD per §5. |
| **Dynamic indexable** | `/product.html` (PDP), `/shop.html?q=` | Static base head (sensible fallback), then `setMeta()` upserts title/description/canonical/OG and injects `Product` JSON-LD after catalogue data loads. |
| **Private (noindex)** | `login`, `signup`, `forgot-password`, `reset-password`, `account`, `measurements`, `cart`, `order-confirmation` | `<meta name="robots" content="noindex, nofollow">` in `<head>`, plus `Disallow` in `robots.txt`. |

Note: `shop.html` appears in both static (default browse) and dynamic (`?q=`) rows — same page, static head is the default, `setMeta()` refines the title/canonical when a `?q=` query is present.

## 4. `js/meta.js` — real implementation

Replace the no-op body. Public surface:

```js
export const SITE_ORIGIN = 'https://countryroadfashions.com';
export function canonicalFor(path);          // absolute URL from a path (+ optional whitelisted params)
export function setMeta({ title, description, canonical, ogImage, ogType, jsonLd, robots });
```

`setMeta` behaviour:
- **Upsert, never duplicate.** Every managed tag carries a `data-meta` marker attribute; a repeat `setMeta` call updates the existing node instead of appending a second one. Managed tags:
  - `<title>`
  - `meta[name=description]`
  - `link[rel=canonical]`
  - Open Graph: `og:title`, `og:description`, `og:url`, `og:image`, `og:type` (default `website`), `og:site_name` (`Country Road Fashions`), `og:locale` (`en_US`)
  - Twitter: `twitter:card` (`summary_large_image`), `twitter:title`, `twitter:description`, `twitter:image`
- **JSON-LD:** injects/replaces a single `<script type="application/ld+json" data-meta-jsonld>` with the passed `jsonLd` object. (`application/ld+json` is a data block, not executed script → not governed by CSP `script-src`; confirmed safe under the existing policy.)
- `robots`, when passed, upserts `meta[name=robots]`.
- Omitted fields leave the corresponding tag untouched (so a static page's baked-in tags survive a partial `setMeta` refinement).

**Canonical policy:** the PDP canonical **strips the `design` query param** — `canonicalFor` for a product returns `…/product.html?item=X&fabric=Y` only. This consolidates all 35 per-design variants onto 6 canonical `(item×fabric)` PDPs and prevents near-duplicate dilution.

## 5. Structured data (JSON-LD)

- **`ClothingStore`** (a `LocalBusiness` subtype) on `/` and `/in-store.html`: `name`, `description`, `url`, `logo`, `image`, `email`, full `PostalAddress` (street `120/91 Ratchaprarop Road, Thanon Phaya Thai`, `addressLocality Ratchathewi`, `addressRegion Bangkok`, `postalCode 10400`, `addressCountry TH`), `foundingDate` `1951`, `founder` (`Person` — Tourmal Chandnani), `priceRange` `฿฿฿`, `areaServed`.
- **`WebSite` + `SearchAction`** on `/`: `potentialAction` → `https://countryroadfashions.com/shop.html?q={search_term_string}` (enables the Google sitelinks search box).
- **`BreadcrumbList`** on `/shop.html` and `/product.html`, mirroring the already-rendered on-page breadcrumb (HOUSE / SHOP / … ).
- **`Product`** on the PDP (injected by `setMeta` after data loads): `name`, `description`, `image` (hero), `brand` (fabric house name), `sku` (= `fabric_number`), and an `Offer` — `price` (the `item×fabric` THB price, whole baht), `priceCurrency` `THB`, `availability` `https://schema.org/InStock`, `url` (canonical PDP). Bespoke/made-to-order is always orderable, so `InStock` is the pragmatic availability value.

## 6. `robots.txt` (new — project root, served by `serve.mjs`)

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

## 7. `sitemap.xml` (generated + committed)

- New `scripts/generate-sitemap.mjs` reads `v_products` from Supabase (anon key) and emits a valid urlset:
  - 5 static indexable pages (`/`, `/shop.html`, `/book-appointment.html`, `/in-store.html`, `/privacy.html`).
  - 6 canonical `(item_type × fabric_type)` PDP URLs — `?item=X&fabric=Y`, **no `design` param** (matches the canonical policy). Deduplicated from the 105-row `v_products`.
  - ~11 clean URLs total; no design-param near-duplicate spam.
- `lastmod` set to generation date; `changefreq`/`priority` reasonable defaults (home/shop higher).
- Output committed to the repo root (`sitemap.xml`). Regenerate + recommit whenever the catalogue changes.
- Footer "Sitemap" link (`components/footer.html`, currently a placeholder → `index.html`) repointed to `/sitemap.xml`. (Footer "Accessibility" placeholder left as-is — out of scope.)

## 8. Tests

- **`scripts/test-seo-meta.mjs`** (puppeteer, server up):
  - Each static indexable page: asserts `<title>`, `meta description`, `link canonical` (absolute, correct origin), and core OG tags present + correct.
  - PDP: navigate, wait for `setMeta`, assert `<title>` includes the product name, `canonical` is design-stripped, and a valid `Product` JSON-LD block exists with the right price/currency.
  - Each private page: asserts `meta[name=robots]` contains `noindex`.
  - `robots.txt` served (200, contains `Sitemap:` line + expected `Disallow`s).
  - `sitemap.xml` served (200, well-formed XML, contains the expected static + PDP URLs, no `design=` params).
- **Pure-Node JSON-LD shape check** (in the same script or a small helper): each emitted JSON-LD object parses and carries required `@context`/`@type`/key fields.
- **CSP:** extend/rerun `scripts/test-csp-compliance.mjs` — the 14-page zero-violation sweep must stay green with the new `ld+json` blocks and injected meta present (verifies ld+json doesn't trip `script-src`).
- Core regression stays green: layout-mount, token-discipline, product-search suite, swatch, customizer, hero-rail, newsletter.

## 9. Out of scope (YAGNI)

- hreflang / multi-language (single en/TH market for now).
- Prerendering / SSR (accepts the deep-linked-PDP social-preview limitation).
- Dynamic OG-image generation. **Default OG image:** point `og:image` at an existing Supabase-hosted suit hero via the render endpoint (~1200px wide). A purpose-built 1200×630 share card is a later nice-to-have.
- AMP, breadcrumb schema on non-shop pages, review/rating schema.

## 10. Acceptance criteria

1. All 5 static indexable pages serve correct hardcoded title/description/canonical/OG in raw HTML (no JS needed).
2. PDP updates title/description/canonical + emits valid `Product` JSON-LD after data loads; canonical is design-stripped.
3. `/` emits `ClothingStore` + `WebSite`/`SearchAction` JSON-LD; shop + PDP emit `BreadcrumbList`.
4. All 8 private pages carry `noindex` and are `Disallow`ed in `robots.txt`.
5. `robots.txt` + `sitemap.xml` serve correctly; sitemap lists the 11 clean URLs; footer Sitemap link works.
6. `test-seo-meta.mjs` green; CSP 14-page sweep green; core regression green.
7. PROJECT.md updated with the SEO baseline inventory; merged to `main`.
