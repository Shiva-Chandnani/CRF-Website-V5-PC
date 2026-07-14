# CSP / RLS Hardening — Design Spec

**Backlog item:** #14 (Privacy page + security baseline) — Phase 3 close.
**Date:** 2026-07-14
**Status:** Approved — ready for implementation plan.

The privacy page (`privacy.html`) and the CSP `<meta>` baseline shipped in Phase 1 WT-4. This spec covers the remaining Phase 3 hardening: enforce clickjacking protection via real HTTP headers, remove the XSS-dangerous `'unsafe-inline'` from `script-src`, and prove owner-only Row-Level Security across every user-data table with one authoritative test. It is the **last remaining Phase 3 feature**.

## Goals

1. Enforce clickjacking protection (`frame-ancestors` / `X-Frame-Options`) — currently unenforced because both directives are ignored when delivered via `<meta http-equiv>`.
2. Remove `'unsafe-inline'` from `script-src` on all 14 pages — the practical XSS defense — by externalizing every executable inline `<script>` to a file covered by `script-src 'self'`.
3. Consolidate the RLS story into one systematic audit test that covers every user-data table, including `newsletter_subscribers` (currently untested).

## Non-goals (explicitly out of scope)

- Full `style-src` lockdown. There are 28 inline `<style>` blocks (~2 per page) and no build step; style injection is not a script-execution vector. `'unsafe-inline'` is **retained** on `style-src` with a documented rationale.
- Migrating the entire CSP to an HTTP header. Only `frame-ancestors` moves to a header; the per-page `<meta>` CSP remains the authoritative policy for all other directives.
- Choosing or configuring the production host. Production header enforcement is delivered as host-agnostic documentation to drop in when a host is picked.
- Nonces/hashes for scripts (externalization makes them unnecessary).

## Current state (verified 2026-07-14)

- **CSP:** identical `<meta http-equiv="Content-Security-Policy">` block at line 5 of all 14 pages. `script-src` is uniformly:
  `script-src 'self' 'unsafe-inline' https://esm.sh https://assets.calendly.com;`
  No `frame-ancestors` (dropped in WT-4 — meta-delivered `frame-ancestors` is ignored by browsers).
- **`serve.mjs`** sends only `Content-Type`. No security headers.
- **Inline scripts (executable):** 12 blocks total —
  - 2 bare IIFE `<script>`: `index.html` (hero-video toggle), `book-appointment.html` (tab switcher).
  - 10 `<script type="module">` bootstraps: `shop.html`, `product.html` (×2), `cart.html`, `account.html`, `login.html`, `signup.html`, `forgot-password.html`, `reset-password.html`, `order-confirmation.html`.
  - `<script type="application/ld+json">` blocks (index ×2, in-store) are **data**, not subject to `script-src` — left inline.
  - Zero inline event handlers (`onclick=` etc.), zero `javascript:` URLs (verified) — so removing `'unsafe-inline'` from `script-src` breaks nothing beyond the 12 blocks.
- **RLS tests:** `test-profile-rls`, `test-measurements-rls`, `test-cart-rls`, `test-orders-rls` exist. `newsletter_subscribers` has no RLS test.
- **No host/deploy config** in the repo (`_headers` / `vercel.json` / nginx all absent).

## Workstream A — HTTP security headers

**`serve.mjs` (dev parity).** Add these response headers to every reply (alongside the existing `Content-Type`):

| Header | Value | Purpose |
|---|---|---|
| `Content-Security-Policy` | `frame-ancestors 'none'` | Clickjacking (header-form; coexists with the per-page meta CSP — both enforce, intersection semantics) |
| `X-Frame-Options` | `DENY` | Clickjacking (legacy fallback) |
| `X-Content-Type-Options` | `nosniff` | Block MIME sniffing |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Referrer privacy |

`serve.mjs` currently writes the header object in one `res.writeHead(200, {...})` on success and `res.writeHead(404)` on error. Apply the security headers to **both** paths (a base header object merged in), so 404s are also protected. Do not add HSTS locally (localhost is HTTP; browsers ignore it, and it can cause dev friction).

**`docs/security/production-headers.md` (host-agnostic bundle).** Since the host is undecided, document ready-to-drop-in configs. Each carries the four `serve.mjs` headers **plus**:
- `Strict-Transport-Security: max-age=31536000; includeSubDomains` — HTTPS-only; production hosts serve over TLS.
- `Permissions-Policy: camera=(), microphone=(), geolocation=()` — deny sensor access the site never uses.

Three snippets in the doc:
1. Netlify / Cloudflare Pages `_headers` file.
2. Vercel `vercel.json` `headers[]` block.
3. nginx `add_header` directives.

Plus a short note that when a host is chosen, the meta-CSP could optionally be promoted to a single header CSP — deferred.

## Workstream B — `script-src 'self'` (remove `'unsafe-inline'`)

**Externalize all 12 executable inline blocks verbatim** into files loaded via `<script ... src="…">`. Naming: page-scoped files under `js/`.

| Page | Inline block | New file | Load tag |
|---|---|---|---|
| `index.html` | hero-video IIFE | `js/index-hero-video.js` | `<script src="js/index-hero-video.js"></script>` (plain — it's an IIFE, no imports) |
| `book-appointment.html` | tabs IIFE | `js/book-appointment-tabs.js` | plain `<script src>` |
| `shop.html` | module bootstrap | `js/shop-page.js` | `<script type="module" src>` |
| `product.html` | **two** module blocks | `js/product-page.js` (concatenated in original order) | `<script type="module" src>` |
| `cart.html` | module bootstrap | `js/cart-page.js` | `<script type="module" src>` |
| `account.html` | module bootstrap | `js/account-page.js` | `<script type="module" src>` |
| `login.html` | module bootstrap | `js/login-page.js` | `<script type="module" src>` |
| `signup.html` | module bootstrap | `js/signup-page.js` | `<script type="module" src>` |
| `forgot-password.html` | module bootstrap | `js/forgot-password-page.js` | `<script type="module" src>` |
| `reset-password.html` | module bootstrap | `js/reset-password-page.js` | `<script type="module" src>` |
| `order-confirmation.html` | module bootstrap | `js/order-confirmation-page.js` | `<script type="module" src>` |

Rules:
- **Verbatim moves.** Copy the block body unchanged. Relative imports (`./js/…` and `/js/…`) resolve identically from a file in the project root's `js/` dir served at `/js/…` — confirm each import path still resolves after the move (root-absolute `/js/…` always works; `./js/…` from a file at `/js/foo.js` would resolve to `/js/js/…` and must be rewritten to `/js/…` or `./…`). **Audit every import path in each externalized module and normalize to root-absolute `/js/…`.**
- `product.html`'s two module blocks concatenate into one file in their original document order (block at ~795 first, block at ~1148 second). If they share top-level identifiers this is a no-op; if not, concatenation still preserves order. Verify no duplicate top-level `const`/`import` collisions after merge — if any, keep them as two files (`js/product-page.js` + `js/product-page-2.js`) rather than forcing a merge.
- Load order and placement: the new `<script src>` goes exactly where the inline block was, preserving any sibling `<script type="module" src="js/cart.js">` ordering (e.g. index/book-appointment load `js/cart.js` after their IIFE — keep that order).

**CSP edit (all 14 pages).** Change the `script-src` line from:
`script-src 'self' 'unsafe-inline' https://esm.sh https://assets.calendly.com;`
to:
`script-src 'self' https://esm.sh https://assets.calendly.com;`
Keep `esm.sh` (auth/profile modules import supabase-js from it) and `assets.calendly.com` (book-appointment). **`style-src` is unchanged** — `'unsafe-inline'` retained. Add a one-line HTML comment above the CSP block on each page (or document centrally) noting why `style-src` keeps `'unsafe-inline'`.

## Workstream C — consolidated RLS audit

**`scripts/test-rls-audit.mjs`** — one suite following the existing test conventions (manual `.env.local` read, admin `createUser` to seed, no `dotenv`). Seed two users (A, B). For each user-data table, assert:

| Table / view | Assertion |
|---|---|
| `profiles` | A reads own row; A cannot read B's row; A cannot update B's row |
| `customer_body_measurements`, `customer_jacket_reference`, `customer_shirt_reference`, `customer_pants_reference` | owner-only SELECT/INSERT; A cannot read B's rows |
| `v_latest_body_measurements`, `v_latest_jacket_reference`, `v_latest_shirt_reference`, `v_latest_pants_reference` | `security_invoker` holds — A sees only own latest; **no cross-user leak** (the WT-3 cautionary bug) |
| `carts` | owner-only; A cannot read/write B's cart |
| `orders` | A reads own; A cannot read B's; **A cannot INSERT/UPDATE any order** (Edge-Function-only write) |
| `payments` | A reads own (via join to orders); A cannot read B's; **A cannot INSERT/UPDATE** |
| `newsletter_subscribers` | anon can INSERT; anon **cannot** SELECT (email enumeration guard) / UPDATE; authenticated owner can SELECT own row |

Teardown deletes both seeded users (cascade cleans dependent rows). The 4 existing per-table RLS tests stay as-is (not deleted) — the audit is the consolidated superset.

## Testing / acceptance criteria

1. `node scripts/test-rls-audit.mjs` — green (all assertions above).
2. `node scripts/test-csp-compliance.mjs` — still zero-violation across all 14 pages with tightened `script-src` (proves externalized scripts load under `'self'`). **Extend it** to additionally assert: (a) `'unsafe-inline'` is **absent** from `script-src` on every page, (b) the `serve.mjs` response carries `X-Frame-Options: DENY` and a `Content-Security-Policy` header containing `frame-ancestors 'none'`.
3. `node scripts/test-seo-meta.mjs` — green (unchanged meta behavior).
4. Core regression green: `test-layout-mount`, `test-token-discipline`, `test-product-search`, `test-search-overlay`, `test-shop-search`, `test-customizer-flow`, plus the moved-bootstrap pages' own e2e where they exist (`test-checkout-flow`, `test-account-profile-crud`, `test-signup-flow`, `test-forgot-reset`, `test-measurements-page` unaffected).
5. Screenshot pass on `shop.html`, a PDP, and `book-appointment.html` — no visual/functional regression from externalization.

## Files touched (summary)

- **Modified:** `serve.mjs`; all 14 `*.html` (CSP `script-src` line + inline→`src` swap); `scripts/test-csp-compliance.mjs` (new assertions); `PROJECT.md` (shipped inventory).
- **New:** 11 `js/*-page.js` (or 12 if product stays split) + `js/index-hero-video.js` + `js/book-appointment-tabs.js`; `scripts/test-rls-audit.mjs`; `docs/security/production-headers.md`.

## Risks

- **Import-path breakage on externalization** — the top risk. Mitigated by normalizing all imports to root-absolute `/js/…` and running the full e2e regression.
- **product.html two-block merge** — fallback is keeping them as two files.
- **CSP header vs meta interaction** — a header `Content-Security-Policy: frame-ancestors 'none'` and a meta CSP without that directive both apply independently (CSP composition is intersection); no conflict.
