# Phase 2 — Stripe Full Checkout (design)

**Date:** 2026-07-09
**Phase:** 2 (Commerce), sub-project 3 of 3 — follows the shipped cart dual-mode.
**Status:** design approved; ready for implementation plan.

## 1. Goal

Let a signed-in customer pay for the garments in their cart with a real card
payment, producing a durable `orders` record and a `payments` record, confirmed
authoritatively by a Stripe webhook. This is the first server-side code in the
project (previously static HTML + client-side Supabase + local `scripts/`).

## 2. Product decisions (locked)

| Decision | Value |
|---|---|
| What is charged | **Full garment amount upfront** (no deposit split). Measurements/fittings happen after payment. |
| Account requirement | **Must be signed in to check out.** A signed-out user hitting checkout is routed to `login.html?next=cart.html`. Every order attaches to a `profiles` row at creation. |
| Consultation flow | **Kept.** `cart.html` keeps **Reserve Consultation** as a secondary CTA; **Proceed to Checkout** becomes the primary CTA. |
| Server runtime | **Supabase Edge Functions (Deno).** Same platform/project, runs with `service_role`, works regardless of static host. |
| Integration style | **Stripe Checkout (hosted redirect).** Lightest PCI burden, fastest secure path. Embedded Payment Element is the documented future upgrade. |
| Checkout branding | **Brand-themed** via Stripe Dashboard Branding (CRF logo, jet `#0E0F11` brand color, stone `#B6ADA5` accent) + per-session `custom_text`/`submit_type`. Limitation: hosted Checkout cannot load custom fonts (Cormorant/Raleway); type will not be pixel-identical to the site. Full type control would require the embedded Payment Element (deferred). |
| Confirmation email | **Deferred to pre-launch** (rides on the SMTP work already flagged). V1 relies on the on-site confirmation page. |

## 3. End-to-end flow

1. Signed-in user on `cart.html` clicks **Proceed to Checkout**. Signed-out →
   redirect to `login.html?next=cart.html`.
2. `js/checkout.js` calls `supabase.functions.invoke('create-checkout-session')`
   (JWT passed automatically). **No cart data is sent from the client.**
3. `create-checkout-session`:
   - Authenticates the user from the JWT; rejects anon (401).
   - Reads the user's `carts` row **from the DB** (never trusts client input).
   - Validates `items[]` shape; **re-resolves every line's unit price** from
     `item_type_fabrics` (+ `fabric_design_price_overrides`) via
     `item_type_id` + `fabric_design_id → fabric_type_id`.
   - Rejects empty/invalid carts.
   - Inserts an `orders` row (`status='pending'`, server-resolved `items`
     snapshot + `total_thb`).
   - Creates a branded Stripe Checkout Session (`mode=payment`,
     `currency=thb`, line items from resolved prices ×100 → satang,
     `client_reference_id=user_id`, `metadata.order_id`, `custom_text`,
     `success_url=/order-confirmation.html?order=<id>`,
     `cancel_url=/cart.html`).
   - Stores `stripe_checkout_session_id` on the order; returns `{ url }`.
4. Browser redirects to Stripe's hosted page. Success → `order-confirmation.html`;
   cancel → `cart.html`.
5. `stripe-webhook` (Stripe → server, authoritative):
   - Verifies the Stripe signature (`STRIPE_WEBHOOK_SECRET`).
   - `checkout.session.completed` → mark order `paid`, record
     `stripe_payment_intent_id`, insert a `payments` row, **clear the user's
     server `carts` row**.
   - `checkout.session.expired` / async failure → `canceled` / `failed`.
   - Idempotent (keyed on `stripe_event_id` / current order status); a replayed
     event is a no-op.
   - Always returns 200 on handled events.

The webhook — not the browser redirect — is the source of truth for `paid`.

## 4. Data model (`db/11_orders.sql`)

Two new tables. **Both are written only by Edge Functions via `service_role`
(which bypasses RLS).** Clients get read-only owner access.

### `orders`
- `id uuid pk default gen_random_uuid()`
- `user_id uuid references profiles(id) on delete set null` — nullable so paid
  order records survive PDPA account deletion (anonymized), rather than
  cascade-deleting financial history. Always set at creation (sign-in required).
- `status text not null default 'pending'` — check in
  (`pending`, `paid`, `failed`, `canceled`). Fulfillment states
  (in-production, delivered) are Phase 5 admin scope — out of scope here.
- `currency text not null default 'thb'`
- `total_thb integer not null` — whole baht, matching catalogue `price`.
- `items jsonb not null` — authoritative server-resolved snapshot:
  `[{ item_type_id, fabric_design_id, unit_price_thb, qty, line_total_thb,
  customizations, display_name }]`. **Not** the client-written `carts.items` blob.
- `stripe_checkout_session_id text`
- `stripe_payment_intent_id text`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

### `payments`
- `id uuid pk default gen_random_uuid()`
- `order_id uuid not null references orders(id) on delete cascade`
- `stripe_payment_intent_id text`
- `stripe_event_id text unique` — idempotency key for webhook replays.
- `amount_thb integer not null`
- `currency text not null default 'thb'`
- `status text not null` — check in (`succeeded`, `failed`, `refunded`).
- `raw jsonb` — event payload for audit (nullable).
- `created_at timestamptz not null default now()`

### RLS (owner read-only; all writes via Edge Functions)
- Enable RLS on both tables.
- `orders`: **SELECT** policy `to authenticated using (auth.uid() = user_id)`.
  No INSERT/UPDATE/DELETE policies → clients cannot forge orders or amounts.
- `payments`: **SELECT** policy `to authenticated using (auth.uid() = (select
  o.user_id from public.orders o where o.id = payments.order_id))`. No write
  policies.
- All policies `public.`-qualified, `to authenticated`, consistent with the
  `carts` migration.

Amount convention: store **whole-THB integers** everywhere in Postgres; multiply
by 100 (→ satang) **only** at the Stripe API boundary in the Edge Function.

## 5. Edge Functions (`supabase/functions/`)

First server-side code in the repo. Deno runtime.

```
supabase/
├── config.toml                          # [functions.stripe-webhook] verify_jwt = false
└── functions/
    ├── _shared/
    │   ├── cors.ts                       # CORS headers for the invoke call
    │   ├── stripe.ts                     # Stripe client from STRIPE_SECRET_KEY
    │   ├── supabase-admin.ts             # service_role client
    │   └── resolve-cart.ts               # shape-validate + re-price from catalogue
    ├── create-checkout-session/index.ts  # verify_jwt = true (auth required)
    └── stripe-webhook/index.ts           # verify_jwt = false; Stripe signature instead
```

- `resolve-cart.ts` is the trust boundary: given a `user_id`, it reads the
  `carts` row, validates each line's shape, resolves each unit price from the
  catalogue, and returns a clean, priced `items[]` + `total_thb`. Pure-ish and
  independently testable.
- `create-checkout-session` — `verify_jwt = true`. Anon/empty/invalid → 4xx.
- `stripe-webhook` — `verify_jwt = false` (Stripe can't send a Supabase JWT);
  security is the Stripe signature check. Idempotent.

**Secrets:** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` via
`supabase secrets set`. `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` are
auto-injected in the Edge runtime.

## 6. Client surface

- **`js/checkout.js`** (new) — wires the cart CTA: `requireAuth` (redirect
  signed-out to `login.html?next=cart.html`) → `functions.invoke(
  'create-checkout-session')` → `window.location = url`. Surfaces friendly
  errors (empty cart; a price changed since the item was added).
- **`cart.html`** — add **Proceed to Checkout** primary CTA; keep **Reserve
  Consultation** secondary. Wire `js/checkout.js`.
- **`order-confirmation.html`** (new) — `requireAuth`; reads `?order=<id>` via
  owner-RLS; renders order summary + full customization spec sheet + status.
  If `pending` (webhook lag), shows "confirming payment…" and polls a few times
  before falling back to a "we'll email you" message.
- **`account.html`** — add a basic **Orders** section (date · total · status,
  each linking to `order-confirmation.html`).
- **CSP** — hosted Checkout is a full-page *redirect* (not an iframe); the
  `invoke` call is same-origin to `*.supabase.co` (already allowed). **No
  `js.stripe.com` needed.** `order-confirmation.html` gets the standard per-page
  CSP `<head>` block; add it to the `test-csp-compliance` PAGES list.

## 7. Security / trust rules (from PROJECT.md)

1. **Never trust the client cart.** Prices are re-resolved server-side from the
   catalogue in `resolve-cart.ts`; the client's `price_thb` is ignored.
2. **Validate `items[]` shape** — known `item_type_id` + `fabric_design_id`,
   qty in 1..99; malformed lines reject the whole session.
3. **Orders/payments are write-locked to Edge Functions** (`service_role`); RLS
   gives clients read-only owner access. Clients cannot INSERT/UPDATE amounts.
4. **Webhook is authoritative** for `paid`, and idempotent via
   `stripe_event_id` (unique) so replays/duplicate deliveries are no-ops.

## 8. Testing

Node-script + puppeteer convention (scripts read `.env.local` manually). Adds
Stripe test mode + `stripe listen`.

- `test-checkout-price-resolution.mjs` — tampered client cart / wrong
  `price_thb` is ignored (server re-prices); empty cart rejected;
  unauthenticated `invoke` → 401.
- `test-orders-rls.mjs` — owner-only SELECT on `orders`/`payments`; cross-user
  isolation; clients cannot INSERT/UPDATE orders.
- `test-webhook-handler.mjs` — POST a Stripe-signed test event → order `paid` +
  `payments` row + server cart cleared; re-POST same event → idempotent no-op.
- `test-checkout-flow.mjs` (puppeteer) — signed-in → **Proceed to Checkout** →
  lands on Stripe's branded hosted page (assert redirect + session). The full
  card→webhook leg runs against Stripe test mode with `stripe listen`, kept
  separate from the UI assertion since live-Stripe e2e is inherently flakier.
- Extend `scripts/test-csp-compliance.mjs` PAGES with `order-confirmation.html`.

New toolchain: **Supabase CLI + Deno** (functions, `supabase functions serve`),
**Stripe CLI** (`stripe listen`, test cards).

## 9. Config & pre-launch

**Now (test mode):**
- `.env.local` (gitignored): add `STRIPE_SECRET_KEY` (test),
  `STRIPE_WEBHOOK_SECRET` (from `stripe listen`). No publishable key needed on
  the client (hosted redirect).
- `supabase secrets set STRIPE_SECRET_KEY=… STRIPE_WEBHOOK_SECRET=…` for
  deployed functions.
- Stripe Dashboard → Branding: CRF logo, jet brand color, stone accent
  (test mode).

**Pre-launch (documented, not done here):**
- Activate the Stripe account (Thai bank + identity) → **live keys** + register
  the **live webhook endpoint**.
- Order-confirmation **email** (rides on the launch SMTP work).
- Unchanged existing pre-launch items: re-enable Supabase email confirmation
  (`mailer_autoconfirm` currently true), custom SMTP.

## 10. Out of scope (later phases)

- Deposit / balance-at-fitting split (chose full-upfront).
- Guest checkout (chose sign-in required).
- Refunds / disputes UI, fulfillment lifecycle states — Phase 5 admin.
- Embedded Payment Element / fully on-brand type — future upgrade.
- Order-confirmation email — pre-launch.
- Normalized `order_items` table — V1 uses a jsonb snapshot on `orders`,
  consistent with the cart's customization blob; revisit if admin/analytics
  (Phase 5) need relational order lines.
