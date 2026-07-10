# Country Road Fashions — Project Handoff

Single source of truth for a new chat session to pick up where the previous one left off. Pair this with [CLAUDE.md](CLAUDE.md) (frontend rules) for full context.

> **Last session ended** at: **✅ PHASE 2 COMPLETE — measurements-capture UX SHIPPED on branch `phase-2/measurements-capture`** (2026-07-10). This was the last remaining Phase 2 sub-project. A signed-in customer can now self-enter their tailoring measurements on a new `requireAuth`-gated `/measurements.html`, covering all four schema kinds (body + jacket/shirt/pants reference) via a data-driven field schema (`js/measurement-schema.js`) rendered by `js/measurements.js`, prefilled from and saved through the already-shipped `getLatestMeasurements`/`saveMeasurements` in `js/profile.js`. Fixed labelled units (in/cm/kg). Full regression (schema drift guard, e2e save round-trip + append-only, measurements RLS/views, account CRUD, layout-mount, token-discipline) + 14-page CSP sweep all green. **With this, all of Phase 2 (cart dual-mode + Stripe checkout + measurements UX) is shipped — Phase 3 (Discovery + SEO + privacy hardening) is next.** ⚠️ Pre-launch reminders (unchanged, still open): re-enable Supabase email confirmation (`mailer_autoconfirm` currently true) + custom SMTP; **activate Stripe account** (Thai bank + identity → live keys) and register a LIVE webhook endpoint pointing at the deployed `stripe-webhook` function; add order-confirmation email (needs SMTP).
>
> **Prior sub-project — 💳 Stripe full checkout SHIPPED** (2026-07-09, branch `phase-2/stripe-checkout`). A signed-in customer pays the full garment amount via hosted Stripe Checkout: `orders` + `payments` rows created server-side by Supabase Edge Functions (Deno), confirmed by a registered Stripe test-mode webhook. The trust boundary re-resolves all prices from `v_products` before creating the Stripe session — the client-written `carts.items` price is never used.
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
> **What's next — Phase 2 (Commerce) is COMPLETE.** All three sub-projects shipped: cart dual-mode (✅ merged 2026-07-08), Stripe full checkout (✅ 2026-07-09), measurements-capture UX (✅ 2026-07-10). **Next up is Phase 3 (Discovery + SEO + privacy hardening).** Still-open pre-launch chores (not blockers for Phase 3):
> 1. Re-enable Supabase email confirmation (`mailer_autoconfirm` currently true) + configure custom SMTP.
> 2. **Activate Stripe account** (Thai bank + identity → live keys) and register a LIVE webhook endpoint pointing at the deployed `stripe-webhook` function; add order-confirmation transactional email.
> 3. Move `frame-ancestors`/clickjacking protection into an HTTP header (Phase 3 CSP hardening).
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
| `/account.html` | [account.html](account.html) | Signed-in account (Phase 1 WT-2) — profile edit + measurement links (now enabled → `/measurements.html`) + Orders history section + delete-account modal. `requireAuth` gated |
| `/order-confirmation.html?order=<uuid>` | [order-confirmation.html](order-confirmation.html) | Post-payment confirmation (Phase 2 Stripe checkout) — `requireAuth`; reads order via owner-RLS; renders the order summary as a brand spec-sheet docket; polls up to ~7.5s to absorb webhook lag |
| `/measurements.html#{body\|jacket\|shirt\|pants}` | [measurements.html](measurements.html) | Self-entry measurements (Phase 2) — `requireAuth`; left sub-nav for the four kinds; forms rendered from `js/measurement-schema.js` by `js/measurements.js`; prefills from + saves to `js/profile.js`'s `getLatestMeasurements`/`saveMeasurements` (append-only). Fixed labelled units (in/cm/kg) |

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
orders (Phase 2 Stripe; id uuid pk, user_id → profiles on delete set null [nullable; preserves records after PDPA deletion], status pending|paid|failed|canceled, currency thb, total_thb integer [whole baht], items jsonb [server-resolved snapshot], stripe_checkout_session_id, stripe_payment_intent_id, created_at, updated_at [touch_updated_at trigger]) — owner-only SELECT; NO client write policies (Edge Functions write via service_role only). Migration: db/11_orders.sql.
payments (Phase 2 Stripe; id uuid pk, order_id → orders on delete cascade, stripe_payment_intent_id, stripe_event_id text UNIQUE [webhook idempotency key], amount_thb, currency, status succeeded|failed|refunded, raw jsonb, created_at) — owner-only SELECT via join to orders. NO client write policies.
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
| `orders` | Phase 2 Stripe — one row per purchase attempt (`id uuid pk`, `user_id → profiles on delete set null` nullable, `status pending\|paid\|failed\|canceled`, `total_thb integer`, `items jsonb` server-resolved snapshot, `stripe_checkout_session_id`, `stripe_payment_intent_id`, `updated_at`). Owner-only SELECT; written only by Edge Functions via service_role. Migration: `db/11_orders.sql`. |
| `payments` | Phase 2 Stripe — one row per `checkout.session.completed` event (`order_id → orders on delete cascade`, `stripe_event_id text UNIQUE` for idempotency, `amount_thb`, `status succeeded\|failed\|refunded`, `raw jsonb`). Owner-only SELECT via join to orders. Migration: `db/11_orders.sql`. |

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
├── order-confirmation.html       # Phase 2 Stripe — post-payment docket; requireAuth; owner-RLS order read
├── measurements.html             # Phase 2 — self-entry measurements; requireAuth; sub-nav for 4 kinds; forms rendered by js/measurements.js
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
│   ├── profile.js                # Phase 1 WT-2 — getMyProfile/updateMyProfile + getLatestMeasurements/saveMeasurements (last two wired to UI in Phase 2 measurements). client() lazily imports auth.js
│   ├── checkout.js               # Phase 2 Stripe — document-level click delegation on [data-checkout-button]; requireAuth bounces guests; flushes localStorage cart to server carts row; invokes create-checkout-session Edge Function; redirects to Stripe
│   ├── measurement-schema.js     # Phase 2 — SINGLE SOURCE OF TRUTH: 4 kinds × field groups (keys mirror db/09_measurements.sql columns exactly), labels/units/hints + ANCHOR_BY_KIND/KIND_BY_ANCHOR. Node-importable (drift guard)
│   ├── measurements.js           # Phase 2 — browser-only: renders 4 forms from measurement-schema, requireAuth, lazy prefill via getLatestMeasurements, validate + save via saveMeasurements, hash-based kind switching
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
│   ├── 10_carts.sql                     # Phase 2 cart — carts table + 4 owner-only RLS policies
│   ├── 11_orders.sql                    # Phase 2 Stripe — orders + payments tables, RLS, orders_set_updated_at trigger; idempotent, transaction-wrapped
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
│   ├── test-csp-compliance.mjs              # Phase 1 — 14-page CSP zero-violation sweep (extended for order-confirmation.html + measurements.html in Phase 2)
│   ├── test-auth-* / test-profile-rls / test-trigger-newsletter-backfill / test-delete-rpc   # WT-1 auth
│   ├── test-measurements-{rls,views,cascade}.mjs                         # WT-3 measurements
│   ├── test-privacy-page.mjs                # WT-4 privacy
│   ├── test-{profile-module,signup-flow,forgot-reset,account-profile-crud,account-delete,route-guards}.mjs  # WT-2 auth pages
│   ├── test-cart-{merge,rls,dual-mode}.mjs  # Phase 2 cart dual-mode (merge: 13 pure cases; rls: owner isolation + cascade; dual-mode: pptr e2e)
│   ├── test-orders-rls.mjs              # Phase 2 Stripe — owner-read-only + write-locked + duplicate-event idempotency
│   ├── test-checkout-price-resolution.mjs  # Phase 2 Stripe — server re-prices items, ignores tampered client price; auth + empty-cart guards
│   ├── test-webhook-handler.mjs         # Phase 2 Stripe — paid + payment row + cart clear on completed; idempotent replay; expired → canceled
│   ├── test-checkout-flow.mjs           # Phase 2 Stripe — puppeteer: guest→login redirect, signed-in→Stripe redirect
│   ├── test-checkout-purchase-e2e.mjs   # Phase 2 Stripe — GOLD-STANDARD: real 4242 test-card purchase → registered webhook → order paid (manual/e2e; not offline CI)
│   ├── test-measurement-schema.mjs      # Phase 2 measurements — pure-Node drift guard: MEASUREMENT_SCHEMA keys ⇔ db/09_measurements.sql numeric columns (both directions)
│   └── test-measurements-page.mjs       # Phase 2 measurements — puppeteer e2e: guest bounce, prefill round-trip, sub-nav switch, append-only, partial save
│      # NOTE: test scripts read .env.local manually (no dotenv). Auth tests use admin createUser (bypasses email blocklist).
│
├── supabase/
│   ├── config.toml                          # sets verify_jwt=true for create-checkout-session, verify_jwt=false for stripe-webhook
│   └── functions/
│       ├── _shared/
│       │   ├── cors.ts                      # CORS headers helper
│       │   ├── clients.ts                   # Stripe client (pinned stripe@18.5.0), adminClient(), callerUserId() JWT resolver
│       │   └── resolve-cart.ts              # TRUST BOUNDARY: reads carts row, validates item shape, re-prices every line from v_products; never trusts client price_thb; uses design_name column
│       ├── create-checkout-session/
│       │   └── index.ts                     # verify_jwt=true; rejects anon/empty/invalid carts; inserts pending order with re-priced snapshot; creates branded Stripe Checkout Session (mode=payment, currency=thb, metadata.order_id, bespoke text, THB×100); returns {url, order_id}
│       └── stripe-webhook/
│           └── index.ts                     # verify_jwt=false; Stripe-signature-verified via constructEventAsync + createSubtleCryptoProvider; checkout.session.completed → order paid + payments row + clear server cart; checkout.session.expired → canceled; idempotent by stripe_event_id
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
| 2 | Add items to cart | 2 (server-side cart dual-mode) | ✅ done — V1 localStorage + Phase 2 offline-first server mirror (merged 2026-07-08) |
| 3 | Site-wide search (header) | 3 | ⬜ |
| 4 | Shop page filters + search | 3 | ⬜ (basic input exists in shop.html) |
| 5 | Customer login + profile (email/password + Google) | 1 | ✅ done — Phase 1 complete (merged 2026-07-07). Email/password auth + profiles + measurements schema + auth pages + privacy page. Google OAuth deferred. |
| 6 | Measurements capture | 1 (schema) + 2 (UX) | ✅ done — schema (Phase 1 WT-3) + self-entry UX (`/measurements.html`, shipped 2026-07-10) |
| 7 | Stripe checkout + payment page | 2 | ✅ done — full Stripe hosted checkout shipped 2026-07-09 (branch `phase-2/stripe-checkout`). Orders + payments + webhook + order-confirmation page. Pre-launch: activate account (Thai bank + identity → live keys) + register live webhook endpoint + order-confirmation email. |
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
| **1 — Identity & Personal Data** | Customers exist; we capture them | 5, 6 (schema), 14 (privacy page draft + CSP baseline) | **✅ shipped 2026-07-07** (all 4 worktrees merged to main). |
| 2 — Commerce | Real cart + paid orders | 2 (cart dual-mode ✅ merged 2026-07-08), 7 (Stripe checkout ✅ shipped 2026-07-09), 6 (measurements UX ✅ shipped 2026-07-10) | **✅ COMPLETE.** All three sub-projects shipped. |
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
- **Out of scope / next (at the time of cart dual-mode merge):** Stripe full checkout (orders / payments / webhook) — shipped in the next sub-project (see below). Measurements-capture UX still pending.

### Phase 2 — measurements-capture UX (SHIPPED 2026-07-10) — Phase 2 close

Self-entry measurements — a signed-in customer types their own tailoring measurements on a new `requireAuth`-gated `/measurements.html`, covering all four schema kinds (body + jacket/shirt/pants reference). UI + wiring only; no DB/schema change (the Phase 1 WT-3 schema + `js/profile.js` data layer were reused unchanged).

- **`js/measurement-schema.js`** — the single source of truth. Exports `MEASUREMENT_SCHEMA` (4 kinds, each with field groups of `{ key, label, unit, hint }`; every `key` matches a `numeric(5,2)` column in `db/09_measurements.sql` EXACTLY), plus `fieldKeysForKind()` and the `ANCHOR_BY_KIND`/`KIND_BY_ANCHOR` hash maps (`body|jacket|shirt|pants`). No browser-only imports → Node-importable for the drift guard. Body = 21 fields in 3 groups (Jacket & Coat / Trousers / Height & Weight); jacket ref = 15, shirt ref = 10, pants ref = 8; each has a free-text `notes`.
- **`js/measurements.js`** — browser-only render module. `requireAuth` (bounces guests to `/login.html?next=/measurements.html`), builds all four `<form>`s from the schema, lazily prefills the active kind via `getLatestMeasurements(kind)`, validates lightly (`0–999.99`, blank always valid — partial saves are a feature), and saves via `saveMeasurements(kind, fields)` (append-only — every save INSERTs a fresh snapshot; latest wins on the `v_latest_*` views). Hash-driven kind switching + `aria-current`. Sets `document.body.dataset.measurementsReady` as a readiness hook. Guards reentrant submit (Enter mid-save) and the `requireAuth` null return (both from code review).
- **`measurements.html`** — dedicated page modelled on `account.html`: same `<head>` CSP block, fonts, `data-layout` header/footer slots; two-column sticky left sub-nav + content; serif "Your *Measurements*" header with the italic stone-underline accent; fixed labelled units (in/cm/kg) shown as an in-input suffix; responsive collapse at ≤900px (sub-nav → horizontal row).
- **Wiring:** the two disabled `account.html` measurement stubs are now enabled `<a>` links → `/measurements.html#body` and `#jacket`. **Footer left unchanged** — its "Online Measurements" link points at `book-appointment.html#online` (an *online consultation*, a distinct concept from self-entry).
- **Units:** fixed + labelled (spec decision); no in/cm toggle. Toggle, a measurement-history browser, per-field diagrams, and PDP/checkout inline capture were all explicitly deferred.
- **Tests (all green):** `test-measurement-schema` (pure-Node drift guard — every schema key ⇔ SQL numeric column, both directions; 109 assertions), `test-measurements-page` (puppeteer e2e — guest bounce, render, empty state, partial save round-trip through the view, sub-nav switch, append-only = 2 rows after 2 saves). CSP sweep extended to **14 pages**. Full regression (+ measurements RLS/views, account CRUD, layout-mount, token-discipline) green.

### Phase 2 — Stripe full checkout (SHIPPED 2026-07-09)

Hosted Stripe Checkout flow — a signed-in customer pays the full garment amount upfront; durable `orders` + `payments` records are confirmed by a registered Stripe test-mode webhook. Full-amount-upfront design decision; sign-in required; "Reserve Consultation" CTA kept as secondary alongside a new "Proceed to Checkout" primary CTA.

- **DB** `db/11_orders.sql` — transaction-wrapped, idempotent. Two new tables:
  - `orders` — `id uuid pk`, `user_id → profiles(id) on delete set null` (nullable; preserves financial records after PDPA account deletion), `status` (`pending|paid|failed|canceled`, default `pending`), `currency` (default `'thb'`), `total_thb integer` (whole baht — amounts stored as integers; ×100 satang conversion happens only at the Stripe API boundary), `items jsonb` (authoritative server-resolved snapshot), `stripe_checkout_session_id`, `stripe_payment_intent_id`, `created_at`, `updated_at` (kept current by an `orders_set_updated_at` trigger reusing `public.touch_updated_at()`).
  - `payments` — `id uuid pk`, `order_id → orders(id) on delete cascade`, `stripe_payment_intent_id`, `stripe_event_id text UNIQUE` (webhook idempotency key), `amount_thb`, `currency`, `status` (`succeeded|failed|refunded`), `raw jsonb`, `created_at`.
  - RLS: owner-only SELECT on both (`auth.uid() = user_id`; payments via join to orders). **NO client write policies** — orders and payments are written ONLY by Edge Functions via the service_role key.
- **Supabase Edge Functions** (Deno runtime; deployed to project `fzgsogdceptjvuahukbn`):
  - `supabase/functions/_shared/cors.ts` — CORS headers helper.
  - `supabase/functions/_shared/clients.ts` — Stripe client pinned at `stripe@18.5.0`, `adminClient()` (service_role Supabase client), `callerUserId()` JWT resolver.
  - `supabase/functions/_shared/resolve-cart.ts` — **the trust boundary**: reads the user's `carts` row, validates item shape, RE-PRICES every line from `v_products`. The client-written `price_thb` is ignored. Uses the `design_name` column (not `fabric_design_name`). Any malformed item or tampered price causes an early-reject 400.
  - `supabase/functions/create-checkout-session/index.ts` — `verify_jwt=true` (rejects anon with 401); validates non-empty, shape-valid cart; inserts a `pending` order with the re-priced server snapshot; creates a branded hosted Checkout Session (`mode=payment`, `currency=thb`, `metadata.order_id`, `client_reference_id=order_id`, bespoke brand text, amounts in THB×100 satang); returns `{ url, order_id }`.
  - `supabase/functions/stripe-webhook/index.ts` — `verify_jwt=false` (public endpoint; verified instead via Stripe-signature + Deno's `constructEventAsync` + `createSubtleCryptoProvider`). On `checkout.session.completed` → marks order `paid` + inserts a `payments` row + clears the user's server cart. On `checkout.session.expired` → marks order `canceled`. Idempotent by `stripe_event_id` UNIQUE constraint.
  - `supabase/config.toml` sets `[functions.create-checkout-session] verify_jwt=true` and `[functions.stripe-webhook] verify_jwt=false`.
- **Toolchain / infrastructure reality for the next session:**
  - **Docker is NOT installed** on this machine, so `supabase functions serve` (which requires Docker) cannot run locally. All Edge Functions were developed and tested against the **deployed** endpoint (`https://fzgsogdceptjvuahukbn.supabase.co/functions/v1/<name>`). Phase 2 test scripts default `FUNCTIONS_URL` to that deployed base.
  - New tools installed via Homebrew: Supabase CLI, Deno, Stripe CLI.
  - Supabase secrets set (test-mode): `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`.
  - A **test-mode Stripe webhook endpoint is registered** (`we_1TrF0rDwo6ikvP7neZBkGwwi`) for `checkout.session.completed` + `checkout.session.expired`, pointing at the deployed `stripe-webhook` function — so checkout completes unattended without needing `stripe listen` running locally.
  - `.env.local` (gitignored) now also holds `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `SITE_URL=http://localhost:3000`.
- **New client surface:**
  - `js/checkout.js` — document-level click delegation on `[data-checkout-button]` (survives `cart.html`'s dynamic re-renders); `requireAuth` bounces unauthenticated visitors to `/login.html?next=cart.html`; flushes the localStorage cart to the server `carts` row, then invokes `create-checkout-session` and redirects to Stripe.
  - `cart.html` — "Proceed to Checkout" primary CTA added (data-checkout-button); "Reserve Consultation" kept as secondary; `[data-checkout-error]` error line; imports `js/checkout.js`.
  - `order-confirmation.html` (NEW page) — `requireAuth`; reads `?order=` UUID via owner-RLS select from `orders`; renders the order summary as a brand spec-sheet docket with italic-serif + stone-hairline "confirmed" headline; polls up to ~5×1.5s to absorb webhook lag; HTML-escapes all DB values; dark header; per-page CSP block.
  - `account.html` — added an "Orders" history section listing past orders (date · status pill · total), each linking to `order-confirmation.html`.
- **Tests (all green):**
  - `test-orders-rls.mjs` — owner-read-only, write-locked, duplicate-event idempotency.
  - `test-checkout-price-resolution.mjs` — server re-prices items correctly, ignores tampered client `price_thb`; auth and empty-cart guards work.
  - `test-webhook-handler.mjs` — `paid` status + `payments` row + cart clear on `completed`; idempotent replay; `expired` → `canceled`.
  - `test-checkout-flow.mjs` — puppeteer: guest→login redirect, signed-in→Stripe redirect.
  - `test-checkout-purchase-e2e.mjs` — **GOLD-STANDARD**: real 4242 test-card purchase through Stripe's hosted UI → registered webhook fires → order marked `paid`. Drives the live Stripe hosted page (Puppeteer), so it is a manual/e2e check — not part of the offline CI suite; requires the registered webhook endpoint or `stripe listen`.
  - `test-csp-compliance.mjs` extended to 13 pages (added `order-confirmation.html`). Full prior suite (cart-merge, cart-rls, customizer-flow, layout-mount, newsletter-submit, token-discipline) still green.
- **Out of scope / pre-launch items for the next session:**
  - **Activate Stripe account** (Thai bank + identity documents → live keys). Swap `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` secrets in Supabase and register a **LIVE mode** webhook endpoint pointing at the deployed `stripe-webhook` function.
  - **Order-confirmation email** — currently there is no transactional email after payment. Needs SMTP (blocked on the same email-confirmation SMTP setup pending from Phase 1).
  - **Embedded Payment Element** — the hosted Checkout cannot load custom fonts (it is a Stripe-branded redirect page). Switching to Stripe's embedded Payment Element would allow full brand control. Deferred post-launch.
  - Measurements-capture UX remains the only open Phase 2 sub-project.
- **Known V1 gaps (from the final code review — deferred, not blocking; wire in Phase 3 / admin phase):**
  - **Refunds + `payment_intent.payment_failed` are unhandled.** The webhook only handles `checkout.session.completed`/`expired`. The `orders.status='failed'` and `payments.status='refunded'` enum values have no writer yet. Acceptable for V1 (hosted Checkout keeps the session open on a failed card), but wire `charge.refunded` when refund ops matter.
  - **Deleted-user order/payment visibility.** `orders.user_id` is `ON DELETE SET NULL` (retains financial records after PDPA deletion), but there is no staff/admin RLS policy, so a deleted user's `orders`/`payments` become unreadable via the API. Revisit when building the admin dashboard.
  - **`cors.ts` allows `*` origin.** Safe today (auth is via JWT, not origin), but tighten `Access-Control-Allow-Origin` to the site origin pre-launch as defense-in-depth.
  - **`checkout.js` `cart_empty` friendly copy may not surface** — `supabase-js` `functions.invoke` returns non-2xx bodies via `error.context`, not `data`, so the empty-cart branch likely shows the generic error instead. Minor; the CTA shouldn't be reachable with an empty cart anyway.
  - **Optional belt-and-suspenders:** log/alert if the webhook's `amount_total` (satang→THB) ever diverges from `orders.total_thb` (they can't today — the session is built from server-resolved prices).

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
