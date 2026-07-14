# CSP / RLS Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the last Phase 3 security gaps — enforce clickjacking protection via HTTP headers, remove `'unsafe-inline'` from `script-src` on all 14 pages by externalizing inline scripts, and prove owner-only RLS across every user-data table with one consolidated test.

**Architecture:** No-build static site. (A) Security headers added to `serve.mjs` for dev + a host-agnostic docs bundle for prod. (B) Every executable inline `<script>` moves verbatim to a file under `js/` (covered by `script-src 'self'`); `application/ld+json` data blocks stay inline. (C) One `scripts/test-rls-audit.mjs` seeds two users and asserts owner-only isolation table-by-table.

**Tech Stack:** vanilla Node HTTP server, ES modules in the browser, Supabase (Postgres + RLS + `@supabase/supabase-js`), Puppeteer for e2e, `pg` pooler via `scripts/run-sql.mjs`.

**Spec:** `docs/superpowers/specs/2026-07-14-csp-rls-hardening-design.md`

**Preconditions:** Run inside a dedicated worktree/branch `phase-3/csp-rls-hardening`. Dev server (`node serve.mjs`) up on :3000 before any Puppeteer/curl step. Test scripts read `.env.local` manually (no `dotenv`) and use admin `createUser` — follow that convention.

---

## File Structure

**New files:**
- `js/index-hero-video.js` — index hero-video play/pause toggle (plain IIFE, no imports)
- `js/book-appointment-tabs.js` — book-appointment tab switcher (plain IIFE, no imports)
- `js/shop-page.js` — shop bootstrap module (imports rewritten `./js/`→`/js/`)
- `js/product-page.js` — product bootstrap module (both inline blocks merged in order; imports rewritten)
- `js/cart-page.js` — cart bootstrap module (imports rewritten)
- `js/account-page.js`, `js/login-page.js`, `js/signup-page.js`, `js/forgot-password-page.js`, `js/reset-password-page.js`, `js/order-confirmation-page.js` — auth-page bootstraps (imports already `/js/`, unchanged)
- `scripts/test-rls-audit.mjs` — consolidated RLS audit
- `docs/security/production-headers.md` — host-agnostic prod header configs

**Modified files:**
- `serve.mjs` — security response headers
- 14 `*.html` — inline `<script>` → `<script src>`; `script-src` drops `'unsafe-inline'`
- `scripts/test-csp-compliance.mjs` — assert no `'unsafe-inline'` in `script-src` + header checks
- `PROJECT.md` — shipped inventory

---

## Task 1: Security headers in serve.mjs

**Files:**
- Modify: `serve.mjs`

- [ ] **Step 1: Add a shared security-header object and apply it to both success and 404 responses**

Replace the `http.createServer` block in `serve.mjs` (lines 28-39) with:

```js
const SECURITY_HEADERS = {
  'Content-Security-Policy': "frame-ancestors 'none'",
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

http.createServer((req, res) => {
  let urlPath = req.url.split('?')[0];
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(__dirname, urlPath);
  const ext = path.extname(filePath);
  const mime = MIME[ext] || 'application/octet-stream';
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404, { ...SECURITY_HEADERS }); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': mime, ...SECURITY_HEADERS });
    res.end(data);
  });
}).listen(PORT, () => console.log(`Serving at http://localhost:${PORT}`));
```

- [ ] **Step 2: Restart the dev server and verify the headers**

Run (restart serve.mjs first if it was already up):
```bash
curl -sI http://localhost:3000/ | grep -iE 'x-frame-options|content-security-policy|x-content-type-options|referrer-policy'
```
Expected: four lines present, including `X-Frame-Options: DENY` and `Content-Security-Policy: frame-ancestors 'none'`.

- [ ] **Step 3: Commit**

```bash
git add serve.mjs
git commit -m "feat(security): send frame-ancestors + hardening headers from serve.mjs"
```

---

## Task 2: Production header docs bundle

**Files:**
- Create: `docs/security/production-headers.md`

- [ ] **Step 1: Write the host-agnostic header docs**

Create `docs/security/production-headers.md` with:

````markdown
# Production Security Headers

This is a static site; real HTTP security-header enforcement happens at the host/CDN.
`serve.mjs` applies the dev subset. Drop ONE of the configs below into the chosen host.

All configs set:

| Header | Value |
|---|---|
| `Content-Security-Policy` | `frame-ancestors 'none'` |
| `X-Frame-Options` | `DENY` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` (HTTPS only — do NOT set on plain-HTTP dev) |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` |

The per-page `<meta>` CSP remains the authoritative policy for all other directives
(`default-src`, `script-src`, `style-src`, etc.). A future task may promote the full
CSP to a header — deferred.

## Netlify / Cloudflare Pages — `_headers` (repo root)

```
/*
  Content-Security-Policy: frame-ancestors 'none'
  X-Frame-Options: DENY
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Strict-Transport-Security: max-age=31536000; includeSubDomains
  Permissions-Policy: camera=(), microphone=(), geolocation=()
```

## Vercel — `vercel.json`

```json
{
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "Content-Security-Policy", "value": "frame-ancestors 'none'" },
        { "key": "X-Frame-Options", "value": "DENY" },
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" },
        { "key": "Strict-Transport-Security", "value": "max-age=31536000; includeSubDomains" },
        { "key": "Permissions-Policy", "value": "camera=(), microphone=(), geolocation=()" }
      ]
    }
  ]
}
```

## nginx

```nginx
add_header Content-Security-Policy "frame-ancestors 'none'" always;
add_header X-Frame-Options "DENY" always;
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
```
````

- [ ] **Step 2: Commit**

```bash
git add docs/security/production-headers.md
git commit -m "docs(security): host-agnostic production header configs"
```

---

## Task 3: Externalize the two plain IIFEs (index + book-appointment)

These have no imports and are plain (non-module) scripts. Warm-up task.

**Files:**
- Create: `js/index-hero-video.js`, `js/book-appointment-tabs.js`
- Modify: `index.html` (lines 829-848), `book-appointment.html` (lines 419-444)

- [ ] **Step 1: Create `js/index-hero-video.js`**

Copy the body **between** `<script>` (line 829) and `</script>` (line 848) of `index.html` verbatim into `js/index-hero-video.js`. Current content:

```js
(function () {
  var video = document.getElementById('heroVideo');
  var btn   = document.getElementById('videoToggle');
  if (!video || !btn) return;

  function sync() {
    var playing = !video.paused && !video.ended;
    btn.dataset.state = playing ? 'playing' : 'paused';
    btn.setAttribute('aria-label', playing ? 'Pause background video' : 'Play background video');
  }

  btn.addEventListener('click', function () {
    if (video.paused) video.play(); else video.pause();
  });
  video.addEventListener('play',  sync);
  video.addEventListener('pause', sync);
  sync();
})();
```

- [ ] **Step 2: Replace the inline block in `index.html` with a src tag**

Replace lines 829-848 (`<script>` … `</script>`) with:
```html
<script src="/js/index-hero-video.js"></script>
```
(Keep the `<script type="module" src="js/cart.js"></script>` that follows it unchanged.)

- [ ] **Step 3: Create `js/book-appointment-tabs.js`**

Copy the body between `<script>` (line 419) and `</script>` (line 444) of `book-appointment.html` verbatim into `js/book-appointment-tabs.js`. Current content:

```js
(function () {
  var tabs   = document.querySelectorAll('.tab');
  var panels = document.querySelectorAll('.panel');

  function activate(target) {
    tabs.forEach(function (t) {
      var on = t.dataset.target === target;
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    panels.forEach(function (p) {
      var on = p.id === 'panel-' + target;
      p.classList.toggle('is-active', on);
      if (on) p.removeAttribute('hidden'); else p.setAttribute('hidden', '');
    });
  }

  tabs.forEach(function (t) {
    t.addEventListener('click', function () { activate(t.dataset.target); });
  });

  // Honor URL hash so /book-appointment.html#online deep-links straight in
  var hash = (location.hash || '').replace('#', '');
  if (hash === 'online' || hash === 'in-person') activate(hash);
})();
```

- [ ] **Step 4: Replace the inline block in `book-appointment.html` with a src tag**

Replace lines 419-444 with:
```html
<script src="/js/book-appointment-tabs.js"></script>
```
(Keep the following `<script type="module" src="js/cart.js"></script>` unchanged.)

- [ ] **Step 5: Verify both pages still work**

Run (server up):
```bash
node screenshot.mjs http://localhost:3000/ index-after
node screenshot.mjs http://localhost:3000/book-appointment.html book-after
```
Read both PNGs from `temporary screenshots/`. Expected: index hero renders with the video toggle button; book-appointment shows the tab UI. Then manually confirm no console errors by checking the CSP sweep later (Task 9).

- [ ] **Step 6: Commit**

```bash
git add js/index-hero-video.js js/book-appointment-tabs.js index.html book-appointment.html
git commit -m "refactor(csp): externalize index + book-appointment inline IIFEs"
```

---

## Task 4: Externalize the six auth-page modules (imports already root-absolute)

`account`, `login`, `signup`, `forgot-password`, `reset-password`, `order-confirmation` all import from `/js/…` (root-absolute) — **no import rewrite needed**. Move each block verbatim.

**Files:**
- Create: `js/account-page.js`, `js/login-page.js`, `js/signup-page.js`, `js/forgot-password-page.js`, `js/reset-password-page.js`, `js/order-confirmation-page.js`
- Modify: the six corresponding `.html` files

- [ ] **Step 1: For each page, move the inline module body to its file**

For each (page, block-range, new-file):
- `account.html` (349-463) → `js/account-page.js`
- `login.html` (132-166) → `js/login-page.js`
- `signup.html` (140-178) → `js/signup-page.js`
- `forgot-password.html` (98-117) → `js/forgot-password-page.js`
- `reset-password.html` (92-127) → `js/reset-password-page.js`
- `order-confirmation.html` (241-292) → `js/order-confirmation-page.js`

Do: copy the body **between** the `<script type="module">` and `</script>` lines verbatim into the new file. Then replace those inline lines in the HTML with:
```html
<script type="module" src="/js/<new-file-name>"></script>
```
(e.g. `login.html` → `<script type="module" src="/js/login-page.js"></script>`.)

- [ ] **Step 2: Verify imports resolve — grep the new files for any `./js/` import**

Run:
```bash
grep -nE "from ['\"]\./|import\(['\"]\./" js/account-page.js js/login-page.js js/signup-page.js js/forgot-password-page.js js/reset-password-page.js js/order-confirmation-page.js
```
Expected: **no output** (all imports were `/js/…`). If any `./js/…` appears, rewrite it to `/js/…`.

- [ ] **Step 3: Run the auth-page e2e regression**

Run (server up):
```bash
node scripts/test-signup-flow.mjs
node scripts/test-forgot-reset.mjs
node scripts/test-account-profile-crud.mjs
node scripts/test-account-delete.mjs
node scripts/test-route-guards.mjs
```
Expected: all pass (behavior unchanged — files just moved).

- [ ] **Step 4: Commit**

```bash
git add js/account-page.js js/login-page.js js/signup-page.js js/forgot-password-page.js js/reset-password-page.js js/order-confirmation-page.js account.html login.html signup.html forgot-password.html reset-password.html order-confirmation.html
git commit -m "refactor(csp): externalize auth-page inline modules"
```

---

## Task 5: Externalize shop-page module (rewrite `./js/`→`/js/`)

**Files:**
- Create: `js/shop-page.js`
- Modify: `shop.html` (lines 537-1022)

- [ ] **Step 1: Move the block and rewrite relative imports**

Copy the body between `<script type="module">` (537) and `</script>` (1022) into `js/shop-page.js`. Then rewrite every `./js/…` import to root-absolute `/js/…`. Known imports to fix:
- `from './js/data-loader.js'` → `from '/js/data-loader.js'`
- `from './js/meta.js'` → `from '/js/meta.js'`

Verify none remain:
```bash
grep -nE "['\"]\./js/" js/shop-page.js
```
Expected: no output.

- [ ] **Step 2: Replace the inline block in `shop.html`**

Replace lines 537-1022 with:
```html
<script type="module" src="/js/shop-page.js"></script>
```
(Keep the following `<script type="module" src="js/cart.js"></script>` unchanged.)

- [ ] **Step 3: Verify shop works**

Run (server up):
```bash
node scripts/test-shop-search.mjs
node scripts/test-product-search.mjs
node screenshot.mjs http://localhost:3000/shop.html shop-after
```
Expected: both tests pass; screenshot shows 6 product cards. Read the PNG to confirm.

- [ ] **Step 4: Commit**

```bash
git add js/shop-page.js shop.html
git commit -m "refactor(csp): externalize shop-page inline module"
```

---

## Task 6: Externalize product-page module (two blocks + rewrites)

`product.html` has **two** inline module blocks (795-1141 and 1148-1183). Merge into one file in document order.

**Files:**
- Create: `js/product-page.js`
- Modify: `product.html` (lines 795-1141 and 1148-1183)

- [ ] **Step 1: Merge both blocks into `js/product-page.js`**

Copy the body of the FIRST block (between `<script type="module">` at 795 and `</script>` at 1141) into `js/product-page.js`, then append the body of the SECOND block (between 1148 and 1183) below it. Rewrite relative imports to root-absolute:
- `from './js/data-loader.js'` → `from '/js/data-loader.js'`
- `from './js/meta.js'` → `from '/js/meta.js'`
- `await import('./js/customizer.js')` → `await import('/js/customizer.js')`

Verify none remain:
```bash
grep -nE "['\"]\./js/" js/product-page.js
```
Expected: no output.

- [ ] **Step 2: Check for top-level identifier collisions between the two merged blocks**

Run:
```bash
node --check js/product-page.js
```
Expected: no output (syntax OK — no duplicate top-level `const`/`let`/`import`). If it errors with a duplicate-declaration message, DO NOT merge: instead keep two files (`js/product-page.js` for block 1, `js/product-page-2.js` for block 2) and add two `<script type="module" src>` tags in Step 3 in original order.

- [ ] **Step 3: Replace both inline blocks in `product.html`**

Replace lines 795-1141 (first block) with:
```html
<script type="module" src="/js/product-page.js"></script>
```
Delete the second block (1148-1183) entirely (its content now lives at the end of `js/product-page.js`). If the collision fallback from Step 2 applied, instead replace the first block with `<script type="module" src="/js/product-page.js"></script>` and the second with `<script type="module" src="/js/product-page-2.js"></script>`.

- [ ] **Step 4: Verify PDP works**

Run (server up):
```bash
node scripts/test-customizer-flow.mjs
node scripts/test-design-hero-rail.mjs
node scripts/test-swatch-prefers-hero.mjs
node screenshot.mjs "http://localhost:3000/product.html?item=formal-suit-2-piece&fabric=vbc-wool&design=vbc-wool-grey-herringbone" pdp-after
```
Expected: all three tests pass; screenshot shows the PDP with thumb rail, design selector, and "Customize Your Suit" button. Read the PNG.

- [ ] **Step 5: Commit**

```bash
git add js/product-page.js product.html
git commit -m "refactor(csp): externalize product-page inline modules"
```

---

## Task 7: Externalize cart-page module (rewrite `./js/`→`/js/`)

**Files:**
- Create: `js/cart-page.js`
- Modify: `cart.html` (lines 349-568)

- [ ] **Step 1: Move the block and rewrite relative imports**

Copy the body between `<script type="module">` (349) and `</script>` (568) into `js/cart-page.js`. Rewrite:
- `from './js/data-loader.js'` → `from '/js/data-loader.js'`
- `from './js/cart.js'` → `from '/js/cart.js'`

Verify:
```bash
grep -nE "['\"]\./js/" js/cart-page.js
```
Expected: no output.

- [ ] **Step 2: Replace the inline block in `cart.html`**

Replace lines 349-568 with:
```html
<script type="module" src="/js/cart-page.js"></script>
```

- [ ] **Step 3: Verify cart works**

Run (server up):
```bash
node scripts/test-checkout-flow.mjs
node screenshot.mjs http://localhost:3000/cart.html cart-after
```
Expected: test passes; screenshot shows the cart page (empty-state or items). Read the PNG.

- [ ] **Step 4: Commit**

```bash
git add js/cart-page.js cart.html
git commit -m "refactor(csp): externalize cart-page inline module"
```

---

## Task 8: Remove `'unsafe-inline'` from `script-src` on all 14 pages

**Files:**
- Modify: `index.html`, `shop.html`, `product.html`, `cart.html`, `book-appointment.html`, `in-store.html`, `privacy.html`, `signup.html`, `login.html`, `forgot-password.html`, `reset-password.html`, `account.html`, `order-confirmation.html`, `measurements.html` (line 7 of each)

- [ ] **Step 1: Flip the `script-src` directive on every page**

On line 7 of each of the 14 pages, change:
```
  script-src 'self' 'unsafe-inline' https://esm.sh https://assets.calendly.com;
```
to:
```
  script-src 'self' https://esm.sh https://assets.calendly.com;
```
Leave `style-src` (line 8) unchanged (`'unsafe-inline'` retained).

- [ ] **Step 2: Add the style-src rationale comment on each page**

Immediately above the `<meta http-equiv="Content-Security-Policy"` line (line 5) on each page, add:
```html
<!-- CSP: script-src is 'self'-only (all inline scripts externalized). style-src retains 'unsafe-inline' — 28 inline <style> blocks, no build step; style injection is not a script-exec vector. See docs/superpowers/specs/2026-07-14-csp-rls-hardening-design.md -->
```

- [ ] **Step 3: Verify no `'unsafe-inline'` remains in any script-src**

Run:
```bash
grep -rn "script-src" *.html | grep "unsafe-inline" || echo "CLEAN: no unsafe-inline in script-src"
```
Expected: `CLEAN: no unsafe-inline in script-src`.

- [ ] **Step 4: Commit**

```bash
git add *.html
git commit -m "feat(csp): drop 'unsafe-inline' from script-src on all 14 pages"
```

---

## Task 9: Extend the CSP compliance sweep + assert headers

**Files:**
- Modify: `scripts/test-csp-compliance.mjs`

- [ ] **Step 1: Read the current test to find its structure**

Run:
```bash
sed -n '1,60p' scripts/test-csp-compliance.mjs
```
Note how it iterates `PAGES`, launches Puppeteer, and records CSP violations, and how it reports pass/fail (so the new assertions match the existing style).

- [ ] **Step 2: Add two new assertion groups after the existing per-page sweep**

Append a block that, after the existing violation sweep passes, additionally:

(a) Fetches each page's raw HTML over HTTP and asserts `'unsafe-inline'` is NOT in the `script-src` directive:
```js
// --- Assert script-src no longer allows 'unsafe-inline' ---
// (uses Node's global fetch — no import needed; define this helper near the top of the file)
async function getText(pathname) {
  const res = await fetch(`http://localhost:3000${pathname}`);
  return { status: res.status, text: await res.text(), headers: res.headers };
}
let scriptSrcClean = true;
for (const p of PAGES) {
  const { text } = await getText(p);
  const m = text.match(/script-src([^;]*);/);
  if (m && /unsafe-inline/.test(m[1])) {
    console.error(`FAIL ${p}: script-src still allows 'unsafe-inline'`);
    scriptSrcClean = false;
  }
}
if (scriptSrcClean) console.log('PASS: no page allows unsafe-inline in script-src');
```

(b) Asserts the server sends the clickjacking headers:
```js
// --- Assert security response headers ---
const { headers } = await getText('/');
const xfo = headers.get('x-frame-options');
const cspHeader = headers.get('content-security-policy');
const headersOk =
  xfo === 'DENY' &&
  cspHeader && cspHeader.includes("frame-ancestors 'none'") &&
  headers.get('x-content-type-options') === 'nosniff';
if (headersOk) console.log('PASS: security response headers present');
else { console.error('FAIL: missing/incorrect security headers', { xfo, cspHeader }); process.exitCode = 1; }
```

Wire `scriptSrcClean === false` into the script's non-zero exit path consistent with its existing failure handling.

- [ ] **Step 3: Run the full sweep**

Run (server up):
```bash
node scripts/test-csp-compliance.mjs
```
Expected: all 14 pages report zero CSP violations (proving externalized scripts execute under `'self'`), plus `PASS: no page allows unsafe-inline in script-src` and `PASS: security response headers present`. If any page logs a `Content Security Policy` violation for a blocked inline script, an inline block was missed — find and externalize it.

- [ ] **Step 4: Commit**

```bash
git add scripts/test-csp-compliance.mjs
git commit -m "test(csp): assert no script-src unsafe-inline + security headers"
```

---

## Task 10: Consolidated RLS audit test

**Files:**
- Create: `scripts/test-rls-audit.mjs`

- [ ] **Step 1: Read an existing RLS test to reuse the env/seed conventions**

Run:
```bash
sed -n '1,80p' scripts/test-orders-rls.mjs
```
Note: manual `.env.local` parse, `createClient` with anon key, admin client with service-role key, `auth.admin.createUser({ email, password, email_confirm: true })` to seed, per-user signed-in clients via `signInWithPassword`, and teardown via `auth.admin.deleteUser`.

- [ ] **Step 2: Write the audit test**

Create `scripts/test-rls-audit.mjs`. It must:
1. Parse `.env.local` for `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (reuse the exact parse from `test-orders-rls.mjs`).
2. Seed two users A and B via the admin client (`email_confirm: true`), using `@test.countryroadfashions.com` addresses (reserved-domain blocklist rejects `example.com`/`.test`). Capture their user ids.
3. Build a signed-in anon-key client for A and for B (`signInWithPassword`).
4. Assert, printing `PASS`/`FAIL` per check and setting `process.exitCode = 1` on any FAIL:

   - **profiles:** A `select` on own id returns 1 row; A `select` filtered to B's id returns 0 rows; A `update` on B's id affects 0 rows / errors.
   - **customer_body_measurements / customer_jacket_reference / customer_shirt_reference / customer_pants_reference:** A inserts one row (own `customer_id`); A selects → sees only own; A selects filtered to B → 0 rows. (Seed one row for B via B's client first so the isolation check is meaningful.)
   - **v_latest_body_measurements / v_latest_jacket_reference / v_latest_shirt_reference / v_latest_pants_reference:** A selects → only own latest row; count of rows visible to A with `customer_id = B` is 0 (the `security_invoker` leak guard).
   - **carts:** A upserts own cart row; A selects → own only; A selects filtered to B → 0 rows; A `update`/`upsert` targeting B's `user_id` fails or affects 0 rows.
   - **orders:** seed one paid order for each of A and B via the **admin (service-role)** client (bypasses RLS, mimics the Edge Function). Then: A (anon client) selects → sees only own order; A select filtered to B → 0 rows; A `insert` of a new order → **rejected** (no client insert policy); A `update` of own order status → **rejected/0 rows**.
   - **payments:** seed one payment per order via admin client. A selects → own only (via order join); A select for B's payment → 0 rows; A `insert` → rejected.
   - **newsletter_subscribers:** using the **anon (not signed-in)** client: `insert` a new email → succeeds; `select` any row → 0 rows / blocked (no anon SELECT); `update` → blocked. Then with A's signed-in client where A's email matches a subscriber row (insert one via admin for A's email + A's `profile_id`), A `select` own row → 1 row; A `select` for a different email → 0 rows.
5. Teardown: `auth.admin.deleteUser(A)` and `(B)` (cascades clean profiles/measurements/carts/orders/payments); delete any `newsletter_subscribers` rows seeded by email via the admin client.
6. Exit non-zero if any check failed; print a final summary line.

Follow the assertion/logging style already used in `test-orders-rls.mjs` so output is consistent.

- [ ] **Step 3: Run the audit**

Run (server not required — this is a DB test):
```bash
node scripts/test-rls-audit.mjs
```
Expected: every check prints `PASS`, final summary reports 0 failures, exit code 0.

- [ ] **Step 4: Commit**

```bash
git add scripts/test-rls-audit.mjs
git commit -m "test(rls): consolidated owner-only audit across all user-data tables"
```

---

## Task 11: Full regression, screenshots, PROJECT.md, finish

**Files:**
- Modify: `PROJECT.md`

- [ ] **Step 1: Run the full regression suite**

Run (server up):
```bash
node scripts/test-csp-compliance.mjs
node scripts/test-rls-audit.mjs
node scripts/test-seo-meta.mjs
node scripts/test-layout-mount.mjs
node scripts/test-token-discipline.mjs
node scripts/test-product-search.mjs
node scripts/test-search-overlay.mjs
node scripts/test-shop-search.mjs
node scripts/test-customizer-flow.mjs
node scripts/test-profile-rls.mjs
node scripts/test-measurements-rls.mjs
node scripts/test-cart-rls.mjs
node scripts/test-orders-rls.mjs
```
Expected: all pass. Fix any regression before proceeding (likely a missed inline script or an unrewritten import).

- [ ] **Step 2: Visual confirmation of the externalized pages**

Run:
```bash
node screenshot.mjs http://localhost:3000/ index-final
node screenshot.mjs http://localhost:3000/shop.html shop-final
node screenshot.mjs "http://localhost:3000/product.html?item=formal-suit-2-piece&fabric=vbc-wool&design=vbc-wool-grey-herringbone" pdp-final
node screenshot.mjs http://localhost:3000/book-appointment.html book-final
```
Read each PNG. Expected: no visual/functional regression vs. the pre-change baseline.

- [ ] **Step 3: Update PROJECT.md**

Add a "Phase 3 — CSP/RLS hardening (SHIPPED 2026-07-14) — #14 / Phase 3 close" subsection under §7 summarizing: security headers in serve.mjs + `docs/security/production-headers.md`; `script-src 'self'` via externalization of 12 inline blocks into 11 `js/*` files; `style-src 'unsafe-inline'` retained-with-rationale; `scripts/test-rls-audit.mjs`; extended `test-csp-compliance.mjs`. Update the top banner and the #14 backlog row to ✅ done, and note **Phase 3 is now COMPLETE**. Keep the pre-launch reminders (Supabase email confirmation + SMTP, Stripe live activation + webhook, choose host + apply production-headers.md).

- [ ] **Step 4: Commit**

```bash
git add PROJECT.md
git commit -m "docs: PROJECT.md — #14 CSP/RLS hardening shipped, Phase 3 complete"
```

- [ ] **Step 5: Finish the branch**

Use superpowers:requesting-code-review, then superpowers:finishing-a-development-branch to merge `phase-3/csp-rls-hardening` to `main` (no-ff), delete the branch, and push to origin.

---

## Notes for the implementer

- **Server restart:** after editing `serve.mjs` (Task 1), kill and restart the dev server so the new headers take effect before cur/Puppeteer checks.
- **Verbatim moves:** the only content changes allowed during externalization are the `./js/…` → `/js/…` import rewrites. Do not "improve" the moved code.
- **`.env.local`** is gitignored — never `git add` it. Test scripts parse it manually; do not add `dotenv`.
- **Failure signal:** after Task 8, a missed inline executable script surfaces as a `Content Security Policy` console violation in `test-csp-compliance.mjs`. That test is the safety net for completeness.
