# Phase 4 — Customization Expansion (Jacket + Trouser) — Design

**Date:** 2026-07-15
**Backlog:** #1 (extend customization)
**Phase:** 4
**Status:** approved (design)

## Goal

The "Customize" drawer currently works only for `formal-suit-2-piece`. Extend it so a
standalone **Formal Jacket** (`formal-jacket`) and **Dress Pants / Trouser** (`dress-pants`)
PDP each expose a customizer, reusing the existing category/option catalogue with no new
categories, options, or SVGs.

The drawer machinery is already item-type-agnostic (catalog loads by `item_type_id`,
defaults are computed generically). Three places hard-code the "Suit" assumption, plus one
latent cart bug that this feature would expose:

1. **Schema** — `item_type_customization_categories` only links categories to
   `formal-suit-2-piece`.
2. **Button gating + label** — `js/product-page.js` shows the Customize button only when
   `item_type_id === 'formal-suit-2-piece'`; the label is the static "Customize Your Suit".
3. **Drawer copy/layout** — `js/customizer.js` hard-codes the title "Customize Your Suit"
   and always renders two group headers ("Jacket" + "Trouser").
4. **Cart catalog index (latent bug)** — `js/cart-page.js` builds `catalogIndex` from only
   the **first** cart line's item type. Harmless today (only Suits carry customizations, and
   a Suit's catalog already contains all jacket+pants options), but once a standalone Trouser
   can be line #1, a later Suit line would silently lose its jacket spec rows.

## Decisions (locked during brainstorming)

- **Category mapping:** reuse the full existing sets as-is — all 11 `group_name='jacket'`
  categories apply to `formal-jacket`; all 10 `group_name='pants'` categories apply to
  `dress-pants`. No curation, no new categories.
- **Single-cut drawer layout:** flat list, **no** group header. The title already names the
  garment. Suit keeps its two headers.
- **Approach A (data-driven, minimal):** no new schema columns, no extra PDP query. A single
  `CUSTOMIZABLE` map in `product-page.js` is the source of both "is customizable" and the
  friendly noun; the customizer decides headers purely from how many category groups are
  present.
- **Copy:** Trouser CTA/title reads "Customize Your **Trousers**" (plural). The Suit's
  internal group header stays the existing singular "Trouser".

## Components

### 1. Schema — `db/13_customization_jacket_pants.sql`

Idempotent migration applied via `scripts/run-sql.mjs`. Seeds the junction rows:

```sql
insert into item_type_customization_categories (item_type_id, category_id)
select 'formal-jacket', id from customization_categories where group_name = 'jacket'
on conflict do nothing;

insert into item_type_customization_categories (item_type_id, category_id)
select 'dress-pants', id from customization_categories where group_name = 'pants'
on conflict do nothing;
```

- Result: `v_customization_catalog` returns 11 categories for `formal-jacket`, 10 for
  `dress-pants`.
- **Guard note:** confirm the junction table's PK / unique constraint is
  `(item_type_id, category_id)` so `on conflict do nothing` is a no-op on re-run. If no such
  constraint backs it, use `where not exists (…)` instead. Verify before writing.

### 2. Button gating + label — `js/product-page.js`

Replace the `=== 'formal-suit-2-piece'` check with a single map — the one source of truth for
both gating and the friendly noun:

```js
const CUSTOMIZABLE = {
  'formal-suit-2-piece': 'Suit',
  'formal-jacket':       'Jacket',
  'dress-pants':         'Trousers',
};
```

- `crf:pdp-ready` handler: show the button when `item_type_id in CUSTOMIZABLE`, else hide and
  add the `is-single` row class (unchanged behaviour for non-customizable types).
- When shown, set the button text to `Customize Your ${noun}`.
- Pass `garment_noun: CUSTOMIZABLE[id]` into `openCustomizer({ … })`.

`product.html`'s static `id="customizeBtn"` label becomes a neutral default (JS overwrites it
when shown); the drawer `aria-label` on the `<aside>` is generalized from "Customize Your
Suit" to a neutral value (e.g. "Customize this garment").

### 3. Drawer — `js/customizer.js`

- **Title:** `Customize Your ${context.garment_noun || 'Garment'}` — drop the hard-coded
  "Suit". `openCustomizer` already spreads `context`, so `garment_noun` flows through.
- **Automatic group headers:** in `renderListView`, compute the distinct `category_group`
  values present in `visibleCategories()`.
  - `>1` group → render each group under its header ("Jacket", "Trouser"), as today.
  - `1` group → render rows flat, no header.
  - No `item_type_id` check anywhere in the customizer — it stays data-driven. Suit → 2
    headers (unchanged), Jacket/Trouser → flat list.
- **Monogram:** unchanged. `jacket-monogram` is in the jacket group, so it appears on the
  Jacket (and Suit) and is simply absent for Trousers.

### 4. Cart fix — `js/cart-page.js`

`render()` currently calls `loadCatalogIndex(cart.items[0].item_type_id)`. Change it to load
and **merge** the catalog index across every distinct `item_type_id` present in the cart:

- Refactor `loadCatalogIndex` to accept a list (or call it per distinct type, accumulating
  into the same `catalogIndex` object).
- Option IDs are globally unique across categories, so merging is a safe union.
- Result: a mixed cart (e.g. Trouser + Suit) renders all spec rows for every line.

## Data flow

PDP load → `product-page.js` reads `item_type_id` → looks up `CUSTOMIZABLE` → shows/hides
button + sets label → on click, lazy-imports `customizer.js` and calls `openCustomizer` with
`garment_noun` → drawer loads catalog for that `item_type_id` (11 / 10 / 21 categories) →
renders title from `garment_noun`, headers from group count → selections persist to the
localStorage cart via `cart.js` (unchanged shape) → `cart.html` renders the spec sheet using a
catalog index merged across all cart item types.

## Testing

- **`scripts/test-customization-item-types.mjs`** (new; Node + Supabase anon, no puppeteer):
  - `v_customization_catalog` returns 11 categories for `formal-jacket`, 10 for `dress-pants`.
  - Every returned category has ≥1 option and exactly one `is_default`.
  - `dress-pants` catalog contains no `jacket-*` category IDs (and vice-versa for group purity).
- **Extend `scripts/test-customizer-flow.mjs`** (puppeteer): drive a Jacket PDP and a Trouser
  PDP — button visible with the correct label, drawer opens with the correct title and a
  **flat list (no group header)**, select an option, Add to Spec, assert the cart line and
  spec rows render. Keep the existing Suit path (two headers) passing.
- **Mixed-cart spec test:** seed a cart with a Trouser line first + a Suit line; assert the
  Suit line's jacket spec rows still render (guards the §4 fix). May live in the extended
  customizer-flow test or a small dedicated script.
- **Regression:** `test-token-discipline`, `test-layout-mount`, `test-csp-compliance`
  (no new inline scripts — all edits are in existing `js/*` files), and the existing Suit
  customizer path.

## Visual verification

Screenshot at 1440px: Jacket drawer, Trouser drawer, and Suit drawer (must be visually
unchanged from before). No reference image — the single-cut drawer inherits the existing
drawer's craft; confirm the flat-list layout reads cleanly and matches established styling.
Two compare rounds per CLAUDE.md.

## Out of scope (YAGNI)

- No price deltas — all `price_delta_thb` remain 0 (all options included).
- No new categories, options, or SVGs.
- No tuxedo-only (`is_tuxedo_only`) enforcement.
- No checkout/orders changes — the server already re-resolves price per item type at checkout.
- No `book-appointment` spec decode.

## Files touched

| File | Change |
|---|---|
| `db/13_customization_jacket_pants.sql` | NEW — seed jacket→formal-jacket, pants→dress-pants junction rows |
| `js/product-page.js` | `CUSTOMIZABLE` map; data-driven gating + label; pass `garment_noun` |
| `js/customizer.js` | title from `garment_noun`; auto group headers (1 vs >1 group) |
| `js/cart-page.js` | merge catalog index across all cart item types |
| `product.html` | neutral default button label + drawer `aria-label` |
| `scripts/test-customization-item-types.mjs` | NEW — schema/catalog assertions |
| `scripts/test-customizer-flow.mjs` | extend — Jacket + Trouser paths + mixed-cart spec |
| `PROJECT.md` | update §10 + backlog #1 + phasing on completion |
