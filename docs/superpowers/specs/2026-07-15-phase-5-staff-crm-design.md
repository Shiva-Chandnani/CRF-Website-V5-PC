# Phase 5 — Internal Staff CRM (Sub-project A) — Design

**Date:** 2026-07-15
**Backlog:** #9 (CRM) + the "customers" half of #8 (admin dashboard)
**Phase:** 5 (Operations)
**Status:** approved (design)

## Context & goal

Country Road Fashions is building a **separate retail POS/CRM** that will become the
**central/master** customer system across retail + online. That POS is not ready for
integration yet (no API/data model/contract available). The website still needs its own CRM.

**Decision:** build the website CRM now as a **spoke** of the future central POS — useful
immediately over data we already collect (`profiles`, `orders`, `payments`, measurements),
with a minimal integration seam baked in so a future connector can reconcile records instead
of forcing a restructure. **Do NOT build the POS connector now** (YAGNI until the contract
exists) — only leave the seam.

The overall CRM effort was decomposed into two independent sub-projects:
- **A — Internal staff CRM (this spec):** staff-facing surface to search/view/manage online
  customers. Carries the POS-link concern (it owns the customer-record management layer).
- **B — Customer-facing account enhancements:** richer logged-in `account.html` experience.
  Documented follow-up; NOT in this spec.

**A is built first** — it is what the user asked for (website CRM linked to the central POS),
unlocks operational value immediately, and establishes the customer model + sync seam that B
and the eventual connector depend on.

## Existing state this builds on

- `profiles` table with `role text not null default 'customer' check (role in ('customer','staff','admin'))`, indexed (`profiles_role_idx`). Today **all** RLS is strictly owner-only (`auth.uid() = id`) — staff cannot read other customers' data.
- `orders` / `payments` — owner-only SELECT; written only by Edge Functions (service_role).
- `customer_body_measurements` / `customer_jacket_reference` / `customer_shirt_reference` /
  `customer_pants_reference` — owner-only RLS; `v_latest_*` views run `security_invoker=true`.
- Architecture: static HTML pages + browser Supabase client (anon key + user session JWT) with
  RLS as the enforcement boundary. Auth wrapper `js/auth.js` (has `requireAuth`/`requireGuest`);
  profile/measurement CRUD in `js/profile.js`. CSP `script-src 'self'` (all scripts externalized).
  `robots.txt` Disallows private pages; `noindex` on private pages.

## Access model (chosen: RLS staff-read policies — Approach 1)

Browser-direct via new **additive** staff RLS policies, consistent with the whole site.

- **`is_staff()`** — `SECURITY DEFINER` SQL function returning `boolean`: true when the calling
  user's `profiles.role in ('staff','admin')`. `SECURITY DEFINER` + a direct lookup avoids RLS
  recursion (a policy on `profiles` that itself queries `profiles`). `stable`. Granted to
  `authenticated`.
- **Staff-read policies** — new `SELECT` policies `using (public.is_staff())` added to:
  `profiles`, `orders`, `payments`, and the four `customer_*` measurement tables. The
  `v_latest_*` views inherit automatically (security_invoker). Existing owner-only policies are
  UNCHANGED — staff policies are purely additive, so a normal customer's access is identical to
  today. (Postgres RLS `SELECT` policies are OR-combined: a row is visible if owner OR staff.)
- **Staff provisioning (V1):** manual — `update profiles set role='staff' where email=…` via
  `scripts/run-sql.mjs`. No self-serve staff-invite UI in V1.
- **Client gate:** `requireStaff()` added to `js/auth.js` — resolves the session, checks the
  caller's `profiles.role`, bounces non-staff to `/` (or `/login.html?next=`). UX only; RLS is
  the real boundary.
- **Routing/secrecy:** admin pages use an `admin-*.html` prefix, carry `noindex`, and are added
  to `robots.txt` Disallow.

## Data model additions

Migration `db/14_staff_crm.sql` (idempotent, transaction-wrapped, applied via `run-sql.mjs`):

1. **POS integration seam — columns on `profiles`:**
   - `pos_customer_id text unique` (nullable) — external id in the central POS.
   - `source text not null default 'website'` — record origin.
   - `last_synced_at timestamptz` (nullable) — last successful POS reconcile.
   No sync outbox/audit table yet (deferred to the connector phase).

2. **`customer_notes`** — `id uuid pk default gen_random_uuid()`,
   `customer_id uuid not null references profiles(id) on delete cascade`,
   `author_id uuid references profiles(id) on delete set null`,
   `body text not null`, `created_at timestamptz not null default now()`.
   Index on `(customer_id, created_at desc)`. RLS: staff SELECT (`is_staff()`), staff INSERT
   (`is_staff()` and `author_id = auth.uid()`); no customer/anon access; no update/delete in V1.

3. **`customer_tags`** — `customer_id uuid not null references profiles(id) on delete cascade`,
   `tag text not null check (char_length(tag) between 1 and 40)`,
   `author_id uuid references profiles(id) on delete set null`,
   `created_at timestamptz not null default now()`, `primary key (customer_id, tag)`.
   Freeform tags, no separate tag catalog in V1. RLS: staff SELECT + INSERT + DELETE
   (`is_staff()`); no customer/anon access.

4. **`crm_metrics()` RPC** — a single `SECURITY DEFINER` function returning **`json`** so it can
   bundle both the tiles and the trend series in one call:
   `{ total_customers, new_this_month, paid_orders, revenue_thb, aov_thb,
   by_month: [{month, new_customers, revenue_thb}] }`. `stable`. Opens with an
   `if not public.is_staff() then raise exception 'forbidden'; end if;` guard (so aggregates
   never leak to a non-staff caller), granted to `authenticated`.

## Pages & UI surface

Two new `requireStaff`-gated pages; dark header; site craft (Cormorant Garamond + Raleway,
`css/base.css` tokens, `.btn--*`, layered shadows — no default Tailwind palette). Externalized
scripts per the CSP `script-src 'self'` convention.

- **`admin-customers.html`** — CRM home:
  - **Metrics strip:** total customers · new this month · paid orders · revenue (THB) · AOV,
    plus one **by-month trend** chart (new customers or revenue). Chart built with the
    **dataviz skill** for a coherent, theme-aware (light/dark) treatment.
  - **Customer table:** name, email, phone, signup date, order count, lifetime total, tags.
    Server-side `?q=` search (reuse the shop-search debounce + stale-response generation guard),
    paginated. Rows link to the detail page.
- **`admin-customer.html?id=<uuid>`** — one customer's record:
  - Contact block: name, email, phone, newsletter status, `source`, `pos_customer_id` (if set).
  - Orders + payments history (from `orders`/`payments`).
  - Latest measurements (4 kinds via `v_latest_*`).
  - **Notes** (add + list) and **tags** (add + remove) — the only write surfaces in V1.

New JS:
- `js/crm.js` — staff data layer: customer list/search, single-customer aggregate load
  (profile + orders + payments + measurements), notes/tags CRUD, metrics fetch.
- `js/admin-customers-page.js`, `js/admin-customer-page.js` — page controllers (externalized).
- `js/auth.js` — add `requireStaff()`; extend header account-link logic if needed.

## Testing & verification

- **`scripts/test-admin-rls.mjs`** (critical; mirrors `test-rls-audit.mjs` rigor, non-vacuous):
  create a staff user + two customers A/B with seeded orders/payments/measurements.
  - Staff CAN SELECT A's and B's profile, orders, payments, measurements (readback, not just
    no-error).
  - Staff CAN insert a note + tag for A and read them back; author_id enforced = staff uid.
  - Customer A STILL cannot read B's profile/orders/payments/measurements, and cannot
    read/write `customer_notes`/`customer_tags` at all.
  - Anon cannot read any of it.
- **`scripts/test-crm-metrics.mjs`** — the RPC returns correct aggregates for seeded data;
  raises/blocks for a non-staff caller.
- **`scripts/test-admin-pages.mjs`** (puppeteer): non-staff bounced from both admin pages;
  staff sees the list, `?q=` filters, detail loads, note + tag round-trip in the UI.
- **Regression:** `test-rls-audit.mjs` (still green — owner-only unaffected), token-discipline,
  layout-mount, CSP sweep extended to the 2 new pages (now ~16 pages).
- **Visual:** screenshot both admin pages at 1440 + 375, 2 comparison rounds.

## Scope boundaries (explicitly deferred / out of scope)

- **POS connector / bidirectional sync** — NOT built. Only the 3-field seam
  (`pos_customer_id`, `source`, `last_synced_at`). Its own future phase once the POS exposes an
  API and a data contract exists.
- **Sub-project B** (customer-facing account enhancements) — separate later spec.
- **Full analytics dashboard (#8)** — V1 is the lightweight metrics strip + one trend only.
- **Staff-invite UI, role-management screen, note edit/delete, tag catalog, bulk actions,
  CSV export** — not in V1.
- No changes to customer-facing owner-only behavior; no changes to checkout/orders writing path.

## Files (anticipated)

| File | Change |
|---|---|
| `db/14_staff_crm.sql` | NEW — is_staff(), staff-read policies, POS seam columns, customer_notes, customer_tags, crm_metrics() |
| `js/auth.js` | add `requireStaff()` |
| `js/crm.js` | NEW — staff data layer |
| `admin-customers.html` + `js/admin-customers-page.js` | NEW — CRM home (metrics + table) |
| `admin-customer.html` + `js/admin-customer-page.js` | NEW — customer detail (orders/payments/measurements/notes/tags) |
| `robots.txt` | Disallow the 2 new admin pages |
| `scripts/test-admin-rls.mjs`, `scripts/test-crm-metrics.mjs`, `scripts/test-admin-pages.mjs` | NEW — tests |
| `scripts/test-csp-compliance.mjs` | extend to the 2 new pages |
| `PROJECT.md` | update on completion (Phase 5 A shipped, backlog #8/#9) |
