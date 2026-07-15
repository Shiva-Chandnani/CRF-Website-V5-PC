# Phase 4 — Customization Expansion (Jacket + Trouser) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the "Customize" drawer from `formal-suit-2-piece` only to standalone `formal-jacket` and `dress-pants`, reusing the existing category/option catalogue, with no new categories/options/SVGs.

**Architecture:** Data-driven (Approach A). One idempotent migration seeds the junction rows. A single `CUSTOMIZABLE` map in `js/product-page.js` drives button gating + friendly noun. The drawer renders group headers only when >1 category group is present (so single-cut garments render flat). The cart's catalog index is merged across all item types in the cart, fixing a latent bug.

**Tech Stack:** Static HTML + vanilla ES modules, Supabase Postgres (`v_customization_catalog` view), `scripts/run-sql.mjs` for migrations, puppeteer + Node smoke tests. No build step.

**Design doc:** `docs/superpowers/specs/2026-07-15-phase-4-customization-expansion-design.md`

**Prereq for testing:** dev server running — `node serve.mjs` (port 3000). Don't start a second instance if already up.

**Reference facts (verified against the codebase):**
- Junction table `item_type_customization_categories` PK = `(item_type_id, category_id)` → `on conflict do nothing` is a valid no-op guard.
- `customization_categories.group_name` ∈ `('jacket','pants')`; 11 jacket categories, 10 pants categories.
- Node tests read `.env.local` manually (no dotenv); anon client via `createClient(URL, ANON, …)`.
- Valid PDP URLs for tests (same design slug is valid across all 3 item types, since `v_products` = 35 designs × 3 item types):
  - Jacket: `product.html?item=formal-jacket&fabric=vbc-wool&design=vbc-wool-grey-herringbone`
  - Trouser: `product.html?item=dress-pants&fabric=vbc-wool&design=vbc-wool-grey-herringbone`
- Non-advanced click targets: jacket → row `jacket-lapel`, option `jacket-lapel-peak`; pants → row `pants-pleats`, option `pants-pleats-single`.

---

## Task 1: Seed junction rows for Jacket + Trouser (schema)

**Files:**
- Create: `db/13_customization_jacket_pants.sql`
- Create (test): `scripts/test-customization-item-types.mjs`

- [ ] **Step 1: Write the failing test**

Create `scripts/test-customization-item-types.mjs`:

```js
// Phase 4: verify the customization catalogue is exposed for standalone
// formal-jacket (11 jacket categories) and dress-pants (10 pants categories),
// with group purity and exactly one default option per category.
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8')
    .split('\n').filter(Boolean)
    .map(l => l.split('=').map(s => s.trim()))
    .map(([k, ...v]) => [k, v.join('=')])
);
const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, { auth: { persistSession: false } });

let failed = false;
function step(name, ok, detail = '') {
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) failed = true;
}

async function catalogFor(itemTypeId) {
  const { data, error } = await supabase
    .from('v_customization_catalog')
    .select('category_id, category_group, option_id, is_default')
    .eq('item_type_id', itemTypeId);
  if (error) throw error;
  return data;
}

function byCategory(rows) {
  const m = new Map();
  for (const r of rows) {
    if (!m.has(r.category_id)) m.set(r.category_id, { group: r.category_group, options: [], defaults: 0 });
    const c = m.get(r.category_id);
    c.options.push(r.option_id);
    if (r.is_default) c.defaults += 1;
  }
  return m;
}

const jacket = byCategory(await catalogFor('formal-jacket'));
const pants  = byCategory(await catalogFor('dress-pants'));

step('formal-jacket exposes 11 categories', jacket.size === 11, `got ${jacket.size}`);
step('dress-pants exposes 10 categories', pants.size === 10, `got ${pants.size}`);
step('all jacket categories are group=jacket', [...jacket.values()].every(c => c.group === 'jacket'));
step('all pants categories are group=pants', [...pants.values()].every(c => c.group === 'pants'));
step('no jacket-* category leaks into dress-pants', ![...pants.keys()].some(id => id.startsWith('jacket-')));
step('no pants-* category leaks into formal-jacket', ![...jacket.keys()].some(id => id.startsWith('pants-')));
step('every jacket category has >=1 option and exactly one default',
  [...jacket.values()].every(c => c.options.length >= 1 && c.defaults === 1));
step('every pants category has >=1 option and exactly one default',
  [...pants.values()].every(c => c.options.length >= 1 && c.defaults === 1));

console.log(failed ? '\n✘ FAILED' : '\n✅ PASS');
process.exit(failed ? 1 : 0);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node scripts/test-customization-item-types.mjs`
Expected: FAIL — `formal-jacket exposes 11 categories — got 0` (no junction rows yet).

- [ ] **Step 3: Write the migration**

Create `db/13_customization_jacket_pants.sql`:

```sql
-- Phase 4 — customization expansion.
-- Enable the existing customization catalogue for standalone formal-jacket
-- (all 11 jacket-group categories) and dress-pants (all 10 pants-group
-- categories). Idempotent: junction PK is (item_type_id, category_id).
-- No new categories, options, or SVGs — pure reuse.

insert into item_type_customization_categories (item_type_id, category_id)
select 'formal-jacket', id from customization_categories where group_name = 'jacket'
on conflict do nothing;

insert into item_type_customization_categories (item_type_id, category_id)
select 'dress-pants', id from customization_categories where group_name = 'pants'
on conflict do nothing;

-- Verification (printed by run-sql):
select item_type_id, count(*) as categories
from item_type_customization_categories
where item_type_id in ('formal-jacket','dress-pants')
group by item_type_id
order by item_type_id;
```

- [ ] **Step 4: Apply the migration**

Run: `node scripts/run-sql.mjs db/13_customization_jacket_pants.sql`
Expected: prints `dress-pants | 10` and `formal-jacket | 11`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `node scripts/test-customization-item-types.mjs`
Expected: `✅ PASS` (all 8 checks ✔).

- [ ] **Step 6: Commit**

```bash
git add db/13_customization_jacket_pants.sql scripts/test-customization-item-types.mjs
git commit -m "feat(customization): seed jacket+pants junction rows for formal-jacket/dress-pants"
```

---

## Task 2: Data-driven button gating + label (product-page.js)

**Files:**
- Modify: `js/product-page.js` (the `customizeBtn` wiring + `crf:pdp-ready` handler, ~lines 347–379)
- Modify: `product.html` (static button label + drawer `aria-label`, lines 762 & 800)

- [ ] **Step 1: Add the `CUSTOMIZABLE` map and use it for gating + label**

In `js/product-page.js`, immediately before the `const customizeBtn = document.getElementById('customizeBtn');` line, add:

```js
  // Phase 4: item types that expose the customizer → friendly noun for copy.
  const CUSTOMIZABLE = {
    'formal-suit-2-piece': 'Suit',
    'formal-jacket':       'Jacket',
    'dress-pants':         'Trousers',
  };
```

Replace the `crf:pdp-ready` handler (currently checking `=== 'formal-suit-2-piece'`) with:

```js
  // Toggle customizer visibility + label based on item type
  window.addEventListener('crf:pdp-ready', () => {
    const s = window.__crfState;
    const btn = document.getElementById('customizeBtn');
    const row = document.getElementById('ctaRow');
    if (!btn || !s?.current) return;
    const noun = CUSTOMIZABLE[s.current.item_type_id];
    if (noun) {
      btn.textContent = `Customize Your ${noun}`;
      btn.hidden = false;
      row?.classList.remove('is-single');
    } else {
      btn.hidden = true;
      row?.classList.add('is-single');
    }
  });
```

In the same file, update the `openCustomizer({ … })` call (inside the click handler) to pass the noun:

```js
      openCustomizer({
        item_type_id: s.current.item_type_id,
        fabric_design_id: s.current.fabric_design_id,
        price_thb: s.current.price,
        fabric_design_name: s.current.design_name,
        fabric_type_name: `${brand} ${family}`.trim(),
        garment_noun: CUSTOMIZABLE[s.current.item_type_id] || 'Garment',
      });
```

- [ ] **Step 2: Neutralize the static labels in product.html**

`product.html:762` — change the static button text so it isn't a stale "Suit" flash before JS runs:

```html
      <button class="btn btn--primary" id="customizeBtn" hidden>Customize</button>
```

`product.html:800` — generalize the drawer `aria-label`:

```html
<aside class="cz-drawer" id="customizerDrawer" aria-label="Customize this garment" aria-hidden="true"></aside>
```

- [ ] **Step 3: Manual verification (both new types + regression)**

With `node serve.mjs` running, load each URL and confirm the button shows with the right label:
- `http://localhost:3000/product.html?item=formal-jacket&fabric=vbc-wool&design=vbc-wool-grey-herringbone` → button reads "Customize Your Jacket".
- `http://localhost:3000/product.html?item=dress-pants&fabric=vbc-wool&design=vbc-wool-grey-herringbone` → "Customize Your Trousers".
- `http://localhost:3000/product.html?item=formal-suit-2-piece&fabric=vbc-wool&design=vbc-wool-grey-herringbone` → "Customize Your Suit" (unchanged).

(Task 5 automates this; this step is a quick smoke before wiring the drawer copy.)

- [ ] **Step 4: Commit**

```bash
git add js/product-page.js product.html
git commit -m "feat(customization): data-driven Customize button gating + per-garment label"
```

---

## Task 3: Auto group-headers + dynamic title (customizer.js)

**Files:**
- Modify: `js/customizer.js` (`renderListView`, ~lines 135–185)

- [ ] **Step 1: Replace the hard-coded jacket/pants grouping with a group-count rule**

In `js/customizer.js`, inside `renderListView`, replace the block that starts at
`// Group rows by jacket vs pants` (the `const jacket = …` / `const pants = …` lines)
through the `const rowHtml = …` definition with:

```js
  // Group labels for multi-group garments (e.g. the Suit). Single-group
  // garments (standalone jacket / trouser) render flat with no header.
  const GROUP_LABELS = { jacket: 'Jacket', pants: 'Trouser' };

  // Distinct groups in display order (cats already sorted by display order).
  const groupsInOrder = [];
  for (const c of cats) {
    if (!groupsInOrder.includes(c.category_group)) groupsInOrder.push(c.category_group);
  }
  const showGroupHeaders = groupsInOrder.length > 1;

  const rowHtml = (c) => `
    <button type="button" class="cz-row" data-cz-row="${c.category_id}">
      <span class="cz-row-label">${escapeHtml(c.category_name)}</span>
      <span class="cz-row-value">${escapeHtml(currentValueLabel(c.category_id))}</span>
      <svg class="cz-row-chev" width="6" height="12" viewBox="0 0 6 12" fill="none" stroke="currentColor" stroke-width="1"><path d="M0.5 10.7L5 6L0.5 1.3"/></svg>
    </button>
  `;

  const rowsHtml = groupsInOrder.map((g) => {
    const groupCats = cats.filter(c => c.category_group === g);
    const header = showGroupHeaders
      ? `<p class="cz-group">${escapeHtml(GROUP_LABELS[g] || g)}</p>`
      : '';
    return header + groupCats.map(rowHtml).join('');
  }).join('');
```

- [ ] **Step 2: Use `rowsHtml` and the dynamic title in the template**

In the same `renderListView` `drawer.innerHTML = …` template:

Change the title line from the hard-coded suit text to the garment noun:

```js
          <h2 class="cz-title">Customize Your ${escapeHtml(context.garment_noun || 'Garment')}</h2>
```

Replace the hard-coded rows region (the `<p class="cz-group">Jacket</p> … ${pants.map(rowHtml).join('')}` block) inside `<div class="cz-rows">` with `${rowsHtml}` followed by the existing advanced toggle:

```js
        <div class="cz-rows">
          ${rowsHtml}
          ${hasAdvanced ? `
            <button type="button" class="cz-toggle-advanced" data-cz-toggle-advanced>
              ${showAdvanced ? 'Hide Additional Options' : 'Show Additional Options'}
            </button>
          ` : ''}
        </div>
```

- [ ] **Step 3: Manual verification**

With `node serve.mjs` running:
- Jacket PDP → click Customize → drawer title "Customize Your Jacket", **no** "Jacket"/"Trouser" group header, rows listed flat.
- Trouser PDP → title "Customize Your Trousers", flat rows, "Show Additional Options" toggle present (5 advanced pants categories).
- Suit PDP → title "Customize Your Suit", still shows "Jacket" then "Trouser" headers (unchanged).

- [ ] **Step 4: Commit**

```bash
git add js/customizer.js
git commit -m "feat(customization): dynamic drawer title + auto group-headers (flat for single-cut)"
```

---

## Task 4: Merge cart catalog index across item types (bug fix)

**Files:**
- Modify: `js/cart-page.js` (`loadCatalogIndex` ~lines 21–37, and `render()` ~line 149)
- Modify (test): `scripts/test-customizer-flow.mjs` — add a mixed-cart spec assertion (added in Task 5; this task fixes the code the test guards)

**Bug being fixed:** `render()` calls `loadCatalogIndex(cart.items[0].item_type_id)`, so `catalogIndex` only covers the first line's item type. Once a standalone Trouser can be line #1, a later Suit line loses its jacket spec rows (filtered out at the `catalogIndex[v]` guard in `specRowsForLine`).

- [ ] **Step 1: Make `loadCatalogIndex` load + merge a set of item types**

Replace the `loadCatalogIndex` function in `js/cart-page.js` with:

```js
let catalogLoaded = false;
async function loadCatalogIndex(itemTypeIds) {
  if (catalogLoaded) return;
  const ids = [...new Set(itemTypeIds)].filter(Boolean);
  if (!ids.length) { catalogIndex = {}; catalogLoaded = true; return; }
  const { data, error } = await supabase
    .from('v_customization_catalog')
    .select('category_id, category_name, category_display_order, option_id, option_name')
    .in('item_type_id', ids);
  if (error) { console.error(error); catalogIndex = {}; catalogLoaded = true; return; }
  catalogIndex = {};
  for (const r of data) {
    catalogIndex[r.option_id] = {
      category_id: r.category_id,
      category_name: r.category_name,
      category_display_order: r.category_display_order,
      option_name: r.option_name,
    };
  }
  catalogLoaded = true;
}
```

(Option IDs are globally unique across categories, so the `.in()` union cannot collide.)

- [ ] **Step 2: Pass all distinct cart item types in `render()`**

In `render()`, replace the line:

```js
  // Ensure catalog index loaded (first item's item_type)
  await loadCatalogIndex(cart.items[0].item_type_id);
```

with:

```js
  // Ensure catalog index covers EVERY item type in the cart (mixed carts).
  await loadCatalogIndex(cart.items.map(x => x.item_type_id));
```

- [ ] **Step 3: Manual verification of the fix**

With `node serve.mjs` running, in the browser console at `http://localhost:3000/cart.html`, seed a mixed cart (Trouser first, then Suit) and reload:

```js
localStorage.setItem('crf.cart.v1', JSON.stringify({
  items: [
    { id: 'l1', item_type_id: 'dress-pants', fabric_design_id: 'vbc-wool-grey-herringbone',
      price_thb: 6000, qty: 1, customizations: { 'pants-pleats': 'pants-pleats-single' }, added_at: new Date().toISOString() },
    { id: 'l2', item_type_id: 'formal-suit-2-piece', fabric_design_id: 'vbc-wool-grey-herringbone',
      price_thb: 20000, qty: 1, customizations: { 'jacket-lapel': 'jacket-lapel-peak' }, added_at: new Date().toISOString() },
  ], updated_at: new Date().toISOString(),
}));
location.reload();
```

Expand both lines' "Customizations": the Trouser shows "Pants Pleats → Single Pleat" AND the Suit shows "Lapel → Peak Lapel". Before the fix, the Suit's Lapel row was missing.

- [ ] **Step 4: Commit**

```bash
git add js/cart-page.js
git commit -m "fix(cart): merge customization catalog index across all cart item types"
```

---

## Task 5: E2E coverage for Jacket + Trouser + mixed cart (puppeteer)

**Files:**
- Modify: `scripts/test-customizer-flow.mjs` — convert from screenshot-only to asserting, and add Jacket + Trouser + mixed-cart paths.

Note: the existing script is a screenshot smoke with no assertions and no exit code. This task adds real assertions while keeping the Suit path.

- [ ] **Step 1: Add an assertion helper + exit code to the existing script**

At the top of `scripts/test-customizer-flow.mjs` (after the imports/`page` setup), add:

```js
let failed = false;
function check(name, ok, detail = '') {
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) failed = true;
}
async function textOf(sel) {
  return page.$eval(sel, el => el.textContent.trim()).catch(() => null);
}
```

- [ ] **Step 2: Add a reusable single-cut flow at the end of the script (before `browser.close()`)**

```js
// ---- Phase 4: standalone Jacket + Trouser ----
async function drive(itemType, expectTitle, rowSel, optSel, expectGroupHeaders) {
  const url = `http://localhost:3000/product.html?item=${itemType}&fabric=vbc-wool&design=vbc-wool-grey-herringbone`;
  await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
  await new Promise(r => setTimeout(r, 500));

  await page.evaluate(() => localStorage.removeItem('crf.cart.v1'));
  await page.waitForSelector('#customizeBtn:not([hidden])', { timeout: 5000 });
  const btnText = await textOf('#customizeBtn');
  check(`${itemType}: button label`, btnText === `Customize Your ${expectTitle}`, btnText);

  await page.click('#customizeBtn');
  await new Promise(r => setTimeout(r, 600));
  const title = await textOf('.cz-title');
  check(`${itemType}: drawer title`, title === `Customize Your ${expectTitle}`, title);

  const headerCount = await page.$$eval('.cz-group', els => els.length);
  check(`${itemType}: ${expectGroupHeaders ? '2 group headers' : 'flat (no group header)'}`,
    expectGroupHeaders ? headerCount === 2 : headerCount === 0, `headers=${headerCount}`);

  await page.click(`[data-cz-row="${rowSel}"]`);
  await new Promise(r => setTimeout(r, 300));
  await page.click(`[data-cz-option="${optSel}"]`);
  await new Promise(r => setTimeout(r, 200));
  await page.click('[data-cz-back]');
  await new Promise(r => setTimeout(r, 200));
  await page.click('[data-cz-add-to-cart]');
  await new Promise(r => setTimeout(r, 600));

  const count = await page.evaluate(() => JSON.parse(localStorage.getItem('crf.cart.v1') || '{"items":[]}').items.length);
  check(`${itemType}: line added to cart`, count === 1, `items=${count}`);
}

await drive('formal-jacket', 'Jacket', 'jacket-lapel', 'jacket-lapel-peak', false);
await drive('dress-pants',   'Trousers', 'pants-pleats', 'pants-pleats-single', false);

// ---- Phase 4: mixed-cart spec renders all lines (guards the cart-index fix) ----
await page.evaluate(() => localStorage.setItem('crf.cart.v1', JSON.stringify({
  items: [
    { id: 'l1', item_type_id: 'dress-pants', fabric_design_id: 'vbc-wool-grey-herringbone',
      price_thb: 6000, qty: 1, customizations: { 'pants-pleats': 'pants-pleats-single' }, added_at: new Date().toISOString() },
    { id: 'l2', item_type_id: 'formal-suit-2-piece', fabric_design_id: 'vbc-wool-grey-herringbone',
      price_thb: 20000, qty: 1, customizations: { 'jacket-lapel': 'jacket-lapel-peak' }, added_at: new Date().toISOString() },
  ], updated_at: new Date().toISOString(),
})));
await page.goto('http://localhost:3000/cart.html', { waitUntil: 'networkidle0' });
await new Promise(r => setTimeout(r, 1400));
await page.evaluate(() => document.querySelectorAll('.cart-spec').forEach(d => d.open = true));
await new Promise(r => setTimeout(r, 300));
const specText = await page.$eval('#cartRoot', el => el.textContent).catch(() => '');
check('mixed cart: trouser pleats row rendered', /Single Pleat/.test(specText));
check('mixed cart: suit lapel row rendered (index-merge fix)', /Peak Lapel/.test(specText));

console.log(failed ? '\n✘ FAILED' : '\n✅ PASS');
```

Then change the final `await browser.close();` to run before the summary and set the exit code:

```js
await browser.close();
process.exit(failed ? 1 : 0);
```

(Remove the old trailing `console.log('\n✅ Done…')` line so there's a single summary.)

- [ ] **Step 3: Run the full flow**

Run: `node scripts/test-customizer-flow.mjs`
Expected: existing Suit screenshots still emit, plus `✔` for all Jacket/Trouser/mixed-cart checks, ending `✅ PASS`.

- [ ] **Step 4: Commit**

```bash
git add scripts/test-customizer-flow.mjs
git commit -m "test(customization): assert Jacket/Trouser drawers + mixed-cart spec e2e"
```

---

## Task 6: Bug-scan, regression, visual verification, docs

**Files:**
- Modify: `PROJECT.md` (§10 + backlog #1 + phasing table)

- [ ] **Step 1: Deliberate bug-scan of the touched surface**

Per the user's standing request to hunt latent bugs each phase, re-read the four modified JS/HTML files and check specifically for:
- Any other `=== 'formal-suit-2-piece'` or hard-coded "Suit"/"Jacket"/"Trouser" copy remaining. Run:
  `grep -rn "formal-suit-2-piece\|Customize Your\|cz-group" js/ product.html`
  Confirm every remaining hit is either data-driven or intentionally the Suit page.
- `currentValueLabel` / monogram special-casing: confirm `jacket-monogram` logic is inert for `dress-pants` (no jacket-monogram category present → never rendered). No code change expected; note the finding.
- Confirm `product-page.js` `import '/js/cart.js';` and lazy `import('/js/customizer.js')` still resolve (no path change).
- Log any bug that can't be fixed in-phase into `PROJECT.md` §7 with enough detail to resume; fix anything quick inline (new commit).

- [ ] **Step 2: Run the full regression suite**

With `node serve.mjs` running:

```bash
node scripts/test-customization-item-types.mjs
node scripts/test-customizer-flow.mjs
node scripts/test-token-discipline.mjs
node scripts/test-layout-mount.mjs
node scripts/test-csp-compliance.mjs
```

Expected: all pass. (CSP unchanged — all edits are in existing `js/*` files, no new inline scripts.)

- [ ] **Step 3: Visual verification (2 rounds, 1440px)**

```bash
node screenshot.mjs "http://localhost:3000/product.html?item=formal-jacket&fabric=vbc-wool&design=vbc-wool-grey-herringbone" jacket-pdp
node screenshot.mjs "http://localhost:3000/product.html?item=dress-pants&fabric=vbc-wool&design=vbc-wool-grey-herringbone" trouser-pdp
```

Then open each drawer via the customizer-flow screenshots (`temporary screenshots/cz-*`). `Read` the PNGs and confirm: flat list reads cleanly, title correct, footer price + "Add to Spec" intact, Suit drawer visually unchanged (still two headers). Fix any spacing/typography mismatch against the established drawer styling; re-screenshot. Do at least 2 rounds.

- [ ] **Step 4: Update PROJECT.md**

- §10: change "Customize Your Suit" framing → note Jacket + Trouser now customizable; update the "Extending to Jacket / Trouser later" subsection to past-tense "shipped" with the migration name `db/13_customization_jacket_pants.sql`.
- Backlog table row #1: mark Phase 4 extend as ✅ done with date.
- Phasing table Phase 4 row: mark complete.
- Update the top "Last session ended" banner to describe Phase 4 shipped.

- [ ] **Step 5: Commit**

```bash
git add PROJECT.md
git commit -m "docs(project): Phase 4 customization expansion shipped — Jacket + Trouser"
```

---

## Done-when (stop conditions)

1. `db/13_customization_jacket_pants.sql` applied; `test-customization-item-types.mjs` green (jacket 11 / pants 10, group-pure, one default each).
2. Jacket + Trouser PDPs show the Customize button with the correct per-garment label; Suit unchanged.
3. Drawer renders flat (no group header) for single-cut garments, dynamic title; Suit keeps its two headers.
4. `cart-page.js` merges the catalog index across all cart item types; mixed-cart spec renders every line's rows.
5. `test-customizer-flow.mjs` (Suit + Jacket + Trouser + mixed-cart) and the full regression suite pass.
6. Visual verification done (≥2 rounds); Suit drawer visually unchanged.
7. Bug-scan complete; any deferred bug logged in PROJECT.md §7.
8. PROJECT.md updated; branch merged to main per `superpowers:finishing-a-development-branch`.
