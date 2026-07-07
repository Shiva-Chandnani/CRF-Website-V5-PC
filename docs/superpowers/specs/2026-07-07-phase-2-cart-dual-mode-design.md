# Phase 2 · Cart Dual-Mode — Design Spec

**Date:** 2026-07-07
**Phase:** 2 (Commerce) — sub-project 1 of 3
**Status:** Design approved; implementation plan next
**Depends on:** Phase 1 (auth + profiles, shipped 2026-07-07)
**Blocks:** Phase 2 Stripe checkout (needs a server-authoritative cart to snapshot into orders)

---

## 1. Goal

Give signed-in customers a cart that follows them across sessions and devices, without
degrading the instant, offline-capable feel of the current anonymous cart. When an
anonymous shopper configures a suit and then signs in, nothing they configured is lost.

This is the natural bridge from Phase 1 (customers now exist) to the Stripe checkout that
follows: it makes the cart server-authoritative enough to become an order, while keeping
the browser experience snappy.

**Success criteria**
- A signed-in user's cart persists server-side and reappears on any device after login.
- An anonymous cart merges into the account cart on sign-in with no lost lines.
- Every cart action still feels instant (no network round-trip in the interaction path).
- Logout clears the local cart (shared-computer safe); the server cart is preserved.
- Background sync self-heals after transient network failures, invisibly to the user.
- `js/cart.js`'s public API is unchanged — its 8 consumers need zero edits.

**Non-goals (YAGNI)**
- No `orders`/`payments` tables, checkout, or cart→order conversion (Stripe sub-project).
- No realtime multi-tab/device push (Supabase Realtime). A bespoke-tailoring cart rarely
  has concurrent live sessions; the added complexity isn't justified now. Cross-device
  sync is achieved at auth-resolve time (login / page load), not continuously.
- No change to measurements or profile flows.

---

## 2. Context — current cart architecture

`js/cart.js` (Phase -1/0) is a **synchronous localStorage cart** under key `crf.cart.v1`:

```js
{ items: [ { id, item_type_id, fabric_design_id, price_thb, qty,
             customizations: { 'jacket-lapel': 'jacket-lapel-notch', ... },
             added_at } ], updated_at }
```

- Public API (all synchronous): `readCart`, `addLine`, `removeLine`, `setQty`,
  `clearCart`, `lineCount`, `subtotal`, `mountCartBadge`.
- Fires `window` event `crf:cart-changed` on every mutation; listens to `storage` for
  cross-tab sync.
- **8 importers:** `index/shop/product/cart/book-appointment/in-store.html`,
  `js/layout.js`, `js/customizer.js`. `cart.html` and `js/customizer.js` call the API
  synchronously inside render code.

`js/auth.js` (Phase 1) provides `getSession`, `getUser`, `getSupabase` (Supabase
singleton on the anon key), and `onAuthChange(cb)` — a passthrough of Supabase's
`onAuthStateChange`, delivering raw events (`INITIAL_SESSION`, `SIGNED_IN`,
`SIGNED_OUT`, `TOKEN_REFRESHED`, `USER_UPDATED`) + session.

**Design decision — offline-first mirror.** localStorage stays the working copy for
everyone. For signed-in users we *mirror* writes to a server `carts` row and reconcile
local↔server when auth resolves. This preserves the synchronous API (zero consumer
ripple) and the instant interaction feel, while delivering cross-device persistence.
The rejected alternative (server-authoritative for signed-in users) would force the
whole API to become async, rippling `await`s into `cart.html` render, `customizer.js`,
and the badge — a large, risky diff for no UX gain.

---

## 3. Data model

New migration `db/10_carts.sql`, applied via `scripts/run-sql.mjs` (never manual SQL
Editor). Idempotent (`create table if not exists`, `drop policy if exists`).

```sql
create table if not exists carts (
  user_id    uuid primary key references profiles(id) on delete cascade,
  items      jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table carts enable row level security;

-- Owner-only: a user may only touch their own cart row.
drop policy if exists carts_select_own on carts;
create policy carts_select_own on carts for select
  using (auth.uid() = user_id);
drop policy if exists carts_insert_own on carts;
create policy carts_insert_own on carts for insert
  with check (auth.uid() = user_id);
drop policy if exists carts_update_own on carts;
create policy carts_update_own on carts for update
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists carts_delete_own on carts;
create policy carts_delete_own on carts for delete
  using (auth.uid() = user_id);
```

- `items` stores the localStorage `items[]` blob verbatim — no schema translation, no
  per-line rows. The cart is ephemeral pre-order state; the Stripe sub-project will
  snapshot it into normalized `orders`/`order_items` at checkout.
- `on delete cascade` from `profiles` means `delete_my_account()` (Phase 1 RPC) already
  cleans up carts for free.
- `updated_at` is the server row's own timestamp; the authoritative last-write-wins
  comparison uses the `updated_at` **embedded in the cart blob** (see §5), which reflects
  the moment of the user's last edit rather than the last network write.

---

## 4. Module topology

Ripple is contained to `js/cart.js` (one additive export) plus two new modules. No page
edits, no consumer edits.

- **`js/cart.js`** — unchanged public API. Adds:
  - `export function replaceCart(cart)` — validates shape, writes the whole cart to
    localStorage, fires `crf:cart-changed`. Used by the merge/pull paths.
  - Browser-only `import('./cart-sync.js')` at module bottom (fire-and-forget; guarded so
    it is a no-op if `window`/`localStorage` are absent, keeping cart.js Node-safe as
    today). Because all 8 consumers already import `cart.js`, sync activates everywhere
    with no new `<script>` tags.

- **`js/cart-merge.js`** — NEW, pure, no browser/network deps (Node-importable for unit
  tests). Exports:
  - `lineKey(item)` → stable dedupe identity:
    `` `${item_type_id}|${fabric_design_id}|${canonicalJSON(customizations)}` `` where
    `canonicalJSON` sorts object keys recursively so key order can't split a duplicate.
  - `mergeCarts(localCart, serverCart)` → `{ items, updated_at }`. Union of both sides;
    lines with equal `lineKey` collapse into one with `qty` summed (clamped to 99, matching
    `setQty`); `added_at` = the earliest of the merged pair; `id` = a stable/regenerated
    line id. `updated_at` = `now()`.

- **`js/cart-sync.js`** — NEW, browser-only. The sync state machine (§5). Depends on
  `js/auth.js` (`getSupabase`, `onAuthChange`) and `js/cart-merge.js`. Reads/writes the
  `carts` row through the auth Supabase singleton (anon key + the user's session JWT, so
  RLS applies). Never throws into callers; all failures degrade to retry (§6).

---

## 5. Sync state machine

The correctness requirement: **merge exactly once** — on the genuine guest→account
transition — and never re-sum quantities on ordinary reloads or token refreshes.

Mechanism: a localStorage ownership marker `crf.cart.owner` ∈ { `'guest'`, `<user-id>` }.
Absent ⇒ treated as `'guest'`.

### On auth resolving to user `U` (`onAuthChange` events `INITIAL_SESSION`/`SIGNED_IN` with a session)

| `crf.cart.owner` | local items | Action |
|---|---|---|
| `guest` | non-empty | **Handoff:** pull server cart → `mergeCarts(local, server)` → `replaceCart(merged)` → push merged to server → set `owner=U` |
| `guest` | empty | Pull server → `replaceCart(server)` → set `owner=U` |
| `U` (same) | any | **Last-write-wins:** pull server; if `server.updated_at > local.updated_at` → `replaceCart(server)`; else push local. (Cross-device reconcile; idempotent — no re-merge.) |
| other user `V` | any | `replaceCart(server for U)` → `owner=U` (defensive; logout normally already cleared) |

### On `SIGNED_OUT`
`clearCart()` (local only) + set `owner='guest'`. Server row untouched — matches the
approved logout behavior (shared-computer safe; cart returns on next login).

### On `crf:cart-changed` while a session exists
Debounce ~800 ms, then upsert the `carts` row (`user_id`, `items`, `updated_at` from the
cart blob). Debouncing coalesces rapid edits (qty steppers) into a single network write.
Guard against feedback loops: sync-initiated `replaceCart` calls set a short-lived
in-memory flag so the resulting `crf:cart-changed` doesn't re-trigger a redundant push.

`TOKEN_REFRESHED` / `USER_UPDATED` take no cart action (owner is already `U`; the
last-write-wins path is only for `INITIAL_SESSION`/`SIGNED_IN`).

---

## 6. Error handling & resilience

- **Self-healing push.** A failed server write marks an in-memory `dirty` flag and keeps
  the local cart intact. Retry triggers: the next `crf:cart-changed`, the window `online`
  event, and `visibilitychange`→visible. The user never sees a sync error; the cart works
  offline and reconciles when connectivity returns.
- **Failed pull** on auth-resolve: fall back to the local cart as-is (do not clobber with
  an empty/failed server read); leave `dirty` set so a later push re-mirrors. `owner` is
  still advanced to `U` to avoid re-merging local into server on the next event.
- **Bounded retry:** exponential-ish backoff with a small cap; never a tight loop.
- All Supabase calls return `{ data, error }` (never throw), consistent with `js/auth.js`
  and `js/profile.js`. `cart-sync` logs at most a single `console.warn` per failure class.
- Malformed server `items` (not an array) is treated as an empty server cart.

---

## 7. Public API impact

`js/cart.js` consumers are **untouched**. Preserved synchronous surface:
`readCart, addLine, removeLine, setQty, clearCart, lineCount, subtotal, mountCartBadge`.
Added: `replaceCart(cart)`. `cart.html`, `js/customizer.js`, `js/layout.js`, and the 6
pages need no changes. This containment is the primary justification for the offline-first
choice.

---

## 8. Testing

Project convention: `.mjs` scripts, manual `.env.local` read (no `dotenv`), admin
`createUser` for auth fixtures (bypasses the reserved-domain email blocklist; use
`@test.countryroadfashions.com`), run with `serve.mjs` up from repo root.

- **`scripts/test-cart-merge.mjs`** — pure unit (no browser): `lineKey` identity
  (including customization key-order invariance and monogram distinctness), `mergeCarts`
  union / dedupe / qty-sum / qty-clamp / `added_at`-earliest / empty-side cases.
- **`scripts/test-cart-rls.mjs`** — 2 admin-created users; each can `select/insert/update/
  delete` only their own `carts` row; cross-user access denied. Cascade: deleting the
  profile (via `delete_my_account` or admin) removes the cart row.
- **`scripts/test-cart-dual-mode.mjs`** — puppeteer end-to-end:
  1. Add lines as guest → server has no row yet.
  2. Sign in → guest cart merges + pushes; `carts` row now matches.
  3. Reload → cart intact (pull path, no duplication).
  4. Add another line signed-in → debounced push updates server.
  5. Log out → local cart empty, server row preserved.
  6. Log back in → cart returns.
  7. Fresh storage ("other device") + same login → server cart pulled.
  8. Handoff dedupe: same config added on both guest-local and server → one line, summed
     qty (no duplicate).
- **Regression gate (must stay green):** `test-customizer-flow`, `test-layout-mount`,
  `test-newsletter-submit`, Phase 1 auth/profile/measurements/privacy suites,
  `test-token-discipline`, and the 12-page `test-csp-compliance` sweep. CSP is unaffected
  — `carts` traffic goes to the already-allowlisted Supabase origin.

---

## 9. Deliverables

- `db/10_carts.sql` — `carts` table + 4 owner-only RLS policies (idempotent, applied live).
- `js/cart.js` — `replaceCart` export + browser-only `cart-sync` bootstrap.
- `js/cart-merge.js` — pure `lineKey` + `mergeCarts`.
- `js/cart-sync.js` — auth-driven sync state machine + self-healing push.
- `scripts/test-cart-merge.mjs`, `scripts/test-cart-rls.mjs`, `scripts/test-cart-dual-mode.mjs`.
- PROJECT.md — Phase 2 cart dual-mode shipped inventory + schema table update (`carts`).

---

## 10. Verification / stop conditions

1. `db/10_carts.sql` applied live; `carts` present with RLS enabled.
2. All three new tests green; full regression suite + CSP sweep green.
3. Manual smoke matches §8 dual-mode script (guest→login merge, cross-device, logout).
4. No edits required to the 8 `cart.js` consumers (diff confined to §9 files).
5. PROJECT.md updated; work merged to `main` via `finishing-a-development-branch`.
