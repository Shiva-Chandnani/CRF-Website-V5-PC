# Country Road Fashions — Project Handoff

Single source of truth for a new chat session to pick up where the previous one left off. Pair this with [CLAUDE.md](CLAUDE.md) (frontend rules) for full context.

> **Last session ended** at: **🛒 PHASE 2 — cart dual-mode SHIPPED** on branch `phase-2/cart-dual-mode` (offline-first server cart: `js/cart.js` stays the synchronous localStorage working copy, `js/cart-sync.js` mirrors it to a per-user `carts` row and reconciles on auth events). Full regression + 12-page CSP sweep green. **Next Phase 2 sub-projects: Stripe full checkout (orders + payments + webhook) and the measurements-capture UX** (forms wiring `js/profile.js`'s `getLatestMeasurements`/`saveMeasurements`, already exported in WT-2). ⚠️ Pre-launch reminder: re-enable Supabase email confirmation (`mailer_autoconfirm` currently true) + custom SMTP.
>
> **Phase 1 recap:** all four worktrees (WT-1 auth foundation, WT-3 measurements schema, WT-4 privacy + CSP, WT-2 auth pages) merged to `main` (2026-07-07). Customers can sign up, sign in, reset passwords, edit their profile, and delete their account.
>
> **Phase 1 design + plans landed on `main`:**
> - Spec: [docs/superpowers/specs/2026-06-16-phase-1-design.md](docs/superpowers/specs/2026-06-16-phase-1-design.md) (commit `30bebcf`)
> - 4 plans: `docs/superpowers/plans/2026-06-17-phase-1-wt-{1,2,3,4}-*.md` (commit `54a9cf6`)
> - 3 plan errata fixes (committed during WT-1 execution): `ffc27ca` (SQL `name[] vs text[]` cast in FK re-assert), `fcb7048` (Supabase query-builder `.catch()` → try/catch), and the `test-auth-guards` request-interception allow-list (must permit both `__probe-*` pages, not just `__probe-guard`).
>
> **WT-1 result:** branch `phase-1/auth-foundation` — `db/08_profiles.sql` applied to live Supabase (profiles + RLS + `handle_new_user` trigger + `delete_my_account` RPC + newsletter FK `on delete set null`), `js/auth.js` shipped with the full spec §6.1 surface + header `[data-account-link]` auto-swap. 7 test scripts (`test-profile-rls`, `test-trigger-newsletter-backfill`, `test-delete-rpc`, `test-auth-module-shape`, `test-auth-roundtrip`, `test-auth-guards`, `test-header-account-swap`) all green.
>
> **⚙️ Config change made during WT-1 (production-relevant):** Supabase Auth **email confirmation is now DISABLED** (`mailer_autoconfirm = true`) — required to make the public-`signUp` roundtrip test deterministic (the built-in mailer is rate-limited to ~2/hr; `@example.com`/`.test` are also on the reserved-domain blocklist, so tests use `@test.countryroadfashions.com`). **Re-enable email confirmation + configure custom SMTP before production launch** (tracked for Phase 2/pre-launch).
>
> **✅ Image-transformation 403 — RESOLVED 2026-07-06.** Earlier the Supabase `render/image` endpoint returned `403 FeatureNotEnabled`, breaking all product images site-wide (`js/data-loader.js` builds render-endpoint URLs). Owner upgraded to **Supabase Pro + enabled Image Transformation** (Storage → Settings). Verified: render endpoint `200 image/jpeg` (widths 140/200/1400), shop + PDP images render, `scripts/test-swatch-prefers-hero.mjs` green. Full Phase 0 image gate restored.
>
> **What's next — Phase 2 (Commerce):**
> 1. Cart dual-mode upgrade (localStorage → server-side for signed-in users), Stripe full checkout (orders + payments tables + webhook), and the measurements-capture UX (forms wiring `js/profile.js`'s `getLatestMeasurements`/`saveMeasurements`, already exported in WT-2). Plan/spec TBD — start with `superpowers:brainstorming`.
> 2. Pre-launch chores: re-enable Supabase email confirmation (`mailer_autoconfirm` currently true) + configure custom SMTP (signup.html already branches on whether a session comes back, so it will show the check-your-email flow automatically once confirmation is on); move `frame-ancestors`/clickjacking protection into an HTTP header (Phase 3 CSP hardening).
>
> **Phase 1 agentic cycle reference:** `superpowers:brainstorming` → `superpowers:writing-plans` → `superpowers:using-git-worktrees` → `superpowers:subagent-driven-development` → `superpowers:verification-before-completion` → `superpowers:requesting-code-review` → `superpowers:finishing-a-development-branch`. Full methodology: `~/.claude/plans/just-to-revamp-the-agile-sundae.md`. Phase 0 retrospective notes live at the end of [§7](#7-open--next-steps) under "Phase 0 — shipped".

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
| `/privacy.html` | [privacy.html](privacy.html) | PDPA privacy notice (Phase 1 WT-4) — 11 numbered clauses + sticky TOC |
| `/signup.html` | [signup.html](signup.html) | Create account (Phase 1 WT-2). Branches on session: lands on `/account.html` (confirmation off) or `/login.html?check_email=1` (confirmation on) |
| `/login.html` | [login.html](login.html) | Sign in (Phase 1 WT-2) — check_email/confirmed/reset status banners; honors `?next=` |
| `/forgot-password.html` | [forgot-password.html](forgot-password.html) | Constant-time reset request (Phase 1 WT-2) |
| `/reset-password.html` | [reset-password.html](reset-password.html) | Set new password from recovery link (Phase 1 WT-2) |
| `/account.html` | [account.html](account.html) | Signed-in account (Phase 1 WT-2) — profile edit + measurement stubs + delete-account modal. `requireAuth` gated |

Start dev server: `node serve.mjs` (port 3000). Don't start a second instance if already running. **Auth pages + `js/auth.js`/`js/profile.js` require `@supabase/supabase-js` (installed `--no-save`) and load it in the browser from esm.sh.**

---

## 3. Supabase project

- URL: `https://fzgsogdceptjvuahukbn.supabase.co`
- Region: `ap-southeast-1` (Singapore)
- Credentials all in [.env.local](.env.local) (gitignored). The user has shared:
  - `SUPABASE_ANON_KEY` — public read, used in [js/data-loader.js](js/data-loader.js)
  - `SUPABASE_SERVICE_ROLE_KEY` — for writing data + uploading to Storage via REST
  - `PGHOST` / `PGPORT` / `PGDATABASE` / `PGUSER` / `PGPASSWORD` — direct Postgres access via the pooler (used by `scripts/run-sql.mjs` for DDL)

### Schema (catalogue + identity + measurements)

See [db/schema.sql](db/schema.sql) for the original catalogue definition, plus the numbered migration files in [db/](db/) for everything added since (Phase 0 `07_`, Phase 1 `08_`/`09_`). High-level:

```
CATALOGUE (Phase -1 / ongoing):
categories ─ subcategories ─ item_types ┐
                                        ├─ item_type_fabrics ── fabric_types ── fabric_designs ── fabric_design_photos
                                        │  (junction; holds PRICE + (item × fabric) hero paths)
                                        └── item_type_photos (lookbook per cut, currently unused)
fabric_design_price_overrides — rare per-(item,design) overrides
customization_categories ─ customization_options ─ item_type_customization_categories  (see §10)
v_products / v_customization_catalog — catalogue views

IDENTITY + MARKETING (Phase 0/1):
newsletter_subscribers (Phase 0; email pk, profile_id FK ON DELETE SET NULL)
profiles (Phase 1 WT-1; pk → auth.users, email/full_name/phone/role/opted_in_newsletter…)
  ↳ handle_new_user() trigger on auth.users insert · delete_my_account() RPC · owner-only RLS

MEASUREMENTS (Phase 1 WT-3; owner-only RLS, cascade from profiles):
customer_body_measurements · customer_jacket_reference · customer_shirt_reference · customer_pants_reference
v_latest_body_measurements · v_latest_jacket_reference · v_latest_shirt_reference · v_latest_pants_reference
  (DISTINCT ON newest; security_invoker=true so base-table RLS applies)

COMMERCE (Phase 2):
carts (Phase 2; user_id pk → profiles on delete cascade, items jsonb, updated_at) — owner-only RLS; server mirror of the localStorage cart
```

**Auth:** Supabase Auth. Email confirmation currently DISABLED (`mailer_autoconfirm=true`) — re-enable + SMTP before launch. `js/auth.js` (WT-1) is the client wrapper; `js/profile.js` (WT-2) is profile/measurement CRUD.

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
| `newsletter_subscribers` | Phase 0 — `(email pk, profile_id uuid nullable, source, opted_in_at, unsubscribed_at, created_at)`. RLS: anon INSERT only (intentionally no anon UPDATE/SELECT to prevent mass-mutation + email enumeration), authenticated owners SELECT own row. Migration: `db/07_newsletter_subscribers.sql`. |
| `carts` | Phase 2 — one row per signed-in user (`user_id pk → profiles on delete cascade, items jsonb, updated_at`). Owner-only RLS; server mirror of the localStorage cart, reconciled on auth events. Migration: `db/10_carts.sql`. |

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
├── index.html, shop.html, product.html, book-appointment.html, in-store.html, cart.html   # catalogue pages
├── privacy.html                  # Phase 1 WT-4 — PDPA notice
├── signup.html, login.html, forgot-password.html, reset-password.html, account.html        # Phase 1 WT-2 — auth
├── serve.mjs                     # localhost:3000 dev server (vanilla node http)
├── screenshot.mjs                # puppeteer screenshot → temporary screenshots/screenshot-N[-label].png (1440×900)
├── package.json                  # deps: puppeteer, pg. NOTE: @supabase/supabase-js installed --no-save (not in package.json)
├── .env.local                    # gitignored — Supabase URL + anon + service_role + PG* vars
├── .gitignore                    # excludes node_modules, .env*, .DS_Store, .claude/, .worktrees/, temporary screenshots/
│
├── components/                   # Phase 0 — header.html + footer.html (fetched + mounted at runtime by js/layout.js into [data-layout] slots)
├── css/base.css                  # Phase 0 — token vocabulary, .btn--* system, .field/.input form controls, header/footer styles
│
├── js/
│   ├── data-loader.js            # @supabase/supabase-js client + getCategories / fabricImageUrl / productImageUrl
│   ├── cart.js                   # localStorage cart (`crf.cart.v1`) — CRUD + header-badge updater, auto-mounts
│   ├── customizer.js             # "Customize Your Suit" drawer — lazy-loaded on first click
│   ├── layout.js                 # Phase 0 — fetch-injects components/ into [data-layout] slots; fires crf:layout-ready
│   ├── newsletter.js             # Phase 0 — footer form → newsletter_subscribers (sets form.dataset.newsletterBound)
│   ├── meta.js                   # Phase 0 — setMeta() no-op skeleton (Phase 3 fills it)
│   ├── auth.js                   # Phase 1 WT-1 — Supabase Auth wrapper (spec §6.1) + header account-link swap; imports supabase from esm.sh (browser-only)
│   ├── profile.js                # Phase 1 WT-2 — getMyProfile/updateMyProfile + getLatestMeasurements/saveMeasurements (last two: Phase 2 UI). client() lazily imports auth.js
│   └── schema.d.ts               # TypeScript types (IDE only; NOT updated for profiles/measurements — stale)
│
├── assets/customization/svg/     # 65 placeholder line-art SVGs (one per customization option)
│
├── db/
│   ├── schema.sql + seed.sql            # historical catalogue (DO NOT rerun — see §8)
│   ├── migration-*.sql                  # catalogue migrations (hero photos, VBC, customization, design heroes)
│   ├── 07_newsletter_subscribers.sql    # Phase 0 — newsletter capture table + RLS
│   ├── 08_profiles.sql                  # Phase 1 WT-1 — profiles + RLS + handle_new_user trigger + delete_my_account RPC
│   ├── 09_measurements.sql              # Phase 1 WT-3 — 4 measurement tables + 16 RLS policies + 4 v_latest_* views (security_invoker)
│   └── README.md                        # initial Supabase setup guide (one-time onboarding)
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
│   ├── generate-customization-svgs.mjs      # one-shot: emit 65 placeholder SVGs
│   ├── run-sql.mjs                           # run any SQL file against the pooler (use for migrations)
│   │  # ── TEST SUITE (all green on main; run with serve.mjs up from repo root) ──
│   ├── test-customizer-flow / -design-hero-rail / -swatch-prefers-hero   # Phase 0 catalogue UI
│   ├── test-layout-mount / -newsletter-submit / -token-discipline        # Phase 0 spine
│   ├── test-csp-compliance.mjs              # Phase 1 — 12-page CSP zero-violation sweep (extend PAGES for new pages)
│   ├── test-auth-* / test-profile-rls / test-trigger-newsletter-backfill / test-delete-rpc   # WT-1 auth
│   ├── test-measurements-{rls,views,cascade}.mjs                         # WT-3 measurements
│   ├── test-privacy-page.mjs                # WT-4 privacy
│   ├── test-{profile-module,signup-flow,forgot-reset,account-profile-crud,account-delete,route-guards}.mjs  # WT-2 auth pages
│   └── test-cart-{merge,rls,dual-mode}.mjs  # Phase 2 cart dual-mode (merge: 13 pure cases; rls: owner isolation + cascade; dual-mode: pptr e2e)
│      # NOTE: test scripts read .env.local manually (no dotenv). Auth tests use admin createUser (bypasses email blocklist).
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
- **No announcement bar** (post-Phase-0 cleanup, 2026-06-03). The thin "Worldwide shipping · Bespoke since 1951 · Book a Visit" strip was removed from every page. Every page now opens directly with the site header. Don't reintroduce it on new pages.
- **Header surface varies per page**: `index.html` uses a light off-white header variant (jet ink + jet icons + inverted cart badge) — implemented as a page-specific override in the page's inline `<style>` block (post-Phase-0, 2026-06-07). Every other page uses the default dark/jet header from `css/base.css`. When Phase 1 adds new pages (signup/login/account/privacy), default to the dark header unless the page is conceptually a "landing" surface.

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
| 13 | Newsletter signup + opt-in | **0 (capture wiring)** + 6 (campaigns) | ✅ V0 capture done in Phase 0 (footer form → `newsletter_subscribers`); double-opt-in + ESP deferred to Phase 6 |
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
| **0 — Foundation Refactor** | One shared spine for every page | Shared header/footer, `css/base.css`, normalized `.btn` system, meta scaffold, newsletter capture table + footer-form wiring (item 13 capture half) | **✅ shipped 2026-05-31** (commit `623c9c3`). Retrospective notes in the "Phase 0 — shipped" subsection below. |
| **1 — Identity & Personal Data** | Customers exist; we capture them | 5, 6 (schema), 14 (privacy page draft + CSP baseline) | **EXECUTE NEXT.** Strict prereq for everything personal. Spec carryover below. |
| 2 — Commerce | Real cart + paid orders | 2 (cart dual-mode upgrade), 6 (UX during checkout), 7 (Stripe) | Depends on Phase 1. |
| 3 — Discovery + SEO + Privacy hardening | Findability + production-ready security | 3, 4, 11, 14 (CSP tighten + RLS audit) | Many parallel streams. |
| 4 — Customization expansion | Jacket + Trouser drawers | 1 (extend) | Half session. Schema already supports it (see §10). |
| 5 — Operations | Admin + CRM | 8, 9 | Needs real data flowing. |
| 6 — Marketing | Content + email | 12, 13 (full double-opt-in + ESP), 10 (final polish pass) | Last because earlier phases generate the audience. |
| Continuous | Polish + SEO check per PR | 10, 11 | Every feature PR closes with frontend-design pass + meta-tags check. |

### Phase 0 — Original spec (HISTORICAL; superseded by the "shipped" subsection further down)

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

### Phase 0 — shipped 2026-05-31

Shared spine landed. Every existing page now mounts `components/header.html` + `components/footer.html` at runtime via `js/layout.js`. `css/base.css` owns the token vocabulary, `.btn--*` system, form controls, header styles, and footer styles. Newsletter capture writes to `newsletter_subscribers` via `js/newsletter.js`.

**New files:**
- `components/header.html`, `components/footer.html` — canonical header + full footer markup
- `css/base.css` — tokens (color/type/spacing/shadow/motion), reset, typography ramp, `.btn--*`, form controls, `.sr-only`, focus-visible (jet on light, stone on dark surfaces), header styles, footer styles, newsletter form styles, responsive collapse
- `js/layout.js` — fetches both components in parallel via `Promise.allSettled` (fires `crf:layout-ready` if at least one slot populates), decorates `[data-nav]` links with `aria-current="page"` based on `location.pathname + location.hash`, clears the FOUC reservation styling
- `js/meta.js` — `setMeta()` no-op skeleton (Phase 3 wires the real `<title>`/meta tags/JSON-LD)
- `js/newsletter.js` — footer form handler. Uses plain `.insert()` and treats Postgres `23505` (unique violation) as idempotent success so re-submission is a no-op (preserves the original `opted_in_at`)
- `db/07_newsletter_subscribers.sql` — `(email pk, profile_id nullable, source, opted_in_at, unsubscribed_at, created_at)`. RLS: anon INSERT only, NO anon UPDATE (prevents mass-mutation), authenticated owners can SELECT their own row
- `scripts/test-layout-mount.mjs`, `scripts/test-newsletter-submit.mjs`, `scripts/test-token-discipline.mjs`
- `scripts/capture-phase-0-baseline.mjs`, `scripts/capture-phase-0-after.mjs` — visual-gate screenshot capture
- `favicon.ico` — 1×1 transparent (silences browser auto-request 404 in console)

**Behavior changes across all 6 pages:**
- Footer is now the canonical full footer (brand + newsletter + 4 link cols + bottom row) on every page. `shop.html`, `product.html`, `cart.html` gained the full footer (previously thin / mid).
- `.btn-primary` and `.btn-dark` collapsed into `.btn--primary`. `.btn-outline*` → `.btn--ghost*`. `.btn-light` → `.btn--light`. All buttons get `transform`-only hover (no `transition: all`).
- All hardcoded `#000` / `#fff` literals replaced with token references (enforced by `scripts/test-token-discipline.mjs`).
- `:focus-visible` outlines added across all interactive elements (a11y baseline). Default ring uses `var(--color-jet)` on light surfaces; `.site-header :focus-visible` and `.site-footer :focus-visible` use `var(--color-stone)` for contrast on dark backgrounds.
- `--color-cream` aligned to `#FBF9F6` everywhere (was `#F7F2EA` in base.css, `#FBF9F6` in shop/product/cart inline overrides).
- `--color-charcoal` aligned to `#1A1B1F` everywhere (shop.html previously had `#2C2E33` divergent override).
- Mobile (375px) header collapses to single-line "Country Road Fashions" wordmark (was 3-line stacked on shop/product/cart/book/in-store before).
- `js/cart.js` defers `mountCartBadge()` until the `crf:layout-ready` event when `[data-cart-count]` isn't in DOM yet.

**Phase 1 hooks waiting:**
- Header Account icon is an `<a href="login.html" data-account-link>` — Phase 1's `js/auth.js` flips href to `account.html` when signed in.
- Footer bottom-row Privacy link points to `privacy.html` — Phase 1 creates that page.
- `js/meta.js` `setMeta()` is a no-op — Phase 3 fills it.
- `newsletter_subscribers.profile_id` is nullable; Phase 1 backfills it when a signup uses an already-captured email.

### Phase 1 WT-1 — auth foundation (SHIPPED 2026-07-06)

- **DB** `db/08_profiles.sql` — `profiles` table + RLS (owner-only select/update),
  `handle_new_user` trigger (mirrors `auth.users.email`, backfills
  `newsletter_subscribers.profile_id`, inserts newsletter row on opt-in),
  `delete_my_account()` RPC, `newsletter_subscribers.profile_id` re-asserted as
  `on delete set null`. Idempotent; applied live via `scripts/run-sql.mjs`.
- **JS** `js/auth.js` — public API per Phase 1 spec §6.1: `getSession`,
  `getUser`, `onAuthChange`, `signUp`, `signInWithPassword`, `signOut`,
  `resetPasswordForEmail`, `updatePassword`, `requireAuth`, `requireGuest`,
  `deleteAccount`. Auto-mounts header `[data-account-link]` swap on
  `crf:layout-ready` (signed-out → `/login.html`, signed-in → `/account.html`).
- **Tests** `test-profile-rls`, `test-trigger-newsletter-backfill`,
  `test-delete-rpc`, `test-auth-module-shape`, `test-auth-roundtrip`,
  `test-auth-guards`, `test-header-account-swap` — all green. Phase 0 suite
  green (during WT-1, `test-swatch-prefers-hero` was temporarily red due to the
  image-transformation 403 — since resolved 2026-07-06, see top banner).
- **Config side-effects (see top banner):** Supabase email confirmation
  disabled (`mailer_autoconfirm = true`) for deterministic auth tests —
  re-enable + add SMTP before launch. Auth test emails use
  `@test.countryroadfashions.com` (reserved-domain blocklist rejects
  `example.com`/`.test`).

### Phase 1 WT-3 — measurements schema (SHIPPED 2026-07-06)

- **DB** `db/09_measurements.sql` — 4 narrow typed tables
  (`customer_body_measurements`, `customer_jacket_reference`,
  `customer_shirt_reference`, `customer_pants_reference`), all measurement
  columns `numeric(5,2)` nullable, `customer_id → profiles(id) on delete
  cascade`. 16 owner-only RLS policies (`auth.uid() = customer_id`). 4
  `v_latest_*` views (`distinct on (customer_id)` newest by `captured_at`).
  Idempotent; applied live.
- **Views use `security_invoker = true`** (PG15+) so base-table RLS applies to
  the querying user. Without it the views bypass RLS and leak every customer's
  row — a bug caught by `test-measurements-rls` and fixed before merge.
- **Tests** `test-measurements-rls` (2 users × 4 tables + 4 views),
  `test-measurements-views` (DISTINCT ON newest), `test-measurements-cascade`
  (auth.users → profiles → 4 tables) — all green. Additive-only worktree; no
  JS/HTML touched.
- **Out of scope:** measurement-capture UI + `js/profile.js` (WT-2), unit
  toggle (Phase 2). Append-only is a WT-2 convention; the UPDATE policy is
  intentionally permissive per spec §5.2.
- **Known Phase 0 flake (unrelated):** `test-newsletter-submit` races the
  form-handler bind vs. submit dispatch — see top-banner tracked items.

### Phase 1 WT-4 — privacy page + CSP baseline (SHIPPED 2026-07-06)

- **New page** `privacy.html` — PDPA-compliant notice: 11 numbered clauses +
  banner, all 12 anchor IDs, sticky spec-sheet TOC (≥1024px) / bordered docket
  (<1024px), brand type/palette from `css/base.css`, print + reduced-motion
  rules. Mounts the shared dark header/footer via `data-layout` slots.
  Owner-supplied entity + Bangkok address (§2) and data-request email (§11,
  `Countryroadfashions@gmail.com`) filled 2026-07-06 — no placeholders remain.
- **CSP baseline** — `<meta http-equiv="Content-Security-Policy">` added to the
  `<head>` of the 6 existing pages + `privacy.html` (spec §8.2). Policy allows
  self + esm.sh + Calendly (script), Google Fonts (style/font), Supabase
  (img/connect/ws), placehold.co (img), inline (`'unsafe-inline'`).
- **Two deliberate deviations from the WT-4 plan:**
  1. **Dropped `frame-ancestors 'none'`** from the meta block — browsers ignore
     it when delivered via `<meta>` and log a console error (which the sweep's
     matcher would treat as a false violation). Clickjacking protection must be
     an **HTTP response header** — deferred to Phase 3 CSP hardening / host config.
  2. **Skipped the `components/header.html` CSP copy** (plan Task 6) — `js/layout.js`
     injects the fragment into the `<body>`, where an http-equiv CSP `<meta>` is
     ignored. The per-page `<head>` CSP is authoritative. (This supersedes the
     Phase 0 note below suggesting the header fragment could carry CSP.)
- **Footer** Privacy link rewired `privacy.html` → `/privacy.html` (absolute).
- **Tests** `test-csp-compliance` (7-page zero-violation sweep) +
  `test-privacy-page` (12 anchors, H1, brand voice, dates, footer link, CSP) —
  green. Phase 0 functional suite (layout-mount, newsletter, customizer,
  hero-rail, swatch) + token-discipline all green with CSP active.
- **WT-2 hook:** when WT-2 ships signup/login/forgot/reset/account, add the same
  `<head>` CSP block to each and extend the `PAGES` array in
  `scripts/test-csp-compliance.mjs`. *(Done in WT-2 — see below.)*

### Phase 1 WT-2 — auth pages (SHIPPED 2026-07-07) — Phase 1 close

- **5 new pages:** `signup.html`, `login.html`, `forgot-password.html`,
  `reset-password.html`, `account.html`. All carry the per-page `<head>` CSP
  block; all use the shared `.auth-card` treatment (440px centered card) except
  `account.html` (two-column: sticky section nav + content, collapses <900px).
- **`js/profile.js`** — `getMyProfile`, `updateMyProfile`, plus
  `getLatestMeasurements`/`saveMeasurements` (exported; **no Phase 1 UI calls the
  last two — Phase 2 wires the measurement forms**). `client()` lazily
  dynamic-imports `js/auth.js` so the module is Node-testable (a top-level import
  would trip auth.js's browser-only esm.sh import).
- **account.html:** profile edit (name/phone/newsletter, email read-only),
  Measurements section (disabled "Available soon" stubs + a Book-consultation
  link), and a Danger zone with a DELETE-typed + password-re-verified modal that
  calls `deleteAccount()` → `delete_my_account` RPC → `/?account_deleted=1`.
- **⚙️ Signup behavior note:** with email confirmation OFF (current config),
  `signUp()` returns a live session, so `signup.html` signs the user in and lands
  them on `/account.html`. It **branches on `data.session`** — when confirmation
  is re-enabled before launch, no session comes back and it routes to
  `/login.html?check_email=1` (the check-your-email flow) automatically. The
  login page already has check_email / confirmed / reset status banners.
- **Deviations from the WT-2 plan (all justified):** test scripts read
  `.env.local` manually (project convention; `dotenv` isn't a dependency);
  CSP blocks omit `frame-ancestors` (per WT-4); each auth page adds a page-local
  `input[type="password"].input` rule (base.css `.input` doesn't cover password).
- **Tests (6, all green):** `test-profile-module`, `test-signup-flow`,
  `test-forgot-reset`, `test-account-profile-crud`, `test-account-delete`,
  `test-route-guards`. Full Phase 0 + WT-1 + WT-3 + WT-2 suite (18 tests) +
  token-discipline + 12-page CSP sweep all green.

### Phase 2 — cart dual-mode (SHIPPED 2026-07-08)

- **Offline-first mirror:** `js/cart.js` stays the synchronous localStorage
  working copy (`crf.cart.v1`) — zero changes to its consumers (customizer,
  cart.html, header badge). `js/cart-sync.js` mirrors that working copy to a
  server `carts` row and reconciles it on auth events (login / logout /
  token-refresh). The site stays fully functional offline / signed-out.
- **DB** `db/10_carts.sql` — `carts` table (`user_id pk → profiles on delete
  cascade, items jsonb, updated_at`) + 4 owner-only RLS policies (all
  `public.`-qualified, `to authenticated`, `auth.uid() = user_id`). Idempotent;
  applied live via `scripts/run-sql.mjs`.
- **`js/cart-merge.js`** — pure, Node-testable `lineKey` + `mergeCarts`: union +
  dedupe by line identity, quantities summed and clamped (≤99), server folded
  first so server price/added_at win on a collision. No DOM / no network.
- **`js/cart.js`** — added `replaceCart()` (an `updated_at`-preserving whole-cart
  swap used by reconcile) + a browser-only dynamic-import bootstrap that lazy-
  loads `cart-sync.js` (keeps cart.js Node-testable and consumers untouched).
- **Merge-EXACTLY-ONCE:** guarded by the `crf.cart.owner` localStorage marker +
  a serialized reconcile — a guest cart is folded into the server cart once per
  login. Reloads / token-refreshes take an idempotent last-write-wins path
  (never re-merge), so quantities don't double.
- **Logout clears LOCAL only** (server row preserved) — shared-computer safe.
  Background push is self-healing: debounced 800ms, exponential backoff, and
  retries on `online` / `visibilitychange`.
- **Tests:** `test-cart-merge` (13 pure cases), `test-cart-rls` (owner-only
  isolation + cascade on profile delete), `test-cart-dual-mode` (puppeteer e2e:
  guest→login merge, reload no-dup, logout clears local/keeps server,
  cross-device pull, identical-line dedupe). Full regression suite (cart-merge,
  cart-rls, cart-dual-mode, customizer-flow, layout-mount, newsletter-submit,
  token-discipline) + 12-page CSP sweep all green.
- **Out of scope / next:** Stripe full checkout (orders / payments / webhook)
  will snapshot the cart into an `orders` row at purchase; measurements-capture
  UX (wire `js/profile.js` `getLatestMeasurements`/`saveMeasurements` into the
  account.html forms).

**Architectural notes for later phases:**
- The CSP meta tag was NOT added in Phase 0 (deferred to Phase 3 hardening per spec). Phase 3 should add it to `components/header.html` since `<meta http-equiv="Content-Security-Policy">` in a fetched HTML fragment IS honored by browsers if it appears before any external resource loads, but it's safer to add it directly to each page's `<head>` until Phase 3.
- The `<form data-newsletter-form>` is bound by `js/newsletter.js` exactly once via a `data-newsletter-bound="1"` guard. If a future feature re-renders the footer dynamically, the guard prevents double-binding but doesn't re-bind a fresh form node — call `js/newsletter.js`'s `init()` after such a re-render.
- The mobile mega-menu (`js/mega-menu.js` + `css/mega-menu.css`) lives separately, used on 5 of 6 pages, unchanged in Phase 0.

### Phase 1 — Spec carryover (EXECUTE NEXT — Phase 0 is shipped)

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
