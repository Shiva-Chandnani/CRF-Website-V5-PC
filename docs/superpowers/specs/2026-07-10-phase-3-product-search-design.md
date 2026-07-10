# Phase 3 — Product Search (site-wide header + shop) — Design

**Date:** 2026-07-10
**Phase:** 3 (Discovery + SEO + Privacy hardening)
**Backlog items:** #3 (site-wide search, header) + #4 (shop page search + filters)
**Status:** Design approved — pending spec review → implementation plan

---

## 1. Goal

Give customers a fast, ranked, typo-tolerant way to find products by the terms
they actually type — fabric family (`"linen"`, `"wool"`), item type (`"suit"`,
`"jacket"`, `"trousers"`), pattern, color, brand, design name, or fabric number
(`"WL-1102"`). Two surfaces, one backend:

1. **Header search (site-wide, #3)** — a typeahead overlay reachable from every
   page's header search icon. Live ranked product results linking straight to the
   PDP, with a "See all results" hand-off to the shop grid.
2. **Shop search (#4)** — the existing `#searchInput` becomes real server-side
   ranked search, combined (AND) with the sidebar filter rail, and reads a `?q=`
   param so the header overlay can hand off into it.

**Scope is products only** (per brainstorm Q1). Static pages are out of scope for
search.

---

## 2. Requirements (locked in brainstorm)

| # | Decision | Value |
|---|----------|-------|
| Q1 | What search covers | **Products only** — but matching must span product *attributes* (fabric family, item type, pattern, color, brand, design name, fabric number), not just the display name |
| Q2 | Header UX | **Typeahead overlay** with live ranked results + "See all results →" row into the shop grid |
| Q3 | Shop search × filters | **Combined (AND)** — text query and sidebar filters both narrow the same set; `?q=` handoff prefills the box and runs on load |
| Q4 | Typo tolerance | **Prefix + fuzzy** — Postgres full-text prefix matching *plus* `pg_trgm` trigram similarity for misspellings |

---

## 3. Architecture

**Chosen approach: RPC over `v_products`.** A single Postgres function computes
the search vector on the fly from `v_products` columns and returns ranked rows.

Rationale: `v_products` is a 7-table join view. A maintained `tsvector` column
would require a denormalized/materialized copy kept in sync via triggers — real
overhead for a 105-row catalogue. At this size the function seq-scans in well
under a millisecond. No denormalization, no triggers, no sync path to break.

**Rejected alternatives:**
- *Materialized search table + generated `tsvector` + GIN trigram index* — the
  correct destination once the catalogue outgrows a per-call seq scan, but
  premature now (adds a sync mechanism). Documented as the migration path.
- *Pure client-side (Fuse.js)* — viable at 105 rows and free typo tolerance, but
  contradicts the locked "Postgres `tsvector` backend" decision and doesn't scale
  cleanly to ranked server results.

### 3.1 Data flow

```
Header search icon ─┐
                    ├─► quickSearch(q, limit=6) ──► rpc search_products(q) ──► top 6 ranked ──► overlay
                    │                                                                   └─► "See all" → /shop.html?q=
Shop page ──────────┘
  on load: read ?q= → run combined search
  on input (debounced): productSearch(q, activeFilters) ──► rpc search_products(q, …filters) ──► ranked grid
  empty q: existing filters-only path (plain filtered v_products select)
```

---

## 4. Database — `db/12_product_search.sql`

Idempotent migration, applied via `node scripts/run-sql.mjs db/12_product_search.sql`.

- `create extension if not exists pg_trgm;`
- Function:
  ```
  search_products(
    search_query      text,
    p_category_id     text default null,
    p_subcategory_id  text default null,
    p_fabric_type_id  text default null,
    p_pattern         text default null,
    p_color           text default null
  ) returns setof v_products
  language sql stable security invoker
  ```
- `grant execute on function search_products(...) to anon, authenticated;`

**Searchable text per row** — concatenation of these real `v_products` columns:
`display_name`, `item_type_name`, `fabric_brand`, `fabric_family`,
`fabric_type_name`, `design_name`, `fabric_number`, `pattern`,
`array_to_string(color, ' ')`, `item_occasion`.
(Note: `v_products` has no category *name* column — only `category_id` — and no
fabric composition column; `fabric_family` = `'wool'`/`'linen'` is what covers
those queries, and `item_type_name` covers `"suit"`/`"jacket"`.)

**Matching + ranking:**
- Build a **prefix** `tsquery` from the query terms (each term suffixed `:*`) over
  `to_tsvector('simple', <searchable text>)` — gives partial-word ("sui" → suit)
  and stemming-adjacent behavior. `'simple'` config (not `'english'`) to avoid
  over-stemming brand/design tokens and fabric numbers.
- Fuzzy fallback via `similarity(<searchable text>, search_query) > <threshold>`
  (threshold ~0.2, tuned during implementation) to catch misspellings
  ("wollen", "linnen").
- **Match** = `tsvector @@ prefix_tsquery OR similarity(...) > threshold`.
- **Order** = combined score `ts_rank(...) + similarity(...)` descending, then
  `display_name` as a stable tiebreak.
- Structured filter params, when non-null, AND with the text match. When
  `search_query` is blank/whitespace, the function returns filter-only results
  ordered by `display_name` (parity with today's `searchProducts`).

**Security:** `security invoker` + `stable`. `v_products` already grants public
`SELECT` to `anon`, so the function runs correctly as the caller with no
elevated privileges. No new RLS surface.

---

## 5. JS — `js/data-loader.js`

- **`productSearch(query, filters)`** — when `query` is non-empty, call
  `supabase.rpc('search_products', { search_query, p_category_id, … })`; when
  empty, use the existing filter query-builder path. Returns the same
  `v_products` row shape the shop grid already consumes (drop-in for
  `searchProducts`).
- **`quickSearch(query, limit = 6)`** — RPC with the query only (no filters),
  capped for the header overlay. Returns ranked rows with the fields the overlay
  needs (product_id, display_name, price, primary_photo_path / hero path).
- Keep `searchProducts` intact or fold it into `productSearch`'s empty-query
  branch — decided during implementation to minimize churn in `shop.html`.

---

## 6. Header overlay — `js/search-overlay.js` + styles in `css/base.css`

New browser-only module (the header is shared/global, so styles live in
`css/base.css`, not a page sheet).

- Mounts on `crf:layout-ready`; wires the existing header `[data-search-btn]`.
- Opens an accessible overlay:
  - Focus moves to the input; **focus trap** while open; `Esc` closes and returns
    focus to the trigger.
  - `aria-expanded` on the trigger; results rendered as an `aria` listbox
    (`role="listbox"` / `role="option"`), arrow-key navigable.
  - Backdrop click closes.
- Debounced input (~200ms) → `quickSearch` → renders top ~6 results
  (thumbnail + `display_name` + "from THB X,XXX"), each an `<a>` to its PDP
  (`/product.html?item=…&fabric=…&design=…`, matching the shop card's URL build).
- Footer row: **"See all results →"** → `/shop.html?q=<encoded query>`.
- Empty / no-match states styled (brand voice, e.g. "No pieces match …").
- No new external origins — Supabase `connect-src` is already in every page's CSP.

**Visual craft** (per CLAUDE.md anti-generic guardrails + `frontend-design`
skill, invoked at implementation): serif/sans pairing, stone accents, layered
overlay surface (backdrop → panel → result rows), `transform`/`opacity`-only
transitions, spring easing, full hover/focus-visible/active states.

---

## 7. Shop — `shop.html`

- On load: parse `?q=` from the URL, populate `#searchInput`, run the combined
  search before first render.
- Replace the current in-memory substring filter (`state.query` + client-side
  `renderGrid` filtering) with a debounced call to `productSearch(query,
  activeFilters)`.
- Sidebar filters continue to AND with the query; facet lists keep deriving from
  the returned result set (preserves today's behavior where facets reflect the
  active result set).
- Clearing the query restores filter-only browsing.

---

## 8. Testing

| Test | Kind | Covers |
|------|------|--------|
| `scripts/test-product-search.mjs` | node / RPC | prefix ("wool", "sui"), fuzzy ("wollen", "linnen"), fabric-number ("WL-1102"), item-type ("suit"), combined query+filter, blank query = filter-only, ranking order sanity |
| `scripts/test-search-overlay.mjs` | puppeteer | open/close, `Esc`, debounced live results, PDP link, "See all" → `shop.html?q=`, listbox a11y roles, no-match state |
| `scripts/test-shop-search.mjs` | puppeteer | `?q=` prefill + run on load, combined AND with a sidebar filter, clearing query restores browse |
| `scripts/test-csp-compliance.mjs` | puppeteer (extend) | header overlay adds zero CSP violations across the 14-page sweep |

Test scripts read `.env.local` manually (project convention — no `dotenv`).

---

## 9. Out of scope / deferred

- Static-page search, blog search, search analytics.
- Materialized search table + GIN trigram index — **documented migration path**
  for when `v_products` outgrows a per-call seq scan; not built now.
- Search on categories/subcategories as first-class result types (brainstorm
  chose products-only).

---

## 10. Scalability note (record in PROJECT.md at merge)

The `search_products` RPC seq-scans `v_products` per call — correct and instant at
~10² rows. When the catalogue grows large enough that this shows up in latency,
migrate to a materialized search table with a generated `tsvector` column and a
GIN trigram index, kept in sync via triggers on the base catalogue tables. The
JS/overlay/shop surfaces stay unchanged — only the RPC's internals swap.

---

## 11. Implementation plan shape (for writing-plans)

Three phased tasks (DB-outward), each independently verifiable:

1. **Backend + data-loader** — `db/12_product_search.sql` (TDD via
   `test-product-search.mjs`) + `productSearch`/`quickSearch` in
   `js/data-loader.js`.
2. **Header overlay** — `js/search-overlay.js` + `css/base.css` styles +
   `test-search-overlay.mjs` + CSP sweep extension. `frontend-design` skill first.
3. **Shop rewiring** — `shop.html` `?q=` + combined server search +
   `test-shop-search.mjs`.
