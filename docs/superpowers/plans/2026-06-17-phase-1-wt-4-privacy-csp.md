# Phase 1 WT-4: Privacy Page + CSP Baseline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a PDPA-compliant `privacy.html` and roll a Content-Security-Policy `<meta>` baseline into every existing page + the shared header component, with footer Privacy link wired live.
**Architecture:** One new HTML page (`privacy.html`, 12 sections, single-column, brand tokens from Phase 0) + a mechanical CSP `<meta>` insertion into the `<head>` of 6 existing pages and `components/header.html` + a one-line edit to `components/footer.html` to point the Privacy link at `/privacy.html`. WT-2 will extend the CSP rollout to its 6 new auth pages and re-run the CSP sweep with the extended page list — this plan does not touch those non-existent files.
**Tech Stack:** static HTML, `css/base.css` tokens from Phase 0 (Cormorant Garamond + Raleway, jet/stone/cream/charcoal palette), puppeteer for CSP-violation sweep + privacy-page smoke test, `node serve.mjs` for the local server, `node screenshot.mjs` for visual gates.

---

## Pre-flight context

- **Spec under implementation:** `/Users/shivachandnani/Desktop/CRF Website/V5 - ProperCloth/docs/superpowers/specs/2026-06-16-phase-1-design.md` — §4 (worktree breakdown), §7.1 (page inventory), §8 (privacy outline + CSP policy + placement), §9.1 WT-4 (gates), §11 (placeholders).
- **Worktree:** `phase-1/privacy-csp` branched from `main`.
- **Existing pages WT-4 touches (6):** `index.html`, `shop.html`, `product.html`, `cart.html`, `book-appointment.html`, `in-store.html`.
- **Components WT-4 touches (2):** `components/header.html` (add CSP meta), `components/footer.html` (rewire Privacy link).
- **New page WT-4 creates (1):** `privacy.html`.
- **Pages WT-4 does NOT touch:** `signup.html`, `login.html`, `forgot-password.html`, `reset-password.html`, `account.html` — these do not exist yet; WT-2 ships them and is responsible for adding the same CSP `<meta>` tag to each one and extending `scripts/test-csp-compliance.mjs` to cover them.
- **Phase 0 invariants honored:** no new `.btn-primary`/`.btn-dark` drift, no hardcoded `#000` (use `var(--color-jet)`), no default Tailwind blue/indigo. `scripts/test-token-discipline.mjs` must continue to pass.

---

## CSP meta tag — verbatim block to insert (spec §8.2)

The following block is the single source of truth. Every occurrence (6 existing pages + `components/header.html` + `privacy.html` = 8 sites) must match this byte-for-byte.

```html
<meta http-equiv="Content-Security-Policy" content="
  default-src 'self';
  script-src 'self' 'unsafe-inline' https://esm.sh https://assets.calendly.com;
  style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://assets.calendly.com;
  font-src 'self' https://fonts.gstatic.com;
  img-src 'self' data: https://*.supabase.co https://placehold.co;
  media-src 'self';
  connect-src 'self' https://*.supabase.co wss://*.supabase.co;
  frame-src https://calendly.com;
  form-action 'self';
  frame-ancestors 'none';
  base-uri 'self';
  object-src 'none';
">
```

**Placement rule (spec §8.3):** the meta tag must sit in the `<head>` as early as possible — directly after the `<meta charset>` line and before any `<link>` / `<script>` element that loads external resources. This guarantees the policy is parsed before the browser issues subresource fetches.

---

## Task 1 — Create worktree

- [ ] From the main repo `/Users/shivachandnani/Desktop/CRF Website/V5 - ProperCloth`, on the `main` branch, run:
  ```bash
  git worktree add ../crf-wt-phase-1-privacy-csp phase-1/privacy-csp
  ```
- [ ] `cd ../crf-wt-phase-1-privacy-csp` and confirm `git status` reports clean tree on branch `phase-1/privacy-csp`.
- [ ] Confirm `node serve.mjs` works (start it in the background; reuse if already running).

---

## Task 2 — Invoke `frontend-design:frontend-design` skill for privacy.html

CLAUDE.md mandates this skill be invoked before writing any frontend code. Do NOT skip; do NOT defer.

- [ ] Call the `frontend-design:frontend-design` skill with the privacy-page brief:
  - Single-column max 720px, generous spacing (`1.7` line-height on body, `-0.03em` tracking on the H1).
  - Cormorant Garamond serif H1/H2; Raleway sans body.
  - Palette: `--color-cream` background, `--color-jet` body text, `--color-stone` muted, `--color-charcoal` rule lines.
  - 12 anchored sections with a sticky in-page table of contents at >=1024px; collapsed list at <1024px.
  - Print-friendly `@media print` rule.
  - Header banner with "Privacy Notice", "Last updated", "Effective" dates in `<time datetime="...">` elements.
- [ ] Capture the skill output and reuse its layout/spacing tokens verbatim in Task 9. Do not redesign in Task 9.

---

## Task 3 — Write `scripts/test-csp-compliance.mjs` (initial: 6 existing pages)

The test must fail before any CSP edits land (Task 4). It walks each page, opens it in headless Chromium, listens for CSP violations on `page.on('console')` (text starting with "Refused to") and `page.on('pageerror')`, and asserts the violation array is empty.

- [ ] Create `scripts/test-csp-compliance.mjs` with the following exact content:

```js
// scripts/test-csp-compliance.mjs
// Phase 1 WT-4: assert zero CSP violations on every page that exists after WT-4 ships.
// WT-2 extends this list with its 6 new auth pages (signup, login, forgot-password,
// reset-password, account) and re-runs this script as part of its own gates.

import puppeteer from 'puppeteer';
import process from 'node:process';

const BASE = process.env.CRF_BASE_URL || 'http://localhost:3000';

// Pages that exist on this worktree after WT-4 lands.
// DO NOT add signup/login/forgot/reset/account here — they do not exist yet.
// WT-2's plan adds them to this list when it ships those pages.
const PAGES = [
  '/index.html',
  '/shop.html',
  '/product.html',
  '/cart.html',
  '/book-appointment.html',
  '/in-store.html',
  '/privacy.html',
];

function isCspViolation(text) {
  if (!text) return false;
  return (
    text.includes('Content Security Policy') ||
    text.startsWith('Refused to') ||
    text.includes("violates the following Content Security Policy directive")
  );
}

async function checkPage(browser, path) {
  const page = await browser.newPage();
  const violations = [];

  page.on('console', (msg) => {
    const text = msg.text();
    if (isCspViolation(text)) violations.push({ kind: 'console', text });
  });
  page.on('pageerror', (err) => {
    const text = err?.message ?? String(err);
    if (isCspViolation(text)) violations.push({ kind: 'pageerror', text });
  });
  page.on('requestfailed', (req) => {
    const failure = req.failure();
    if (failure && isCspViolation(failure.errorText)) {
      violations.push({ kind: 'requestfailed', text: `${req.url()} — ${failure.errorText}` });
    }
  });

  const url = `${BASE}${path}`;
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
  // Allow late-firing inline scripts / layout-ready hooks to complete.
  await new Promise((r) => setTimeout(r, 750));

  await page.close();
  return { path, violations };
}

async function main() {
  const browser = await puppeteer.launch({ headless: 'new' });
  let failed = 0;
  try {
    for (const path of PAGES) {
      const result = await checkPage(browser, path);
      if (result.violations.length === 0) {
        console.log(`OK   ${path}`);
      } else {
        failed++;
        console.error(`FAIL ${path} — ${result.violations.length} CSP violation(s):`);
        for (const v of result.violations) {
          console.error(`     [${v.kind}] ${v.text}`);
        }
      }
    }
  } finally {
    await browser.close();
  }
  if (failed > 0) {
    console.error(`\n${failed} page(s) failed CSP compliance.`);
    process.exit(1);
  }
  console.log(`\nAll ${PAGES.length} pages clean.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] Make the file executable mentally (no `chmod` needed — run via `node`).

---

## Task 4 — Run CSP sweep; expect failure

- [ ] Start `node serve.mjs` if not already running.
- [ ] Run `node scripts/test-csp-compliance.mjs`.
- [ ] Expected: `FAIL /privacy.html` (404 — page not yet written). Other pages currently load with no CSP set, so they produce zero CSP violations and may appear "OK"; that is fine. The privacy.html failure is enough red signal.
- [ ] Record the failure output in the task log.

---

## Task 5 — Add CSP meta to all 6 existing pages

For each of the following files, insert the verbatim CSP block from the top of this plan into the `<head>`, directly after the `<meta charset="UTF-8">` line (or whichever charset declaration is present) and BEFORE any `<link rel="stylesheet">` or `<script>` element:

1. `index.html`
2. `shop.html`
3. `product.html`
4. `cart.html`
5. `book-appointment.html`
6. `in-store.html`

- [ ] Open each file with the Read tool first to confirm the charset line position.
- [ ] Use the Edit tool with `old_string` = the existing charset line and `new_string` = charset line + newline + the verbatim CSP block. Indentation must be preserved.
- [ ] After all 6 edits, reload each page in the browser manually (or trust the sweep in Task 7) — DevTools Network panel should show no blocked requests.

**Notes:**
- Do not delete or relocate any existing `<meta>` in the head.
- Do not modify the `<title>`, viewport, or favicon links.
- The CSP block uses multi-line `content="..."` syntax intentionally; whitespace inside a CSP `content` attribute is collapsed by browsers and does not change semantics.

---

## Task 6 — Add CSP meta to `components/header.html` (safety belt)

Per spec §8.3, the header fragment also carries the CSP `<meta>` as a duplicate. Browsers intersect duplicate CSPs (both must allow) — duplicate identical policies are tolerated.

- [ ] Read `components/header.html` to find the current top of the fragment.
- [ ] Insert the verbatim CSP block at the very top of the fragment, BEFORE any `<header>`, `<nav>`, or `<div>` element.
- [ ] Confirm `js/layout.js` does not strip `<meta>` elements when mounting the fragment. If it does (verify with a Read on `js/layout.js`), document the constraint here and skip the fragment edit — the per-page CSP from Task 5 is the authoritative copy.

---

## Task 7 — Re-run CSP sweep against the 6 existing pages

- [ ] `node scripts/test-csp-compliance.mjs`.
- [ ] Privacy still fails (404). The 6 existing pages must report `OK`.
- [ ] If any existing page reports a violation, the offending external resource is not in the policy. Audit:
  - Google Fonts → covered by `style-src https://fonts.googleapis.com` + `font-src https://fonts.gstatic.com`.
  - esm.sh → covered by `script-src https://esm.sh`.
  - Supabase → covered by `connect-src https://*.supabase.co wss://*.supabase.co` + `img-src https://*.supabase.co`.
  - Calendly → covered by `script-src https://assets.calendly.com`, `style-src https://assets.calendly.com`, `frame-src https://calendly.com`.
  - placehold.co images → covered by `img-src https://placehold.co`.
  - Inline scripts/styles → covered by `'unsafe-inline'` (intentional, per spec §8.2 + Q7b).
- [ ] DO NOT widen the policy unless the resource is provably loaded by Phase 0 / WT-4 code. Phase 2/3 extend the policy for Stripe and any tightened directives.

---

## Task 8 — Write `scripts/test-privacy-page.mjs` (smoke test, fails first)

- [ ] Create `scripts/test-privacy-page.mjs` with the following content:

```js
// scripts/test-privacy-page.mjs
// Phase 1 WT-4: smoke-test privacy.html — anchor IDs, H1, brand voice, zero CSP violations.

import puppeteer from 'puppeteer';
import process from 'node:process';

const BASE = process.env.CRF_BASE_URL || 'http://localhost:3000';
const URL = `${BASE}/privacy.html`;

const REQUIRED_ANCHORS = [
  'header-banner',
  'intro',
  'who-we-are',
  'what-we-collect',
  'why-we-collect',
  'who-we-share-with',
  'how-long-we-keep',
  'your-rights',
  'cookies-and-local-storage',
  'cross-border-transfer',
  'changes-to-this-notice',
  'contact-us',
];

function isCspViolation(text) {
  if (!text) return false;
  return (
    text.includes('Content Security Policy') ||
    text.startsWith('Refused to') ||
    text.includes("violates the following Content Security Policy directive")
  );
}

async function main() {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  const cspViolations = [];

  page.on('console', (msg) => {
    if (isCspViolation(msg.text())) cspViolations.push(msg.text());
  });
  page.on('pageerror', (err) => {
    const t = err?.message ?? String(err);
    if (isCspViolation(t)) cspViolations.push(t);
  });

  const response = await page.goto(URL, { waitUntil: 'networkidle2', timeout: 30000 });
  if (!response || !response.ok()) {
    throw new Error(`privacy.html did not load: status ${response && response.status()}`);
  }

  // Anchor ID check
  const missing = [];
  for (const id of REQUIRED_ANCHORS) {
    const found = await page.$(`#${id}`);
    if (!found) missing.push(id);
  }
  if (missing.length > 0) {
    throw new Error(`Missing anchor IDs on privacy.html: ${missing.join(', ')}`);
  }

  // H1 text check
  const h1 = await page.$eval('h1', (el) => el.textContent.trim());
  if (!/privacy notice/i.test(h1)) {
    throw new Error(`H1 expected to contain "Privacy Notice"; got: "${h1}"`);
  }

  // Brand voice spot-checks — these specific copy strings must appear (sourced from spec §8.1).
  const bodyText = await page.$eval('body', (el) => el.textContent);
  const requiredCopyHits = [
    'PDPA',
    'Supabase',
    'Calendly',
    'localStorage',
    'Thai Revenue Code',
    'PDPC',
  ];
  const missingCopy = requiredCopyHits.filter((s) => !bodyText.includes(s));
  if (missingCopy.length > 0) {
    throw new Error(`Privacy page is missing required copy: ${missingCopy.join(', ')}`);
  }

  // Last-updated / Effective dates use <time datetime="...">
  const timeEls = await page.$$('time[datetime]');
  if (timeEls.length < 2) {
    throw new Error(`Expected at least 2 <time datetime="..."> elements (Last updated + Effective); found ${timeEls.length}`);
  }

  // Footer Privacy link points to /privacy.html
  await page.goto(`${BASE}/index.html`, { waitUntil: 'networkidle2' });
  const footerHref = await page.$eval(
    'footer a[href$="privacy.html"], footer a[href="/privacy.html"]',
    (a) => a.getAttribute('href'),
  );
  if (footerHref !== '/privacy.html') {
    throw new Error(`Footer Privacy link href is "${footerHref}"; expected "/privacy.html"`);
  }

  await browser.close();

  if (cspViolations.length > 0) {
    console.error('CSP violations on privacy.html:');
    for (const v of cspViolations) console.error(`  ${v}`);
    process.exit(1);
  }

  console.log(`OK   /privacy.html — all ${REQUIRED_ANCHORS.length} anchors, H1, brand voice, dates, footer link, zero CSP violations.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] Run `node scripts/test-privacy-page.mjs`. Expected: fails (privacy.html does not exist yet).

---

## Task 9 — Write `privacy.html`

Use the layout produced by the `frontend-design:frontend-design` skill in Task 2. The skeleton below is the structural contract — all 12 anchor IDs and the placeholder comments are mandatory. Visual styling is free to follow the skill output as long as it uses `css/base.css` tokens.

- [ ] Create `privacy.html` at the project root with this skeleton:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="
    default-src 'self';
    script-src 'self' 'unsafe-inline' https://esm.sh https://assets.calendly.com;
    style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://assets.calendly.com;
    font-src 'self' https://fonts.gstatic.com;
    img-src 'self' data: https://*.supabase.co https://placehold.co;
    media-src 'self';
    connect-src 'self' https://*.supabase.co wss://*.supabase.co;
    frame-src https://calendly.com;
    form-action 'self';
    frame-ancestors 'none';
    base-uri 'self';
    object-src 'none';
  ">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Privacy Notice — Country Road Fashions</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600&family=Raleway:wght@300;400;500;600&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/css/base.css">
  <style>
    /* privacy.html — page-local layout. All colors via base.css tokens. */
    .privacy-shell {
      max-width: 720px;
      margin: 0 auto;
      padding: 4rem 1.5rem 6rem;
      color: var(--color-jet);
      background: var(--color-cream);
    }
    .privacy-shell h1 {
      font-family: 'Cormorant Garamond', serif;
      font-size: clamp(2rem, 4.5vw, 3rem);
      letter-spacing: -0.03em;
      line-height: 1.1;
      margin: 0 0 0.5rem;
    }
    .privacy-shell h2 {
      font-family: 'Cormorant Garamond', serif;
      font-size: 1.5rem;
      margin: 2.75rem 0 0.75rem;
      color: var(--color-jet);
    }
    .privacy-shell p,
    .privacy-shell li {
      font-family: 'Raleway', sans-serif;
      font-size: 1rem;
      line-height: 1.7;
      color: var(--color-charcoal);
    }
    .privacy-shell .meta {
      font-family: 'Raleway', sans-serif;
      font-size: 0.875rem;
      color: var(--color-stone);
      margin-bottom: 2rem;
    }
    .privacy-shell .meta time { font-weight: 500; color: var(--color-charcoal); }
    .privacy-shell ul { padding-left: 1.25rem; margin: 0.5rem 0 1rem; }
    .privacy-shell hr {
      border: none;
      border-top: 1px solid var(--color-stone);
      margin: 3rem 0;
      opacity: 0.4;
    }
    .privacy-toc {
      font-family: 'Raleway', sans-serif;
      font-size: 0.875rem;
      background: transparent;
      border: 1px solid var(--color-stone);
      padding: 1.25rem 1.5rem;
      margin: 1.5rem 0 2.5rem;
    }
    .privacy-toc ol { margin: 0.5rem 0 0; padding-left: 1.25rem; }
    .privacy-toc a { color: var(--color-jet); text-decoration: none; border-bottom: 1px solid transparent; transition: border-color 200ms ease; }
    .privacy-toc a:hover,
    .privacy-toc a:focus-visible { border-bottom-color: var(--color-jet); }
    @media print {
      .privacy-toc { display: none; }
      .privacy-shell { max-width: none; padding: 1rem; background: #fff; }
    }
  </style>
</head>
<body>
  <div data-header-mount></div>

  <main class="privacy-shell">
    <section id="header-banner">
      <h1>Privacy Notice</h1>
      <p class="meta">
        Last updated: <time datetime="2026-06-17">17 June 2026</time> &middot;
        Effective: <time datetime="2026-06-17">17 June 2026</time>
      </p>
    </section>

    <nav class="privacy-toc" aria-label="On this page">
      <strong>On this page</strong>
      <ol>
        <li><a href="#intro">Introduction</a></li>
        <li><a href="#who-we-are">Who we are</a></li>
        <li><a href="#what-we-collect">What we collect</a></li>
        <li><a href="#why-we-collect">Why we collect it</a></li>
        <li><a href="#who-we-share-with">Who we share it with</a></li>
        <li><a href="#how-long-we-keep">How long we keep it</a></li>
        <li><a href="#your-rights">Your rights</a></li>
        <li><a href="#cookies-and-local-storage">Cookies &amp; local storage</a></li>
        <li><a href="#cross-border-transfer">Cross-border transfer</a></li>
        <li><a href="#changes-to-this-notice">Changes to this notice</a></li>
        <li><a href="#contact-us">Contact us</a></li>
      </ol>
    </nav>

    <section id="intro">
      <h2>Introduction</h2>
      <p>
        Country Road Fashions is a bespoke tailoring house. This notice explains, in plain
        language, what personal data we collect from you, why, and the rights you hold over
        it under Thailand&rsquo;s Personal Data Protection Act (PDPA).
      </p>
    </section>

    <section id="who-we-are">
      <h2>Who we are</h2>
      <!-- TODO[WT-4-execution]: registered business entity + Bangkok address from spec §11 -->
      <p>
        We are the data controller for the information described in this notice. Our
        registered business entity and Bangkok address will be inserted here at WT-4
        execution time per spec §11.
      </p>
    </section>

    <section id="what-we-collect">
      <h2>What we collect</h2>
      <ul>
        <li><strong>Identity &amp; contact</strong> — name, email address, phone number.</li>
        <li><strong>Account credentials</strong> — email and a hashed password held by our auth provider.</li>
        <li><strong>Measurements &amp; fit preferences</strong> — body measurements, reference-garment measurements, and notes you choose to save.</li>
        <li><strong>Communication preferences</strong> — newsletter opt-in status and the timestamp at which consent was given.</li>
        <li><strong>Consultation bookings</strong> — appointment metadata passed to our scheduling provider.</li>
        <li><strong>Cart contents</strong> — held locally in your browser; not transmitted to us until you complete a purchase.</li>
        <li><strong>Technical data</strong> — auth tokens (in your browser&rsquo;s localStorage), server access logs, and standard request metadata.</li>
      </ul>
    </section>

    <section id="why-we-collect">
      <h2>Why we collect it (lawful basis under PDPA)</h2>
      <ul>
        <li><strong>Contract performance</strong> — to take measurements, fulfil orders, and provide the service you have purchased.</li>
        <li><strong>Consent</strong> — for newsletter communications and any optional marketing.</li>
        <li><strong>Legitimate interest</strong> — to secure our service (auth tokens, abuse prevention) and to maintain our records.</li>
      </ul>
    </section>

    <section id="who-we-share-with">
      <h2>Who we share it with</h2>
      <p>We use the following sub-processors. We do not share your data with advertisers.</p>
      <ul>
        <li><strong>Supabase</strong> — managed Postgres + authentication. Data resides in the Singapore region.</li>
        <li><strong>Calendly</strong> — consultation scheduling. Operated from the United States.</li>
      </ul>
    </section>

    <section id="how-long-we-keep">
      <h2>How long we keep it</h2>
      <ul>
        <li><strong>Account &amp; measurements</strong> — until you delete your account.</li>
        <li><strong>Order history</strong> — indefinite while your account is active. Tax-mandated invoice records may be retained per the Thai Revenue Code even after account deletion.</li>
        <li><strong>Newsletter subscriptions</strong> — until you unsubscribe.</li>
        <li><strong>Server logs</strong> — 90 days, rolling.</li>
      </ul>
    </section>

    <section id="your-rights">
      <h2>Your rights</h2>
      <p>
        Under the PDPA (sections 30&ndash;37) you have the right to access your data,
        correct it, delete it, withdraw consent for newsletter marketing, and lodge a
        complaint with the Personal Data Protection Committee (PDPC) of Thailand.
      </p>
      <p>
        You can exercise the access, correction, and deletion rights directly from your
        account page once signed in. For newsletter consent, use the unsubscribe link in
        any marketing email.
      </p>
    </section>

    <section id="cookies-and-local-storage">
      <h2>Cookies &amp; local storage</h2>
      <p>
        We do not use tracking cookies. Your auth session is stored in your browser&rsquo;s
        localStorage by our authentication provider. Your shopping cart is also held in
        localStorage. Because these are strictly necessary for the service to function,
        no consent banner is required.
      </p>
    </section>

    <section id="cross-border-transfer">
      <h2>Cross-border transfer</h2>
      <p>
        Your data is stored in Singapore by our database provider. The protections of
        PDPA section 28 apply to this transfer, supported by our provider&rsquo;s
        contractual commitments.
      </p>
    </section>

    <section id="changes-to-this-notice">
      <h2>Changes to this notice</h2>
      <p>
        We will email account holders before any material change takes effect, and the
        &ldquo;Last updated&rdquo; date at the top of this page will be revised.
      </p>
    </section>

    <section id="contact-us">
      <h2>Contact us</h2>
      <!-- TODO[WT-4-execution]: data-request contact email from spec §11 -->
      <p>
        For any request relating to your personal data &mdash; access, correction,
        deletion, or a complaint &mdash; please email us at the address that will be
        inserted here at WT-4 execution time per spec §11.
      </p>
    </section>
  </main>

  <div data-footer-mount></div>

  <script type="module" src="/js/layout.js"></script>
</body>
</html>
```

- [ ] After writing the file, reload `http://localhost:3000/privacy.html` and visually scan: H1 reads "Privacy Notice", TOC links jump to each section, the page uses serif H1/H2 and sans body.

---

## Task 10 — Confirm CSP meta is present on `privacy.html`

The skeleton above already includes the CSP meta in the `<head>`. This task is the verification step.

- [ ] Read `privacy.html` and confirm the meta block matches the verbatim policy from the top of this plan, byte-for-byte (whitespace inside `content="..."` excepted).
- [ ] Run `node scripts/test-csp-compliance.mjs` — privacy.html should now report `OK`.

---

## Task 11 — Update privacy smoke test verification

The smoke test from Task 8 already asserts zero CSP violations on privacy.html. This task verifies the full sweep passes.

- [ ] Run `node scripts/test-privacy-page.mjs` → expect `OK   /privacy.html — all 12 anchors, H1, brand voice, dates, footer link, zero CSP violations.`
- [ ] If the footer link assertion fails, proceed to Task 12 (footer not yet rewired) and re-run.

---

## Task 12 — Wire the footer Privacy link

- [ ] Read `components/footer.html`. Locate the current Privacy link — it is the `<a>` whose visible text is "Privacy" (case-insensitive) and `href="#"`.
- [ ] Edit precisely. The find/replace pattern depends on the exact attributes present, but the rule is:
  - Find: the single Privacy anchor tag with `href="#"`.
  - Replace: identical attributes except `href="#"` → `href="/privacy.html"`.
- [ ] Concrete example — if the current line is:
  ```html
  <a href="#" class="footer-link">Privacy</a>
  ```
  rewrite to:
  ```html
  <a href="/privacy.html" class="footer-link">Privacy</a>
  ```
- [ ] If the Privacy link is the only `href="#"` in the footer, a single Edit call with `old_string='href="#"'` and `new_string='href="/privacy.html"'` is safe. Otherwise, include the surrounding context (e.g., `>Privacy<`) in `old_string` to disambiguate.
- [ ] Do NOT touch any other footer link or attribute.

---

## Task 13 — Re-run all gates

- [ ] `node scripts/test-csp-compliance.mjs` → all 7 pages `OK`.
- [ ] `node scripts/test-privacy-page.mjs` → `OK` including the footer link assertion.
- [ ] `node scripts/test-token-discipline.mjs` (from Phase 0) → green. If it fails, audit `privacy.html` for any hardcoded `#000`, `#fff`, default Tailwind palette, or new `.btn-primary`/`.btn-dark` drift.
- [ ] Manually click the footer Privacy link from each of the 6 existing pages and confirm it lands on `/privacy.html` with no CSP errors in DevTools console.

---

## Task 14 — Visual gate: screenshot privacy.html at 1440 + 375

- [ ] Confirm `node serve.mjs` is running.
- [ ] Run:
  ```bash
  node screenshot.mjs http://localhost:3000/privacy.html privacy-1440
  ```
- [ ] Run a 375-width screenshot. If `screenshot.mjs` does not accept a width flag, temporarily set the viewport inside the script or use a separate puppeteer one-liner that sets `defaultViewport: { width: 375, height: 812 }`. Save as `privacy-375`.
- [ ] Read both PNGs from `temporary screenshots/` with the Read tool.
- [ ] Compare to the layout produced by the `frontend-design:frontend-design` skill in Task 2. Verify:
  - Heading hierarchy: serif H1 large, serif H2s consistent, sans body.
  - Spacing: section gaps roughly 2.75rem; max-width 720px holds at 1440.
  - Colors: cream background, jet text, stone rules. No flat black.
  - Mobile: single column, TOC stacks, no horizontal scroll.
- [ ] Note any mismatch; iterate; re-screenshot. Do at least two comparison rounds per CLAUDE.md.

---

## Task 15 — PR checklist and commit

- [ ] Stage only the files this worktree touched:
  - `privacy.html` (new)
  - `index.html`, `shop.html`, `product.html`, `cart.html`, `book-appointment.html`, `in-store.html` (CSP meta inserted)
  - `components/header.html` (CSP meta inserted, if Task 6 did not skip)
  - `components/footer.html` (Privacy link rewired)
  - `scripts/test-csp-compliance.mjs` (new)
  - `scripts/test-privacy-page.mjs` (new)
- [ ] Do NOT stage any new auth pages, JS modules, or DB migrations — those belong to WT-1/WT-2/WT-3.
- [ ] Commit message:

```
Phase 1 WT-4: privacy.html + CSP baseline

- Add PDPA-compliant privacy.html (12 sections, anchor IDs, brand voice).
  Placeholders for registered entity + contact email per spec §11.
- Add Content-Security-Policy <meta> (spec §8.2) to 6 existing pages and
  components/header.html. WT-2 extends the policy to its 6 new auth pages.
- Wire footer Privacy link from "#" to "/privacy.html".
- Add scripts/test-csp-compliance.mjs (zero-violation sweep) and
  scripts/test-privacy-page.mjs (anchor + brand-voice + CSP smoke test).

Spec: docs/superpowers/specs/2026-06-16-phase-1-design.md §4, §7.1, §8, §9.1.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
```

- [ ] Open the PR against `main`. Title: `Phase 1 WT-4: privacy page + CSP baseline`. PR body must include the spec link and a note that WT-2 is responsible for adding CSP to its 6 new pages and extending `scripts/test-csp-compliance.mjs`.

---

## Self-review (run before opening the PR)

### 1. Spec §8 coverage check

- [ ] All 12 privacy sections present, in spec §8.1 order, with the anchor IDs the smoke test expects: `header-banner`, `intro`, `who-we-are`, `what-we-collect`, `why-we-collect`, `who-we-share-with`, `how-long-we-keep`, `your-rights`, `cookies-and-local-storage`, `cross-border-transfer`, `changes-to-this-notice`, `contact-us`.
- [ ] CSP meta tag matches spec §8.2 byte-for-byte (whitespace inside `content="..."` excluded). Confirm via a diff between the privacy.html copy, the `components/header.html` copy, and one existing-page copy.
- [ ] Both placement locations covered: per-page `<head>` (primary) and `components/header.html` (safety belt, unless `js/layout.js` strips meta tags — documented in Task 6).

### 2. Placeholder scan

- [ ] `grep -rn 'TODO\[WT-4-execution\]' privacy.html` returns exactly two hits — §3 ("Who we are") and §12 ("Contact us"). No other TODOs.
- [ ] No `Lorem ipsum`, no `[TO FILL]` outside the two documented placeholders, no `<!-- TODO -->` without the `[WT-4-execution]` tag.

### 3. CSP allowed-domain consistency

Every domain in the policy must be justified by an actual external resource loaded by current site code. Audit:

- [ ] `https://esm.sh` — used by `js/layout.js` / module imports. Confirm at least one `import ... from 'https://esm.sh/...'` exists in the codebase.
- [ ] `https://assets.calendly.com` (script-src + style-src) — used by `book-appointment.html` Calendly embed.
- [ ] `https://calendly.com` (frame-src) — Calendly iframe target.
- [ ] `https://fonts.googleapis.com` + `https://fonts.gstatic.com` — Google Fonts (Cormorant Garamond + Raleway) loaded by every page.
- [ ] `https://*.supabase.co` + `wss://*.supabase.co` (connect-src) — Supabase REST + realtime. WT-1 ships `js/auth.js` that uses this; if WT-1 has not merged yet, the connect-src directive is still correct as a forward-compatible declaration because no other Phase 0/WT-4 code calls these origins.
- [ ] `https://*.supabase.co` (img-src) — Supabase Storage product imagery (Phase 0 catalogue).
- [ ] `https://placehold.co` — placeholder imagery on shop/product/cart pages.
- [ ] `data:` (img-src) — inline SVG noise filters and any base64 favicons.
- [ ] `'unsafe-inline'` — intentional baseline per spec §8.2 + Q7b. Do NOT remove.

### 4. Phase 0 invariant check

- [ ] `privacy.html` uses only `var(--color-jet|stone|cream|charcoal)` for colors; no `#000`, no `#fff`, no Tailwind color classes.
- [ ] No new `.btn-primary` or `.btn-dark` classes introduced.
- [ ] `scripts/test-token-discipline.mjs` passes.

### 5. Scope boundary check

- [ ] No edits to `signup.html`, `login.html`, `forgot-password.html`, `reset-password.html`, `account.html` (they don't exist; WT-2 owns them).
- [ ] No edits to `css/base.css` (privacy page styling is inline; tokens are consumed, not added).
- [ ] No edits to `js/auth.js`, `js/profile.js`, or any DB migration.
- [ ] No edits to any file outside `privacy.html`, the 6 existing pages, `components/header.html`, `components/footer.html`, and the two new scripts.
