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
