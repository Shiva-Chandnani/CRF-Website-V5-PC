# Phase 3 Product Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship ranked, typo-tolerant product search across the site — a header typeahead overlay on every page and real server-side search on the shop page (combined with the sidebar filters) — backed by one Postgres RPC over `v_products`.

**Architecture:** A `stable`/`security invoker` Postgres function `search_products(query, …filters)` computes a full-text vector on the fly from `v_products` columns, combining `tsvector` prefix matching with `pg_trgm` trigram similarity, and returns ranked `setof v_products` rows. `js/data-loader.js` gains `productSearch` (query + filters, for the shop) and `quickSearch` (query-only, capped, for the overlay). A new `js/search-overlay.js` mounts on every page's shared header; `shop.html` reads `?q=` and routes its search through the RPC.

**Tech Stack:** Postgres 15 (`pg_trgm`, `tsvector`), `@supabase/supabase-js` (browser ESM + node tests), vanilla ES modules, `css/base.css`, puppeteer for e2e. Migrations run via `node scripts/run-sql.mjs`. Dev server `node serve.mjs` on `:3000`.

**Worktree:** Create an isolated worktree/branch `phase-3/product-search` (via `superpowers:using-git-worktrees`) before Task 1.

---

## File Structure

- **Create** `db/12_product_search.sql` — `pg_trgm` extension + `search_products` RPC + grants. Idempotent.
- **Create** `scripts/test-product-search.mjs` — node RPC test (prefix, fuzzy, fabric-number, item-type, combined, blank, ranking).
- **Modify** `js/data-loader.js` — add `productSearch(query, filters)` + `quickSearch(query, limit)`.
- **Create** `js/search-overlay.js` — browser module: header search icon → accessible typeahead overlay.
- **Modify** `css/base.css` — overlay styles (header is shared/global).
- **Modify** every page that loads the shared header — add `<script type="module" src="js/search-overlay.js">`. (Pages listed in Task 4.)
- **Create** `scripts/test-search-overlay.mjs` — puppeteer: open/close, debounced results, PDP link, "See all", `Esc`, a11y.
- **Modify** `shop.html` — read `?q=`, route search through `productSearch`, drop client-side substring filter.
- **Create** `scripts/test-shop-search.mjs` — puppeteer: `?q=` prefill, combined AND with filter, clearing query.
- **Modify** `scripts/test-csp-compliance.mjs` — assert overlay opens with zero CSP violations.

---

## Task 1: Backend — `search_products` RPC

**Files:**
- Create: `db/12_product_search.sql`
- Test: `scripts/test-product-search.mjs`

- [ ] **Step 1: Write the failing test**

Create `scripts/test-product-search.mjs`:

```js
// Phase 3 verification: search_products RPC — prefix, fuzzy, fabric-number,
// item-type, combined query+filter, blank query, ranking order.
// Reads .env.local manually (project convention; no dotenv). Uses the ANON key
// so the test exercises the same grants the browser will (public SELECT on v_products).
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8').split('\n').filter(Boolean)
    .map(l => l.split('=').map(s => s.trim())).map(([k, ...v]) => [k, v.join('=')])
);
const URL = env.SUPABASE_URL, ANON = env.SUPABASE_ANON_KEY;
if (!URL || !ANON) { console.error('missing env'); process.exit(2); }
const db = createClient(URL, ANON, { auth: { persistSession: false } });

let failed = false;
const step = (name, ok, detail = '') => {
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) failed = true;
};
const rpc = (args) => db.rpc('search_products', args);

try {
  // prefix / partial word: "sui" must find suits
  {
    const { data, error } = await rpc({ search_query: 'sui' });
    step('prefix "sui" returns suit rows', !error && data.length > 0 &&
      data.every(r => /suit/i.test(r.item_type_name + ' ' + r.display_name)), error?.message);
  }
  // fabric family term
  {
    const { data, error } = await rpc({ search_query: 'wool' });
    step('"wool" returns wool rows', !error && data.length > 0 &&
      data.every(r => /wool/i.test(r.fabric_family + ' ' + r.display_name)), error?.message);
  }
  // fuzzy / typo: "wollen" (pg_trgm similarity) should still find wool
  {
    const { data, error } = await rpc({ search_query: 'wollen' });
    step('fuzzy "wollen" finds wool via trigram', !error && data.length > 0, error?.message);
  }
  // fabric number exact
  {
    const { data, error } = await rpc({ search_query: 'WL-1102' });
    step('fabric number "WL-1102" resolves', !error && data.length > 0 &&
      data.every(r => r.fabric_number === 'WL-1102'), error?.message);
  }
  // combined query + filter (AND): "wool" + a fabric_type filter narrows
  {
    const all = (await rpc({ search_query: 'wool' })).data || [];
    const anyFabric = all[0]?.fabric_type_id;
    const { data, error } = await rpc({ search_query: 'wool', p_fabric_type_id: anyFabric });
    step('combined query+filter ANDs', !error && data.length > 0 &&
      data.every(r => r.fabric_type_id === anyFabric) && data.length <= all.length, error?.message);
  }
  // blank query = filter-only, ordered by display_name
  {
    const { data, error } = await rpc({ search_query: '   ' });
    const sorted = [...data].sort((a, b) => a.display_name.localeCompare(b.display_name));
    step('blank query returns all, display_name-ordered',
      !error && data.length > 0 && JSON.stringify(data.map(r => r.product_id)) === JSON.stringify(sorted.map(r => r.product_id)),
      error?.message);
  }
  // ranking: exact-ish term ranks a matching row at the top
  {
    const { data, error } = await rpc({ search_query: 'pinstripe' });
    step('"pinstripe" top result mentions pinstripe', !error && data.length > 0 &&
      /pinstripe/i.test((data[0].pattern || '') + ' ' + data[0].display_name), error?.message);
  }
  // garbage / punctuation-only must not throw
  {
    const { data, error } = await rpc({ search_query: '!!!' });
    step('punctuation-only query does not error', !error && Array.isArray(data), error?.message);
  }
} catch (e) {
  step('unexpected exception', false, e.message);
}
process.exit(failed ? 1 : 0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/test-product-search.mjs`
Expected: FAIL — every `rpc` call errors with something like `Could not find the function public.search_products` (function not created yet).

- [ ] **Step 3: Write the migration**

Create `db/12_product_search.sql`:

```sql
-- db/12_product_search.sql — Phase 3 product search.
-- RPC over v_products: tsvector prefix matching + pg_trgm fuzzy fallback.
-- Idempotent. Apply with: node scripts/run-sql.mjs db/12_product_search.sql

create extension if not exists pg_trgm;

create or replace function search_products(
  search_query     text,
  p_category_id    text default null,
  p_subcategory_id text default null,
  p_fabric_type_id text default null,
  p_pattern        text default null,
  p_color          text default null
) returns setof v_products
language sql
stable
security invoker
as $func$
  with q as (
    select nullif(btrim(coalesce(search_query, '')), '') as raw
  ),
  toks as (
    -- lowercase, strip non-alphanumerics to spaces, split to word tokens
    select raw,
           array(
             select tok
             from unnest(regexp_split_to_array(
                    lower(regexp_replace(coalesce(raw, ''), '[^a-z0-9]+', ' ', 'gi')), '\s+')) as tok
             where tok <> ''
           ) as words
    from q
  ),
  tsq as (
    select raw, words,
           case when raw is null or array_length(words, 1) is null then null
                else to_tsquery('simple',
                       array_to_string(array(select w || ':*' from unnest(words) as w), ' & '))
           end as query
    from toks
  )
  select p.*
  from v_products p
  cross join tsq
  cross join lateral (
    select lower(concat_ws(' ',
      p.display_name, p.item_type_name, p.fabric_brand, p.fabric_family,
      p.fabric_type_name, p.design_name, p.fabric_number, p.pattern,
      array_to_string(p.color, ' '), p.item_occasion)) as doc
  ) d
  where (p_category_id    is null or p.category_id    = p_category_id)
    and (p_subcategory_id is null or p.subcategory_id = p_subcategory_id)
    and (p_fabric_type_id is null or p.fabric_type_id = p_fabric_type_id)
    and (p_pattern        is null or p.pattern        = p_pattern)
    and (p_color          is null or p.color @> array[p_color])
    and (
      tsq.raw is null
      or (tsq.query is not null and to_tsvector('simple', d.doc) @@ tsq.query)
      or similarity(d.doc, tsq.raw) > 0.2
    )
  order by
    case when tsq.raw is null then 0::real
         else coalesce(
                case when tsq.query is not null
                     then ts_rank(to_tsvector('simple', d.doc), tsq.query) else 0 end, 0)
              + similarity(d.doc, tsq.raw)
    end desc,
    p.display_name asc;
$func$;

grant execute on function search_products(text, text, text, text, text, text) to anon, authenticated;
```

- [ ] **Step 4: Apply the migration**

Run: `node scripts/run-sql.mjs db/12_product_search.sql`
Expected: no error; prints statement completion (extension + function created).

- [ ] **Step 5: Run test to verify it passes**

Run: `node scripts/test-product-search.mjs`
Expected: all `✔`, exit 0. If a case fails, adjust the `0.2` similarity threshold or token handling in `db/12_product_search.sql`, re-apply via `run-sql.mjs`, re-run. (Threshold tuning is expected here — the test is the oracle.)

- [ ] **Step 6: Commit**

```bash
git add db/12_product_search.sql scripts/test-product-search.mjs
git commit -m "feat(search): search_products RPC — tsvector prefix + pg_trgm fuzzy over v_products"
```

---

## Task 2: Data-loader — `productSearch` + `quickSearch`

**Files:**
- Modify: `js/data-loader.js` (after the existing `searchProducts` function, ~line 131)

- [ ] **Step 1: Add the two functions**

In `js/data-loader.js`, immediately after the closing `}` of `searchProducts` (currently line 131), insert:

```js
// -----------------------------------------------------------------------------
// Ranked search (Phase 3) — server-side via the search_products RPC.
// productSearch: query + optional structured filters (shop page, combined AND).
// quickSearch:   query only, capped (header typeahead overlay).
// Both return the same v_products row shape searchProducts returns.
// -----------------------------------------------------------------------------
export async function productSearch(query, filters = {}) {
  const q = (query || '').trim();
  if (!q) return searchProducts(filters); // empty query → existing filter-only path
  const { data, error } = await supabase.rpc('search_products', {
    search_query:     q,
    p_category_id:    filters.categoryId    ?? null,
    p_subcategory_id: filters.subcategoryId ?? null,
    p_fabric_type_id: filters.fabricTypeId  ?? null,
    p_pattern:        filters.pattern       ?? null,
    p_color:          filters.color         ?? null,
  });
  if (error) throw error;
  return data;
}

export async function quickSearch(query, limit = 6) {
  const q = (query || '').trim();
  if (!q) return [];
  const { data, error } = await supabase.rpc('search_products', { search_query: q });
  if (error) throw error;
  return data.slice(0, limit);
}
```

- [ ] **Step 2: Sanity-check exports resolve**

Run (dev server must be up — `node serve.mjs` in background if not):
```bash
node -e "import('./js/data-loader.js').then(m => { if (typeof m.productSearch !== 'function' || typeof m.quickSearch !== 'function') { console.error('missing export'); process.exit(1);} console.log('exports ok'); }).catch(e => { console.error(e.message); process.exit(1); })"
```
Expected: `exports ok`. (If the import fails because `data-loader.js` imports supabase from esm.sh at the top and node can't fetch it, skip this step — the browser-level check in Task 3's overlay test covers it. Note the skip in the commit message.)

- [ ] **Step 3: Commit**

```bash
git add js/data-loader.js
git commit -m "feat(search): productSearch + quickSearch data-loader helpers over search_products RPC"
```

---

## Task 3: Header typeahead overlay

**Files:**
- Create: `js/search-overlay.js`
- Modify: `css/base.css` (append overlay styles)
- Test: `scripts/test-search-overlay.mjs`

> Invoke the **`frontend-design`** skill before writing the overlay markup/styles (per CLAUDE.md — every session, before frontend code). Honor the anti-generic guardrails: serif/sans pairing, stone accents, layered surfaces (backdrop → panel → rows), `transform`/`opacity`-only transitions, spring easing, full hover/focus-visible/active states.

- [ ] **Step 1: Write the failing test**

Create `scripts/test-search-overlay.mjs`:

```js
// Phase 3 e2e: header search overlay — open/close, debounced results, PDP link,
// "See all" handoff, Esc, listbox a11y. Reads no auth (search is public).
import puppeteer from 'puppeteer';

let failed = false;
const must = (c, m) => { if (!c) { console.error('✘', m); failed = true; } else console.log('✓', m); };

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
try {
  await page.goto('http://localhost:3000/index.html', { waitUntil: 'networkidle0' });
  // header mounts async via layout.js — wait for the wired trigger
  await page.waitForSelector('[data-search-btn][data-search-ready="1"]', { timeout: 5000 });

  // 1. Opens on click, input focused
  await page.click('[data-search-btn]');
  await page.waitForSelector('#search-overlay[data-open="1"]', { visible: true });
  const focusedName = await page.evaluate(() => document.activeElement?.getAttribute('data-search-input'));
  must(focusedName === '1', 'overlay opens and focuses the input');

  // 2. Debounced live results appear for "wool"
  await page.type('[data-search-input]', 'wool');
  await page.waitForSelector('#search-overlay [role="option"]', { timeout: 5000 });
  const optionCount = await page.$$eval('#search-overlay [role="option"]', els => els.length);
  must(optionCount > 0 && optionCount <= 6, `results render (got ${optionCount}, ≤6)`);

  // 3. Listbox a11y roles present
  const hasListbox = await page.$('#search-overlay [role="listbox"]');
  must(!!hasListbox, 'results container is a listbox');

  // 4. First result links to a PDP
  const href = await page.$eval('#search-overlay [role="option"] a, #search-overlay a[role="option"]',
    a => a.getAttribute('href')).catch(() => null);
  must(!!href && href.includes('product.html?item='), `result links to PDP → ${href}`);

  // 5. "See all results" → shop.html?q=wool
  const seeAll = await page.$eval('[data-search-seeall]', a => a.getAttribute('href')).catch(() => null);
  must(!!seeAll && /shop\.html\?q=wool/i.test(seeAll), `see-all handoff → ${seeAll}`);

  // 6. Esc closes and restores focus to the trigger
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('#search-overlay')?.getAttribute('data-open') !== '1');
  const backToTrigger = await page.evaluate(() => document.activeElement?.hasAttribute('data-search-btn'));
  must(backToTrigger, 'Esc closes overlay and returns focus to trigger');
} catch (e) {
  must(false, 'unexpected exception: ' + e.message);
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node serve.mjs &` (if not already running), then `node scripts/test-search-overlay.mjs`
Expected: FAIL at `waitForSelector('[data-search-btn][data-search-ready="1"]')` (overlay module not built).

- [ ] **Step 3: Create the overlay module**

Create `js/search-overlay.js`:

```js
// Phase 3 — header typeahead search overlay. Mounts on every page's shared
// header (crf:layout-ready). Debounced quickSearch → ranked product results.
import { quickSearch, fabricImageUrl } from './data-loader.js';

const DEBOUNCE_MS = 200;
const fmtTHB = (n) => 'THB ' + Number(n).toLocaleString('en-US');
const pdpHref = (r) =>
  `product.html?item=${encodeURIComponent(r.item_type_id)}` +
  `&fabric=${encodeURIComponent(r.fabric_type_id)}` +
  `&design=${encodeURIComponent(r.fabric_design_id)}`;

function buildOverlay() {
  const el = document.createElement('div');
  el.id = 'search-overlay';
  el.setAttribute('data-open', '0');
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', 'Search products');
  el.hidden = true;
  el.innerHTML = `
    <div class="search-overlay__backdrop" data-search-close></div>
    <div class="search-overlay__panel" role="document">
      <div class="search-overlay__bar">
        <svg class="search-overlay__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.35-4.35"/></svg>
        <input type="search" class="search-overlay__input" data-search-input="1"
               placeholder="Search cloth, cut, or fabric number" autocomplete="off"
               aria-controls="search-overlay-results" aria-label="Search products" />
        <button class="search-overlay__close icon-btn" data-search-close aria-label="Close search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>
        </button>
      </div>
      <div class="search-overlay__results" id="search-overlay-results" role="listbox" aria-label="Search results"></div>
      <a class="search-overlay__seeall" data-search-seeall href="shop.html" hidden>See all results →</a>
    </div>`;
  document.body.appendChild(el);
  return el;
}

function renderResults(listbox, seeAll, rows, query) {
  seeAll.setAttribute('href', `shop.html?q=${encodeURIComponent(query)}`);
  if (!query) { listbox.innerHTML = ''; seeAll.hidden = true; return; }
  if (!rows.length) {
    listbox.innerHTML = `<p class="search-overlay__empty">No pieces match “${query}”. Try a fabric, cut, or number.</p>`;
    seeAll.hidden = true;
    return;
  }
  listbox.innerHTML = rows.map((r, i) => {
    const img = fabricImageUrl(r.primary_photo_path, { width: 96 }) || 'https://placehold.co/96x120';
    return `<a class="search-overlay__result" role="option" id="search-opt-${i}" tabindex="-1"
               href="${pdpHref(r)}">
      <img class="search-overlay__thumb" src="${img}" alt="" loading="lazy" />
      <span class="search-overlay__meta">
        <span class="search-overlay__name">${r.display_name}</span>
        <span class="search-overlay__price">from ${fmtTHB(r.price)}</span>
      </span>
    </a>`;
  }).join('');
  seeAll.hidden = false;
}

function init(trigger) {
  if (trigger.dataset.searchReady === '1') return;
  const overlay = buildOverlay();
  const input   = overlay.querySelector('[data-search-input]');
  const listbox = overlay.querySelector('#search-overlay-results');
  const seeAll  = overlay.querySelector('[data-search-seeall]');
  let timer = null, lastFocus = null;

  const open = () => {
    lastFocus = document.activeElement;
    overlay.hidden = false;
    overlay.setAttribute('data-open', '1');
    trigger.setAttribute('aria-expanded', 'true');
    requestAnimationFrame(() => input.focus());
    document.addEventListener('keydown', onKey);
  };
  const close = () => {
    overlay.setAttribute('data-open', '0');
    trigger.setAttribute('aria-expanded', 'false');
    document.removeEventListener('keydown', onKey);
    setTimeout(() => { overlay.hidden = true; }, 180); // let the fade-out run
    (trigger || lastFocus)?.focus?.();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    // simple focus trap: keep Tab inside the panel
    if (e.key === 'Tab') {
      const focusables = overlay.querySelectorAll('input, button, a[href]:not([hidden]), [role="option"]');
      if (!focusables.length) return;
      const first = focusables[0], last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  };

  trigger.addEventListener('click', (e) => { e.preventDefault(); open(); });
  overlay.querySelectorAll('[data-search-close]').forEach(b => b.addEventListener('click', close));
  input.addEventListener('input', () => {
    const q = input.value.trim();
    clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        const rows = q ? await quickSearch(q, 6) : [];
        renderResults(listbox, seeAll, rows, q);
      } catch (err) {
        listbox.innerHTML = `<p class="search-overlay__empty">Search is unavailable right now.</p>`;
        console.error('[search-overlay]', err);
      }
    }, DEBOUNCE_MS);
  });
  // Enter with a query → go to full shop results
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && input.value.trim()) {
      location.href = `shop.html?q=${encodeURIComponent(input.value.trim())}`;
    }
  });

  trigger.setAttribute('aria-haspopup', 'dialog');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.dataset.searchReady = '1';
}

function mount() {
  const trigger = document.querySelector('[data-search-btn]');
  if (trigger) init(trigger);
}
document.addEventListener('crf:layout-ready', mount);
if (document.querySelector('[data-search-btn]')) mount(); // header already present
```

- [ ] **Step 4: Append overlay styles to `css/base.css`**

At the end of `css/base.css`, append (use existing token names — verify `--color-jet`, `--color-stone`, `--color-cream`, `--font-serif`, `--font-sans` exist in the file's `:root`; adjust names to match if they differ):

```css
/* ============== SEARCH OVERLAY (Phase 3) ============== */
#search-overlay {
  position: fixed; inset: 0; z-index: 1000;
  display: flex; justify-content: center; align-items: flex-start;
  opacity: 0; pointer-events: none;
  transition: opacity .18s cubic-bezier(.2,.8,.2,1);
}
#search-overlay[data-open="1"] { opacity: 1; pointer-events: auto; }
.search-overlay__backdrop {
  position: absolute; inset: 0;
  background: color-mix(in srgb, var(--color-jet) 55%, transparent);
  backdrop-filter: blur(2px);
}
.search-overlay__panel {
  position: relative; width: min(680px, 92vw); margin-top: 12vh;
  background: var(--color-cream); color: var(--color-jet);
  border-radius: 4px;
  box-shadow: 0 24px 60px -20px color-mix(in srgb, var(--color-jet) 45%, transparent);
  transform: translateY(-8px);
  transition: transform .22s cubic-bezier(.2,.8,.2,1);
}
#search-overlay[data-open="1"] .search-overlay__panel { transform: translateY(0); }
.search-overlay__bar {
  display: flex; align-items: center; gap: 12px;
  padding: 18px 20px; border-bottom: 1px solid color-mix(in srgb, var(--color-stone) 45%, transparent);
}
.search-overlay__icon { width: 18px; height: 18px; color: var(--color-stone); flex: none; }
.search-overlay__input {
  flex: 1; border: 0; background: transparent; outline: none;
  font-family: var(--font-serif); font-size: 20px; color: var(--color-jet);
}
.search-overlay__input::placeholder { color: var(--color-stone); font-style: italic; }
.search-overlay__results { max-height: 56vh; overflow-y: auto; padding: 8px; }
.search-overlay__result {
  display: flex; align-items: center; gap: 14px; padding: 10px 12px;
  border-radius: 3px; text-decoration: none; color: inherit;
  transition: background-color .15s ease, transform .15s cubic-bezier(.2,.8,.2,1);
}
.search-overlay__result:hover,
.search-overlay__result:focus-visible {
  background: color-mix(in srgb, var(--color-stone) 22%, transparent);
  transform: translateX(2px); outline: none;
}
.search-overlay__thumb { width: 44px; height: 56px; object-fit: cover; border-radius: 2px; flex: none; }
.search-overlay__meta { display: flex; flex-direction: column; gap: 2px; }
.search-overlay__name { font-family: var(--font-serif); font-size: 15px; }
.search-overlay__price { font-family: var(--font-sans); font-size: 12px; letter-spacing: .04em; color: var(--color-stone); text-transform: uppercase; }
.search-overlay__empty { padding: 28px 16px; text-align: center; font-family: var(--font-serif); font-style: italic; color: var(--color-stone); }
.search-overlay__seeall {
  display: block; padding: 14px 20px; text-align: center;
  border-top: 1px solid color-mix(in srgb, var(--color-stone) 45%, transparent);
  font-family: var(--font-sans); font-size: 12px; letter-spacing: .12em; text-transform: uppercase;
  color: var(--color-jet); text-decoration: none;
  transition: color .15s ease, background-color .15s ease;
}
.search-overlay__seeall:hover,
.search-overlay__seeall:focus-visible { background: color-mix(in srgb, var(--color-stone) 18%, transparent); outline: none; }
@media (prefers-reduced-motion: reduce) {
  #search-overlay, .search-overlay__panel, .search-overlay__result { transition: none; }
}
```

- [ ] **Step 5: Wire the overlay script into `index.html`** (the test loads `index.html`)

In `index.html`, find the existing `<script type="module" src="js/layout.js"></script>` line and add directly after it:

```html
    <script type="module" src="js/search-overlay.js"></script>
```

(The remaining pages are wired in Task 4.)

- [ ] **Step 6: Run test to verify it passes**

Run: `node scripts/test-search-overlay.mjs`
Expected: all `✓`, exit 0. If results don't appear, confirm the migration from Task 1 is applied and `serve.mjs` is running.

- [ ] **Step 7: Screenshot the overlay (visual gate per CLAUDE.md)**

```bash
node screenshot.mjs http://localhost:3000/index.html search-overlay-closed
```
Then manually verify the overlay opens cleanly by reading the test output. Optionally add a puppeteer screenshot of the open state during dev. Read the PNG and check: panel centered, stone hairlines, serif input, no layout shift.

- [ ] **Step 8: Commit**

```bash
git add js/search-overlay.js css/base.css index.html scripts/test-search-overlay.mjs
git commit -m "feat(search): header typeahead overlay (quickSearch) + styles + e2e"
```

---

## Task 4: Wire overlay into every shared-header page + CSP sweep

**Files:**
- Modify: `shop.html`, `product.html`, `cart.html`, `book-appointment.html`, `in-store.html`, `privacy.html`, `signup.html`, `login.html`, `forgot-password.html`, `reset-password.html`, `account.html`, `order-confirmation.html`, `measurements.html` (every page with `data-layout="header"` except `index.html`, already done)
- Modify: `scripts/test-csp-compliance.mjs`

- [ ] **Step 1: Add the module script to each page**

For each file listed above, find its existing `<script type="module" src="js/layout.js"></script>` line and add directly after it:

```html
    <script type="module" src="js/search-overlay.js"></script>
```

Verify each page actually mounts the shared header first:
```bash
grep -L 'data-layout="header"' shop.html product.html cart.html book-appointment.html in-store.html privacy.html signup.html login.html forgot-password.html reset-password.html account.html order-confirmation.html measurements.html
```
Expected: no output (all list files contain the header slot). If any file is printed, it has no shared header — skip adding the script there and note it.

- [ ] **Step 2: Confirm every page loads the script**

```bash
grep -L 'js/search-overlay.js' index.html shop.html product.html cart.html book-appointment.html in-store.html privacy.html signup.html login.html forgot-password.html reset-password.html account.html order-confirmation.html measurements.html
```
Expected: no output (all pages now reference the overlay script).

- [ ] **Step 3: Extend the CSP sweep to open the overlay**

In `scripts/test-csp-compliance.mjs`, after each page is loaded and its console/CSP violations are collected, add an interaction that opens the overlay and types a query, so any CSP violation from the RPC fetch or overlay render is caught. Locate the per-page loop (where it does `page.goto(...)` then checks violations) and, immediately after the page settles, insert:

```js
  // Phase 3: exercise the search overlay so its fetch/render is CSP-checked.
  const hasSearch = await page.$('[data-search-btn]');
  if (hasSearch) {
    await page.click('[data-search-btn]').catch(() => {});
    await page.waitForSelector('#search-overlay[data-open="1"]', { timeout: 3000 }).catch(() => {});
    await page.type('[data-search-input]', 'wool').catch(() => {});
    await new Promise(r => setTimeout(r, 500)); // let debounced quickSearch fire
  }
```

(Match the existing variable name for the `page` object and place this inside the same try-block that records violations.)

- [ ] **Step 4: Run the CSP sweep**

Run: `node scripts/test-csp-compliance.mjs`
Expected: zero violations across all pages (the Supabase `connect-src` is already allow-listed; the overlay adds no new origins).

- [ ] **Step 5: Commit**

```bash
git add index.html shop.html product.html cart.html book-appointment.html in-store.html privacy.html signup.html login.html forgot-password.html reset-password.html account.html order-confirmation.html measurements.html scripts/test-csp-compliance.mjs
git commit -m "feat(search): mount overlay site-wide + extend CSP sweep to open it"
```

---

## Task 5: Shop page — server-side search + `?q=` handoff

**Files:**
- Modify: `shop.html` (import list ~line 525; `state` ~line 555-565; `init` ~line 587-620; `loadProducts` ~line 623-632; `renderGrid` ~line 762-786)
- Test: `scripts/test-shop-search.mjs`

- [ ] **Step 1: Write the failing test**

Create `scripts/test-shop-search.mjs`:

```js
// Phase 3 e2e: shop page server-side search — ?q= prefill+run, combined AND
// with a sidebar filter, clearing the query restores browse.
import puppeteer from 'puppeteer';

let failed = false;
const must = (c, m) => { if (!c) { console.error('✘', m); failed = true; } else console.log('✓', m); };
const countCards = (page) => page.$$eval('.product-card', els => els.length);

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
try {
  // 1. ?q= prefills the input and runs the search on load
  await page.goto('http://localhost:3000/shop.html?q=wool', { waitUntil: 'networkidle0' });
  await page.waitForSelector('#productGrid .product-card, #productGrid .grid-msg', { timeout: 5000 });
  const inputVal = await page.$eval('#searchInput', el => el.value);
  must(inputVal === 'wool', `?q= prefilled input → "${inputVal}"`);
  const woolCards = await countCards(page);
  must(woolCards > 0, `query returned cards (${woolCards})`);

  // 2. Baseline (no query) has at least as many cards as the wool search
  await page.goto('http://localhost:3000/shop.html', { waitUntil: 'networkidle0' });
  await page.waitForSelector('#productGrid .product-card', { timeout: 5000 });
  const allCards = await countCards(page);
  must(allCards >= woolCards, `no-query browse ≥ query results (${allCards} ≥ ${woolCards})`);

  // 3. Typing a query narrows the grid (debounced)
  await page.type('#searchInput', 'linen');
  await new Promise(r => setTimeout(r, 600));
  await page.waitForSelector('#productGrid .product-card, #productGrid .grid-msg', { timeout: 5000 });
  const linenCards = await countCards(page);
  must(linenCards <= allCards, `typed query narrows grid (${linenCards} ≤ ${allCards})`);

  // 4. Clearing the query restores full browse
  await page.click('#searchInput', { clickCount: 3 });
  await page.keyboard.press('Backspace');
  await new Promise(r => setTimeout(r, 600));
  const restored = await countCards(page);
  must(restored === allCards, `clearing query restores browse (${restored} === ${allCards})`);
} catch (e) {
  must(false, 'unexpected exception: ' + e.message);
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/test-shop-search.mjs`
Expected: FAIL at assertion 1 — `?q=` is not read yet, so `#searchInput` value is empty.

- [ ] **Step 3: Import `productSearch` in shop.html**

In `shop.html`, the import (line ~525) currently reads:
```js
    getCategories, getSubcategoriesFor, fabricImageUrl, productImageUrl, searchProducts, supabase
```
Change it to add `productSearch`:
```js
    getCategories, getSubcategoriesFor, fabricImageUrl, productImageUrl, searchProducts, productSearch, supabase
```

- [ ] **Step 4: Seed `state.query` from `?q=`**

In the `state` object (line ~562), change:
```js
    query:         '',
```
to:
```js
    query:         params.get('q') || '',
```

- [ ] **Step 5: Route `loadProducts` through `productSearch`**

Replace the body of `loadProducts` (lines ~623-632):
```js
  async function loadProducts() {
    const filters = {
      categoryId:    state.categoryId    || undefined,
      subcategoryId: state.subcategoryId || undefined,
      fabricTypeId:  state.fabricTypeId  || undefined,
      pattern:       state.pattern       || undefined,
      color:         state.color         || undefined,
    };
    state.products = await searchProducts(filters);
  }
```
with:
```js
  async function loadProducts() {
    const filters = {
      categoryId:    state.categoryId    || null,
      subcategoryId: state.subcategoryId || null,
      fabricTypeId:  state.fabricTypeId  || null,
      pattern:       state.pattern       || null,
      color:         state.color         || null,
    };
    // productSearch: server-ranked when a query is present; falls back to the
    // filter-only path (searchProducts) when the query is blank.
    state.products = await productSearch(state.query, filters);
  }
```

- [ ] **Step 6: Drop the client-side substring filter in `renderGrid`**

Replace the top of `renderGrid` (lines ~762-775):
```js
  function renderGrid() {
    const grid = $('#productGrid');
    const q = state.query;
    let list = state.products;
    if (q) {
      list = list.filter(p =>
        p.design_name.toLowerCase().includes(q)        ||
        p.fabric_type_name.toLowerCase().includes(q)   ||
        p.fabric_number.toLowerCase().includes(q)      ||
        p.item_type_name.toLowerCase().includes(q)     ||
        (p.color || []).some(c => c.toLowerCase().includes(q))
      );
    }
    list = sortProducts(list);
```
with:
```js
  function renderGrid() {
    const grid = $('#productGrid');
    // state.products is already the server-side (ranked) result set for the
    // current query + filters — no client-side substring filtering here.
    let list = sortProducts(state.products);
```

- [ ] **Step 7: Prefill the input + make the search box re-run the server query (debounced)**

In `init`, after the products first load (the `await loadProducts(); renderAll();` around line 605), add a line to reflect the seeded query into the input. Find:
```js
    // Fetch products with current filters
    await loadProducts();
    renderAll();
```
and insert right after it:
```js
    // Reflect any ?q= into the search box
    $('#searchInput').value = state.query;
```

Then replace the existing `#searchInput` handler (lines ~610-613):
```js
    $('#searchInput').addEventListener('input', (e) => {
      state.query = e.target.value.trim().toLowerCase();
      renderGrid();
    });
```
with a debounced server re-query:
```js
    let searchTimer = null;
    $('#searchInput').addEventListener('input', (e) => {
      state.query = e.target.value.trim();
      clearTimeout(searchTimer);
      searchTimer = setTimeout(async () => {
        await loadProducts();
        renderAll();
      }, 250);
    });
```

> Note: `sortProducts` currently defaults `state.sort = 'recommended'`. The server already returns rows ranked by relevance for a query; `sortProducts` with `'recommended'` must preserve incoming order (verify it doesn't re-sort away the ranking — if it does, leave a `recommended` branch that returns the list as-is). Confirm during Step 9.

- [ ] **Step 8: Verify `sortProducts` preserves server ranking for 'recommended'**

Read the `sortProducts` function in `shop.html`. If the `'recommended'` case reorders (e.g. by price or name), change it to return the list unchanged so the server relevance order survives:
```js
      case 'recommended':
      default:
        return list; // preserve server order (relevance for queries)
```
(Only apply if it currently reorders. If it already returns the list as-is for `'recommended'`, no change.)

- [ ] **Step 9: Run test to verify it passes**

Run (dev server up): `node scripts/test-shop-search.mjs`
Expected: all `✓`, exit 0.

- [ ] **Step 10: Screenshot the shop query state (visual gate)**

```bash
node screenshot.mjs "http://localhost:3000/shop.html?q=wool" shop-query-wool
```
Read the PNG: input shows "wool", grid shows only wool cards, filter rail intact, no console-driven layout breakage.

- [ ] **Step 11: Commit**

```bash
git add shop.html scripts/test-shop-search.mjs
git commit -m "feat(search): shop page server-side ranked search + ?q= handoff (combined with filters)"
```

---

## Task 6: Full regression + docs

**Files:**
- Modify: `PROJECT.md` (record the shipped feature + scalability note)

- [ ] **Step 1: Run the full relevant suite**

With `serve.mjs` up, run each and confirm exit 0:
```bash
node scripts/test-product-search.mjs
node scripts/test-search-overlay.mjs
node scripts/test-shop-search.mjs
node scripts/test-csp-compliance.mjs
node scripts/test-layout-mount.mjs
node scripts/test-token-discipline.mjs
node scripts/test-swatch-prefers-hero.mjs
```
Expected: all pass. Fix any regression before proceeding.

- [ ] **Step 2: Update PROJECT.md**

- Add `/shop.html?q=<query>` note to the shop row in §2 (server-side ranked search).
- Add `js/search-overlay.js` and `db/12_product_search.sql` to the layout in §4.
- Add a "Phase 3 — product search (SHIPPED)" subsection under §7 summarizing: `search_products` RPC (tsvector prefix + pg_trgm fuzzy over `v_products`), header typeahead overlay site-wide, shop combined search+filters, 3 new tests. Include the **scalability note** verbatim from the spec §10 (migrate to a materialized search table + GIN trigram index when `v_products` outgrows a per-call seq scan).
- Update the backlog table (§7): items #3 and #4 → ✅ done (this feature).

- [ ] **Step 3: Commit**

```bash
git add PROJECT.md
git commit -m "docs: PROJECT.md — Phase 3 product search shipped (#3 + #4)"
```

- [ ] **Step 4: Request code review**

Invoke `superpowers:requesting-code-review` against the branch diff, then `superpowers:finishing-a-development-branch` to merge `phase-3/product-search` to `main` once review + all gates pass.

---

## Self-Review Notes

- **Spec coverage:** §4 DB → Task 1; §5 data-loader → Task 2; §6 overlay → Tasks 3-4; §7 shop → Task 5; §8 tests → Tasks 1/3/5 + CSP in Task 4; §10 scalability note → Task 6 Step 2. All covered.
- **Type/name consistency:** `search_products` RPC param names (`search_query`, `p_category_id`, …) match between `db/12_product_search.sql` (Task 1), `productSearch`/`quickSearch` (Task 2), and the tests. Overlay data-attributes (`data-search-btn`, `data-search-input`, `data-search-seeall`, `data-search-ready`, `#search-overlay[data-open]`) match between `js/search-overlay.js` (Task 3) and both puppeteer tests (Tasks 3 & 5's harness, Task 4 CSP sweep).
- **`fabricImageUrl` import:** used by the overlay for `primary_photo_path`; confirmed exported from `js/data-loader.js`.
- **Open verification during execution:** (a) similarity threshold `0.2` may need tuning against real catalogue tokens — the node test is the oracle; (b) `sortProducts('recommended')` must preserve server ranking — Task 5 Step 8 guards this.
