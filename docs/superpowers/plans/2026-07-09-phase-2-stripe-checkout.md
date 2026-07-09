# Stripe Full Checkout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a signed-in customer pay the full garment amount for their cart via Stripe Checkout (hosted), producing durable `orders` + `payments` records confirmed by a Stripe webhook.

**Architecture:** Two Supabase Edge Functions (Deno) — `create-checkout-session` (auth-required; re-prices the server cart, creates an order + a branded Stripe Checkout Session) and `stripe-webhook` (signature-verified; authoritatively marks the order paid, writes the payment, clears the server cart). The browser only ever *reads* its own orders via RLS; every write goes through a function using `service_role`. Client surface: a `Proceed to Checkout` CTA on `cart.html`, a new `order-confirmation.html`, and an Orders list on `account.html`.

**Tech Stack:** Supabase Edge Functions (Deno), Supabase CLI, Stripe (hosted Checkout), Stripe CLI (`stripe listen`), Postgres (via `scripts/run-sql.mjs`), vanilla ES-module frontend, Node test scripts (puppeteer + `@supabase/supabase-js`).

**Spec:** [docs/superpowers/specs/2026-07-09-phase-2-stripe-checkout-design.md](../specs/2026-07-09-phase-2-stripe-checkout-design.md)

**Conventions to honor (from the codebase):**
- Test scripts read `.env.local` with the manual parser (no `dotenv`) and create test users via `admin.auth.admin.createUser({ email_confirm: true })`. Copy the header from `scripts/test-cart-rls.mjs`.
- Migrations run via `node scripts/run-sql.mjs db/<file>.sql` (never manual SQL Editor). Idempotent DDL.
- RLS policies: `public.`-qualified, `to authenticated`, mirror `db/10_carts.sql`.
- Frontend auth uses `js/auth.js` (`getSupabase`, `requireAuth`, `getUser`). Client is `@supabase/supabase-js@2` from esm.sh.
- Amounts are whole-THB integers in Postgres; ×100 (→ satang) only at the Stripe boundary.

---

## File Structure

**Create:**
- `db/11_orders.sql` — `orders` + `payments` tables, RLS, indexes.
- `supabase/config.toml` — function config (`stripe-webhook` → `verify_jwt = false`).
- `supabase/functions/_shared/cors.ts` — CORS headers.
- `supabase/functions/_shared/clients.ts` — Stripe + service-role Supabase client factories.
- `supabase/functions/_shared/resolve-cart.ts` — shape-validate + re-price the server cart (trust boundary).
- `supabase/functions/create-checkout-session/index.ts` — auth-required session creator.
- `supabase/functions/stripe-webhook/index.ts` — signature-verified confirmer.
- `js/checkout.js` — cart CTA wiring (requireAuth → invoke → redirect).
- `order-confirmation.html` — post-payment page.
- `scripts/test-orders-rls.mjs`, `scripts/test-checkout-price-resolution.mjs`, `scripts/test-webhook-handler.mjs`, `scripts/test-checkout-flow.mjs`.

**Modify:**
- `.env.local` — add `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (test mode).
- `package.json` — add `stripe` devDependency (used only by tests to sign fake events).
- `cart.html` — add `Proceed to Checkout` CTA + import `js/checkout.js`.
- `account.html` — add Orders section.
- `scripts/test-csp-compliance.mjs` — add `order-confirmation.html` to `PAGES`.
- `PROJECT.md` — shipped inventory.

---

## Task 1: Toolchain + Supabase project scaffold

**Files:**
- Create: `supabase/config.toml` (via `supabase init`)
- Modify: `.env.local`, `.gitignore`

- [ ] **Step 1: Verify / install the CLIs**

Run:
```bash
supabase --version || brew install supabase/tap/supabase
stripe --version   || brew install stripe/stripe-cli/stripe
deno --version     || brew install deno
```
Expected: each prints a version. (Supabase Edge functions run on Deno; the CLI bundles a runtime, but a local `deno` helps editor tooling.)

- [ ] **Step 2: Initialize Supabase in the repo (non-destructive)**

Run: `supabase init`
Expected: creates `supabase/config.toml` (and a `supabase/.gitignore`). It does NOT touch the live project. If it prompts about VS Code settings, decline.

- [ ] **Step 3: Link the CLI to the live project**

Run: `supabase link --project-ref fzgsogdceptjvuahukbn`
Expected: `Finished supabase link.` (uses the DB password from `.env.local` `PGPASSWORD` if prompted).

- [ ] **Step 4: Create test-mode Stripe keys + add to `.env.local`**

In the Stripe Dashboard (Test mode), copy the **Secret key** (`sk_test_…`). Append to `.env.local` (gitignored — never commit):
```
STRIPE_SECRET_KEY=sk_test_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx   # filled in Task 5 from `stripe listen`
```
Leave `STRIPE_WEBHOOK_SECRET` as a placeholder for now.

- [ ] **Step 5: Ignore Supabase local temp dir**

Confirm `.gitignore` excludes `supabase/.temp` and `.env*` (already ignored). Add `supabase/.branches` and `supabase/.temp` if `supabase init` created a local `.gitignore` that doesn't cover them. Do NOT gitignore `supabase/functions` or `supabase/config.toml` — those are committed.

- [ ] **Step 6: Configure Stripe Checkout branding (test mode)**

In Stripe Dashboard → Settings → Branding: upload the CRF logo (`brand_assets/CRF Logo.png`), set brand color `#0E0F11` (jet), accent color `#B6ADA5` (stone). This themes the hosted Checkout page. (No code; recorded here as a required deliverable.)

- [ ] **Step 7: Commit the scaffold**

```bash
git add supabase/config.toml supabase/.gitignore .gitignore
git commit -m "chore: scaffold Supabase Edge Functions project (config + link)"
```

---

## Task 2: orders + payments schema + RLS (TDD)

**Files:**
- Create: `db/11_orders.sql`, `scripts/test-orders-rls.mjs`

- [ ] **Step 1: Write the failing RLS test**

Create `scripts/test-orders-rls.mjs` (header copied from `test-cart-rls.mjs`):
```js
// Phase 2 verification: orders/payments are owner-read-only and clients cannot write them.
// 1. Create users A + B (admin API, auto-confirmed).
// 2. Insert an order for A via service_role (simulating the Edge Function).
// 3. Assert A can SELECT it, B cannot, and neither can INSERT/UPDATE an order.
// 4. Insert a payment for A's order; assert same isolation via the join policy.
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8').split('\n').filter(Boolean)
    .map(l => l.split('=').map(s => s.trim())).map(([k, ...v]) => [k, v.join('=')]));
const URL = env.SUPABASE_URL, ANON = env.SUPABASE_ANON_KEY, SVC = env.SUPABASE_SERVICE_ROLE_KEY;
const admin = createClient(URL, SVC, { auth: { persistSession: false } });

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
const password = 'Test-Pass-123!';
let failed = false;
const step = (n, ok, d = '') => { console.log(`${ok ? '✔' : '✘'} ${n}${d ? '  — ' + d : ''}`); if (!ok) failed = true; };

let userA, userB, orderId;
try {
  userA = (await admin.auth.admin.createUser({ email: `ord-a-${stamp}@example.test`, password, email_confirm: true })).data.user;
  userB = (await admin.auth.admin.createUser({ email: `ord-b-${stamp}@example.test`, password, email_confirm: true })).data.user;

  // Edge Function role: service_role inserts A's order.
  const ins = await admin.from('orders').insert({
    user_id: userA.id, status: 'pending', total_thb: 20000,
    items: [{ item_type_id: 'formal-suit-2-piece', fabric_design_id: 'vbc-wool-grey-herringbone', unit_price_thb: 20000, qty: 1, line_total_thb: 20000, customizations: {} }],
  }).select('id').single();
  step('service_role inserts order', !ins.error, ins.error?.message);
  orderId = ins.data?.id;

  const pay = await admin.from('payments').insert({
    order_id: orderId, stripe_event_id: `evt_test_${stamp}`, amount_thb: 20000, status: 'succeeded',
  });
  step('service_role inserts payment', !pay.error, pay.error?.message);

  const anonA = createClient(URL, ANON, { auth: { persistSession: false } });
  const anonB = createClient(URL, ANON, { auth: { persistSession: false } });
  await anonA.auth.signInWithPassword({ email: `ord-a-${stamp}@example.test`, password });
  await anonB.auth.signInWithPassword({ email: `ord-b-${stamp}@example.test`, password });

  const aSees = await anonA.from('orders').select('id').eq('id', orderId);
  step('A sees own order', aSees.data?.length === 1, `len=${aSees.data?.length}`);
  const bSees = await anonB.from('orders').select('id').eq('id', orderId);
  step('B cannot see A order', (bSees.data?.length ?? 0) === 0);
  const aPay = await anonA.from('payments').select('id').eq('order_id', orderId);
  step('A sees own payment', aPay.data?.length === 1);
  const bPay = await anonB.from('payments').select('id').eq('order_id', orderId);
  step('B cannot see A payment', (bPay.data?.length ?? 0) === 0);

  const forge = await anonB.from('orders').insert({ user_id: userB.id, status: 'paid', total_thb: 1, items: [] });
  step('client INSERT blocked (no policy)', !!forge.error, forge.error ? 'blocked' : 'LEAK');
  const tamper = await anonA.from('orders').update({ status: 'paid' }).eq('id', orderId);
  const stillPending = (await admin.from('orders').select('status').eq('id', orderId).single()).data?.status;
  step('client UPDATE cannot flip status', stillPending === 'pending', `status=${stillPending}`);
} catch (e) { failed = true; console.error('threw:', e.message); }
finally {
  if (orderId) await admin.from('orders').delete().eq('id', orderId).catch(() => {});
  if (userA) await admin.auth.admin.deleteUser(userA.id).catch(() => {});
  if (userB) await admin.auth.admin.deleteUser(userB.id).catch(() => {});
}
if (failed) { console.error('\n❌ orders RLS test failed'); process.exit(1); }
console.log('\n✅ orders/payments owner-read-only + write-locked');
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node scripts/test-orders-rls.mjs`
Expected: FAIL — `relation "public.orders" does not exist` (or insert error).

- [ ] **Step 3: Write the migration**

Create `db/11_orders.sql`:
```sql
-- Phase 2 — orders + payments. Written ONLY by Edge Functions (service_role).
-- Clients get owner-only SELECT; no client write policies exist.
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  status text not null default 'pending'
    check (status in ('pending','paid','failed','canceled')),
  currency text not null default 'thb',
  total_thb integer not null check (total_thb >= 0),
  items jsonb not null default '[]'::jsonb,
  stripe_checkout_session_id text,
  stripe_payment_intent_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  stripe_payment_intent_id text,
  stripe_event_id text unique,
  amount_thb integer not null check (amount_thb >= 0),
  currency text not null default 'thb',
  status text not null check (status in ('succeeded','failed','refunded')),
  raw jsonb,
  created_at timestamptz not null default now()
);

create index if not exists orders_user_id_idx on public.orders (user_id);
create index if not exists orders_session_idx on public.orders (stripe_checkout_session_id);
create index if not exists payments_order_id_idx on public.payments (order_id);

alter table public.orders enable row level security;
alter table public.payments enable row level security;

-- Owner-only SELECT. No INSERT/UPDATE/DELETE policies → clients cannot write.
drop policy if exists "orders_select_own" on public.orders;
create policy "orders_select_own" on public.orders
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "payments_select_own" on public.payments;
create policy "payments_select_own" on public.payments
  for select to authenticated using (
    auth.uid() = (select o.user_id from public.orders o where o.id = payments.order_id)
  );
```

- [ ] **Step 4: Apply it**

Run: `node scripts/run-sql.mjs db/11_orders.sql`
Expected: no errors (idempotent).

- [ ] **Step 5: Run the test to verify it passes**

Run: `node scripts/test-orders-rls.mjs`
Expected: `✅ orders/payments owner-read-only + write-locked`.

- [ ] **Step 6: Commit**

```bash
git add db/11_orders.sql scripts/test-orders-rls.mjs
git commit -m "feat: orders + payments schema with owner-read-only RLS"
```

---

## Task 3: shared Edge helpers (CORS + clients + cart resolver)

**Files:**
- Create: `supabase/functions/_shared/cors.ts`, `supabase/functions/_shared/clients.ts`, `supabase/functions/_shared/resolve-cart.ts`

- [ ] **Step 1: CORS headers**

Create `supabase/functions/_shared/cors.ts`:
```ts
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
```

- [ ] **Step 2: Client factories**

Create `supabase/functions/_shared/clients.ts`:
```ts
import Stripe from 'https://esm.sh/stripe@18.5.0?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2025-08-27.basil',
  httpClient: Stripe.createFetchHttpClient(),
});

// service_role client — bypasses RLS. Used for all order/payment writes.
export function adminClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );
}

// Resolve the caller's user id from the Authorization header (create-session only).
export async function callerUserId(authHeader: string | null): Promise<string | null> {
  if (!authHeader) return null;
  const anon = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } },
  );
  const { data, error } = await anon.auth.getUser();
  if (error) return null;
  return data.user?.id ?? null;
}
```

- [ ] **Step 3: Cart resolver (the trust boundary)**

Create `supabase/functions/_shared/resolve-cart.ts`:
```ts
import { adminClient } from './clients.ts';

export type ResolvedLine = {
  item_type_id: string;
  fabric_design_id: string;
  unit_price_thb: number;
  qty: number;
  line_total_thb: number;
  customizations: Record<string, unknown>;
  display_name: string;
};

export type ResolveResult =
  | { ok: true; items: ResolvedLine[]; total_thb: number }
  | { ok: false; error: string };

// Reads the user's server cart, validates shape, and RE-PRICES every line from
// the catalogue. The client-supplied price_thb is never trusted.
export async function resolveCart(userId: string): Promise<ResolveResult> {
  const db = adminClient();

  const { data: cart, error: cartErr } = await db
    .from('carts').select('items').eq('user_id', userId).maybeSingle();
  if (cartErr) return { ok: false, error: 'cart_read_failed' };
  const rawItems = Array.isArray(cart?.items) ? cart!.items : [];
  if (rawItems.length === 0) return { ok: false, error: 'cart_empty' };

  const resolved: ResolvedLine[] = [];
  let total = 0;

  for (const raw of rawItems) {
    const item_type_id = raw?.item_type_id;
    const fabric_design_id = raw?.fabric_design_id;
    const qty = Math.max(1, Math.min(99, Math.floor(Number(raw?.qty) || 1)));
    if (typeof item_type_id !== 'string' || typeof fabric_design_id !== 'string') {
      return { ok: false, error: 'invalid_line_shape' };
    }

    // v_products carries the resolved price + display name per (design × item type).
    const { data: prod, error: prodErr } = await db
      .from('v_products')
      .select('price, item_type_name, fabric_design_name')
      .eq('item_type_id', item_type_id)
      .eq('fabric_design_id', fabric_design_id)
      .maybeSingle();
    if (prodErr) return { ok: false, error: 'price_lookup_failed' };
    if (!prod || prod.price == null) return { ok: false, error: `unknown_product:${item_type_id}/${fabric_design_id}` };

    const unit = Math.round(Number(prod.price));
    const customizations = (raw?.customizations && typeof raw.customizations === 'object') ? raw.customizations : {};
    const line_total = unit * qty;
    total += line_total;
    resolved.push({
      item_type_id, fabric_design_id, unit_price_thb: unit, qty,
      line_total_thb: line_total, customizations,
      display_name: `${prod.fabric_design_name} — ${prod.item_type_name}`,
    });
  }
  return { ok: true, items: resolved, total_thb: total };
}
```

- [ ] **Step 4: Verify `v_products` exposes the fields used**

Run:
```bash
ANON=$(grep SUPABASE_ANON_KEY .env.local | cut -d= -f2-)
curl -s "https://fzgsogdceptjvuahukbn.supabase.co/rest/v1/v_products?fabric_design_id=eq.vbc-wool-grey-herringbone&item_type_id=eq.formal-suit-2-piece&select=price,item_type_name,fabric_design_name" -H "apikey: $ANON"
```
Expected: one row with `price` (e.g. `20000`), `item_type_name`, `fabric_design_name`.
If any column name differs, fix `resolve-cart.ts` to match the real `v_products` columns before proceeding (inspect with `select=*`).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared
git commit -m "feat: Edge shared helpers (cors, clients, cart re-pricing)"
```

---

## Task 4: create-checkout-session function (+ price-resolution test)

**Files:**
- Create: `supabase/functions/create-checkout-session/index.ts`, `scripts/test-checkout-price-resolution.mjs`
- Modify: `supabase/config.toml`

- [ ] **Step 1: Write the function**

Create `supabase/functions/create-checkout-session/index.ts`:
```ts
import { corsHeaders } from '../_shared/cors.ts';
import { stripe, adminClient, callerUserId } from '../_shared/clients.ts';
import { resolveCart } from '../_shared/resolve-cart.ts';

const SITE_URL = Deno.env.get('SITE_URL') ?? 'http://localhost:3000';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  const userId = await callerUserId(req.headers.get('Authorization'));
  if (!userId) return json({ error: 'unauthorized' }, 401);

  const resolved = await resolveCart(userId);
  if (!resolved.ok) return json({ error: resolved.error }, 400);

  const db = adminClient();
  const { data: order, error: orderErr } = await db.from('orders').insert({
    user_id: userId, status: 'pending', currency: 'thb',
    total_thb: resolved.total_thb, items: resolved.items,
  }).select('id').single();
  if (orderErr || !order) return json({ error: 'order_create_failed' }, 500);

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    client_reference_id: userId,
    metadata: { order_id: order.id },
    submit_type: 'pay',
    custom_text: { submit: { message: 'Your bespoke order begins after payment — we\'ll arrange your fitting next.' } },
    line_items: resolved.items.map((li) => ({
      quantity: li.qty,
      price_data: {
        currency: 'thb',
        unit_amount: li.unit_price_thb * 100, // THB → satang at the Stripe boundary
        product_data: { name: li.display_name },
      },
    })),
    success_url: `${SITE_URL}/order-confirmation.html?order=${order.id}`,
    cancel_url: `${SITE_URL}/cart.html`,
  });

  await db.from('orders').update({ stripe_checkout_session_id: session.id, updated_at: new Date().toISOString() }).eq('id', order.id);
  return json({ url: session.url, order_id: order.id });
});
```

- [ ] **Step 2: Register function config**

Edit `supabase/config.toml` — append:
```toml
[functions.create-checkout-session]
verify_jwt = true

[functions.stripe-webhook]
verify_jwt = false
```

- [ ] **Step 3: Set function secrets + serve locally**

Run:
```bash
supabase secrets set STRIPE_SECRET_KEY="$(grep '^STRIPE_SECRET_KEY=' .env.local | cut -d= -f2-)"
supabase functions serve --env-file .env.local --no-verify-jwt
```
(`--no-verify-jwt` locally lets the test send its own bearer; the deployed function keeps `verify_jwt=true`.) Leave this running in a second terminal. Local endpoint base: `http://localhost:54321/functions/v1/`.
Add `SITE_URL=http://localhost:3000` to `.env.local` so success/cancel URLs resolve locally.

- [ ] **Step 4: Write the failing trust test**

Create `scripts/test-checkout-price-resolution.mjs`:
```js
// Phase 2: create-checkout-session ignores the client cart price and re-prices
// server-side; rejects empty carts + unauthenticated callers.
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
const env = Object.fromEntries(fs.readFileSync('.env.local','utf8').split('\n').filter(Boolean)
  .map(l=>l.split('=').map(s=>s.trim())).map(([k,...v])=>[k,v.join('=')]));
const URL=env.SUPABASE_URL, ANON=env.SUPABASE_ANON_KEY, SVC=env.SUPABASE_SERVICE_ROLE_KEY;
const FN = env.FUNCTIONS_URL || 'http://localhost:54321/functions/v1';
const admin = createClient(URL, SVC, { auth: { persistSession: false } });
const stamp = `${Date.now()}-${Math.random().toString(36).slice(2,8)}`, password='Test-Pass-123!';
let failed=false; const step=(n,ok,d='')=>{console.log(`${ok?'✔':'✘'} ${n}${d?'  — '+d:''}`); if(!ok)failed=true;};

async function invoke(token, path='create-checkout-session') {
  const res = await fetch(`${FN}/${path}`, { method:'POST',
    headers:{ 'Content-Type':'application/json', ...(token?{Authorization:`Bearer ${token}`}:{}) }, body:'{}' });
  let body=null; try{ body=await res.json(); }catch{}
  return { status:res.status, body };
}

let user;
try {
  // Unauthenticated → 401
  const noauth = await invoke(null);
  step('unauthenticated rejected', noauth.status === 401, `status=${noauth.status}`);

  user = (await admin.auth.admin.createUser({ email:`co-${stamp}@example.test`, password, email_confirm:true })).data.user;
  const anon = createClient(URL, ANON, { auth:{ persistSession:false } });
  const { data: sess } = await anon.auth.signInWithPassword({ email:`co-${stamp}@example.test`, password });
  const token = sess.session.access_token;

  // Empty cart → 400 cart_empty
  const empty = await invoke(token);
  step('empty cart rejected', empty.status === 400 && empty.body?.error === 'cart_empty', JSON.stringify(empty.body));

  // TAMPERED price: client says 1 THB, catalogue is 20000.
  await admin.from('carts').upsert({ user_id:user.id, updated_at:new Date().toISOString(),
    items:[{ id:'crfln_x', item_type_id:'formal-suit-2-piece', fabric_design_id:'vbc-wool-grey-herringbone',
      price_thb:1, qty:1, customizations:{}, added_at:new Date().toISOString() }] }, { onConflict:'user_id' });
  const ok = await invoke(token);
  step('session created', ok.status === 200 && !!ok.body?.url, JSON.stringify(ok.body));

  const { data: order } = await admin.from('orders').select('total_thb,items,status').eq('id', ok.body.order_id).single();
  step('server re-priced (ignored client 1 THB)', order?.total_thb === 20000, `total=${order?.total_thb}`);
  step('order starts pending', order?.status === 'pending');
} catch(e){ failed=true; console.error('threw:', e.message); }
finally { if (user) await admin.auth.admin.deleteUser(user.id).catch(()=>{}); }
if (failed){ console.error('\n❌ price-resolution test failed'); process.exit(1);} 
console.log('\n✅ create-checkout-session re-prices server-side + guards auth/empty');
```

- [ ] **Step 5: Run it (functions server + this test)**

Run: `node scripts/test-checkout-price-resolution.mjs`
Expected: `✅ create-checkout-session re-prices server-side + guards auth/empty`.
If `unauthenticated rejected` fails with 401 from the platform (not the function body), that's still a pass on intent — but prefer the function's own 401 by serving with `--no-verify-jwt` so the check exercises `callerUserId`.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/create-checkout-session supabase/config.toml scripts/test-checkout-price-resolution.mjs
git commit -m "feat: create-checkout-session Edge Function (server re-pricing + order create)"
```

---

## Task 5: stripe-webhook function (+ idempotent handler test)

**Files:**
- Create: `supabase/functions/stripe-webhook/index.ts`, `scripts/test-webhook-handler.mjs`
- Modify: `package.json` (add `stripe` devDependency)

- [ ] **Step 1: Write the webhook function**

Create `supabase/functions/stripe-webhook/index.ts`:
```ts
import { stripe, adminClient } from '../_shared/clients.ts';
import Stripe from 'https://esm.sh/stripe@18.5.0?target=deno';

const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET')!;
const cryptoProvider = Stripe.createSubtleCryptoProvider();

Deno.serve(async (req) => {
  const sig = req.headers.get('Stripe-Signature');
  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, sig!, webhookSecret, undefined, cryptoProvider);
  } catch (err) {
    return new Response(`Bad signature: ${(err as Error).message}`, { status: 400 });
  }

  const db = adminClient();

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    const orderId = session.metadata?.order_id;
    if (!orderId) return new Response('no order_id', { status: 200 });

    // Idempotency: skip if this event was already recorded.
    const { data: seen } = await db.from('payments').select('id').eq('stripe_event_id', event.id).maybeSingle();
    if (seen) return new Response('duplicate', { status: 200 });

    const paymentIntentId = typeof session.payment_intent === 'string' ? session.payment_intent : null;
    const amount = Math.round((session.amount_total ?? 0) / 100); // satang → THB

    await db.from('orders').update({
      status: 'paid', stripe_payment_intent_id: paymentIntentId, updated_at: new Date().toISOString(),
    }).eq('id', orderId).eq('status', 'pending');

    await db.from('payments').insert({
      order_id: orderId, stripe_payment_intent_id: paymentIntentId, stripe_event_id: event.id,
      amount_thb: amount, currency: session.currency ?? 'thb', status: 'succeeded', raw: event as unknown as Record<string, unknown>,
    });

    // Clear the user's server cart (best-effort).
    if (session.client_reference_id) {
      await db.from('carts').update({ items: [], updated_at: new Date().toISOString() }).eq('user_id', session.client_reference_id);
    }
    return new Response('ok', { status: 200 });
  }

  if (event.type === 'checkout.session.expired') {
    const orderId = (event.data.object as Stripe.Checkout.Session).metadata?.order_id;
    if (orderId) await db.from('orders').update({ status: 'canceled', updated_at: new Date().toISOString() }).eq('id', orderId).eq('status', 'pending');
    return new Response('ok', { status: 200 });
  }

  return new Response('ignored', { status: 200 });
});
```

- [ ] **Step 2: Wire the local webhook secret**

In a terminal (Stripe CLI logged in): `stripe listen --forward-to http://localhost:54321/functions/v1/stripe-webhook`
Copy the printed `whsec_…` into `.env.local` as `STRIPE_WEBHOOK_SECRET`, then set it for the served functions:
```bash
supabase secrets set STRIPE_WEBHOOK_SECRET="$(grep '^STRIPE_WEBHOOK_SECRET=' .env.local | cut -d= -f2-)"
```
Restart `supabase functions serve --env-file .env.local --no-verify-jwt`.

- [ ] **Step 3: Add the `stripe` devDependency (test-only signer)**

Run: `npm install --save-dev stripe`
Expected: `package.json` gains `"stripe"` under devDependencies.

- [ ] **Step 4: Write the failing webhook test**

Create `scripts/test-webhook-handler.mjs`:
```js
// Phase 2: stripe-webhook marks the order paid, writes a payment, clears the
// cart, and is idempotent on replay. Uses the Stripe SDK to sign a fake event.
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import fs from 'node:fs';
const env = Object.fromEntries(fs.readFileSync('.env.local','utf8').split('\n').filter(Boolean)
  .map(l=>l.split('=').map(s=>s.trim())).map(([k,...v])=>[k,v.join('=')]));
const URL=env.SUPABASE_URL, SVC=env.SUPABASE_SERVICE_ROLE_KEY, WHSEC=env.STRIPE_WEBHOOK_SECRET;
const FN = env.FUNCTIONS_URL || 'http://localhost:54321/functions/v1';
const admin = createClient(URL, SVC, { auth:{ persistSession:false } });
const stripe = new Stripe('sk_test_dummy'); // only for generateTestHeaderString
const stamp=`${Date.now()}-${Math.random().toString(36).slice(2,8)}`, password='Test-Pass-123!';
let failed=false; const step=(n,ok,d='')=>{console.log(`${ok?'✔':'✘'} ${n}${d?'  — '+d:''}`); if(!ok)failed=true;};

async function post(payloadObj){
  const payload = JSON.stringify(payloadObj);
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret: WHSEC });
  const res = await fetch(`${FN}/stripe-webhook`, { method:'POST', headers:{ 'Stripe-Signature':header, 'Content-Type':'application/json' }, body:payload });
  return { status: res.status, text: await res.text() };
}

let user, orderId;
try {
  user = (await admin.auth.admin.createUser({ email:`wh-${stamp}@example.test`, password, email_confirm:true })).data.user;
  await admin.from('carts').upsert({ user_id:user.id, items:[{ item_type_id:'formal-suit-2-piece', fabric_design_id:'vbc-wool-grey-herringbone', price_thb:20000, qty:1, customizations:{} }], updated_at:new Date().toISOString() }, { onConflict:'user_id' });
  orderId = (await admin.from('orders').insert({ user_id:user.id, status:'pending', total_thb:20000, items:[] }).select('id').single()).data.id;

  const evtId = `evt_test_${stamp}`;
  const event = { id: evtId, object:'event', type:'checkout.session.completed',
    data:{ object:{ object:'checkout.session', metadata:{ order_id: orderId }, payment_intent:`pi_${stamp}`, amount_total:2000000, currency:'thb', client_reference_id:user.id } } };

  const badSig = await fetch(`${FN}/stripe-webhook`, { method:'POST', headers:{ 'Stripe-Signature':'t=1,v1=deadbeef' }, body:JSON.stringify(event) });
  step('bad signature rejected', badSig.status === 400, `status=${badSig.status}`);

  const r1 = await post(event);
  step('valid event accepted', r1.status === 200, r1.text);
  const o1 = (await admin.from('orders').select('status,stripe_payment_intent_id').eq('id', orderId).single()).data;
  step('order marked paid', o1?.status === 'paid', `status=${o1?.status}`);
  const pays = (await admin.from('payments').select('id,amount_thb').eq('order_id', orderId)).data;
  step('payment row written (20000 THB)', pays?.length === 1 && pays[0].amount_thb === 20000, JSON.stringify(pays));
  const cart = (await admin.from('carts').select('items').eq('user_id', user.id).single()).data;
  step('cart cleared', Array.isArray(cart?.items) && cart.items.length === 0);

  const r2 = await post(event); // replay
  step('replay is idempotent', r2.status === 200 && r2.text === 'duplicate', r2.text);
  const pays2 = (await admin.from('payments').select('id').eq('order_id', orderId)).data;
  step('no duplicate payment', pays2?.length === 1, `count=${pays2?.length}`);
} catch(e){ failed=true; console.error('threw:', e.message); }
finally { if (orderId) await admin.from('orders').delete().eq('id', orderId).catch(()=>{}); if (user) await admin.auth.admin.deleteUser(user.id).catch(()=>{}); }
if (failed){ console.error('\n❌ webhook handler test failed'); process.exit(1);} 
console.log('\n✅ webhook: paid + payment + cart clear, idempotent');
```

- [ ] **Step 5: Run it**

Run: `node scripts/test-webhook-handler.mjs`
Expected: `✅ webhook: paid + payment + cart clear, idempotent`.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/stripe-webhook scripts/test-webhook-handler.mjs package.json package-lock.json
git commit -m "feat: stripe-webhook Edge Function (authoritative paid + idempotent)"
```

---

## Task 6: cart CTA → checkout (`js/checkout.js` + cart.html)

**Files:**
- Create: `js/checkout.js`, `scripts/test-checkout-flow.mjs`
- Modify: `cart.html`

- [ ] **Step 1: Write `js/checkout.js`**

Create `js/checkout.js`:
```js
// Phase 2 — checkout entry. Signed-in only: requireAuth bounces guests to login,
// then invokes create-checkout-session and redirects to Stripe's hosted page.
import { getSupabase, getUser } from './auth.js';
import { readCart } from './cart.js';

// Flush the localStorage working copy to the server carts row BEFORE invoking, so
// create-checkout-session reads the current cart (cart-sync.js pushes on an 800ms
// debounce — a fast Checkout click could otherwise hit a stale server cart). Safe:
// the Edge Function re-prices and validates shape, trusting only item identity/qty.
async function flushCart(sb, userId) {
  const cart = readCart();
  await sb.from('carts').upsert(
    { user_id: userId, items: cart.items, updated_at: new Date().toISOString() },
    { onConflict: 'user_id' },
  );
}

async function startCheckout(btn) {
  const original = btn.textContent;
  btn.setAttribute('disabled', '');
  btn.textContent = 'Redirecting…';
  try {
    const user = await getUser();
    if (!user) { window.location.href = '/login.html?next=cart.html'; return; }
    const sb = getSupabase();
    await flushCart(sb, user.id);
    const { data, error } = await sb.functions.invoke('create-checkout-session', { body: {} });
    if (error || !data?.url) throw new Error(data?.error || error?.message || 'checkout_failed');
    window.location.href = data.url;
  } catch (e) {
    btn.removeAttribute('disabled');
    btn.textContent = original;
    const msg = document.querySelector('[data-checkout-error]');
    if (msg) msg.textContent = e.message === 'cart_empty'
      ? 'Your cart is empty.'
      : 'We couldn\'t start checkout. Please try again.';
  }
}

export function mountCheckout() {
  const btn = document.querySelector('[data-checkout-button]');
  if (!btn || btn.dataset.checkoutBound) return;
  btn.dataset.checkoutBound = '1';
  btn.addEventListener('click', (e) => { e.preventDefault(); startCheckout(btn); });
}

document.addEventListener('crf:layout-ready', mountCheckout, { once: true });
mountCheckout();
```

- [ ] **Step 2: Add the CTA to `cart.html`**

In `cart.html`, replace the `.cart-ctas` block (around line 510) with:
```html
<div class="cart-ctas" style="margin-top: 28px;">
  <button class="btn btn--primary" type="button" data-checkout-button>Proceed to Checkout</button>
  <a class="btn btn--ghost" id="reserveLink" href="#">Reserve Consultation</a>
  <a class="btn btn--ghost" href="shop.html">Continue Shopping</a>
</div>
<p class="checkout-error" data-checkout-error role="alert" aria-live="polite"></p>
```
(Keep the existing `reserveLink` href assignment — the spec param still populates it.)

- [ ] **Step 3: Import checkout.js in cart.html**

In the page's module `<script>` (the one importing `./js/cart.js`), add:
```js
import './js/checkout.js';
```

- [ ] **Step 4: Write the puppeteer flow test**

Create `scripts/test-checkout-flow.mjs`:
```js
// Phase 2: signed-out checkout → login redirect; signed-in checkout → invoke
// returns a Stripe URL and the browser navigates to checkout.stripe.com.
import puppeteer from 'puppeteer';
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
const env = Object.fromEntries(fs.readFileSync('.env.local','utf8').split('\n').filter(Boolean)
  .map(l=>l.split('=').map(s=>s.trim())).map(([k,...v])=>[k,v.join('=')]));
const URL=env.SUPABASE_URL, ANON=env.SUPABASE_ANON_KEY, SVC=env.SUPABASE_SERVICE_ROLE_KEY;
const admin = createClient(URL, SVC, { auth:{ persistSession:false } });
const stamp=`${Date.now()}-${Math.random().toString(36).slice(2,8)}`, password='Test-Pass-123!';
let failed=false; const step=(n,ok,d='')=>{console.log(`${ok?'✔':'✘'} ${n}${d?'  — '+d:''}`); if(!ok)failed=true;};

let user, browser;
try {
  user = (await admin.auth.admin.createUser({ email:`flow-${stamp}@example.test`, password, email_confirm:true })).data.user;
  await admin.from('carts').upsert({ user_id:user.id, updated_at:new Date().toISOString(),
    items:[{ item_type_id:'formal-suit-2-piece', fabric_design_id:'vbc-wool-grey-herringbone', price_thb:20000, qty:1, customizations:{} }] }, { onConflict:'user_id' });

  browser = await puppeteer.launch({ headless:'new', args:['--no-sandbox'] });
  const page = await browser.newPage();

  // Signed-OUT: guest cart with an item → checkout bounces to /login.html
  await page.goto('http://localhost:3000/cart.html', { waitUntil:'networkidle0' });
  await page.evaluate(() => localStorage.setItem('crf.cart.v1', JSON.stringify({ items:[{ id:'x', item_type_id:'formal-suit-2-piece', fabric_design_id:'vbc-wool-grey-herringbone', price_thb:20000, qty:1, customizations:{}, added_at:new Date().toISOString() }], updated_at:new Date().toISOString() })));
  await page.reload({ waitUntil:'networkidle0' });
  await page.click('[data-checkout-button]');
  await page.waitForNavigation({ waitUntil:'domcontentloaded' }).catch(()=>{});
  step('signed-out → login redirect', page.url().includes('/login.html'), page.url());

  // Signed-IN: log in via the SDK in-page, then checkout → Stripe URL
  await page.goto('http://localhost:3000/login.html', { waitUntil:'networkidle0' });
  await page.type('#email', `flow-${stamp}@example.test`);
  await page.type('#password', password);
  await Promise.all([ page.waitForNavigation({ waitUntil:'networkidle0' }).catch(()=>{}), page.click('button[type="submit"]') ]);
  await page.goto('http://localhost:3000/cart.html', { waitUntil:'networkidle0' });
  await Promise.all([
    page.waitForNavigation({ waitUntil:'domcontentloaded', timeout:15000 }).catch(()=>{}),
    page.click('[data-checkout-button]'),
  ]);
  step('signed-in → Stripe checkout', /checkout\.stripe\.com|stripe/.test(page.url()), page.url());
} catch(e){ failed=true; console.error('threw:', e.message); }
finally { if (browser) await browser.close().catch(()=>{}); if (user) await admin.auth.admin.deleteUser(user.id).catch(()=>{}); }
if (failed){ console.error('\n❌ checkout flow test failed'); process.exit(1);} 
console.log('\n✅ checkout flow: guest→login, signed-in→Stripe');
```
Note: requires `serve.mjs` on :3000 AND `supabase functions serve` running. If `#email`/`#password`/submit selectors differ in `login.html`, adjust to the real selectors (grep the file first).

- [ ] **Step 5: Run it**

Run: `node scripts/test-checkout-flow.mjs`
Expected: `✅ checkout flow: guest→login, signed-in→Stripe`.

- [ ] **Step 6: Commit**

```bash
git add js/checkout.js cart.html scripts/test-checkout-flow.mjs
git commit -m "feat: cart Proceed to Checkout CTA + Stripe redirect"
```

---

## Task 7: order-confirmation.html

**Files:**
- Create: `order-confirmation.html`
- Modify: `scripts/test-csp-compliance.mjs`

- [ ] **Step 1: Build the page**

Create `order-confirmation.html` modeled on `account.html` (copy its `<head>`: the CSP `<meta>` block, Google Fonts, `css/base.css`, and the `js/layout.js` / `js/meta.js` module tags + the `data-layout="header"/"footer"` slots). Between the slots, add:
```html
<main class="order-confirm-wrap">
  <section class="order-confirm-card">
    <p class="order-confirm-eyebrow">Country Road Fashions</p>
    <h1 class="order-confirm-title" data-order-title>Confirming your order…</h1>
    <p class="order-confirm-status" data-order-status aria-live="polite">Please wait while we confirm your payment.</p>
    <div class="order-confirm-summary" data-order-summary hidden></div>
    <div class="order-confirm-ctas">
      <a class="btn btn--ghost" href="shop.html">Continue Shopping</a>
      <a class="btn btn--ghost" href="account.html">View Account</a>
    </div>
  </section>
</main>
<script type="module">
  import { requireAuth, getSupabase } from './js/auth.js';
  await requireAuth({ redirectTo: '/login.html' });
  const params = new URLSearchParams(location.search);
  const orderId = params.get('order');
  const sb = getSupabase();
  const titleEl = document.querySelector('[data-order-title]');
  const statusEl = document.querySelector('[data-order-status]');
  const summaryEl = document.querySelector('[data-order-summary]');
  const fmtTHB = (n) => 'THB ' + Number(n).toLocaleString('en-US');

  function renderSummary(order) {
    summaryEl.hidden = false;
    summaryEl.innerHTML = (order.items || []).map(li => `
      <div class="order-line">
        <span class="order-line-name">${li.display_name ?? li.fabric_design_id} × ${li.qty}</span>
        <span class="order-line-price">${fmtTHB(li.line_total_thb ?? (li.unit_price_thb * li.qty))}</span>
      </div>`).join('') +
      `<div class="order-line order-line--total"><span>Total</span><span>${fmtTHB(order.total_thb)}</span></div>`;
  }

  async function load(attempt = 0) {
    if (!orderId) { titleEl.textContent = 'Order not found'; statusEl.textContent = 'Missing order reference.'; return; }
    const { data: order } = await sb.from('orders').select('status,total_thb,items').eq('id', orderId).maybeSingle();
    if (!order) { titleEl.textContent = 'Order not found'; statusEl.textContent = 'We could not find this order on your account.'; return; }
    renderSummary(order);
    if (order.status === 'paid') {
      titleEl.textContent = 'Thank you — your order is confirmed';
      statusEl.textContent = 'We\'ve received your payment and will be in touch to arrange your fitting.';
    } else if (order.status === 'pending' && attempt < 5) {
      setTimeout(() => load(attempt + 1), 1500); // webhook lag
    } else if (order.status === 'pending') {
      titleEl.textContent = 'Payment processing';
      statusEl.textContent = 'Your payment is still processing. We\'ll email you once it\'s confirmed.';
    } else {
      titleEl.textContent = 'Payment not completed';
      statusEl.textContent = 'This order was not paid. You can try checking out again from your cart.';
    }
  }
  load();
</script>
```
Add matching styles in the page's inline `<style>` (reuse `css/base.css` tokens: `--color-jet`, `--color-stone`, `--color-cream`; Cormorant title, Raleway body; card with a low-opacity tinted shadow). Use the dark header (default) — this is not a landing surface.

- [ ] **Step 2: Add the page to the CSP sweep**

In `scripts/test-csp-compliance.mjs`, add `'order-confirmation.html'` to the `PAGES` array.

- [ ] **Step 3: Run the CSP sweep**

Run: `node scripts/test-csp-compliance.mjs`
Expected: zero violations across all pages incl. `order-confirmation.html`.

- [ ] **Step 4: Visual check**

Run:
```bash
node screenshot.mjs "http://localhost:3000/order-confirmation.html?order=none" confirm
```
Read `temporary screenshots/screenshot-N-confirm.png`. Expected: branded card, dark header/footer mounted, "Order not found" state (no auth session in the shot is fine — verify layout/typography only). Do a second pass and fix spacing/type mismatches vs `account.html`.

- [ ] **Step 5: Commit**

```bash
git add order-confirmation.html scripts/test-csp-compliance.mjs
git commit -m "feat: order-confirmation page (owner-read, webhook-lag polling)"
```

---

## Task 8: account.html Orders section

**Files:**
- Modify: `account.html`

- [ ] **Step 1: Add an Orders section + nav entry**

In `account.html`, add a new section (matching the existing section pattern — a nav item in the sticky section nav + a content block):
```html
<section id="orders" class="account-section">
  <h2 class="account-section-title">Orders</h2>
  <div data-orders-list class="orders-list"><p class="orders-empty">Loading…</p></div>
</section>
```
Add `<a href="#orders">Orders</a>` to the sticky section nav alongside the existing Profile/Measurements links.

- [ ] **Step 2: Populate it from the module script**

In `account.html`'s existing module `<script>` (already has `requireAuth` + `getSupabase`/profile calls), append:
```js
async function loadOrders() {
  const el = document.querySelector('[data-orders-list]');
  if (!el) return;
  const sb = getSupabase();
  const { data: orders, error } = await sb.from('orders')
    .select('id,status,total_thb,created_at').order('created_at', { ascending: false });
  if (error) { el.innerHTML = '<p class="orders-empty">Could not load orders.</p>'; return; }
  if (!orders?.length) { el.innerHTML = '<p class="orders-empty">No orders yet.</p>'; return; }
  const fmtTHB = (n) => 'THB ' + Number(n).toLocaleString('en-US');
  const fmtDate = (s) => new Date(s).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' });
  el.innerHTML = orders.map(o => `
    <a class="order-row" href="order-confirmation.html?order=${o.id}">
      <span class="order-row-date">${fmtDate(o.created_at)}</span>
      <span class="order-row-status order-row-status--${o.status}">${o.status}</span>
      <span class="order-row-total">${fmtTHB(o.total_thb)}</span>
    </a>`).join('');
}
loadOrders();
```
(Ensure `getSupabase` is imported in that script; add it to the existing `import { … } from './js/auth.js'` line if absent.)

- [ ] **Step 3: Style the list**

Add `.orders-list`, `.order-row`, `.order-row-status--paid/pending/failed/canceled`, `.orders-empty` rules to the page's inline `<style>` using base.css tokens (paid = a muted green tint, pending = stone, failed/canceled = a muted red tint; keep it editorial, low-saturation).

- [ ] **Step 4: Visual check**

Run: `node screenshot.mjs "http://localhost:3000/account.html" account-orders`
Read the PNG. Expected: Orders section renders under the nav; since the shot is unauthenticated it will redirect to login — instead verify by temporarily seeding a session is out of scope; confirm the section markup/nav via the redirect-free path by reading the diff against the prior account layout. (Functional coverage of the query is in `test-orders-rls.mjs`.)

- [ ] **Step 5: Commit**

```bash
git add account.html
git commit -m "feat: account Orders history list"
```

---

## Task 9: full regression + deploy notes + PROJECT.md

**Files:**
- Modify: `PROJECT.md`

- [ ] **Step 1: Run the full Phase 2 + regression suite**

With `serve.mjs` (:3000) and `supabase functions serve --env-file .env.local --no-verify-jwt` (:54321) and `stripe listen` all running:
```bash
node scripts/test-orders-rls.mjs
node scripts/test-checkout-price-resolution.mjs
node scripts/test-webhook-handler.mjs
node scripts/test-checkout-flow.mjs
node scripts/test-cart-merge.mjs
node scripts/test-cart-rls.mjs
node scripts/test-csp-compliance.mjs
node scripts/test-customizer-flow.mjs
node scripts/test-layout-mount.mjs
node scripts/test-token-discipline.mjs
```
Expected: every script prints its ✅ line and exits 0. Fix any red before proceeding (use superpowers:systematic-debugging if stuck).

- [ ] **Step 2: Deploy the functions to the live project**

Run:
```bash
supabase functions deploy create-checkout-session
supabase functions deploy stripe-webhook
```
Expected: both deploy. Confirm secrets are set on the project: `supabase secrets list` shows `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET`. (The deployed webhook needs a **Stripe Dashboard webhook endpoint** pointing at the deployed URL with `checkout.session.completed` + `checkout.session.expired` — record this; for launch it becomes the live-mode endpoint.)

- [ ] **Step 3: Smoke the deployed create-session endpoint**

Run `scripts/test-checkout-price-resolution.mjs` again with `FUNCTIONS_URL=https://fzgsogdceptjvuahukbn.supabase.co/functions/v1` prefixed:
```bash
FUNCTIONS_URL=https://fzgsogdceptjvuahukbn.supabase.co/functions/v1 node scripts/test-checkout-price-resolution.mjs
```
Expected: ✅ (the deployed function enforces `verify_jwt=true`; the test's signed-in token passes, the unauth case returns 401 from the platform — acceptable).

- [ ] **Step 4: Update PROJECT.md**

Add a "Phase 2 — Stripe checkout (SHIPPED)" subsection to §7 mirroring the cart dual-mode entry: tables (`orders`/`payments` + owner-read-only RLS), the two Edge Functions, the trust boundary (`resolve-cart` re-pricing + write-lock), the webhook idempotency key, the new client pages, the new toolchain (Supabase CLI, Deno, Stripe CLI), and the test list. Update: the top banner (Stripe now shipped; next = measurements UX), the §3 COMMERCE schema block, the §2 pages table (`order-confirmation.html`), the backlog table row #7 → ✅, and the Phasing table Phase 2 row. Move the "activate Stripe account (live keys) + live webhook endpoint" + "order-confirmation email" items into the pre-launch list.

- [ ] **Step 5: Commit**

```bash
git add PROJECT.md
git commit -m "docs: PROJECT.md — Stripe checkout shipped inventory"
```

- [ ] **Step 6: Finish the branch**

Use superpowers:finishing-a-development-branch to merge to `main` once all stop conditions pass (below).

---

## Stop conditions (all green before merge)

1. `test-orders-rls`, `test-checkout-price-resolution`, `test-webhook-handler`, `test-checkout-flow` all pass.
2. Full regression (cart-merge, cart-rls, csp-compliance incl. `order-confirmation.html`, customizer-flow, layout-mount, token-discipline) all pass.
3. A manual Stripe **test-mode** purchase (test card `4242 4242 4242 4242`) end-to-end: cart → hosted Checkout (shows CRF branding) → success → `order-confirmation.html` shows "confirmed" → `orders.status='paid'` + `payments` row + server cart cleared.
4. Both functions deployed; secrets set; Stripe Dashboard webhook endpoint registered (test mode).
5. Client-tampered price is ignored (covered by `test-checkout-price-resolution`); clients cannot write `orders`/`payments` (covered by `test-orders-rls`).
6. PROJECT.md updated.

## Out of scope (spec §10)

Deposit/balance split, guest checkout, refunds/disputes UI, fulfillment states, embedded Payment Element, order-confirmation email (pre-launch), normalized `order_items` table.
