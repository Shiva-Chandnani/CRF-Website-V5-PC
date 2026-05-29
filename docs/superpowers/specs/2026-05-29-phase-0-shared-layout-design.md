# Phase 0 — Shared Layout + Design System Lock

**Date:** 2026-05-29
**Status:** Design approved, ready for implementation plan
**Workflow context:** First phase of the 14-feature backlog defined in [PROJECT.md](../../../PROJECT.md) §7. Pre-requisite for every later phase; eliminates header/footer/CSS duplication across the 6 existing pages before 6+ new pages (signup, login, account, privacy, checkout, blog) inherit the drift.

---

## 1. Goal

Every existing page (`index.html`, `shop.html`, `product.html`, `cart.html`, `book-appointment.html`, `in-store.html`) renders from a single shared header and footer, with all foundational styling in `css/base.css`. The newsletter capture form in the footer writes to a new Supabase table (`newsletter_subscribers`). The result is one coherent spine that every later phase imports from rather than redefines.

## 2. Non-goals

- No new pages.
- No new visual design — token-discipline polish only (replace `#000` with `var(--color-jet)`, normalize `.btn--*`, add focus-visible). No new colors, spacing, or animation curves.
- No build step. Site stays as static HTML served by `serve.mjs`.
- No double-opt-in newsletter flow — capture only. Activation is Phase 6.
- No auth wiring on the Account icon — header already has the icon; Phase 1 swaps its href based on session state.

## 3. Decisions

| # | Decision | Value |
|---|---|---|
| Q1 | Footer scope across all pages | One full footer everywhere (index.html-style: brand + newsletter + 4 link cols + bottom row) |
| Q2 | Polish scope | Refactor + token-discipline polish (no spacing/animation changes) |
| Q3 | Execution shape | Single worktree `phase-0-shared-layout` + dispatched subagents for independent slices (newsletter backend, meta scaffold) |
| Q4 | FOUC mitigation | Inline per-page `<style>` block declaring color tokens only + `<link rel="preload" as="fetch">` hints + reserved-space slots |
| — | `mega-menu.css` disposition | Keep as separate layered stylesheet (already isolated, 334 lines, used on 5 of 6 pages) |
| — | Page-specific CSS extraction | Keep page-specific styles inline in each page's `<style>` block; only the shared spine migrates to `css/base.css` |

## 4. Architecture & Shared Spine

**New file layout:**

```
/
├── components/
│   ├── header.html          # canonical header markup (Search + Account + Cart icons)
│   └── footer.html          # canonical full footer (brand + newsletter + 4 cols + bottom row)
│
├── css/
│   ├── base.css             # NEW — tokens, reset, typography, .btn--*, form controls,
│   │                        # header styles, footer styles, announcement bar, utility classes
│   └── mega-menu.css        # UNCHANGED — kept separate (already isolated, 334 lines)
│
├── js/
│   ├── layout.js            # NEW — mounts header/footer into <div data-layout> slots
│   ├── meta.js              # NEW — setMeta() skeleton; no-op until Phase 3
│   ├── newsletter.js        # NEW — footer form → INSERT into newsletter_subscribers
│   ├── cart.js              # MODIFIED — waits for crf:layout-ready event before binding badge
│   ├── customizer.js        # UNCHANGED
│   ├── data-loader.js       # UNCHANGED (reused by newsletter.js for the Supabase client)
│   ├── mega-menu.js         # UNCHANGED
│   └── schema.d.ts          # MODIFIED — adds newsletter_subscribers row type
│
└── db/
    └── 07_newsletter_subscribers.sql   # NEW migration, applied via scripts/run-sql.mjs
```

**Unit contracts:**

| Unit | Responsibility | Interface | Depends on |
|---|---|---|---|
| `components/header.html` | Canonical header markup | Pure HTML fragment fetched as text | — |
| `components/footer.html` | Canonical footer markup, contains `<form data-newsletter-form>` | Pure HTML fragment | — |
| `css/base.css` | Token vocabulary + visual system | CSS custom properties + class names | brand_assets palette |
| `js/layout.js` | Mount components into `<div data-layout="header">` + `"footer">` slots, fire `crf:layout-ready` when both are in the DOM, decorate active nav link | Side-effect module; exports nothing | `components/*.html` over HTTP |
| `js/meta.js` | `export function setMeta({title, description, canonical, ogImage, jsonLd})` — writes/updates `<title>` + meta tags + JSON-LD script. No-op skeleton in Phase 0. | Pure function | DOM only |
| `js/newsletter.js` | Find `[data-newsletter-form]`, intercept submit, UPSERT into Supabase, swap form for success state | Side-effect module that listens for `crf:layout-ready` | `data-loader.js`, Supabase REST |
| `db/07_newsletter_subscribers.sql` | Schema + RLS | One SQL file | run via `scripts/run-sql.mjs` |

**Layered CSS dependency:** `base.css` → `mega-menu.css` → page `<style>`. Each layer may reference tokens defined in a layer below it, never the reverse.

## 5. Mounting Strategy & FOUC

**Race condition:** `js/cart.js` auto-mounts and binds to `[data-cart-count]` inside the header; if the header isn't injected yet, the binding misses.

**Resolution:**

1. **`js/layout.js` runs as an ES module (deferred by default).** It fetches both fragments in parallel, injects them synchronously, then dispatches `crf:layout-ready` on `document`:

   ```js
   const [headerHtml, footerHtml] = await Promise.all([
     fetch('/components/header.html').then(r => r.text()),
     fetch('/components/footer.html').then(r => r.text()),
   ]);
   document.querySelector('[data-layout="header"]').innerHTML = headerHtml;
   document.querySelector('[data-layout="footer"]').innerHTML = footerHtml;
   document.dispatchEvent(new Event('crf:layout-ready'));
   ```

2. **`js/cart.js` defers `bindBadge()`** until `crf:layout-ready` if `[data-cart-count]` isn't in the DOM yet:

   ```js
   if (document.querySelector('[data-cart-count]')) bindBadge();
   else document.addEventListener('crf:layout-ready', bindBadge, { once: true });
   ```

3. **FOUC mitigation — reserved-space slots.** Each page emits:

   ```html
   <div data-layout="header" style="min-height:72px;background:var(--color-jet);"></div>
   ...
   <div data-layout="footer" style="min-height:480px;background:var(--color-charcoal);"></div>
   ```

   The color tokens are declared in a small inline `<style>` block in `<head>` (~150 bytes per page) so the bands paint at the correct color on first frame. `layout.js` removes the `min-height` once the real content is in place.

4. **Preload hints in `<head>`** start the component fetches before the JS module runs:

   ```html
   <link rel="preload" as="fetch" href="/components/header.html" crossorigin>
   <link rel="preload" as="fetch" href="/components/footer.html" crossorigin>
   ```

5. **No-JS fallback:** out of scope for Phase 0. A `<noscript>` block in each page links to `/index.html` and includes a static text footer line.

**Mounting timing:**
```
HTML parse → <head> modules deferred → DOMContentLoaded
                                            │
                                            ▼
                                    layout.js fetches (Promise.all)
                                            │
                                            ▼
                                    inject + dispatch crf:layout-ready
                                            │
                            ┌───────────────┼───────────────┐
                            ▼               ▼               ▼
                         cart.js      newsletter.js   page listeners
```

## 6. Design Tokens & `.btn--*` System

`css/base.css` is the single source of truth for the visual vocabulary.

**Token map:**

```css
:root {
  /* Color */
  --color-jet: #0E0F11;
  --color-charcoal: #1A1B1F;
  --color-stone: #B6ADA5;
  --color-stone-soft: #D9D2CA;
  --color-cream: #F7F2EA;
  --color-off-white: #FAF8F4;
  --color-ink: #2A2A2E;
  --color-muted: #6B6B70;
  --color-rule: rgba(14, 15, 17, 0.08);

  /* Type */
  --font-serif: "Cormorant Garamond", Georgia, serif;
  --font-sans: "Raleway", system-ui, sans-serif;
  --tracking-tight: -0.03em;
  --leading-body: 1.7;

  /* Spacing — intentional ramp */
  --space-1: 4px;  --space-2: 8px;  --space-3: 12px; --space-4: 16px;
  --space-5: 24px; --space-6: 32px; --space-7: 48px; --space-8: 72px;
  --space-9: 96px;

  /* Surface elevation */
  --shadow-1: 0 1px 2px rgba(14,15,17,0.06), 0 1px 1px rgba(14,15,17,0.04);
  --shadow-2: 0 4px 10px rgba(14,15,17,0.08), 0 2px 4px rgba(14,15,17,0.05);
  --shadow-3: 0 16px 32px rgba(14,15,17,0.10), 0 4px 8px rgba(14,15,17,0.06);

  /* Motion */
  --ease-spring: cubic-bezier(0.34, 1.36, 0.64, 1);
  --t-fast: 140ms; --t-med: 220ms; --t-slow: 360ms;
}
```

**Button system:**

| Class | Replaces | Visual contract |
|---|---|---|
| `.btn` | base layout | Inline-flex, padding `12px 28px`, font-sans, letter-spacing `0.04em`, `transition: background var(--t-med), transform var(--t-fast)` (NOT `transition-all`) |
| `.btn--primary` | `.btn-primary` (cart, product) AND `.btn-dark` (index, in-store) | `background: var(--color-jet)`, white text, hover lifts `translateY(-1px)` + bg `var(--color-charcoal)`. Both legacy classes collapse here — they rendered identically. |
| `.btn--ghost` | `.btn-outline`, `.btn-outline-light` | Transparent bg, 1px border `var(--color-jet)`, hover fills with jet + flips text to off-white |
| `.btn--light` | `.btn-light` (hero) | White bg, jet text, used on dark photo backgrounds |

Every button gets `:focus-visible { outline: 2px solid var(--color-stone); outline-offset: 3px; }`.

**Constraints:** no new colors, no new spacing tokens, no new animation curves. The token list is extracted from what already exists across the 6 pages; the `.btn--*` collapse is the only behavior unification.

## 7. Newsletter Migration & Form UX

### 7.1 Schema (`db/07_newsletter_subscribers.sql`)

```sql
create table newsletter_subscribers (
  email           text primary key,
  profile_id      uuid references auth.users(id) on delete set null,
  source          text not null default 'footer',
  opted_in_at     timestamptz not null default now(),
  unsubscribed_at timestamptz,
  created_at      timestamptz not null default now()
);

alter table newsletter_subscribers enable row level security;

create policy "anon can insert"
  on newsletter_subscribers for insert
  to anon, authenticated
  with check (email is not null);

create policy "owners can read their own row"
  on newsletter_subscribers for select
  to authenticated
  using (profile_id = auth.uid());
```

**Notes:**
- `email` is PK → idempotent re-submission via UPSERT.
- `profile_id` nullable; Phase 1 backfills it when a user signs up with an already-captured email.
- `source` defaults to `'footer'`. Phase 1 signup uses `'signup'`; Phase 6 campaigns use `'campaign'`.
- RLS: anon INSERT only (no email enumeration). Authenticated users can read only their own row.

### 7.2 Form UX (4-state swap)

| State | Markup | Visual |
|---|---|---|
| **idle** | `<form data-newsletter-form>` with email input + `→` button | Existing visual |
| **submitting** | Same form, button gets `aria-busy="true"` + disabled + arrow swaps to thin spinner | Stone-colored spinner, no layout shift |
| **success** | Form replaced in-place with `<p class="newsletter-success">Thanks — you'll hear from us when the cloth arrives.</p>` | Stone color, italic Cormorant, same height as form (~64px) so footer doesn't jump |
| **error** | Form stays, small `<p class="newsletter-error">` inserted under input | Stone color, sans, 12px |

**Two error types only:**
- Network / Supabase 5xx → "Couldn't reach us — please try again."
- Invalid email (RFC client-side regex) → "Please enter a valid email address."

### 7.3 `js/newsletter.js` shape

```js
import { supabase } from './data-loader.js';

function init() {
  const form = document.querySelector('[data-newsletter-form]');
  if (!form) return;
  form.addEventListener('submit', onSubmit);
}

async function onSubmit(e) {
  e.preventDefault();
  const form = e.currentTarget;
  const email = form.querySelector('input[type="email"]').value.trim().toLowerCase();
  if (!isValidEmail(email)) return showError(form, 'Please enter a valid email address.');

  setBusy(form, true);
  const { error } = await supabase
    .from('newsletter_subscribers')
    .upsert({
      email,
      source: 'footer',
      opted_in_at: new Date().toISOString(),
      unsubscribed_at: null,
    });
  setBusy(form, false);

  if (error) return showError(form, "Couldn't reach us — please try again.");
  swapToSuccess(form);
}

if (document.readyState === 'loading') {
  document.addEventListener('crf:layout-ready', init, { once: true });
} else {
  init();
}
```

Migration applied via `node scripts/run-sql.mjs db/07_newsletter_subscribers.sql`.

## 8. Testing & Verification Gates

Phase 0 closes when both gates are green.

### 8.1 Automated gate

| Test file | What it asserts |
|---|---|
| `scripts/test-layout-mount.mjs` (NEW) | Loads each of the 6 pages on `localhost:3000`. For each: (a) `[data-layout="header"]` non-empty after `crf:layout-ready` fires, (b) `[data-layout="footer"]` non-empty, (c) `.brand-wordmark` and `<form data-newsletter-form>` are present, (d) console produces zero errors and zero warnings, (e) all `.btn--*` classes resolve to a non-default-Tailwind background. Fails fast on any page. |
| `scripts/test-newsletter-submit.mjs` (NEW) | Submits a unique throwaway email on `index.html`. Polls Supabase REST for the row; asserts presence + `source='footer'`. Re-submits the same email and asserts idempotency. Cleans up the row at the end via service-role key. |
| `scripts/test-token-discipline.mjs` (NEW) | Greps the 6 HTML files + `css/base.css`. Fails if any of: `#000` appears outside `--color-jet` definition, `#ffffff`/`#fff` appears outside token defs, `.btn-primary`/`.btn-dark` class attribute appears in markup, `transition-all` appears anywhere. |
| `scripts/test-customizer-flow.mjs` (existing) | Must still pass |
| `scripts/test-design-hero-rail.mjs` (existing) | Must still pass |
| `scripts/test-swatch-prefers-hero.mjs` (existing) | Must still pass |

### 8.2 Visual gate

For each of the 6 pages, capture before/after at two widths (1440 and 375):

```
temporary screenshots/phase-0/
├── before/   # captured on main BEFORE worktree diverges (12 PNGs)
└── after/    # captured after Phase 0 lands, before merge (12 PNGs)
```

**Pass criteria per page:**
- **Above-the-fold (header band + first hero/content section)** must be pixel-equivalent between before/after at the same width. Any visible difference must be either explained (e.g., focus ring now visible because it was missing before) or fixed.
- **Footer** intentionally differs on `shop.html`, `product.html`, `cart.html` — those gain the canonical full footer. Visual gate requires the new footer matches `index.html`'s footer pixel-for-pixel at the same width.
- **Anywhere else** must be pixel-equivalent.

### 8.3 Console + network gate (built into test-layout-mount.mjs)

- Zero console errors, zero warnings (uncaught promise rejection counts as an error).
- `components/header.html`, `components/footer.html`, `css/base.css` all return 200 from `serve.mjs`.

### 8.4 Phase 0 merge checklist (refined stop conditions)

- [ ] All 6 pages render visually per the visual gate
- [ ] `node scripts/test-layout-mount.mjs` passes
- [ ] `node scripts/test-newsletter-submit.mjs` passes
- [ ] `node scripts/test-token-discipline.mjs` passes
- [ ] `node scripts/test-customizer-flow.mjs` passes
- [ ] `node scripts/test-design-hero-rail.mjs` passes
- [ ] `node scripts/test-swatch-prefers-hero.mjs` passes
- [ ] PROJECT.md updated with Phase 0 shipped inventory + new files list
- [ ] Single commit on `main`: `Phase 0: shared layout + design system lock`
- [ ] Worktree cleaned up

## 9. Execution Plan Summary

### Setup (sequential)

1. `superpowers:using-git-worktrees` creates `../V5-ProperCloth-phase-0-shared-layout/` branched from `main`.
2. Capture before-screenshots — 12 PNGs (6 pages × 2 widths) on `main` *before* the worktree diverges, saved into `temporary screenshots/phase-0/before/`.

### Parallel subagent dispatch (Streams A + B simultaneously)

| Stream | Files touched | Conflicts with | Skill |
|---|---|---|---|
| **A — Newsletter backend** | `db/07_newsletter_subscribers.sql`, `js/newsletter.js`, `js/schema.d.ts` | None | dispatched subagent |
| **B — Meta scaffold** | `js/meta.js` | None | dispatched subagent |

Both streams never touch the 6 page HTML files or `css/base.css`, so they run in parallel via `superpowers:dispatching-parallel-agents`.

### Main thread (sequential, after A + B return)

3. Build `components/header.html` (extract canonical markup from `index.html`).
4. Build `components/footer.html` (extract full footer from `index.html`; confirm `data-newsletter-form` hook present).
5. Build `css/base.css` (tokens → reset → typography → `.btn--*` → form controls → header styles → footer styles, each in a labeled section block).
6. Build `js/layout.js` (fetch + inject + `crf:layout-ready` event + active-link decoration + FOUC `min-height` cleanup).
7. Modify `js/cart.js` (defer `bindBadge()` until `crf:layout-ready` if `[data-cart-count]` isn't in DOM yet).
8. Migrate the 6 pages, one at a time. For each page:
   - Replace `<header>...</header>` with `<div data-layout="header" style="min-height:72px;background:var(--color-jet);"></div>`
   - Replace `<footer>...</footer>` with `<div data-layout="footer" style="min-height:480px;background:var(--color-charcoal);"></div>`
   - Add `<link rel="preload" as="fetch" href="/components/header.html" crossorigin>` + same for footer in `<head>`
   - Add `<link rel="stylesheet" href="/css/base.css">` before any page-specific `<style>`
   - Add tiny inline `<style>` block declaring `--color-jet` and `--color-charcoal` only
   - Add `<script type="module" src="/js/layout.js"></script>` and `<script type="module" src="/js/newsletter.js"></script>` in `<head>`
   - Strip duplicated tokens, `.btn-primary`, `.btn-dark`, hardcoded `#000`/`#fff` from the page's inline `<style>` — keep only page-specific rules
   - Replace `class="btn btn-primary"` / `class="btn btn-dark"` with `class="btn btn--primary"`
   - Capture screenshot at 1440; verify against before-screenshot
   - Move to next page

   Order: `index.html` → `shop.html` → `product.html` → `cart.html` → `book-appointment.html` → `in-store.html`.

9. `node scripts/run-sql.mjs db/07_newsletter_subscribers.sql`.

### Verification (sequential)

10. Capture after-screenshots — 12 PNGs into `temporary screenshots/phase-0/after/`.
11. Run all 6 tests in order; any failure → `superpowers:systematic-debugging`, do not advance.
12. Visual diff per §8.2 criteria.

### Close (sequential)

13. Update PROJECT.md — append "Phase 0 — shipped 2026-05-29" subsection under §7 with new files, `.btn--*` rename, newsletter table, and any decisions made during execution.
14. `superpowers:requesting-code-review` — coherence check against the shared spine description.
15. `superpowers:finishing-a-development-branch` — merge to `main` with commit message `Phase 0: shared layout + design system lock`. Exit worktree.

**Estimated session shape:** setup + parallel streams ~30 min; main-thread refactor ~90–120 min; verification ~30 min; close ~15 min.

## 10. References

- [PROJECT.md](../../../PROJECT.md) §7 — original Phase 0 spec
- `~/.claude/plans/just-to-revamp-the-agile-sundae.md` — overall agentic methodology
- [CLAUDE.md](../../../CLAUDE.md) — frontend rules (anti-generic guardrails, brand assets, localhost workflow)
- `brand_assets/crf_brand_guidelines.png` — color palette authority
