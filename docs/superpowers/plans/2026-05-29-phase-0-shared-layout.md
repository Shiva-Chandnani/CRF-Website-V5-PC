# Phase 0 — Shared Layout + Design System Lock — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the shared header/footer/CSS spine + newsletter capture so every existing page renders from one canonical layout, with `css/base.css` as the single source of truth for tokens and `.btn--*`.

**Architecture:** Two HTML fragments in `components/`, fetched at runtime by `js/layout.js`, mounted into `<div data-layout>` slots. All foundational styling lives in `css/base.css`. Page-specific styles stay inline in each page's `<style>` block. The footer form posts to a new `newsletter_subscribers` Supabase table via `js/newsletter.js`. Single worktree, with two non-conflicting subagent streams (newsletter backend + meta scaffold) running in parallel.

**Tech Stack:** Static HTML + vanilla ES modules served by `serve.mjs` on `localhost:3000`. Supabase (Postgres + REST) for the newsletter table. Puppeteer for smoke tests. No build step.

**Spec reference:** [`docs/superpowers/specs/2026-05-29-phase-0-shared-layout-design.md`](../specs/2026-05-29-phase-0-shared-layout-design.md)

---

## File Plan

**Created:**
- `components/header.html` — canonical header markup
- `components/footer.html` — canonical full footer (brand + newsletter form + 4 link cols + bottom row)
- `css/base.css` — tokens, reset, typography, `.btn--*`, form controls, header styles, footer styles
- `js/layout.js` — fetch + inject header/footer, dispatch `crf:layout-ready`, decorate active nav link
- `js/meta.js` — `setMeta()` skeleton (no-op until Phase 3)
- `js/newsletter.js` — footer form → UPSERT into `newsletter_subscribers`
- `db/07_newsletter_subscribers.sql` — table + RLS
- `scripts/test-layout-mount.mjs` — 6-page mount smoke test
- `scripts/test-newsletter-submit.mjs` — submit roundtrip + idempotency
- `scripts/test-token-discipline.mjs` — forbid legacy classes / hardcoded `#000` / `transition-all`

**Modified:**
- `js/cart.js` — defer `mountCartBadge()` until `crf:layout-ready` if `[data-cart-count]` isn't in DOM yet
- `js/schema.d.ts` — add `newsletter_subscribers` row type
- `index.html`, `shop.html`, `product.html`, `cart.html`, `book-appointment.html`, `in-store.html` — swap inline header/footer for `<div data-layout>` slots; replace `.btn-primary`/`.btn-dark` with `.btn--primary`; strip duplicated tokens/buttons/`#000` from inline `<style>`; add `<link rel="stylesheet" href="/css/base.css">` and `<script type="module" src="/js/layout.js">` etc.
- `PROJECT.md` — append Phase 0 shipped inventory

---

## Task 1: Worktree + baseline screenshots

**Files:**
- Create: worktree `../V5-ProperCloth-phase-0-shared-layout/` on branch `phase-0-shared-layout`
- Create: `temporary screenshots/phase-0/before/` directory with 12 PNGs

- [ ] **Step 1: Verify clean working state on main**

Run: `git status --short`
Expected: shows only the untracked project files already present (cart.html, css/, db/, etc.) — no in-progress edits to spec or plan files. The Phase 0 spec commit (`af3ab90`) is on main.

- [ ] **Step 2: Invoke using-git-worktrees skill**

Use the `superpowers:using-git-worktrees` skill to create a worktree at `../V5-ProperCloth-phase-0-shared-layout/` on a new branch `phase-0-shared-layout` based on `main`. All subsequent steps run inside that worktree.

- [ ] **Step 3: Start the dev server (if not already running)**

From the worktree root:

```bash
# Check if 3000 is already serving
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000
```

If the response is `200`, the server is already up (per CLAUDE.md: never start a second instance). If it's not, start it in the background:

```bash
node serve.mjs &
sleep 1
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000   # expect 200
```

- [ ] **Step 4: Create the before/ screenshot folder**

```bash
mkdir -p "temporary screenshots/phase-0/before"
mkdir -p "temporary screenshots/phase-0/after"
```

- [ ] **Step 5: Write a one-shot capture script**

Create `scripts/capture-phase-0-baseline.mjs`:

```js
// One-off: capture before/ screenshots for Phase 0 visual gate.
// 6 pages × 2 widths (1440 + 375) = 12 PNGs into temporary screenshots/phase-0/before/
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const OUT_DIR = path.join(process.cwd(), 'temporary screenshots', 'phase-0', 'before');
fs.mkdirSync(OUT_DIR, { recursive: true });

const PAGES = [
  ['index',            'http://localhost:3000/index.html'],
  ['shop',             'http://localhost:3000/shop.html'],
  ['product',          'http://localhost:3000/product.html?item=formal-suit-2-piece&fabric=vbc-wool&design=vbc-wool-grey-herringbone'],
  ['cart',             'http://localhost:3000/cart.html'],
  ['book-appointment', 'http://localhost:3000/book-appointment.html'],
  ['in-store',         'http://localhost:3000/in-store.html'],
];
const WIDTHS = [1440, 375];

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
for (const [name, url] of PAGES) {
  for (const w of WIDTHS) {
    const page = await browser.newPage();
    await page.setViewport({ width: w, height: w === 1440 ? 900 : 812 });
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
    await new Promise(r => setTimeout(r, 800));
    const file = path.join(OUT_DIR, `${w}-${name}.png`);
    await page.screenshot({ path: file, fullPage: true });
    console.log(`✔ ${file}`);
    await page.close();
  }
}
await browser.close();
console.log('Done. 12 baseline screenshots saved.');
```

- [ ] **Step 6: Run the baseline capture**

Run: `node scripts/capture-phase-0-baseline.mjs`
Expected: 12 lines of `✔ ...` output, then `Done.`
Verify: `ls "temporary screenshots/phase-0/before/" | wc -l` returns `12`.

- [ ] **Step 7: Commit the baseline capture script (screenshots are gitignored)**

```bash
git add scripts/capture-phase-0-baseline.mjs
git commit -m "Phase 0 Task 1: baseline screenshot capture script"
```

---

## Task 2: Newsletter migration (Subagent Stream A — part 1)

**Files:**
- Create: `db/07_newsletter_subscribers.sql`
- Modify: `js/schema.d.ts` (append row type)

- [ ] **Step 1: Write the migration SQL**

Create `db/07_newsletter_subscribers.sql`:

```sql
-- Phase 0 newsletter capture table.
-- email is PK so UPSERT on conflict is the natural idempotent submit path.
-- profile_id nullable; Phase 1 backfills it when a signup uses an already-captured email.
-- RLS: anon can INSERT only (no email enumeration). Authenticated owners can SELECT their own row.

create table if not exists newsletter_subscribers (
  email           text primary key,
  profile_id      uuid references auth.users(id) on delete set null,
  source          text not null default 'footer',
  opted_in_at     timestamptz not null default now(),
  unsubscribed_at timestamptz,
  created_at      timestamptz not null default now()
);

alter table newsletter_subscribers enable row level security;

drop policy if exists "anon can insert" on newsletter_subscribers;
create policy "anon can insert"
  on newsletter_subscribers for insert
  to anon, authenticated
  with check (email is not null);

drop policy if exists "anon can upsert" on newsletter_subscribers;
create policy "anon can upsert"
  on newsletter_subscribers for update
  to anon, authenticated
  using (true)
  with check (email is not null);

drop policy if exists "owners can read their own row" on newsletter_subscribers;
create policy "owners can read their own row"
  on newsletter_subscribers for select
  to authenticated
  using (profile_id = auth.uid());

create index if not exists newsletter_subscribers_source_idx
  on newsletter_subscribers (source);
```

Note: the UPDATE policy is needed for UPSERT (`on conflict do update`) to work for anon submitters re-subscribing.

- [ ] **Step 2: Apply the migration**

Run: `node scripts/run-sql.mjs db/07_newsletter_subscribers.sql`
Expected output ends with `✅ Done.` and shows commands like `CREATE TABLE`, `ALTER TABLE`, `CREATE POLICY`.

- [ ] **Step 3: Verify the table exists**

```bash
ANON=$(grep SUPABASE_ANON_KEY .env.local | cut -d= -f2-)
curl -s -o /dev/null -w "newsletter_subscribers: %{http_code}\n" \
  "https://fzgsogdceptjvuahukbn.supabase.co/rest/v1/newsletter_subscribers?select=email&limit=1" \
  -H "apikey: $ANON"
```

Expected: `newsletter_subscribers: 200`. (An empty array `[]` is fine — the table exists and SELECT is open via the anon role through PostgREST since the RLS denies it; actually `200` with `[]` means table exists. If it's `404` the table wasn't created.)

- [ ] **Step 4: Append the row type to `js/schema.d.ts`**

Open `js/schema.d.ts` and append at the end:

```ts
export interface NewsletterSubscriberRow {
  email: string;
  profile_id: string | null;
  source: string;
  opted_in_at: string;
  unsubscribed_at: string | null;
  created_at: string;
}
```

- [ ] **Step 5: Commit**

```bash
git add db/07_newsletter_subscribers.sql js/schema.d.ts
git commit -m "Phase 0 Task 2: newsletter_subscribers table + RLS"
```

---

## Task 3: `js/newsletter.js` (Subagent Stream A — part 2)

**Files:**
- Create: `js/newsletter.js`

- [ ] **Step 1: Create the module**

Create `js/newsletter.js`:

```js
// =============================================================================
// Country Road Fashions — Newsletter footer-form handler
// =============================================================================
// Listens for crf:layout-ready (fired by js/layout.js after the footer is in
// the DOM). On submit, validates the email client-side, UPSERTs into
// newsletter_subscribers via the Supabase REST client, and swaps the form for
// a success message. Idempotent: re-submitting the same email is a successful
// no-op from the user's perspective.
// =============================================================================

import { supabase } from './data-loader.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(value) {
  return typeof value === 'string' && EMAIL_RE.test(value.trim());
}

function clearMessages(form) {
  form.querySelectorAll('.newsletter-error').forEach(el => el.remove());
}

function showError(form, message) {
  clearMessages(form);
  const p = document.createElement('p');
  p.className = 'newsletter-error';
  p.setAttribute('role', 'alert');
  p.textContent = message;
  form.appendChild(p);
}

function setBusy(form, busy) {
  const button = form.querySelector('button[type="submit"]');
  const input  = form.querySelector('input[type="email"]');
  if (button) {
    button.disabled = busy;
    button.setAttribute('aria-busy', busy ? 'true' : 'false');
  }
  if (input) input.disabled = busy;
}

function swapToSuccess(form) {
  const success = document.createElement('p');
  success.className = 'newsletter-success';
  success.setAttribute('role', 'status');
  success.textContent = "Thanks — you'll hear from us when the cloth arrives.";
  form.replaceWith(success);
}

async function onSubmit(e) {
  e.preventDefault();
  const form = e.currentTarget;
  clearMessages(form);

  const email = form.querySelector('input[type="email"]').value.trim().toLowerCase();
  if (!isValidEmail(email)) {
    showError(form, 'Please enter a valid email address.');
    return;
  }

  setBusy(form, true);
  const { error } = await supabase
    .from('newsletter_subscribers')
    .upsert(
      { email, source: 'footer', opted_in_at: new Date().toISOString(), unsubscribed_at: null },
      { onConflict: 'email' }
    );
  setBusy(form, false);

  if (error) {
    console.error('[newsletter] upsert failed', error);
    showError(form, "Couldn't reach us — please try again.");
    return;
  }

  swapToSuccess(form);
}

function init() {
  const form = document.querySelector('[data-newsletter-form]');
  if (!form || form.dataset.newsletterBound === '1') return;
  form.dataset.newsletterBound = '1';
  form.addEventListener('submit', onSubmit);
}

// Two paths: footer present at parse time (defensive) OR injected by layout.js.
if (document.querySelector('[data-newsletter-form]')) {
  init();
} else {
  document.addEventListener('crf:layout-ready', init, { once: true });
}
```

- [ ] **Step 2: Sanity-check the regex inline (no test framework — quick node REPL)**

Run:

```bash
node --input-type=module -e "
import('./js/newsletter.js').then(m => {
  const cases = [
    ['ok@example.com', true],
    ['Ok+Tag@Example.CO.UK', true],
    ['bad', false],
    ['no-at.com', false],
    ['', false],
    [null, false],
  ];
  let pass = 0, fail = 0;
  for (const [input, want] of cases) {
    const got = m.isValidEmail(input);
    const ok = got === want;
    console.log(ok ? 'PASS' : 'FAIL', JSON.stringify(input), '→', got, '(want', want + ')');
    ok ? pass++ : fail++;
  }
  console.log(pass + '/' + (pass+fail) + ' passing');
  if (fail) process.exit(1);
});
"
```

Expected: `6/6 passing` and exit 0.

Note: this loads `js/newsletter.js` which imports `js/data-loader.js`, which imports `@supabase/supabase-js` from `esm.sh`. In Node that import will fail. To run the validation check in pure Node, temporarily extract `isValidEmail` to a side-effect-free file, OR skip this step and rely on Task 19's puppeteer test (`test-newsletter-submit.mjs`) to validate the regex inside a real browser. **Skip this step if the import fails — it's belt-and-braces.**

- [ ] **Step 3: Commit**

```bash
git add js/newsletter.js
git commit -m "Phase 0 Task 3: js/newsletter.js footer form handler"
```

---

## Task 4: `js/meta.js` skeleton (Subagent Stream B)

**Files:**
- Create: `js/meta.js`

- [ ] **Step 1: Write the skeleton**

Create `js/meta.js`:

```js
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
```

- [ ] **Step 2: Commit**

```bash
git add js/meta.js
git commit -m "Phase 0 Task 4: js/meta.js skeleton (no-op until Phase 3)"
```

---

## Task 5: `components/header.html`

**Files:**
- Create: `components/header.html`
- Reference: `index.html` lines 771–790

- [ ] **Step 1: Create the components/ directory**

```bash
mkdir -p components
```

- [ ] **Step 2: Read index.html lines 771–790 to confirm header source markup**

Run: `sed -n '771,790p' index.html`
Expected: shows `<header class="site-header">` with `nav-left` (Shop / In-Store / Trunk Shows), `brand-wordmark`, and `nav-right` (Search, Account, Cart buttons with SVG icons).

- [ ] **Step 3: Write `components/header.html`**

The canonical markup, identical visuals to index.html's header but with `data-nav` hooks so `js/layout.js` can mark the active link, and `data-account-link` so Phase 1's `js/auth.js` can flip the href:

```html
<header class="site-header">
  <div class="header-inner">
    <nav class="nav-left">
      <a href="shop.html"             data-nav="/shop.html">Shop</a>
      <a href="in-store.html"         data-nav="/in-store.html">In-Store</a>
      <a href="in-store.html#trunk-shows" data-nav="/in-store.html#trunk-shows">Trunk Shows</a>
    </nav>
    <a href="index.html" class="brand-wordmark" data-nav="/">Country Road Fashions</a>
    <div class="nav-right">
      <button class="icon-btn" aria-label="Search" data-search-btn>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.35-4.35"/></svg>
      </button>
      <a href="login.html" class="icon-btn" aria-label="Account" data-account-link>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-7 8-7s8 3 8 7"/></svg>
      </a>
      <a href="cart.html" class="icon-btn cart-btn" aria-label="Cart">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M5 7h14l-1.5 12h-11Z"/><path d="M9 7V5a3 3 0 0 1 6 0v2"/></svg>
        <span class="cart-count" data-cart-count hidden>0</span>
      </a>
    </div>
  </div>
</header>
```

Three differences from the inline index.html version:
1. `Shop` and the brand wordmark now have real hrefs (not `#`)
2. The Account `<button>` becomes an `<a href="login.html">` with `data-account-link` — Phase 1 will flip the href to `account.html` when signed in
3. `data-nav` attributes added — `js/layout.js` will compare to `location.pathname` and add `[aria-current="page"]`

- [ ] **Step 4: Sanity-check the file**

Run: `cat components/header.html | head -3`
Expected: starts with `<header class="site-header">`.

- [ ] **Step 5: Commit**

```bash
git add components/header.html
git commit -m "Phase 0 Task 5: components/header.html canonical markup"
```

---

## Task 6: `components/footer.html`

**Files:**
- Create: `components/footer.html`
- Reference: `index.html` lines 1010–1075

- [ ] **Step 1: Read index.html lines 1010–1075 to confirm footer source markup**

Run: `sed -n '1010,1075p' index.html`
Expected: `<footer class="site-footer">` with `footer-grid`, `footer-brand` (logo + newsletter form), three `footer-col` blocks (Bespoke / Visit Us / House), and `footer-bottom`.

- [ ] **Step 2: Write `components/footer.html`**

Same structure as index.html's footer, but with the `<form>` upgraded with `data-newsletter-form` (so `js/newsletter.js` binds) and the broken `onsubmit="return false;"` removed. Privacy link in `footer-bottom` is kept (Phase 1 wires its href to `privacy.html`):

```html
<footer class="site-footer">
  <div class="footer-grid">
    <div class="footer-brand">
      <img class="footer-logo-img" src="/brand_assets/crf-logo.png" alt="Country Road Fashions" />
      <p class="footer-wordmark">Country Road Fashions</p>
      <p class="brand-line">Bespoke since 1951.<br/>Bangkok, Thailand.</p>
      <div class="footer-newsletter">
        <h5>Stay in touch</h5>
        <p>Quietly delivered: trunk show dates and seasonal cloth arrivals.</p>
        <form class="newsletter-form" data-newsletter-form novalidate>
          <input type="email" name="email" placeholder="Your email" autocomplete="email" required />
          <button type="submit" aria-label="Subscribe">→</button>
        </form>
      </div>
    </div>
    <div class="footer-col">
      <h4>Bespoke</h4>
      <ul>
        <li><a href="shop.html">Custom Suits</a></li>
        <li><a href="shop.html">Custom Shirts</a></li>
        <li><a href="shop.html">Tuxedos &amp; Black Tie</a></li>
        <li><a href="shop.html">Wedding Suits</a></li>
        <li><a href="shop.html">Mandarin Collar</a></li>
        <li><a href="shop.html">For Women</a></li>
      </ul>
    </div>
    <div class="footer-col">
      <h4>Visit Us</h4>
      <ul>
        <li><a href="in-store.html">Bangkok Showroom</a></li>
        <li><a href="in-store.html#trunk-shows">Trunk Shows</a></li>
        <li><a href="book-appointment.html">Book a Consultation</a></li>
        <li><a href="book-appointment.html#online">Online Measurements</a></li>
        <li><a href="in-store.html">Worldwide Shipping</a></li>
        <li><a href="book-appointment.html">Contact Us</a></li>
      </ul>
    </div>
    <div class="footer-col">
      <h4>House</h4>
      <ul>
        <li><a href="index.html">Our Heritage</a></li>
        <li><a href="index.html">The Bespoke Process</a></li>
        <li><a href="shop.html">Fabric Library</a></li>
        <li><a href="index.html">Press</a></li>
        <li><a href="index.html">FAQs</a></li>
        <li><a href="index.html">Satisfaction Promise</a></li>
      </ul>
    </div>
  </div>

  <div class="footer-bottom">
    <div>
      © 2026 Country Road Fashions, Bangkok.
      <span class="links" style="margin-left:18px;">
        <a href="privacy.html">Privacy</a>
        <a href="index.html">Sitemap</a>
        <a href="index.html">Accessibility</a>
      </span>
    </div>
    <div class="currency-select">
      <span>Thailand (THB)</span>
      <span>▾</span>
    </div>
  </div>
</footer>
```

- [ ] **Step 3: Commit**

```bash
git add components/footer.html
git commit -m "Phase 0 Task 6: components/footer.html canonical full footer"
```

---

## Task 7: `css/base.css` — tokens + reset + typography

**Files:**
- Create: `css/base.css` (this task writes the first section; Tasks 8 and 9 append the rest)

- [ ] **Step 1: Create `css/base.css` with tokens + reset + typography**

```css
/* =============================================================================
   Country Road Fashions — base.css
   Shared spine for every page. Token vocabulary, reset, typography ramp,
   .btn--* system, form controls, header styles, footer styles.
   No page-specific rules. No new colors, spacing, or animation curves —
   everything here is extracted from what already existed across the 6 pages.
   ============================================================================= */

/* === 1. Tokens ============================================================ */
:root {
  /* Color */
  --color-jet:        #0E0F11;
  --color-charcoal:   #1A1B1F;
  --color-stone:      #B6ADA5;
  --color-stone-soft: #D9D2CA;
  --color-cream:      #F7F2EA;
  --color-off-white:  #FAF8F4;
  --color-ink:        #2A2A2E;
  --color-muted:      #6B6B70;
  --color-rule:       rgba(14, 15, 17, 0.08);
  --color-white:      #FFFFFF;

  /* Type */
  --font-serif:       "Cormorant Garamond", Georgia, serif;
  --font-sans:        "Raleway", system-ui, -apple-system, "Segoe UI", sans-serif;
  --tracking-tight:   -0.03em;
  --tracking-eyebrow: 0.18em;
  --leading-body:     1.7;
  --leading-tight:    1.15;

  /* Spacing — intentional ramp */
  --space-1: 4px;   --space-2: 8px;   --space-3: 12px;  --space-4: 16px;
  --space-5: 24px;  --space-6: 32px;  --space-7: 48px;  --space-8: 72px;
  --space-9: 96px;

  /* Surface elevation */
  --shadow-1: 0 1px 2px rgba(14,15,17,0.06), 0 1px 1px rgba(14,15,17,0.04);
  --shadow-2: 0 4px 10px rgba(14,15,17,0.08), 0 2px 4px rgba(14,15,17,0.05);
  --shadow-3: 0 16px 32px rgba(14,15,17,0.10), 0 4px 8px rgba(14,15,17,0.06);

  /* Motion */
  --ease-spring: cubic-bezier(0.34, 1.36, 0.64, 1);
  --ease-out:    cubic-bezier(0.22, 1, 0.36, 1);
  --t-fast:      140ms;
  --t-med:       220ms;
  --t-slow:      360ms;

  /* Layout */
  --container-max: 1440px;
  --header-h:      72px;
}

/* === 2. Reset ============================================================= */
*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
html { -webkit-text-size-adjust: 100%; }
body {
  font-family: var(--font-sans);
  font-size: 16px;
  line-height: var(--leading-body);
  color: var(--color-ink);
  background: var(--color-off-white);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
img, svg, video { display: block; max-width: 100%; }
button { font: inherit; color: inherit; background: none; border: 0; padding: 0; cursor: pointer; }
a { color: inherit; text-decoration: none; }
ul, ol { margin: 0; padding: 0; list-style: none; }

/* === 3. Typography ramp =================================================== */
.eyebrow {
  font-family: var(--font-sans);
  font-size: 11px;
  letter-spacing: var(--tracking-eyebrow);
  text-transform: uppercase;
  color: var(--color-muted);
}
.h-display {
  font-family: var(--font-serif);
  font-weight: 500;
  font-size: clamp(36px, 5vw, 72px);
  line-height: var(--leading-tight);
  letter-spacing: var(--tracking-tight);
  color: var(--color-jet);
}
.h-section {
  font-family: var(--font-serif);
  font-weight: 500;
  font-size: clamp(28px, 3.5vw, 44px);
  line-height: var(--leading-tight);
  letter-spacing: var(--tracking-tight);
  color: var(--color-jet);
}
.h-card {
  font-family: var(--font-serif);
  font-weight: 500;
  font-size: 22px;
  line-height: 1.3;
  color: var(--color-jet);
}
.copy-body {
  font-size: 15px;
  line-height: var(--leading-body);
  color: var(--color-ink);
}
.copy-muted {
  font-size: 14px;
  line-height: var(--leading-body);
  color: var(--color-muted);
}

/* === 4. Focus visibility (a11y baseline) ================================== */
:focus { outline: none; }
:focus-visible {
  outline: 2px solid var(--color-stone);
  outline-offset: 3px;
  border-radius: 2px;
}
```

- [ ] **Step 2: Verify the file is valid CSS by hitting it from the dev server**

Run: `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/css/base.css`
Expected: `200`. (Even though no page references it yet, the file should serve.)

- [ ] **Step 3: Commit**

```bash
git add css/base.css
git commit -m "Phase 0 Task 7: css/base.css tokens + reset + typography"
```

---

## Task 8: `css/base.css` — `.btn--*` system + form controls

**Files:**
- Modify: `css/base.css` (append)

- [ ] **Step 1: Append the button system and form controls to `css/base.css`**

```css

/* === 5. Buttons =========================================================== */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  padding: 12px 28px;
  font-family: var(--font-sans);
  font-size: 13px;
  font-weight: 500;
  letter-spacing: 0.04em;
  line-height: 1;
  border: 1px solid transparent;
  border-radius: 0;
  cursor: pointer;
  transition: background var(--t-med) var(--ease-out),
              border-color var(--t-med) var(--ease-out),
              color var(--t-med) var(--ease-out),
              transform var(--t-fast) var(--ease-out);
}
.btn:active { transform: translateY(0); }

.btn--primary {
  background: var(--color-jet);
  color: var(--color-white);
  border-color: var(--color-jet);
}
.btn--primary:hover {
  background: var(--color-charcoal);
  border-color: var(--color-charcoal);
  transform: translateY(-1px);
}

.btn--ghost {
  background: transparent;
  color: var(--color-jet);
  border-color: var(--color-jet);
}
.btn--ghost:hover {
  background: var(--color-jet);
  color: var(--color-off-white);
}
.btn--ghost-light {
  background: transparent;
  color: var(--color-off-white);
  border-color: var(--color-off-white);
}
.btn--ghost-light:hover {
  background: var(--color-off-white);
  color: var(--color-jet);
}

.btn--light {
  background: var(--color-off-white);
  color: var(--color-jet);
  border-color: var(--color-off-white);
}
.btn--light:hover {
  background: var(--color-white);
  border-color: var(--color-white);
  transform: translateY(-1px);
}

/* === 6. Form controls ===================================================== */
.field {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  font-family: var(--font-sans);
}
.field label {
  font-size: 12px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-muted);
}
input[type="text"].input,
input[type="email"].input,
input[type="tel"].input,
input[type="search"].input,
textarea.input,
select.input {
  font-family: var(--font-sans);
  font-size: 14px;
  padding: 12px 14px;
  background: var(--color-white);
  color: var(--color-ink);
  border: 1px solid var(--color-rule);
  border-radius: 0;
  transition: border-color var(--t-med) var(--ease-out);
}
input.input:hover, textarea.input:hover, select.input:hover { border-color: var(--color-stone); }
input.input:focus-visible, textarea.input:focus-visible, select.input:focus-visible {
  border-color: var(--color-jet);
  outline-offset: 0;
}
input.input::placeholder { color: var(--color-muted); }
```

- [ ] **Step 2: Re-verify CSS still serves**

Run: `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/css/base.css`
Expected: `200`.

- [ ] **Step 3: Commit**

```bash
git add css/base.css
git commit -m "Phase 0 Task 8: css/base.css .btn--* system + form controls"
```

---

## Task 9: `css/base.css` — header + footer + newsletter form

**Files:**
- Modify: `css/base.css` (append)
- Reference for header CSS: `index.html` (inline `<style>` block), `shop.html`, `product.html` for existing rules to consolidate
- Reference for footer CSS: same

- [ ] **Step 1: Inspect existing header styles in `index.html`**

Run: `grep -n "site-header\|header-inner\|nav-left\|nav-right\|brand-wordmark\|icon-btn\|cart-count" index.html | head -40`
Take note of the rule blocks (line numbers) — you'll port them verbatim into base.css, with `var(--color-jet)` replacing any hardcoded `#000`.

- [ ] **Step 2: Append the header styles**

```css

/* === 7. Site header ======================================================= */
.site-header {
  position: sticky;
  top: 0;
  z-index: 50;
  background: var(--color-jet);
  color: var(--color-off-white);
  border-bottom: 1px solid rgba(255,255,255,0.06);
}
.header-inner {
  max-width: var(--container-max);
  margin: 0 auto;
  height: var(--header-h);
  padding: 0 var(--space-6);
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: var(--space-5);
}
.nav-left, .nav-right {
  display: flex;
  align-items: center;
  gap: var(--space-5);
}
.nav-right { justify-content: flex-end; }
.nav-left a {
  font-size: 12px;
  letter-spacing: var(--tracking-eyebrow);
  text-transform: uppercase;
  color: var(--color-off-white);
  transition: color var(--t-fast) var(--ease-out);
}
.nav-left a:hover { color: var(--color-stone); }
.nav-left a[aria-current="page"] { color: var(--color-stone); }

.brand-wordmark {
  font-family: var(--font-serif);
  font-style: italic;
  font-size: 22px;
  letter-spacing: 0.02em;
  color: var(--color-off-white);
  white-space: nowrap;
}

.icon-btn {
  width: 36px;
  height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--color-off-white);
  position: relative;
  transition: color var(--t-fast) var(--ease-out);
}
.icon-btn svg { width: 20px; height: 20px; }
.icon-btn:hover { color: var(--color-stone); }
.cart-btn .cart-count {
  position: absolute;
  top: -2px;
  right: -4px;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  background: var(--color-stone);
  color: var(--color-jet);
  font-size: 10px;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

@media (max-width: 720px) {
  .header-inner { grid-template-columns: auto 1fr auto; padding: 0 var(--space-4); }
  .nav-left { display: none; }
  .brand-wordmark { font-size: 18px; }
}

/* === 8. Site footer ======================================================= */
.site-footer {
  background: var(--color-charcoal);
  color: var(--color-off-white);
  padding: var(--space-8) var(--space-6) var(--space-5);
}
.footer-grid {
  max-width: var(--container-max);
  margin: 0 auto;
  display: grid;
  grid-template-columns: 1.4fr 1fr 1fr 1fr;
  gap: var(--space-7);
}
.footer-brand .footer-logo-img {
  width: 56px;
  height: auto;
  margin-bottom: var(--space-4);
  filter: brightness(0) invert(1);
}
.footer-wordmark {
  font-family: var(--font-serif);
  font-style: italic;
  font-size: 22px;
  margin: 0 0 var(--space-2);
}
.brand-line {
  font-size: 13px;
  color: var(--color-stone);
  margin: 0 0 var(--space-5);
}
.footer-col h4, .footer-newsletter h5 {
  font-family: var(--font-sans);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: var(--tracking-eyebrow);
  text-transform: uppercase;
  color: var(--color-stone);
  margin: 0 0 var(--space-3);
}
.footer-col ul { display: flex; flex-direction: column; gap: var(--space-2); }
.footer-col a {
  font-size: 13px;
  color: var(--color-off-white);
  transition: color var(--t-fast) var(--ease-out);
}
.footer-col a:hover { color: var(--color-stone); }

.footer-newsletter p {
  font-size: 13px;
  color: var(--color-stone-soft);
  margin: 0 0 var(--space-3);
}
.newsletter-form {
  display: flex;
  align-items: stretch;
  border: 1px solid rgba(255,255,255,0.16);
}
.newsletter-form input {
  flex: 1;
  background: transparent;
  color: var(--color-off-white);
  font-family: var(--font-sans);
  font-size: 13px;
  padding: 10px 12px;
  border: 0;
  outline: none;
}
.newsletter-form input::placeholder { color: var(--color-stone); }
.newsletter-form button {
  padding: 0 16px;
  color: var(--color-off-white);
  font-size: 18px;
  line-height: 1;
  transition: background var(--t-fast) var(--ease-out);
}
.newsletter-form button:hover { background: rgba(255,255,255,0.06); }
.newsletter-form button[aria-busy="true"] {
  opacity: 0.6;
  cursor: progress;
}
.newsletter-success {
  font-family: var(--font-serif);
  font-style: italic;
  font-size: 15px;
  color: var(--color-stone);
  margin: var(--space-3) 0 0;
  min-height: 64px;
}
.newsletter-error {
  font-size: 12px;
  color: var(--color-stone-soft);
  margin: var(--space-2) 0 0;
}

.footer-bottom {
  max-width: var(--container-max);
  margin: var(--space-7) auto 0;
  padding-top: var(--space-5);
  border-top: 1px solid rgba(255,255,255,0.08);
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  color: var(--color-stone);
}
.footer-bottom .links a {
  color: var(--color-stone);
  margin-right: var(--space-4);
  transition: color var(--t-fast) var(--ease-out);
}
.footer-bottom .links a:hover { color: var(--color-off-white); }

@media (max-width: 900px) {
  .footer-grid { grid-template-columns: 1fr 1fr; gap: var(--space-6); }
}
@media (max-width: 540px) {
  .footer-grid { grid-template-columns: 1fr; }
  .footer-bottom { flex-direction: column; gap: var(--space-3); align-items: flex-start; }
}
```

- [ ] **Step 2: Re-verify CSS still serves and parses**

Run: `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/css/base.css`
Expected: `200`.

- [ ] **Step 3: Commit**

```bash
git add css/base.css
git commit -m "Phase 0 Task 9: css/base.css header + footer + newsletter styles"
```

---

## Task 10: `js/layout.js`

**Files:**
- Create: `js/layout.js`

- [ ] **Step 1: Write the module**

Create `js/layout.js`:

```js
// =============================================================================
// Country Road Fashions — layout mounter
// =============================================================================
// Fetches components/header.html and components/footer.html and injects them
// into the page's <div data-layout="header"> and <div data-layout="footer">
// slots, then dispatches a `crf:layout-ready` event on document. Consumer
// modules (js/cart.js, js/newsletter.js, page scripts) listen for this event
// before binding to header/footer elements.
//
// Also: decorates the active nav link based on location.pathname.
// =============================================================================

const HEADER_URL = '/components/header.html';
const FOOTER_URL = '/components/footer.html';

async function fetchFragment(url) {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`[layout] ${url} → ${res.status}`);
  return res.text();
}

function decorateActiveNav(root) {
  if (!root) return;
  const here = location.pathname || '/';
  const links = root.querySelectorAll('[data-nav]');
  for (const a of links) {
    const target = a.getAttribute('data-nav');
    if (target === here || (target === '/' && (here === '/' || here.endsWith('/index.html')))) {
      a.setAttribute('aria-current', 'page');
    }
  }
}

function clearReservation(slot) {
  if (!slot) return;
  slot.style.minHeight = '';
  slot.style.background = '';
}

async function mount() {
  const headerSlot = document.querySelector('[data-layout="header"]');
  const footerSlot = document.querySelector('[data-layout="footer"]');

  const tasks = [];
  if (headerSlot) tasks.push(fetchFragment(HEADER_URL).then(html => { headerSlot.innerHTML = html; clearReservation(headerSlot); }));
  if (footerSlot) tasks.push(fetchFragment(FOOTER_URL).then(html => { footerSlot.innerHTML = html; clearReservation(footerSlot); }));

  if (!tasks.length) return;
  try {
    await Promise.all(tasks);
  } catch (e) {
    console.error('[layout] mount failed', e);
    return;
  }

  if (headerSlot) decorateActiveNav(headerSlot);
  document.dispatchEvent(new Event('crf:layout-ready'));
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount, { once: true });
} else {
  mount();
}
```

- [ ] **Step 2: Verify it serves**

Run: `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/js/layout.js`
Expected: `200`.

- [ ] **Step 3: Commit**

```bash
git add js/layout.js
git commit -m "Phase 0 Task 10: js/layout.js fetch + inject + crf:layout-ready"
```

---

## Task 11: Modify `js/cart.js` to wait for `crf:layout-ready`

**Files:**
- Modify: `js/cart.js` lines 121–126 (the auto-mount block)

- [ ] **Step 1: Read the current auto-mount block**

Run: `sed -n '121,126p' js/cart.js`
Expected:

```js
// Auto-mount on DOMContentLoaded so callers don't have to.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mountCartBadge);
} else {
  mountCartBadge();
}
```

- [ ] **Step 2: Replace it with layout-aware mounting**

Use Edit to replace the 5-line auto-mount block with:

```js
// Auto-mount: prefer the layout-ready event (shared header), fall back to
// DOMContentLoaded for any page that still has an inline [data-cart-count].
function tryMount() {
  if (document.querySelector('[data-cart-count]')) {
    mountCartBadge();
    return true;
  }
  return false;
}
if (!tryMount()) {
  document.addEventListener('crf:layout-ready', tryMount, { once: true });
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tryMount);
  }
}
```

The double-bind is safe because `mountCartBadge` is internally idempotent enough (it just queries elements again), but to be safe we wrap in `tryMount` that returns early after success.

- [ ] **Step 3: Make `mountCartBadge` re-entrant-safe**

In `js/cart.js`, find the line `export function mountCartBadge() {` (~line 103) and add a guard immediately inside the function body:

```js
export function mountCartBadge() {
  if (mountCartBadge._mounted) return;
  const els = document.querySelectorAll('[data-cart-count]');
  if (!els.length) return;
  mountCartBadge._mounted = true;
  // ...rest of existing body unchanged
```

(Add the guard line, then the existing `const els` line, then add `mountCartBadge._mounted = true;` AFTER the early-return check. The rest of the function body is unchanged.)

- [ ] **Step 4: Smoke-test in a browser**

Manual: open `http://localhost:3000/cart.html` (which still has an inline header — this task runs BEFORE Task 12). Verify the cart badge still works (add an item via the customizer on a PDP first if cart is empty). Console should be clean.

- [ ] **Step 5: Commit**

```bash
git add js/cart.js
git commit -m "Phase 0 Task 11: js/cart.js defers badge mount until crf:layout-ready"
```

---

## Task 12: Migrate `index.html`

**Files:**
- Modify: `index.html`

For each page-migration task (12–17), the operations are:
1. Add `<link rel="stylesheet" href="/css/base.css">` in `<head>` before any existing `<style>`
2. Add inline FOUC token block in `<head>`
3. Add preload hints in `<head>`
4. Add `<script type="module" src="/js/layout.js"></script>` and `<script type="module" src="/js/newsletter.js"></script>` in `<head>`
5. Replace `<header>...</header>` with `<div data-layout="header">` slot
6. Replace `<footer>...</footer>` with `<div data-layout="footer">` slot
7. Strip duplicated tokens, `.btn-primary`/`.btn-dark`/`.btn-light`/`.btn-outline*` rules, hardcoded `#000`/`#fff` from inline `<style>`
8. Rename button class attributes in markup
9. Smoke-test in browser
10. Commit

- [ ] **Step 1: Add the base.css link + FOUC block + preload hints + script tags in `<head>`**

Find the `<head>` block in `index.html` and insert the following AFTER the last existing `<link>` tag (Google Fonts), BEFORE the existing `<style>` block:

```html
<link rel="preload" as="fetch" href="/components/header.html" crossorigin>
<link rel="preload" as="fetch" href="/components/footer.html" crossorigin>
<link rel="stylesheet" href="/css/base.css">
<style>
  /* FOUC tokens — only the two used by the data-layout slot reservations. */
  :root { --color-jet:#0E0F11; --color-charcoal:#1A1B1F; }
</style>
<script type="module" src="/js/layout.js"></script>
<script type="module" src="/js/newsletter.js"></script>
<script type="module" src="/js/meta.js"></script>
```

- [ ] **Step 2: Replace `<header>` block with a slot**

Find `<header class="site-header">` (around line 771) and the matching `</header>` (around line 791). Replace the entire block with:

```html
<div data-layout="header" style="min-height:72px;background:var(--color-jet);"></div>
```

- [ ] **Step 3: Replace `<footer>` block with a slot**

Find `<footer class="site-footer">` (around line 1010) and the matching `</footer>` (around line 1076). Replace with:

```html
<div data-layout="footer" style="min-height:480px;background:var(--color-charcoal);"></div>
```

- [ ] **Step 4: Strip duplicated rules from the inline `<style>` block**

In `index.html`'s `<style>` block, delete the following rule sets (they are now in `css/base.css`):
- The `:root { ... }` token block (the file-level one near the top; if there's a page-specific override block leave that alone)
- Any reset/normalize rules (`*, *::before, *::after`, `body { font-family: ... }`, `img { ... }`, etc.) — keep only page-specific layout rules
- `.btn-dark { ... }` and `.btn-dark:hover { ... }` blocks (now `.btn--primary` in base.css)
- Header rules: `.site-header`, `.header-inner`, `.nav-left`, `.nav-right`, `.brand-wordmark`, `.icon-btn`, `.cart-btn`, `.cart-count`
- Footer rules: `.site-footer`, `.footer-grid`, `.footer-brand`, `.footer-logo-img`, `.footer-wordmark`, `.brand-line`, `.footer-col`, `.footer-newsletter`, `.newsletter-form`, `.footer-bottom`, `.currency-select`
- Any `transition: all ...` declarations — narrow to specific properties (the surviving CSS in base.css already does this)

KEEP: page-specific styles like `.hero`, `.hero-overlay`, `.hero-eyebrow`, `.hero-title`, `.hero-actions`, `.category-tiles`, `.tile`, `.tile-img--suit`, `.tile-content`, `.tile-eyebrow`, `.tile-title`, the video toggle styles, and any editorial section styles. These remain inline.

- [ ] **Step 5: Replace any hardcoded `#000` or `#000000` outside the FOUC block with `var(--color-jet)`**

Run: `grep -n "#000\b\|#000000" index.html`
For each match (excluding the FOUC `<style>` block), replace with `var(--color-jet)`. Skip matches that are inside SVG `stroke="#000"` attributes (those are fine).

- [ ] **Step 6: Rename button classes in markup**

Run: `grep -n "class=\"btn btn-dark\"\|class=\"btn btn-primary\"" index.html`
For each match, replace `btn-dark` or `btn-primary` with `btn--primary`. Also replace `btn-light` with `btn--light` and `btn-outline-light` with `btn--ghost-light`.

- [ ] **Step 7: Reload + smoke-test**

Manual: visit `http://localhost:3000/` in a browser. Verify:
- Header appears within ~100ms with no flash of white
- Footer appears below the fold with the full multi-column structure + newsletter form
- Console clean (no errors, no 404s for components/*)
- "Book a Visit" / "Custom Made" buttons in the hero still styled correctly

Run: `node screenshot.mjs http://localhost:3000/ phase-0-index-after`
Compare visually against `temporary screenshots/phase-0/before/1440-index.png`.

- [ ] **Step 8: Commit**

```bash
git add index.html
git commit -m "Phase 0 Task 12: migrate index.html to shared layout"
```

---

## Task 13: Migrate `shop.html`

**Files:**
- Modify: `shop.html`

- [ ] **Step 1: Add `<head>` additions**

Same block as Task 12 Step 1, inserted at the same position (after Google Fonts, before existing `<style>`):

```html
<link rel="preload" as="fetch" href="/components/header.html" crossorigin>
<link rel="preload" as="fetch" href="/components/footer.html" crossorigin>
<link rel="stylesheet" href="/css/base.css">
<style>
  :root { --color-jet:#0E0F11; --color-charcoal:#1A1B1F; }
</style>
<script type="module" src="/js/layout.js"></script>
<script type="module" src="/js/newsletter.js"></script>
<script type="module" src="/js/meta.js"></script>
```

- [ ] **Step 2: Replace `<header>` block**

Find `<header class="site-header">` (line ~479) through `</header>`. Replace with:

```html
<div data-layout="header" style="min-height:72px;background:var(--color-jet);"></div>
```

- [ ] **Step 3: Replace the thin `<footer>` block**

Find `<footer class="site-footer">` (line ~591) through `</footer>`. Replace with:

```html
<div data-layout="footer" style="min-height:480px;background:var(--color-charcoal);"></div>
```

This intentionally upgrades shop's thin signature footer to the canonical full footer per spec §3 Q1.

- [ ] **Step 4: Strip duplicated rules from inline `<style>` block**

Remove from `shop.html`'s `<style>`:
- `:root { ... }` token block
- Reset/normalize rules
- `.btn-primary`, `.btn-outline` (now in base.css as `.btn--primary` and `.btn--ghost`)
- Header rules (same selector list as Task 12 Step 4)
- The thin footer rules (`.site-footer .signature`, `.site-footer .links` — gone, replaced by base.css)
- Any `transition: all ...`

KEEP: page-specific shop styles — `.shop-layout`, `.filter-rail`, `.product-card`, `.product-card.has-hero`, `.img-wrap`, swatch rows, etc.

- [ ] **Step 5: `#000` audit**

Run: `grep -n "#000\b\|#000000" shop.html`
Replace each non-FOUC, non-SVG-attribute match with `var(--color-jet)`.

- [ ] **Step 6: Rename button classes in markup**

Run: `grep -n "btn-primary\|btn-outline\|btn-dark" shop.html`
Replace `btn-primary` → `btn--primary`, `btn-outline` → `btn--ghost`.

- [ ] **Step 7: Smoke-test**

Visit `http://localhost:3000/shop.html`. Verify:
- Shared header (with `Shop` link marked active via `aria-current="page"`)
- 6 product cards still render with swatch hover
- Footer is the full multi-column version
- Console clean

Run: `node screenshot.mjs http://localhost:3000/shop.html phase-0-shop-after`

- [ ] **Step 8: Commit**

```bash
git add shop.html
git commit -m "Phase 0 Task 13: migrate shop.html to shared layout (gains full footer)"
```

---

## Task 14: Migrate `product.html`

**Files:**
- Modify: `product.html`

- [ ] **Step 1: Add `<head>` additions**

Insert the same block as Task 12 Step 1 in `product.html`'s `<head>` after Google Fonts.

- [ ] **Step 2: Replace `<header>` block**

Find `<header class="site-header">` (line ~781) through `</header>`. Replace with:

```html
<div data-layout="header" style="min-height:72px;background:var(--color-jet);"></div>
```

- [ ] **Step 3: Replace the thin `<footer>` block**

Find `<footer class="site-footer">` (line ~883) through `</footer>`. Replace with:

```html
<div data-layout="footer" style="min-height:480px;background:var(--color-charcoal);"></div>
```

- [ ] **Step 4: Strip duplicated rules from inline `<style>`**

Remove same categories as Task 13 Step 4. KEEP: `.pdp-layout`, `.thumb-rail`, `.main-image`, `.design-swatches`, `.size-row`, `.customize-btn`, accordion styles, etc.

- [ ] **Step 5: `#000` audit**

Run: `grep -n "#000\b\|#000000" product.html`
Replace each non-FOUC, non-SVG-attribute match with `var(--color-jet)`.

- [ ] **Step 6: Rename button classes in markup**

Run: `grep -n "btn-primary\|btn-outline\|btn-dark" product.html`
Replace `btn-primary` → `btn--primary`. Note: `<button class="btn-primary" id="customizeBtn" hidden>` becomes `<button class="btn btn--primary" id="customizeBtn" hidden>` — make sure the `btn` base class is present.

- [ ] **Step 7: Smoke-test**

Visit `http://localhost:3000/product.html?item=formal-suit-2-piece&fabric=vbc-wool&design=vbc-wool-grey-herringbone`. Verify:
- Shared header
- PDP layout intact (thumb rail + main image + customize button + accordion)
- Click "Customize Your Suit" → drawer opens correctly (cart.js race condition fix is exercised here)
- Footer is the full multi-column version
- Console clean

Run: `node screenshot.mjs "http://localhost:3000/product.html?item=formal-suit-2-piece&fabric=vbc-wool&design=vbc-wool-grey-herringbone" phase-0-product-after`

- [ ] **Step 8: Commit**

```bash
git add product.html
git commit -m "Phase 0 Task 14: migrate product.html to shared layout"
```

---

## Task 15: Migrate `cart.html`

**Files:**
- Modify: `cart.html`

- [ ] **Step 1: Add `<head>` additions**

Insert the same block as Task 12 Step 1 in `cart.html`'s `<head>` after Google Fonts.

- [ ] **Step 2: Replace `<header>` block**

Find `<header class="site-header">` (line ~431) through `</header>`. Replace with:

```html
<div data-layout="header" style="min-height:72px;background:var(--color-jet);"></div>
```

- [ ] **Step 3: Replace the mid `<footer>` block**

Find `<footer class="site-footer">` (line ~475) through `</footer>`. Replace with:

```html
<div data-layout="footer" style="min-height:480px;background:var(--color-charcoal);"></div>
```

- [ ] **Step 4: Strip duplicated rules from inline `<style>`**

Remove same categories as Task 13 Step 4. Specifically: `.btn-primary`, `.btn-outline`, `.footer-inner`, `.footer-col` styles. KEEP: `.cart-grid`, `.cart-line`, `.line-spec`, `.summary-card`, `.empty-state`, etc.

- [ ] **Step 5: `#000` audit**

Run: `grep -n "#000\b\|#000000" cart.html`
Replace each non-FOUC, non-SVG-attribute match with `var(--color-jet)`.

- [ ] **Step 6: Rename button classes in markup**

Run: `grep -n "btn-primary\|btn-outline" cart.html`
Replace `btn-primary` → `btn--primary`, `btn-outline` → `btn--ghost`. The `<a class="btn-primary" id="reserveLink" href="#">Reserve Consultation</a>` becomes `<a class="btn btn--primary" id="reserveLink" href="#">Reserve Consultation</a>` — keep the `btn` base class.

- [ ] **Step 7: Smoke-test**

Add an item to the cart first (via the customizer on a PDP), then visit `http://localhost:3000/cart.html`. Verify:
- Shared header with cart badge showing count
- Cart line rendered with full spec sheet
- `Reserve Consultation` button styled correctly
- Footer is the full multi-column version
- Console clean

Run: `node screenshot.mjs http://localhost:3000/cart.html phase-0-cart-after`

- [ ] **Step 8: Commit**

```bash
git add cart.html
git commit -m "Phase 0 Task 15: migrate cart.html to shared layout"
```

---

## Task 16: Migrate `book-appointment.html`

**Files:**
- Modify: `book-appointment.html`

- [ ] **Step 1: Add `<head>` additions**

Insert the same block as Task 12 Step 1 in `book-appointment.html`'s `<head>` after Google Fonts.

- [ ] **Step 2: Replace `<header>` block**

Find `<header class="site-header">` (line ~427) through `</header>`. Replace with:

```html
<div data-layout="header" style="min-height:72px;background:var(--color-jet);"></div>
```

- [ ] **Step 3: Replace `<footer>` block**

Find `<footer class="site-footer">` (line ~569) through `</footer>`. Replace with:

```html
<div data-layout="footer" style="min-height:480px;background:var(--color-charcoal);"></div>
```

- [ ] **Step 4: Strip duplicated rules from inline `<style>`**

Remove same categories as Task 13 Step 4 (including `.footer-grid`, `.footer-brand`, etc. — same selectors as index, this page used the full footer too). KEEP: hero/consultation form styles, Calendly embed wrappers.

- [ ] **Step 5: `#000` audit + button class rename**

```bash
grep -n "#000\b\|#000000" book-appointment.html
grep -n "btn-dark\|btn-primary\|btn-outline\|btn-light" book-appointment.html
```

Replace each non-FOUC, non-SVG match with the token. Rename: `btn-dark`/`btn-primary` → `btn--primary`, `btn-light` → `btn--light`, `btn-outline-light` → `btn--ghost-light`.

- [ ] **Step 6: Smoke-test**

Visit `http://localhost:3000/book-appointment.html`. Verify:
- Shared header with `Trunk Shows` and `In-Store` nav links (no `Book` nav link to mark active — that's expected)
- Consultation form intact
- Footer matches index.html's footer
- Console clean

Run: `node screenshot.mjs http://localhost:3000/book-appointment.html phase-0-book-after`

- [ ] **Step 7: Commit**

```bash
git add book-appointment.html
git commit -m "Phase 0 Task 16: migrate book-appointment.html to shared layout"
```

---

## Task 17: Migrate `in-store.html`

**Files:**
- Modify: `in-store.html`

- [ ] **Step 1: Add `<head>` additions**

Insert the same block as Task 12 Step 1 in `in-store.html`'s `<head>` after Google Fonts.

- [ ] **Step 2: Replace `<header>` block**

Find `<header class="site-header">` (line ~412) through `</header>`. Replace with:

```html
<div data-layout="header" style="min-height:72px;background:var(--color-jet);"></div>
```

- [ ] **Step 3: Replace `<footer>` block**

Find `<footer class="site-footer">` (line ~531) through `</footer>`. Replace with:

```html
<div data-layout="footer" style="min-height:480px;background:var(--color-charcoal);"></div>
```

- [ ] **Step 4: Strip duplicated rules from inline `<style>`**

Remove same categories as Task 13 Step 4. KEEP: `.atelier-row`, `.trunk-row`, `.virtual-row` and other page-specific layout rules.

- [ ] **Step 5: `#000` audit + button class rename**

```bash
grep -n "#000\b\|#000000" in-store.html
grep -n "btn-dark\|btn-primary\|btn-outline\|btn-light" in-store.html
```

Replace each non-FOUC, non-SVG match with the token. Rename: `btn-dark`/`btn-primary` → `btn--primary`. Special-case: `.virtual-row .btn-dark { background: var(--color-jet); border-color: var(--color-jet); }` rule — that descendant override can be removed entirely (the new `.btn--primary` already uses `--color-jet`).

- [ ] **Step 6: Smoke-test**

Visit `http://localhost:3000/in-store.html`. Verify:
- Shared header with `In-Store` link marked active
- All three sections (atelier / trunk shows / virtual) render correctly with their `Book Appointment` CTAs
- Footer matches index.html's footer
- Console clean

Run: `node screenshot.mjs http://localhost:3000/in-store.html phase-0-instore-after`

- [ ] **Step 7: Commit**

```bash
git add in-store.html
git commit -m "Phase 0 Task 17: migrate in-store.html to shared layout"
```

---

## Task 18: `scripts/test-layout-mount.mjs`

**Files:**
- Create: `scripts/test-layout-mount.mjs`

- [ ] **Step 1: Write the failing test (test runs against the now-migrated pages, so it should PASS — but write it as a real test that would fail if mounting were broken)**

Create `scripts/test-layout-mount.mjs`:

```js
// Phase 0 smoke test: header + footer mount on all 6 pages, console clean,
// .btn--primary computes a non-default background.
// Run AFTER all 6 pages have been migrated (Tasks 12–17).

import puppeteer from 'puppeteer';

const PAGES = [
  'http://localhost:3000/index.html',
  'http://localhost:3000/shop.html',
  'http://localhost:3000/product.html?item=formal-suit-2-piece&fabric=vbc-wool&design=vbc-wool-grey-herringbone',
  'http://localhost:3000/cart.html',
  'http://localhost:3000/book-appointment.html',
  'http://localhost:3000/in-store.html',
];

let failures = 0;

function fail(url, msg) {
  console.error(`✘ ${url}\n  ${msg}`);
  failures++;
}

function pass(url, msg) {
  console.log(`✔ ${url}  ${msg}`);
}

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
for (const url of PAGES) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  const consoleErrors = [];
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') consoleErrors.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', e => consoleErrors.push(`[pageerror] ${e.message}`));

  await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });

  // Wait for crf:layout-ready (or 5s timeout)
  const ready = await page.evaluate(() => new Promise(resolve => {
    if (document.querySelector('[data-layout="header"]')?.children.length) return resolve(true);
    document.addEventListener('crf:layout-ready', () => resolve(true), { once: true });
    setTimeout(() => resolve(false), 5000);
  }));

  if (!ready) { fail(url, 'crf:layout-ready never fired'); await page.close(); continue; }

  const checks = await page.evaluate(() => {
    const headerSlot = document.querySelector('[data-layout="header"]');
    const footerSlot = document.querySelector('[data-layout="footer"]');
    const brand = document.querySelector('.brand-wordmark');
    const newsletterForm = document.querySelector('[data-newsletter-form]');
    const cartBadge = document.querySelector('[data-cart-count]');

    let primaryBtnBg = null;
    const primary = document.querySelector('.btn--primary');
    if (primary) primaryBtnBg = getComputedStyle(primary).backgroundColor;

    return {
      headerInjected: !!(headerSlot && headerSlot.children.length),
      footerInjected: !!(footerSlot && footerSlot.children.length),
      hasBrand: !!brand,
      hasNewsletterForm: !!newsletterForm,
      hasCartBadge: !!cartBadge,
      primaryBtnBg,
    };
  });

  if (!checks.headerInjected) fail(url, 'header slot is empty');
  else if (!checks.footerInjected) fail(url, 'footer slot is empty');
  else if (!checks.hasBrand) fail(url, '.brand-wordmark missing in header');
  else if (!checks.hasNewsletterForm) fail(url, '[data-newsletter-form] missing in footer');
  else if (!checks.hasCartBadge) fail(url, '[data-cart-count] missing in header');
  else if (checks.primaryBtnBg && !/14,\s*15,\s*17|rgb\(14,\s*15,\s*17\)/.test(checks.primaryBtnBg)) {
    fail(url, `.btn--primary background is ${checks.primaryBtnBg}, expected rgb(14, 15, 17)`);
  } else {
    pass(url, 'mounts clean');
  }

  if (consoleErrors.length) {
    fail(url, `console: ${consoleErrors.join(' | ')}`);
  }

  await page.close();
}

await browser.close();

if (failures) {
  console.error(`\n❌ ${failures} failure(s)`);
  process.exit(1);
} else {
  console.log(`\n✅ All 6 pages mount cleanly`);
}
```

- [ ] **Step 2: Run the test**

Run: `node scripts/test-layout-mount.mjs`
Expected: 6 `✔` lines, ending in `✅ All 6 pages mount cleanly`.

If anything fails: do NOT advance. Diagnose the specific failure — most likely cause is one of the 6 pages missing the script tags or having a typo in the slot markup. Fix and re-run.

- [ ] **Step 3: Commit**

```bash
git add scripts/test-layout-mount.mjs
git commit -m "Phase 0 Task 18: scripts/test-layout-mount.mjs"
```

---

## Task 19: `scripts/test-newsletter-submit.mjs`

**Files:**
- Create: `scripts/test-newsletter-submit.mjs`

- [ ] **Step 1: Write the submit + idempotency test**

Create `scripts/test-newsletter-submit.mjs`:

```js
// Phase 0 smoke test: submit a unique email via the footer form on index.html,
// poll Supabase REST for the row, then re-submit the same email and assert
// idempotency. Cleans up the row at the end using the service-role key.

import puppeteer from 'puppeteer';
import fs from 'node:fs';

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8')
    .split('\n').filter(Boolean)
    .map(l => l.split('=').map(s => s.trim()))
    .map(([k, ...v]) => [k, v.join('=')])
);
const ANON   = env.SUPABASE_ANON_KEY;
const SVCROL = env.SUPABASE_SERVICE_ROLE_KEY;
const URL    = 'https://fzgsogdceptjvuahukbn.supabase.co';
const REST   = `${URL}/rest/v1/newsletter_subscribers`;

const TEST_EMAIL = `phase0-test-${Date.now()}-${Math.random().toString(36).slice(2,8)}@example.com`;

async function fetchRow(email) {
  const r = await fetch(`${REST}?email=eq.${encodeURIComponent(email)}&select=email,source,opted_in_at`, {
    headers: { apikey: SVCROL, Authorization: `Bearer ${SVCROL}` },
  });
  if (!r.ok) throw new Error(`REST ${r.status} ${await r.text()}`);
  return (await r.json())[0] || null;
}

async function deleteRow(email) {
  await fetch(`${REST}?email=eq.${encodeURIComponent(email)}`, {
    method: 'DELETE',
    headers: { apikey: SVCROL, Authorization: `Bearer ${SVCROL}`, Prefer: 'return=minimal' },
  });
}

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });

let failed = false;
function step(name, ok, detail = '') {
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) failed = true;
}

try {
  await page.goto('http://localhost:3000/index.html', { waitUntil: 'networkidle0' });

  // Scroll to footer + wait for layout-ready
  await page.evaluate(() => new Promise(resolve => {
    if (document.querySelector('[data-newsletter-form]')) return resolve();
    document.addEventListener('crf:layout-ready', resolve, { once: true });
  }));
  await page.waitForSelector('[data-newsletter-form] input[type="email"]', { timeout: 5000 });

  // Submit 1
  await page.evaluate((email) => {
    const form  = document.querySelector('[data-newsletter-form]');
    const input = form.querySelector('input[type="email"]');
    input.value = email;
    form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
  }, TEST_EMAIL);

  // Wait for success swap (form replaced with .newsletter-success) — or error
  const result1 = await page.waitForFunction(
    () => document.querySelector('.newsletter-success') || document.querySelector('.newsletter-error'),
    { timeout: 8000 }
  ).then(h => h.evaluate(el => el.className));
  step('submit 1 produced success', result1 === 'newsletter-success', result1);

  // Poll REST for the row (up to 3s)
  let row = null;
  for (let i = 0; i < 10 && !row; i++) {
    row = await fetchRow(TEST_EMAIL);
    if (!row) await new Promise(r => setTimeout(r, 300));
  }
  step('row exists in newsletter_subscribers', !!row, row ? `source=${row.source}` : 'not found');
  step('row source = "footer"', row?.source === 'footer');

  // Submit 2 (idempotency) — reload page, submit same email
  await page.goto('http://localhost:3000/index.html', { waitUntil: 'networkidle0' });
  await page.evaluate(() => new Promise(resolve => {
    if (document.querySelector('[data-newsletter-form]')) return resolve();
    document.addEventListener('crf:layout-ready', resolve, { once: true });
  }));
  await page.waitForSelector('[data-newsletter-form] input[type="email"]');
  await page.evaluate((email) => {
    const form  = document.querySelector('[data-newsletter-form]');
    const input = form.querySelector('input[type="email"]');
    input.value = email;
    form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
  }, TEST_EMAIL);

  const result2 = await page.waitForFunction(
    () => document.querySelector('.newsletter-success') || document.querySelector('.newsletter-error'),
    { timeout: 8000 }
  ).then(h => h.evaluate(el => el.className));
  step('submit 2 (same email) produced success', result2 === 'newsletter-success', result2);
} catch (e) {
  failed = true;
  console.error('Test threw:', e.message);
} finally {
  await deleteRow(TEST_EMAIL).catch(() => {});
  await browser.close();
}

if (failed) { console.error('\n❌ newsletter submit test failed'); process.exit(1); }
console.log('\n✅ newsletter submit + idempotency pass');
```

- [ ] **Step 2: Run the test**

Run: `node scripts/test-newsletter-submit.mjs`
Expected: 4 `✔` lines (submit 1 success, row exists, source correct, submit 2 success), then `✅ newsletter submit + idempotency pass`.

- [ ] **Step 3: Commit**

```bash
git add scripts/test-newsletter-submit.mjs
git commit -m "Phase 0 Task 19: scripts/test-newsletter-submit.mjs"
```

---

## Task 20: `scripts/test-token-discipline.mjs`

**Files:**
- Create: `scripts/test-token-discipline.mjs`

- [ ] **Step 1: Write the lint-style discipline test**

Create `scripts/test-token-discipline.mjs`:

```js
// Phase 0 lint: forbid legacy button class attribute use, hardcoded #000/#fff
// outside token definitions, and `transition: all` anywhere.

import fs from 'node:fs';
import path from 'node:path';

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
    pattern: /(?:background(?:-color)?|color|border(?:-color)?|fill|stroke)\s*:\s*#000\b/i,
    allow: /--color-jet\s*:\s*#0E0F11/,
    message: 'hardcoded #000 — use var(--color-jet)',
  },
  {
    pattern: /(?:background(?:-color)?|color|border(?:-color)?|fill|stroke)\s*:\s*#fff\b/i,
    allow: /--color-(?:white|off-white)\s*:/,
    message: 'hardcoded #fff — use var(--color-white) or var(--color-off-white)',
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
```

- [ ] **Step 2: Run the test**

Run: `node scripts/test-token-discipline.mjs`
Expected: `✅ token discipline clean across 7 files`.

If failures: each violation prints with file + line. Fix the underlying file, re-run.

- [ ] **Step 3: Commit**

```bash
git add scripts/test-token-discipline.mjs
git commit -m "Phase 0 Task 20: scripts/test-token-discipline.mjs"
```

---

## Task 21: After-screenshots + visual gate

**Files:**
- Create: `temporary screenshots/phase-0/after/` (12 PNGs)

- [ ] **Step 1: Reuse the baseline capture script for the after/ pass**

Edit `scripts/capture-phase-0-baseline.mjs` (created in Task 1) — change the constant `OUT_DIR` from `'before'` to `'after'`. Or use a one-shot variant:

```bash
node -e "
import('node:fs').then(fs => {
  const src = fs.readFileSync('scripts/capture-phase-0-baseline.mjs','utf8');
  fs.writeFileSync('scripts/capture-phase-0-after.mjs', src.replace(\"'before'\",\"'after'\"));
});
"
node scripts/capture-phase-0-after.mjs
```

Expected: 12 `✔` lines, then `Done.`.

- [ ] **Step 2: Verify 12 after-screenshots exist**

Run: `ls "temporary screenshots/phase-0/after/" | wc -l`
Expected: `12`.

- [ ] **Step 3: Visual gate — manual diff**

For each of the 6 pages, open the before and after 1440-width PNGs side-by-side. Apply Section 8.2 of the spec:

- **Above-the-fold (header band + first hero/content section):** pixel-equivalent? Differences must be either (a) explained (e.g., focus ring now visible because it wasn't before — acceptable) or (b) fixed.
- **Footer on shop/product/cart:** intentionally different (now full footer). Verify the new footer matches index.html's after-footer at 1440 width.
- **Anywhere else:** pixel-equivalent.

Repeat for 375-width PNGs.

If anything is unexpectedly different (e.g., a hero CTA changed color, a button shrank), trace it back: usually a stripped CSS rule that was actually page-specific. Restore it inline and re-screenshot.

- [ ] **Step 4: Commit the capture-after script (screenshots stay gitignored)**

```bash
git add scripts/capture-phase-0-after.mjs
git commit -m "Phase 0 Task 21: after-screenshot capture script"
```

---

## Task 22: Run the full test suite

**Files:** none modified

- [ ] **Step 1: Run all six tests in sequence**

```bash
node scripts/test-layout-mount.mjs        && \
node scripts/test-newsletter-submit.mjs   && \
node scripts/test-token-discipline.mjs    && \
node scripts/test-customizer-flow.mjs     && \
node scripts/test-design-hero-rail.mjs    && \
node scripts/test-swatch-prefers-hero.mjs && \
echo "✅ ALL TESTS PASS"
```

Expected: each script prints its own success line; the chain ends with `✅ ALL TESTS PASS`. Any single failure aborts the chain — diagnose and fix before advancing.

If any pre-existing test fails (customizer / design-hero-rail / swatch-prefers-hero), the most likely cause is a missed CSS rule that the existing test relies on. Use `superpowers:systematic-debugging`. Do NOT mark the task complete until all six pass.

- [ ] **Step 2: No commit (tests already committed in Tasks 18–20)**

---

## Task 23: Update `PROJECT.md`

**Files:**
- Modify: `PROJECT.md`

- [ ] **Step 1: Append a "Phase 0 — shipped" subsection under §7**

In `PROJECT.md` §7 (Open / next steps), immediately AFTER the "Phase 0 — Detailed spec" section and BEFORE the "Phase 1 — Spec carryover" section, insert:

```markdown
### Phase 0 — shipped 2026-05-29

Shared spine landed. Every existing page now mounts `components/header.html` + `components/footer.html` at runtime via `js/layout.js`. `css/base.css` owns the token vocabulary, `.btn--*` system, form controls, header styles, and footer styles. Newsletter capture writes to `newsletter_subscribers` via `js/newsletter.js`.

**New files:**
- `components/header.html`, `components/footer.html`
- `css/base.css` (tokens + reset + typography + `.btn--*` + form controls + header + footer)
- `js/layout.js`, `js/meta.js` (no-op skeleton), `js/newsletter.js`
- `db/07_newsletter_subscribers.sql` (table + RLS)
- `scripts/test-layout-mount.mjs`, `scripts/test-newsletter-submit.mjs`, `scripts/test-token-discipline.mjs`
- `scripts/capture-phase-0-baseline.mjs`, `scripts/capture-phase-0-after.mjs`

**Behavior changes:**
- Footer is now the canonical full footer (brand + newsletter + 4 link cols + bottom row) on every page. `shop.html`, `product.html`, `cart.html` gained the full footer (previously thin or mid).
- `.btn-primary`, `.btn-dark` collapsed into `.btn--primary`. `.btn-outline*` → `.btn--ghost*`. `.btn-light` → `.btn--light`.
- All hardcoded `#000` / `#fff` replaced with token references.
- `:focus-visible` outlines added across all interactive elements.
- `js/cart.js` defers `mountCartBadge()` until the `crf:layout-ready` event when `[data-cart-count]` isn't in DOM yet.

**Phase 1 hooks waiting:**
- Header Account icon is an `<a href="login.html" data-account-link>` — Phase 1's `js/auth.js` flips href to `account.html` when signed in.
- Footer bottom-row Privacy link points to `privacy.html` — Phase 1 creates that page.
- `js/meta.js` `setMeta()` is a no-op — Phase 3 fills it.
```

- [ ] **Step 2: Commit**

```bash
git add PROJECT.md
git commit -m "Phase 0 Task 23: update PROJECT.md with shipped inventory"
```

---

## Task 24: Code review + merge to main

**Files:** none modified directly; merges the worktree branch

- [ ] **Step 1: Run `superpowers:requesting-code-review`**

Invoke the skill. It will examine the diff against `main` and the spec at `docs/superpowers/specs/2026-05-29-phase-0-shared-layout-design.md`, verifying coherence with the shared spine. Address any feedback inline before advancing.

- [ ] **Step 2: Final pre-merge sanity check**

```bash
git status --short                       # expect: clean working tree
node scripts/test-layout-mount.mjs       # expect: ✅
node scripts/test-newsletter-submit.mjs  # expect: ✅
node scripts/test-token-discipline.mjs   # expect: ✅
```

- [ ] **Step 3: Invoke `superpowers:finishing-a-development-branch`**

The skill walks through the merge option. Choose: squash-merge to `main` with the single commit message:

```
Phase 0: shared layout + design system lock

Eliminates header/footer/CSS duplication across the 6 existing pages by
extracting components/header.html + components/footer.html (mounted at
runtime by js/layout.js), and css/base.css owns the token system + .btn--*.
Footer form captures emails into newsletter_subscribers via js/newsletter.js.
```

After merge, exit the worktree via `ExitWorktree` (or the skill handles it).

- [ ] **Step 4: Verify main is healthy**

From the original project directory (not the worktree):

```bash
git log --oneline -3
# Expect: <new merge SHA> Phase 0: shared layout + design system lock
#         af3ab90 Phase 0 design spec: shared layout + design system lock
#         df071f4 Initial commit: Country Road Fashions landing page (V5)

node scripts/test-layout-mount.mjs
# Expect: ✅
```

- [ ] **Step 5: No commit needed (merge is the final commit)**

---

## Self-Review

I checked this plan against the spec.

**Spec coverage:** Every section maps to tasks.
- Spec §4 architecture → Tasks 5, 6, 7–9, 10
- Spec §5 mounting strategy → Tasks 10, 11, plus the inline FOUC block in Tasks 12–17
- Spec §6 tokens + buttons → Tasks 7, 8
- Spec §7 newsletter → Tasks 2, 3, plus the form hook in Task 6
- Spec §8 testing → Tasks 18, 19, 20, 21, 22
- Spec §9 execution → setup is Task 1; parallel streams are Tasks 2–4; main thread is Tasks 5–17; verification is Tasks 18–22; close is Tasks 23–24
- Spec §3 decisions Q1 (full footer everywhere) → Task 6 builds the canonical footer; Tasks 13, 14, 15 explicitly replace the thin footer
- Spec §3 Q2 (token-discipline polish, no spacing/animation changes) → Tasks 8 (focus-visible), Task 20 (discipline test), strip rules in Tasks 12–17
- Spec §3 Q3 (single worktree + dispatched subagents) → Task 1 (worktree); Tasks 2, 3, 4 are the dispatched streams
- Spec §3 Q4 (FOUC inline block + preload) → present in every page-migration task

**Placeholder scan:**
- Task 3 Step 2 includes a "skip if it fails" — that's a documented practical fallback, not a placeholder. The actual validation happens in Task 19's puppeteer test.
- All file paths are absolute and explicit.
- All commands have expected output.
- No "TBD" / "TODO" / "implement later" anywhere.
- Per-page migration tasks (12–17) repeat the pattern rather than saying "similar to Task 12" — engineer can read them out of order.

**Type/name consistency:**
- `crf:layout-ready` (event name) used identically in Tasks 3, 10, 11, 18, 19
- `[data-layout="header"]` / `[data-layout="footer"]` (selectors) used identically in Tasks 10, 12–17, 18
- `[data-newsletter-form]` used in Tasks 3, 6, 18, 19
- `.btn--primary` / `.btn--ghost` / `.btn--light` used identically in Tasks 8, 12–17, 20
- `data-cart-count` matches existing `js/cart.js` line 104
- `mountCartBadge` matches existing `js/cart.js` line 103, used in Task 11

All checks pass.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-29-phase-0-shared-layout.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
