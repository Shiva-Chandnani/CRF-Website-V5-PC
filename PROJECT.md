# Country Road Fashions — Project Handoff

Single source of truth for a new chat session to pick up where the previous one left off. Pair this with [CLAUDE.md](CLAUDE.md) (frontend rules) for full context.

> **Last session ended** at: agentic workflow planned and approved for the 14-feature backlog. Codebase audit done. **New Phase 0 inserted** before Phase 1 to fix header/footer/CSS duplication across all 6 pages before adding 6+ more pages. Strategic decisions locked: Stripe full checkout = YES, Supabase Auth, worktree-per-feature isolation. Customizer V1 + cart V1 + VBC heroes all stable from prior sessions. **Git state**: only the initial commit exists — everything else uncommitted but stable.
>
> **What's next**: **Execute Phase 0 — shared layout refactor.** The full workflow methodology lives at `~/.claude/plans/just-to-revamp-the-agile-sundae.md` — read it first. Phase 0 detailed scope is documented in [§7 Open / next steps](#7-open--next-steps) below. The per-feature agentic cycle is: `superpowers:brainstorming` → `superpowers:writing-plans` → `superpowers:using-git-worktrees` → `superpowers:executing-plans` → `superpowers:verification-before-completion` → `superpowers:requesting-code-review` → `superpowers:finishing-a-development-branch`.

---

## 1. What this is

A static HTML/CSS/vanilla-JS website for **Country Road Fashions** — a Bangkok-based bespoke tailoring house (founded 1951). The site is backed by a **Supabase** project (`fzgsogdceptjvuahukbn`) that holds the product catalogue. No build step; runs locally on `localhost:3000` via [serve.mjs](serve.mjs).

---

## 2. Live pages

| URL | File | Purpose |
|---|---|---|
| `/` | [index.html](index.html) | Landing page (hero video, category tiles, editorial, footer) |
| `/shop.html` | [shop.html](shop.html) | Product browsing — left filter rail + 2-col grid. Cards group by `(item × fabric)` with design swatches that swap the photo on hover |
| `/product.html?item=...&fabric=...&design=...` | [product.html](product.html) | Product detail page — thumbnail rail (per-design heroes + fabric) + main image + design selector + size selects + **Customize Your Suit** button (suit only) + accordion |
| `/cart.html` | [cart.html](cart.html) | Cart page — lists line items with full customisation spec sheet; CTA passes spec into the consultation form |
| `/book-appointment.html` | [book-appointment.html](book-appointment.html) | In-person / online consultation booking (Calendly embed placeholders) |
| `/in-store.html` | [in-store.html](in-store.html) | Bangkok atelier, trunk shows, virtual consultation info |

Start dev server: `node serve.mjs` (port 3000). Don't start a second instance if already running.

---

## 3. Supabase project

- URL: `https://fzgsogdceptjvuahukbn.supabase.co`
- Region: `ap-southeast-1` (Singapore)
- Credentials all in [.env.local](.env.local) (gitignored). The user has shared:
  - `SUPABASE_ANON_KEY` — public read, used in [js/data-loader.js](js/data-loader.js)
  - `SUPABASE_SERVICE_ROLE_KEY` — for writing data + uploading to Storage via REST
  - `PGHOST` / `PGPORT` / `PGDATABASE` / `PGUSER` / `PGPASSWORD` — direct Postgres access via the pooler (used by `scripts/run-sql.mjs` for DDL)

### Schema (12 tables + 2 views)

See [db/schema.sql](db/schema.sql) for the canonical definition, plus the migration files in [db/](db/) for everything added since. High-level:

```
categories ─ subcategories ─ item_types ┐
                                        ├─ item_type_fabrics ── fabric_types ── fabric_designs ── fabric_design_photos
                                        │  (junction; holds PRICE + (item × fabric) hero paths)         (one row per
                                        │                                                                fabric closeup
                                        │                                                                + per-design heroes;
                                        │                                                                photo_type col)
                                        └── item_type_photos (lookbook per cut, currently unused)

fabric_design_price_overrides — rare per-(item,design) overrides

Customization (see §10):
  customization_categories ─ customization_options
                          └─ item_type_customization_categories (junction)

v_products              — view; one row per (item × design) with resolved price + all photo paths + design_hero_paths[]
v_customization_catalog — view; one row per (item × category × option) for the drawer
```

**Key conventions**
- IDs are slugs (`formal-suit-2-piece`, `cavani-wool`, `cavani-wool-navy-pinstripe`).
- `fabric_number` is globally unique with family-prefix: `WL-####` wool, `LN-####` linen, `CT-####` cotton, `SLK-####` silk, `TWD-####` tweed, `BLD-####` blends. Enforced by a regex CHECK constraint.
- Price lives on `item_type_fabrics(item_type_id, fabric_type_id) → price`. All designs under the same fabric type inherit that price by default. Per-design overrides go in `fabric_design_price_overrides`.
- Hero photo paths live on `item_type_fabrics.hero_image_path` and `.hero_image_hover_path` (added in the [hero migration](db/migration-hero-photos.sql)). The shop card uses these to override the default fabric-design photo and swap on hover. Nullable — most rows leave them null.
- RLS: public `SELECT` for browsing, `authenticated` (i.e. logged-in) for writes.

### Current catalogue state

| Table | Rows |
|---|---|
| `categories` | 7 (Suits, Shirts, Pants, Coats, Jackets & Blazers, Mandarin Collar, Accessories) |
| `subcategories` | 22 |
| `item_types` | 3 active: `formal-suit-2-piece`, `formal-jacket`, `dress-pants` |
| `fabric_types` | 2: **Cavani Wool** (`cavani-wool`) and **Vitale Barberis Canonico Wool** (`vbc-wool`). Both all-season. |
| `item_type_fabrics` | 6 rows. Cavani: Suit 15,000 / Jacket 10,500 / Trouser 4,500 (THB). VBC: Suit 20,000 / Jacket 14,000 / Trouser 6,000 (THB). Hero paths set on both Suit rows. |
| `fabric_designs` | 35 — Cavani `WL-1102…WL-1128` (26) + VBC `WL-1129…WL-1137` (9). |
| `fabric_design_photos` | 53 — 35 fabric closeups (`photo_type='fabric'`, `is_primary=true`, at `crf-fabrics/{fabric_number}/01.jpg`) **plus** 18 VBC per-design model photos (`photo_type='hero'`, at `crf-fabrics/{fabric_number}/hero-01.png` and `hero-02.png`). New column `photo_type` added by `db/migration-design-hero-photos.sql`. |
| `v_products` | **105** (35 designs × 3 item types). |
| `customization_categories` | 21 (11 jacket + 10 pants) — V1 catalogue applied to Suit only. |
| `customization_options` | 65 — every option has a placeholder SVG under `assets/customization/svg/`. |
| `item_type_customization_categories` | 21 — every category linked to `formal-suit-2-piece`. |
| `v_customization_catalog` | view: `(item_type, category, option)` resolved + ordered for the drawer. |

### Storage

Two public buckets:

| Bucket | Layout | Notes |
|---|---|---|
| `crf-fabrics` | `{fabric_number}/01.jpg` — fabric closeup; `{fabric_number}/hero-01.png` + `hero-02.png` — per-design model photos (VBC only so far) | Flat. All 18 VBC design heroes padded to aspect 1054/1656 by [scripts/pad-vbc-design-heroes.mjs](scripts/pad-vbc-design-heroes.mjs). |
| `crf-products` | `hero/{item_type_id}__{fabric_type_id}/01.png` and `02.png` | (item × fabric) hero photos — used by the shop card. Populated for `formal-suit-2-piece__cavani-wool/` and `formal-suit-2-piece__vbc-wool/`. |

---

## 4. Local project layout

```
/
├── index.html, shop.html, product.html, book-appointment.html, in-store.html, cart.html
├── serve.mjs                     # localhost:3000 dev server (vanilla node http)
├── screenshot.mjs                # puppeteer screenshot → temporary screenshots/screenshot-N[-label].png
├── package.json                  # deps: puppeteer, pg
├── .env.local                    # gitignored — Supabase URL + anon + service_role + PG* vars
├── .gitignore                    # excludes node_modules, .env*, .DS_Store, .claude/, temporary screenshots/
│
├── js/
│   ├── data-loader.js            # @supabase/supabase-js client + getCategories / fabricImageUrl / productImageUrl
│   ├── cart.js                   # localStorage cart (`crf.cart.v1`) — CRUD + header-badge updater, auto-mounts
│   ├── customizer.js             # "Customize Your Suit" drawer — list/detail views, monogram special-case, lazy-loaded on first click
│   └── schema.d.ts               # TypeScript types matching the schema (IDE only; not auto-generated)
│
├── assets/customization/svg/     # 65 placeholder line-art SVGs (one per customization option)
│
├── db/
│   ├── schema.sql                # historical canonical schema (DO NOT rerun — see §8)
│   ├── seed.sql                  # historical Cavani seed (3 designs)
│   ├── migration-hero-photos.sql        # +hero_image_path on item_type_fabrics; recreate v_products
│   ├── migration-vbc-wool.sql           # +VBC fabric type + 3 item_type_fabrics rows
│   ├── migration-vbc-hero.sql           # wire item × fabric hero paths for VBC Suit
│   ├── migration-customization-schema.sql      # 3 new tables + v_customization_catalog view + RLS
│   ├── migration-customization-seed-suit.sql   # 21 categories + 65 options + 21 junction rows
│   ├── migration-design-hero-photos.sql        # +photo_type column on fabric_design_photos; recreate v_products w/ design_hero_paths
│   └── README.md                 # initial Supabase setup guide (one-time onboarding)
│
├── scripts/
│   ├── run-sql.mjs                          # run any SQL file against the pooler (use for migrations)
│   ├── upload-cavani-batch.mjs              # one-shot: 23 Cavani designs + photos + photo rows
│   ├── upload-cavani-hero.mjs               # one-shot: 2 Cavani Suit hero photos
│   ├── pad-hero-photos.mjs                  # one-shot: pad Cavani heroes
│   ├── upload-vbc-batch.mjs                 # one-shot: 9 VBC designs + photos + photo rows
│   ├── pad-vbc-hero-photos.mjs              # one-shot: pad VBC item × fabric heroes
│   ├── upload-vbc-design-heroes.mjs         # one-shot: 18 VBC per-design hero PNGs + photo rows
│   ├── pad-vbc-design-heroes.mjs            # one-shot: pad all 18 per-design heroes to 1054/1656 + re-upload
│   ├── generate-customization-svgs.mjs      # one-shot: emit 65 placeholder SVGs into assets/customization/svg/
│   ├── test-customizer-flow.mjs             # puppeteer smoke test: open drawer → select option → add to cart → cart.html
│   ├── test-design-hero-rail.mjs            # puppeteer smoke test: rail renders 3 thumbs + swaps on design change
│   └── test-swatch-prefers-hero.mjs         # puppeteer smoke test: swatch click → main image = hero #2
│
├── brand_assets/
│   ├── CRF Logo.png
│   ├── crf_brand_guidelines.png
│   └── country_road_fashions_business_brand_summary.md
│
├── Cavani Designs/                          # source photos for Cavani Wool (3 originals + 23 batch + 2 hero)
│   ├── Cavani - *.jpg
│   └── Cavani Hero photos/
│       ├── *.png  (originals: 1054×1492 / 1093×1439)
│       └── padded/  (Storage versions: 1054×1656 / 1093×1598)
│
├── Vitale Barberis Canonico/                # source photos for VBC Wool
│   ├── VBC - *.jpg                          # 9 fabric closeups (already uploaded)
│   ├── VBC hero photos/                     # original (item × fabric) heroes
│   │   ├── VBC - hero photo 1.png  (1054×1492)
│   │   ├── VBC hero photo 2.png    (1086×1448)
│   │   └── padded/                          # Storage versions
│   └── new hero photos/                     # per-design heroes (9 designs × 2 each = 18)
│       ├── VBC - {Design Name} - hero {01|02}.png
│       └── padded/                          # padded to 1054/1656 aspect, uploaded to crf-fabrics/WL-####/hero-{01,02}.png
│
├── temporary screenshots/        # gitignored, regenerable — many in here from puppeteer flows
├── AdobeStock_469157216.mov      # hero video used on index.html
└── CLAUDE.md                     # frontend rules (always-loaded)
```

---

## 5. Common workflows

### Add a new fabric type (e.g. Loro Piana Linen)
1. `INSERT INTO fabric_types (id, brand, family, composition, origin, season, display_order) VALUES (...)`.
2. `INSERT INTO item_type_fabrics` — one row per item type it's offered in, with the price.
3. Add designs (next workflow) and uploads.

### Add new fabric designs to an existing fabric type
1. Place photos in a folder.
2. Adapt `scripts/upload-cavani-batch.mjs` — change `DESIGNS` array and `PHOTO_DIR`. Re-run.
3. Or do it by hand: SQL insert into `fabric_designs`, upload photos to `crf-fabrics/{fabric_number}/01.jpg`, SQL insert into `fabric_design_photos`.

### Add hero photos to another `(item × fabric)` combo
1. Re-process photos with `scripts/pad-hero-photos.mjs` to add breathing room (or use bare photos if the source already has margin).
2. Upload to `crf-products/hero/{item_type_id}__{fabric_type_id}/01.png` (default) and `02.png` (hover).
3. `UPDATE item_type_fabrics SET hero_image_path = '...', hero_image_hover_path = '...' WHERE item_type_id = '...' AND fabric_type_id = '...';`
4. The shop card will pick up the hero photo automatically; on the PDP, both heroes appear as the first two thumbnails in the left rail.
5. If the photo aspect ratio differs significantly from `1054 / 1656`, you may want a per-card aspect-ratio override in [shop.html](shop.html) under the `.product-card.has-hero` rule.

### Run any schema change / SQL migration
```bash
# Write the SQL to db/<name>.sql, then:
node scripts/run-sql.mjs db/<name>.sql
```
This connects directly to the Postgres pooler with the credentials in `.env.local`. The user explicitly chose this workflow over manual SQL-Editor pastes — use it.

### Take a screenshot
```bash
node serve.mjs &                          # if not already running
node screenshot.mjs http://localhost:3000/shop.html [label]
# → temporary screenshots/screenshot-N[-label].png
```
Then `Read` the PNG to view it.

---

## 6. Recent design decisions worth keeping

- **Card grouping**: shop cards represent `(item_type × fabric_type)` (e.g. "The Cavani Wool Suit"), not individual designs. Designs are shown as small fabric-swatch thumbnails under the card; hover swaps the photo, click navigates to the PDP with that design pre-selected. See [shop.html:groupForCards](shop.html#L852).
- **Hero photo behaviour**: on shop cards that have item × fabric hero paths (`item_type_fabrics.hero_image_path`), default = hero #1 (full body), hovering the image swaps to hero #2 (closeup). Hovering a design swatch still overrides with that design's fabric photo. Leaving the image area reverts to hero #1. See [shop.html:wireSwatchInteractions](shop.html#L944).
- **PDP rail is per-design**: the left thumb rail shows the currently-selected design's hero photos (`design_hero_paths[]` from `v_products`) followed by the design's fabric closeup. Selecting a different design via the swatch grid re-renders the rail. Currently populated for VBC designs only — Cavani PDPs show just the fabric thumb because no Cavani per-design heroes exist yet. See [product.html:renderThumbRail](product.html#L989).
- **Swatch click defaults to hero #2** (closeup): when the customer clicks a design swatch in the right panel, `selectDesign(designId, { preferHero: true })` swaps the main image to that design's `design_hero_paths[1]` (the close-up model shot) and marks the hero #2 thumb active. Falls back to hero #1 if only one exists, then to the fabric photo. Clicking the fabric thumb in the left rail directly still shows the fabric closeup as before. See [product.html:selectDesign](product.html#L1100).
- **Hero card aspect ratio**: cards with hero photos use `aspect-ratio: 1054 / 1656` (the padded model photo's true ratio) — no letterbox, no crop. Other cards stay at 4:5. See `.product-card.has-hero .img-wrap`.
- **Hero photos are padded at the file level**, not via CSS. The original photos had the model touching top/bottom edges; `scripts/pad-hero-photos.mjs` extends the canvas and replicates the edge rows (so the studio backdrop gradient continues seamlessly into the new margin).
- **Pricing language**: "from THB X,XXX", "Reserve Consultation", "Bespoke Make" — bespoke vocabulary, not retail.
- **Visual identity**: Cormorant Garamond serif (display) + Raleway sans (body). Palette: jet `#0E0F11`, charcoal, stone `#B6ADA5` (warm accent), off-white, cream. Italic emphasis on key serif words with a stone-coloured hairline under them (e.g. "The *Bespoke* Collection", "The *Cavani Wool* Suit").

---

## 7. Open / next steps — 14-feature backlog + agentic workflow

The full workflow methodology lives at **`~/.claude/plans/just-to-revamp-the-agile-sundae.md`** — read it first. Summary below.

### Per-feature agentic cycle (the unit of work)

Every feature in every phase follows the same skill sequence:

```
1. superpowers:brainstorming                  → clarify intent + acceptance criteria
2. superpowers:writing-plans                  → plan file under .claude/plans/
3. superpowers:using-git-worktrees            → isolated worktree + branch (one per feature)
4. frontend-design:frontend-design            → (UI-heavy features only) high-craft start
5. superpowers:executing-plans                → drive implementation in a separate session
   ├─ superpowers:test-driven-development for any logic
   └─ superpowers:subagent-driven-development for plans with parallel steps
6. superpowers:verification-before-completion → smoke tests + screenshot diff
7. superpowers:requesting-code-review         → coherence check against shared spine
8. superpowers:finishing-a-development-branch → merge to main when stop conditions pass
9. superpowers:systematic-debugging           → only when stuck
```

A **phase** is a sequence of these units. Phase ends when all its features are merged to main and per-phase verification gates pass.

### Backlog (14 features)

| # | Feature | Phase | Status |
|---|---|---|---|
| 1 | Customization for Suit | 4 (extend to Jacket/Trouser) | ✅ V1 done |
| 2 | Add items to cart | 2 (server-side cart dual-mode) | ✅ V1 localStorage done |
| 3 | Site-wide search (header) | 3 | ⬜ |
| 4 | Shop page filters + search | 3 | ⬜ (basic input exists in shop.html) |
| 5 | Customer login + profile (email/password + Google) | 1 | ⬜ |
| 6 | Measurements capture | 1 (schema) + 2 (UX) | ⬜ |
| 7 | Stripe checkout + payment page | 2 | ⬜ **confirmed: full Stripe** |
| 8 | Admin dashboard (analytics + customers) | 5 | ⬜ |
| 9 | CRM sync | 5 | ⬜ |
| 10 | Professional polish | Continuous | ⬜ |
| 11 | SEO optimisation | 3 baseline + continuous | ⬜ |
| 12 | Blog (SEO content) | 6 | ⬜ |
| 13 | Newsletter signup + opt-in | **0 (capture wiring)** + 6 (campaigns) | ⬜ |
| 14 | Privacy page + security baseline | 1 (draft + CSP baseline) + 3 (CSP hardening + RLS audit) | ⬜ |

### Strategic decisions — locked

| Decision | Confirmed value |
|---|---|
| **Phase 0 shared-layout refactor before Phase 1** | YES — required to prevent compounding duplication across 6+ new pages |
| **Online payments via Stripe** | YES — full checkout, orders + payments tables, webhook handler |
| **Auth provider** | Supabase Auth (email/password + Google OAuth) |
| **Newsletter V0** | Capture-only into Supabase `newsletter_subscribers`; ESP provider deferred to Phase 6 |
| **Branching model** | One git worktree per feature via `superpowers:using-git-worktrees` |
| CRM platform | defer to Phase 5 start |
| Blog authoring surface | defer to Phase 6 start |
| Search backend | start with Postgres `tsvector` in Phase 3 |

### Phasing (post-revision)

| Phase | Goal | Items | Notes |
|---|---|---|---|
| **0 — Foundation Refactor** | One shared spine for every page | Shared header/footer, `css/base.css`, normalized `.btn` system, meta scaffold, newsletter capture table + footer-form wiring (item 13 capture half) | **EXECUTE NEXT.** ~1 session. Detailed spec below. |
| 1 — Identity & Personal Data | Customers exist; we capture them | 5, 6 (schema), 14 (privacy page draft + CSP baseline) | Strict prereq for everything personal. |
| 2 — Commerce | Real cart + paid orders | 2 (cart dual-mode upgrade), 6 (UX during checkout), 7 (Stripe) | Depends on Phase 1. |
| 3 — Discovery + SEO + Privacy hardening | Findability + production-ready security | 3, 4, 11, 14 (CSP tighten + RLS audit) | Many parallel streams. |
| 4 — Customization expansion | Jacket + Trouser drawers | 1 (extend) | Half session. Schema already supports it (see §10). |
| 5 — Operations | Admin + CRM | 8, 9 | Needs real data flowing. |
| 6 — Marketing | Content + email | 12, 13 (full double-opt-in + ESP), 10 (final polish pass) | Last because earlier phases generate the audience. |
| Continuous | Polish + SEO check per PR | 10, 11 | Every feature PR closes with frontend-design pass + meta-tags check. |

### Phase 0 — Detailed spec (execute next session)

**Goal:** every existing page renders identical, shared header + footer; all styling lives in `css/base.css` + a thin per-page sheet; newsletter form actually writes to Supabase.

**Files created:**
- `components/header.html`, `components/footer.html` — single source of truth markup
- `css/base.css` — locks tokens (`--color-jet`, `--color-stone`, etc.) + typography ramp + `.btn` system (`.btn--primary`, `.btn--dark`, `.btn--ghost`) + form controls + reset + announcement bar + footer + header
- `js/layout.js` — `fetch`-injects components into `<div data-layout="header">` / `<div data-layout="footer">` on `DOMContentLoaded`
- `js/meta.js` — `setMeta({title, description, canonical, ogImage, jsonLd})` skeleton (no-op until Phase 3)
- `js/newsletter.js` — footer form → INSERT into `newsletter_subscribers`. UPSERT-safe.
- `db/07_newsletter_subscribers.sql` migration: `(email pk, profile_id nullable, source, opted_in_at, unsubscribed_at, created_at)` — anonymous INSERT-only via RLS, no anonymous SELECT
- `scripts/test-layout-mount.mjs` — puppeteer smoke: header+footer mount on all 6 pages, console clean

**Files modified (all 6 existing pages):**
- [index.html](index.html), [shop.html](shop.html), [product.html](product.html), [cart.html](cart.html), [book-appointment.html](book-appointment.html), [in-store.html](in-store.html):
  - Replace inline `<header>` markup with `<div data-layout="header"></div>`
  - Replace inline `<footer>` markup with `<div data-layout="footer"></div>`
  - Remove duplicated tokens/buttons/reset from `<style>`; `<link rel="stylesheet" href="css/base.css">` instead (keep page-specific styles)
  - Add `<script type="module" src="js/layout.js"></script>` and `<script type="module" src="js/newsletter.js"></script>`

**Reusable code to honor (do NOT rewrite):**
- [js/cart.js](js/cart.js) — keep as-is; Phase 2 upgrades it to dual-mode
- [js/customizer.js](js/customizer.js) — keep as-is; Phase 4 extends to Jacket/Trouser
- [js/data-loader.js](js/data-loader.js) — Supabase client pattern; reuse for `js/newsletter.js`
- [scripts/run-sql.mjs](scripts/run-sql.mjs) — every migration goes through this
- [css/mega-menu.css](css/mega-menu.css) — fold into `css/base.css` or keep separate; decide during execution

**Phase 0 stop conditions (both gates green):**
1. All 6 existing pages render visually identical to pre-refactor screenshots (diff via `temporary screenshots/phase-0/` at 1440 and 375 widths).
2. `scripts/test-layout-mount.mjs` passes.
3. All prior tests still pass: `test-customizer-flow.mjs`, `test-design-hero-rail.mjs`, `test-swatch-prefers-hero.mjs`.
4. Footer newsletter form submits → row appears in `newsletter_subscribers`.
5. No `.btn-primary` / `.btn-dark` / hardcoded `#000` drift remaining (all CTAs use `.btn--*` from base.css; all greys reference tokens).
6. PROJECT.md updated with Phase 0 shipped inventory.
7. Committed to main with a clear "Phase 0: shared layout + design system lock" commit.

### Phase 1 — Spec carryover (for reference; execute after Phase 0)

**Goal:** customer accounts + measurements schema + privacy baseline.

**New tables (all RLS-scoped to `auth.uid()`):**
- `profiles(id uuid pk → auth.users, full_name, phone, role default 'customer' enum customer|staff|admin, opted_in_newsletter bool, marketing_consent_at, …)` — trigger on `auth.users` insert auto-creates a `profiles` row (`handle_new_user()`)
- `customer_measurements(id, customer_id → profiles, chest_in, waist_in, hip_in, neck_in, shoulder_in, sleeve_in, jacket_length_in, trouser_waist_in, trouser_inseam_in, trouser_outseam_in, thigh_in, knee_in, height_cm, weight_kg, fit_preferences jsonb, notes, captured_at, updated_at)`

**New JS modules:**
- `js/auth.js` — Supabase Auth wrapper: `signUp / signInWithPassword / signInWithGoogle / signOut / getSession / onAuthChange`. Updates header Account icon on every page based on session state (the shared header from Phase 0 has the hook).
- `js/profile.js` — profile + measurements CRUD on `account.html`.

**New pages:**
- `signup.html` — email/password + full name + Google OAuth + newsletter opt-in checkbox (writes to `newsletter_subscribers` via the Phase 0 helper).
- `login.html` — email/password + Google OAuth + forgot-password link.
- `account.html` — logged-in profile view: name + phone + measurements form + newsletter toggle + sign-out.
- `privacy.html` — privacy notice: what we collect, why, retention, third parties, cookies, data-request contact. Editorial register.

**Modifications to shared header/footer (from Phase 0):**
1. Header Account icon: smart link to `/login.html` if signed out, `/account.html` if signed in. `data-account-link` so `auth.js` can flip href on auth state change.
2. Footer: Privacy link added (form already wired in Phase 0).
3. CSP meta tag tightened: add Supabase + Google OAuth domains.
4. On signed-in pages, `cart.html` + `book-appointment.html` pre-fill name/email from profile.

**Privacy / security baseline (item #14 draft):**
- Privacy policy page draft listing every data category, sub-processors (Supabase, Stripe in Phase 2), retention, deletion process.
- Document third-party CDNs: Google Fonts, `esm.sh/@supabase/supabase-js`.
- No cookies set today (localStorage only). After auth ships, Supabase sets *necessary* auth cookies — GDPR/PDPA does **not** require a consent banner for strictly necessary cookies. No banner in V1. Revisit when adding analytics.

**Verification (Phase 1 stop conditions):**
- New user can sign up with email/password OR Google → profile row created → newsletter row created if opted in.
- Logged-in user can view + edit profile + measurements on `/account.html`.
- Logged-in user's name appears on cart + book-appointment pages.
- `/privacy.html` accessible from every page footer.
- `test-auth-roundtrip.mjs` + `test-profile-rls.mjs` pass.
- All Phase 0 tests still pass.

### Smaller carryover from prior sessions

- The `item_type_photos` table exists but is unused — intended for per-item-type lookbook independent of fabric.
- `js/schema.d.ts` types do not include `hero_image_path` / `hero_image_hover_path` / `design_hero_paths` / customization tables — update if a TS user wants strong typing.
- Cart-to-consultation handoff: `cart.html` "Reserve Consultation" CTA appends `?spec={base64(cart JSON)}` to the book-appointment URL. The book-appointment page does not yet decode this — wiring it to display the spec on the consultation form is a small follow-up.
- Customize button visibility is hard-coded to `formal-suit-2-piece` in [product.html](product.html). Phase 4 (Jacket/Trouser drawers) needs to broaden this check + update drawer copy per item type.
- Loro Piana / Cavani-Linen / other fabric onboarding workflow is documented in §5; tractable any time.

---

## 8. Things to avoid

- **Don't recreate the schema from `db/seed.sql` or `db/schema.sql`** — those are historical. The live DB has migrations beyond them (hero columns, the 23 extra designs). Always read live state via the REST API or `run-sql.mjs` before assuming.
- **Don't write to `fabric_design_photos` for an item that doesn't have a corresponding `fabric_design` row** — FK will reject.
- **Don't put fabric_number in the path with spaces or special chars** — DB stores `'WL-1102/01.jpg'` as plain text, and the regex constraint enforces `^(WL|LN|CT|SLK|TWD|BLD)-[0-9]{4,}$`.
- **Don't try to run DDL via the REST API** — PostgREST only does CRUD. Use `scripts/run-sql.mjs`.
- **Don't commit `.env.local`** — it's gitignored; double-check before any `git add`.

---

## 9. Quick verification

After picking up a new session, run these to confirm everything is healthy:

```bash
# 0. Server up
node serve.mjs &                                                  # if not already running
curl -s -o /dev/null -w "homepage: %{http_code}\n" http://localhost:3000          # 200

# 1. Catalogue health
ANON=$(grep SUPABASE_ANON_KEY .env.local | cut -d= -f2-)
curl -s "https://fzgsogdceptjvuahukbn.supabase.co/rest/v1/v_products?select=product_id" \
  -H "apikey: $ANON" \
  | python3 -c "import sys,json; print('products:', len(json.load(sys.stdin)))"   # 105

# 2. Customization catalogue
curl -s "https://fzgsogdceptjvuahukbn.supabase.co/rest/v1/v_customization_catalog?item_type_id=eq.formal-suit-2-piece&select=category_id,option_id" \
  -H "apikey: $ANON" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print('cats:', len({r['category_id'] for r in d})); print('opts:', len(d))"
# expect: cats: 21, opts: 65

# 3. Per-design hero photos (sample)
curl -s "https://fzgsogdceptjvuahukbn.supabase.co/rest/v1/v_products?fabric_design_id=eq.vbc-wool-grey-herringbone&item_type_id=eq.formal-suit-2-piece&select=design_hero_paths" \
  -H "apikey: $ANON"
# expect: [{"design_hero_paths":["WL-1129/hero-01.png","WL-1129/hero-02.png"]}]

# 4. Storage smoke (one of each kind)
for url in \
  "https://fzgsogdceptjvuahukbn.supabase.co/storage/v1/object/public/crf-fabrics/WL-1129/01.jpg" \
  "https://fzgsogdceptjvuahukbn.supabase.co/storage/v1/object/public/crf-fabrics/WL-1129/hero-01.png" \
  "https://fzgsogdceptjvuahukbn.supabase.co/storage/v1/object/public/crf-products/hero/formal-suit-2-piece__cavani-wool/01.png" \
  "https://fzgsogdceptjvuahukbn.supabase.co/storage/v1/object/public/crf-products/hero/formal-suit-2-piece__vbc-wool/01.png" \
; do curl -s -o /dev/null -w "$(basename "$url") %{http_code}\n" "$url"; done
# all 200

# 5. End-to-end UI smoke tests (puppeteer)
node scripts/test-customizer-flow.mjs       # drawer → add to cart → cart.html
node scripts/test-design-hero-rail.mjs      # rail renders 3 thumbs + swaps on design change
node scripts/test-swatch-prefers-hero.mjs   # swatch click → main = hero #2

# 6. Visual sanity
node screenshot.mjs http://localhost:3000/shop.html state
node screenshot.mjs "http://localhost:3000/product.html?item=formal-suit-2-piece&fabric=vbc-wool&design=vbc-wool-grey-herringbone" pdp
# shop: 6 cards (3 Cavani + 3 VBC); both Suit cards show model photo
# pdp:  left rail = 2 model thumbs + 1 fabric thumb; "Customize Your Suit" + "Reserve Consultation" CTAs
```

---

## 10. Customization drawer + cart

The PDP renders a **"Customize Your Suit"** drawer for `formal-suit-2-piece` products. Selections are stored in a localStorage cart (`crf.cart.v1`) and previewed on [cart.html](cart.html). No backend cart yet — V1 is anonymous, browser-local.

### Schema (V1 — Suit only)

| Table / view | Rows | Purpose |
|---|---|---|
| `customization_categories` | 21 | The buckets the customer chooses across (Lapel, Vent, Pleats, …). `is_advanced` rows hide under "Show Additional Options". `is_tuxedo_only` is set but not yet enforced. |
| `customization_options` | 65 | Each variant (Notch, Peak, Shawl, …). One default per category enforced by partial unique index. `price_delta_thb` defaults to 0 (V1 — all included). |
| `item_type_customization_categories` | 21 | Junction: which categories apply to which item type. V1 = every category for Suit. |
| `v_customization_catalog` | view | `(item_type, category, option)` joined + sortable. The drawer fetches this once per PDP load. |

### Files

```
/
├── cart.html                            # The cart page
├── js/
│   ├── cart.js                          # localStorage CRUD + header-badge updater. Auto-mounts.
│   └── customizer.js                    # Drawer state machine; lazy-loaded on first Customize click.
├── assets/customization/svg/            # 65 placeholder line-art SVGs (one per option, named {option_id}.svg)
├── db/
│   ├── migration-customization-schema.sql       # 3 tables + view + RLS
│   └── migration-customization-seed-suit.sql    # 21 cats + 65 options + 21 junction rows
└── scripts/
    └── generate-customization-svgs.mjs  # one-shot SVG generator (re-run to refresh placeholders)
```

### Cart shape (localStorage `crf.cart.v1`)

```js
{
  items: [
    {
      id: 'crfln_xyz',
      item_type_id: 'formal-suit-2-piece',
      fabric_design_id: 'vbc-wool-grey-herringbone',
      price_thb: 20000,
      qty: 1,
      customizations: { 'jacket-lapel': 'jacket-lapel-notch', /* … */ },
      added_at: '2026-05-28T...'
    }
  ],
  updated_at: '…'
}
```

### Add a new customization option

```sql
insert into customization_options
  (id, category_id, name, description, svg_path, is_default, display_order)
values
  ('jacket-buttons-mother-of-pearl', 'jacket-buttons', 'Mother of Pearl',
   'Iridescent natural shell. Best on dressy fabrics.',
   'assets/customization/svg/jacket-buttons-mother-of-pearl.svg',
   false, 60);
```
Then add the matching SVG entry to `scripts/generate-customization-svgs.mjs` and re-run it. (Or write the SVG by hand at the same path.)

### Add a new category

```sql
insert into customization_categories
  (id, name, group_name, display_order, is_advanced, description) values
  ('jacket-pocket-square', 'Pocket Square', 'jacket', 75, true, 'Optional silk pocket square in the chest pocket.');

-- Make it apply to the Suit
insert into item_type_customization_categories (item_type_id, category_id)
values ('formal-suit-2-piece', 'jacket-pocket-square');

-- Insert the options under it (don't forget exactly one is_default=true).
```

### Extending to Jacket / Trouser later

The 11 jacket categories make sense for `formal-jacket`; the 10 pants categories for `dress-pants`. To enable:

```sql
insert into item_type_customization_categories (item_type_id, category_id)
select 'formal-jacket', id from customization_categories where group_name = 'jacket';

insert into item_type_customization_categories (item_type_id, category_id)
select 'dress-pants', id from customization_categories where group_name = 'pants';
```
Then in [product.html](product.html), broaden the visibility check around `crf:pdp-ready` to enable the Customize button for those item types too (currently hard-coded to `formal-suit-2-piece`). The drawer copy ("Customize Your Suit") should be updated per item type at that point.

### Things to know

- The drawer is a fixed-position `<aside>` overlaying the right ~530px of the PDP. The main image stays visible behind it. No layout collapse (kept simpler than the Proper Cloth pattern).
- Monogram is a special category: when "Add Monogram" is selected, the detail panel reveals a text input (max 3 letters) and a 5-thread-color picker. The thread colours are **hardcoded in `js/customizer.js`** (V1), not in the DB. They serialize into the cart as `customizations['jacket-monogram-text']` and `customizations['jacket-monogram-thread']`.
- The cart-to-consultation handoff: from `cart.html` the **Reserve Consultation** CTA appends `?spec={base64(cart JSON)}` to the book-appointment URL. The book-appointment page does not yet decode this — wiring it to display the spec on the consultation form is the next obvious step.
