// =============================================================================
// Country Road Fashions — SEO + structured-data meta helper
// =============================================================================
// Skeleton for Phase 0. Every page imports this so Phase 3 can fill it in
// without touching page HTML. In Phase 0 setMeta() is a deliberate no-op.
//
// Usage (Phase 3):
//   import { setMeta } from '/js/meta.js';
//   setMeta({
//     title: 'The Cavani Wool Suit — Country Road Fashions',
//     description: '...',
//     canonical: 'https://countryroadfashions.com/product.html?...',
//     ogImage: 'https://.../hero.png',
//     jsonLd: { '@context': 'https://schema.org', '@type': 'Product', ... },
//   });
// =============================================================================

/**
 * @param {object} _opts
 * @param {string} [_opts.title]
 * @param {string} [_opts.description]
 * @param {string} [_opts.canonical]
 * @param {string} [_opts.ogImage]
 * @param {object} [_opts.jsonLd]
 */
export function setMeta(_opts) {
  // Phase 0: intentional no-op. Phase 3 wires the actual <title> + meta tags + JSON-LD.
}

// Auto-imported by every page (via layout.js or directly) so Phase 3 can
// simply replace this function body without revisiting page HTML.
