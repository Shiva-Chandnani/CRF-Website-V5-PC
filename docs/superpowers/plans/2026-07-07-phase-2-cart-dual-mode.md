# Cart Dual-Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give signed-in customers an offline-first server-backed cart that follows them across devices and merges an anonymous cart on login, with zero changes to `js/cart.js`'s 8 consumers.

**Architecture:** localStorage stays the synchronous working copy (`js/cart.js`). A new browser-only `js/cart-sync.js` mirrors the cart to a `carts(user_id, items jsonb)` Supabase row and reconciles local↔server when auth resolves (`onAuthChange`). Merge/dedupe logic lives in a pure, Node-testable `js/cart-merge.js`. A `crf.cart.owner` localStorage marker guarantees the guest→account merge runs exactly once; ordinary reloads take an idempotent last-write-wins path.

**Tech Stack:** Vanilla ES modules, Supabase (`@supabase/supabase-js` via esm.sh in browser / npm in Node tests), Postgres RLS applied through `scripts/run-sql.mjs`, puppeteer + Node `assert` for tests. No build step.

**Spec:** `docs/superpowers/specs/2026-07-07-phase-2-cart-dual-mode-design.md`

---

## File Structure

| File | Create/Modify | Responsibility |
|---|---|---|
| `db/10_carts.sql` | Create | `carts` table + 4 owner-only RLS policies (idempotent) |
| `js/cart-merge.js` | Create | Pure `lineKey` + `mergeCarts` (no browser/network deps) |
| `js/cart.js` | Modify | Add `replaceCart()` export (preserves `updated_at`) + browser-only `cart-sync` bootstrap |
| `js/cart-sync.js` | Create | Auth-driven sync state machine + self-healing push |
| `scripts/test-cart-merge.mjs` | Create | Pure unit test for merge/dedupe |
| `scripts/test-cart-rls.mjs` | Create | `carts` owner-only RLS isolation test |
| `scripts/test-cart-dual-mode.mjs` | Create | Puppeteer end-to-end: guest→login merge, reload, logout, cross-device |
| `PROJECT.md` | Modify | Phase 2 cart dual-mode shipped inventory + `carts` schema row |

**Conventions to follow (from existing code):**
- Migrations run via `node scripts/run-sql.mjs db/<file>.sql` (never manual SQL Editor). Idempotent DDL.
- Test scripts read `.env.local` manually (no `dotenv`), use admin `createUser`/`deleteUser` for auth fixtures, and `@example.test` emails (admin API bypasses the reserved-domain blocklist — matches `test-profile-rls.mjs`).
- Supabase calls return `{ data, error }` and never throw on REST errors.
- Cart localStorage key is `crf.cart.v1`; browser Supabase auth `storageKey` is `sb-fzgsogdceptjvuahukbn-auth-token`.
- Run tests from repo root with `node serve.mjs` already running on :3000.

---

## Task 1: `carts` table + RLS (TDD via RLS test)

**Files:**
- Create: `scripts/test-cart-rls.mjs`
- Create: `db/10_carts.sql`

- [ ] **Step 1: Write the failing RLS test**

Create `scripts/test-cart-rls.mjs`:

```js
// Phase 2 verification: carts RLS isolates one user's cart from another's,
// and the row cascades when the profile is deleted.
// 1. Create user A + user B via the service-role admin API (auto-confirmed).
// 2. Sign in as each with the anon key; each upserts their own carts row.
// 3. Assert A sees exactly A's cart, cannot see or write B's.
// 4. Delete A's auth user → assert A's carts row is gone (cascade).

import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8')
    .split('\n').filter(Boolean)
    .map(l => l.split('=').map(s => s.trim()))
    .map(([k, ...v]) => [k, v.join('=')])
);

const URL  = env.SUPABASE_URL;
const ANON = env.SUPABASE_ANON_KEY;
const SVC  = env.SUPABASE_SERVICE_ROLE_KEY;

const admin = createClient(URL, SVC, { auth: { persistSession: false } });

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
const emailA = `cart-a-${stamp}@example.test`;
const emailB = `cart-b-${stamp}@example.test`;
const password = 'Test-Pass-123!';

let failed = false;
function step(name, ok, detail = '') {
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) failed = true;
}

const sampleItem = (design) => ({
  id: 'crfln_' + Math.random().toString(36).slice(2, 10),
  item_type_id: 'formal-suit-2-piece',
  fabric_design_id: design,
  price_thb: 20000,
  qty: 1,
  customizations: { 'jacket-lapel': 'jacket-lapel-notch' },
  added_at: new Date().toISOString(),
});

let userA, userB;
try {
  const a = await admin.auth.admin.createUser({ email: emailA, password, email_confirm: true });
  if (a.error) throw new Error(`create A: ${a.error.message}`);
  userA = a.data.user;
  const b = await admin.auth.admin.createUser({ email: emailB, password, email_confirm: true });
  if (b.error) throw new Error(`create B: ${b.error.message}`);
  userB = b.data.user;

  const anonA = createClient(URL, ANON, { auth: { persistSession: false } });
  const anonB = createClient(URL, ANON, { auth: { persistSession: false } });
  const si = await anonA.auth.signInWithPassword({ email: emailA, password });
  if (si.error) throw new Error(`sign in A: ${si.error.message}`);
  const sib = await anonB.auth.signInWithPassword({ email: emailB, password });
  if (sib.error) throw new Error(`sign in B: ${sib.error.message}`);

  // Each user upserts their own cart
  const upA = await anonA.from('carts').upsert(
    { user_id: userA.id, items: [sampleItem('vbc-wool-grey-herringbone')], updated_at: new Date().toISOString() },
    { onConflict: 'user_id' });
  step('A upsert own cart', !upA.error, upA.error?.message);
  const upB = await anonB.from('carts').upsert(
    { user_id: userB.id, items: [sampleItem('cavani-wool-navy-pinstripe')], updated_at: new Date().toISOString() },
    { onConflict: 'user_id' });
  step('B upsert own cart', !upB.error, upB.error?.message);

  // A selects carts → exactly one row (own)
  const { data: visible, error: selErr } = await anonA.from('carts').select('user_id, items');
  step('A select carts succeeded', !selErr, selErr?.message);
  step('A sees exactly one cart (own)', visible?.length === 1, `len=${visible?.length}`);
  step('A sees own user_id', visible?.[0]?.user_id === userA.id);

  // A cannot write B's cart (RLS with-check on user_id)
  const badWrite = await anonA.from('carts').upsert(
    { user_id: userB.id, items: [], updated_at: new Date().toISOString() },
    { onConflict: 'user_id' });
  step('A cannot upsert B cart (RLS blocks)', !!badWrite.error, badWrite.error ? 'blocked' : 'LEAK');

  // Cascade: delete A's auth user → A's carts row gone
  await admin.auth.admin.deleteUser(userA.id);
  userA = null;
  const { data: gone } = await admin.from('carts').select('user_id').eq('user_id', si.data.user.id);
  step('A cart cascaded on profile delete', (gone?.length ?? 0) === 0, `remaining=${gone?.length ?? 0}`);

  await anonA.auth.signOut().catch(() => {});
  await anonB.auth.signOut().catch(() => {});
} catch (e) {
  failed = true;
  console.error('Test threw:', e.message);
} finally {
  if (userA) await admin.auth.admin.deleteUser(userA.id).catch(() => {});
  if (userB) await admin.auth.admin.deleteUser(userB.id).catch(() => {});
}

if (failed) { console.error('\n❌ carts RLS test failed'); process.exit(1); }
console.log('\n✅ carts RLS isolates users + cascades');
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node scripts/test-cart-rls.mjs`
Expected: FAIL — errors like `relation "public.carts" does not exist` (table not created yet).

- [ ] **Step 3: Write the migration**

Create `db/10_carts.sql`:

```sql
-- Phase 2 · cart dual-mode: server-side cart mirror (offline-first).
-- One row per user; `items` mirrors the localStorage crf.cart.v1 items[] blob.
-- Idempotent: safe to re-run via scripts/run-sql.mjs.

create table if not exists carts (
  user_id    uuid primary key references profiles(id) on delete cascade,
  items      jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table carts enable row level security;

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

- [ ] **Step 4: Apply the migration**

Run: `node scripts/run-sql.mjs db/10_carts.sql`
Expected: prints success (statements applied, no error).

- [ ] **Step 5: Run the test to verify it passes**

Run: `node scripts/test-cart-rls.mjs`
Expected: PASS — `✅ carts RLS isolates users + cascades`, exit 0.

- [ ] **Step 6: Commit**

```bash
git add db/10_carts.sql scripts/test-cart-rls.mjs
git commit -m "Phase 2 WT cart: carts table + owner-only RLS + isolation test"
```

---

## Task 2: `js/cart-merge.js` — pure merge/dedupe (TDD unit)

**Files:**
- Create: `scripts/test-cart-merge.mjs`
- Create: `js/cart-merge.js`

- [ ] **Step 1: Write the failing unit test**

Create `scripts/test-cart-merge.mjs`:

```js
// Pure unit test for js/cart-merge.js. No browser, no network.
import assert from 'node:assert/strict';
import { lineKey, mergeCarts } from '../js/cart-merge.js';

let failed = false;
function check(name, fn) {
  try { fn(); console.log(`✔ ${name}`); }
  catch (e) { failed = true; console.log(`✘ ${name}  — ${e.message}`); }
}

const item = (over = {}) => ({
  id: 'crfln_' + Math.random().toString(36).slice(2, 8),
  item_type_id: 'formal-suit-2-piece',
  fabric_design_id: 'vbc-wool-grey-herringbone',
  price_thb: 20000,
  qty: 1,
  customizations: { 'jacket-lapel': 'jacket-lapel-notch', 'jacket-vent': 'jacket-vent-double' },
  added_at: '2026-07-07T10:00:00.000Z',
  ...over,
});

check('lineKey is key-order invariant', () => {
  const a = item({ customizations: { x: '1', y: '2' } });
  const b = item({ customizations: { y: '2', x: '1' } });
  assert.equal(lineKey(a), lineKey(b));
});

check('lineKey distinguishes monogram text', () => {
  const a = item({ customizations: { 'jacket-monogram-text': 'ABC' } });
  const b = item({ customizations: { 'jacket-monogram-text': 'XYZ' } });
  assert.notEqual(lineKey(a), lineKey(b));
});

check('lineKey distinguishes fabric design', () => {
  assert.notEqual(
    lineKey(item({ fabric_design_id: 'a' })),
    lineKey(item({ fabric_design_id: 'b' })));
});

check('merge unions disjoint lines', () => {
  const local  = { items: [item({ fabric_design_id: 'a' })] };
  const server = { items: [item({ fabric_design_id: 'b' })] };
  const m = mergeCarts(local, server);
  assert.equal(m.items.length, 2);
});

check('merge dedupes identical lines and sums qty', () => {
  const local  = { items: [item({ qty: 1 })] };
  const server = { items: [item({ qty: 2 })] };
  const m = mergeCarts(local, server);
  assert.equal(m.items.length, 1);
  assert.equal(m.items[0].qty, 3);
});

check('merge clamps summed qty to 99', () => {
  const local  = { items: [item({ qty: 60 })] };
  const server = { items: [item({ qty: 60 })] };
  const m = mergeCarts(local, server);
  assert.equal(m.items[0].qty, 99);
});

check('merge keeps earliest added_at', () => {
  const local  = { items: [item({ added_at: '2026-07-07T12:00:00.000Z' })] };
  const server = { items: [item({ added_at: '2026-07-01T09:00:00.000Z' })] };
  const m = mergeCarts(local, server);
  assert.equal(m.items[0].added_at, '2026-07-01T09:00:00.000Z');
});

check('merge tolerates empty / missing sides', () => {
  assert.equal(mergeCarts({ items: [] }, { items: [item()] }).items.length, 1);
  assert.equal(mergeCarts(null, null).items.length, 0);
  assert.equal(mergeCarts({ items: 'nope' }, { items: [item()] }).items.length, 1);
});

check('merge drops malformed lines (no ids)', () => {
  const m = mergeCarts({ items: [{ qty: 1 }] }, { items: [item()] });
  assert.equal(m.items.length, 1);
});

check('merge stamps a fresh updated_at', () => {
  const m = mergeCarts({ items: [item()] }, { items: [] });
  assert.ok(Date.parse(m.updated_at) > 0);
});

if (failed) { console.error('\n❌ cart-merge unit test failed'); process.exit(1); }
console.log('\n✅ cart-merge: lineKey + mergeCarts correct');
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node scripts/test-cart-merge.mjs`
Expected: FAIL — `Cannot find module '.../js/cart-merge.js'`.

- [ ] **Step 3: Write the implementation**

Create `js/cart-merge.js`:

```js
// =============================================================================
// Country Road Fashions — cart merge helpers (pure; no browser/network deps)
// =============================================================================
// Node-importable so the reconcile logic can be unit-tested in isolation.
// Used by js/cart-sync.js to fold an anonymous localStorage cart into a
// signed-in user's server cart on the guest→account handoff.
//
// IMPORTANT: this module must NEVER import js/cart.js (which runs browser-only
// code at load). Keep it dependency-free.
// =============================================================================

const MAX_QTY = 99;

// Deterministic JSON: sort object keys recursively so customization key order
// can't split two otherwise-identical maps into different dedupe buckets.
function canonicalJSON(value) {
  if (Array.isArray(value)) return '[' + value.map(canonicalJSON).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort()
      .map(k => JSON.stringify(k) + ':' + canonicalJSON(value[k]))
      .join(',') + '}';
  }
  return JSON.stringify(value);
}

// Stable identity for a cart line: same item + fabric design + customizations.
export function lineKey(item) {
  return [
    item.item_type_id,
    item.fabric_design_id,
    canonicalJSON(item.customizations || {}),
  ].join('|');
}

function makeLineId() {
  return 'crfln_' + Math.random().toString(36).slice(2, 10);
}

function clampQty(n) {
  n = Math.floor(Number(n) || 1);
  return Math.max(1, Math.min(MAX_QTY, n));
}

// Union of two carts, deduped by lineKey. Duplicate qty is summed (clamped to
// MAX_QTY); added_at keeps the earliest of the pair. Server items are folded
// first so a server line's id/price is the surviving base for a duplicate.
export function mergeCarts(localCart, serverCart) {
  const localItems  = Array.isArray(localCart?.items)  ? localCart.items  : [];
  const serverItems = Array.isArray(serverCart?.items) ? serverCart.items : [];

  const byKey = new Map();
  for (const raw of [...serverItems, ...localItems]) {
    if (!raw || !raw.item_type_id || !raw.fabric_design_id) continue;
    const key = lineKey(raw);
    const existing = byKey.get(key);
    if (existing) {
      existing.qty = clampQty((existing.qty || 1) + (raw.qty || 1));
      if (raw.added_at && (!existing.added_at || raw.added_at < existing.added_at)) {
        existing.added_at = raw.added_at;
      }
    } else {
      byKey.set(key, {
        id: raw.id || makeLineId(),
        item_type_id: raw.item_type_id,
        fabric_design_id: raw.fabric_design_id,
        price_thb: Number(raw.price_thb) || 0,
        qty: clampQty(raw.qty),
        customizations: { ...(raw.customizations || {}) },
        added_at: raw.added_at || new Date().toISOString(),
      });
    }
  }

  return { items: [...byKey.values()], updated_at: new Date().toISOString() };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node scripts/test-cart-merge.mjs`
Expected: PASS — `✅ cart-merge: lineKey + mergeCarts correct`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add js/cart-merge.js scripts/test-cart-merge.mjs
git commit -m "Phase 2 WT cart: pure cart-merge (lineKey + mergeCarts) + unit test"
```

---

## Task 3: `replaceCart()` export in `js/cart.js` (regression-gated)

`js/cart.js` runs browser code at load, so it can't be unit-tested in Node. This task adds `replaceCart()` (which preserves the cart's `updated_at`, unlike `writeCart`) and is verified by re-running the existing customizer e2e to prove no regression. `replaceCart`'s behavior is exercised end-to-end in Task 5.

**Files:**
- Modify: `js/cart.js` (add export near `clearCart`, around line 87-89)

- [ ] **Step 1: Add the `replaceCart` export**

In `js/cart.js`, immediately after the `clearCart` function (currently lines 87-89), add:

```js
// Atomically replace the whole cart. Unlike the mutation helpers, this
// PRESERVES the provided updated_at (the sync layer relies on it for
// cross-device last-write-wins). Falls back to now() when absent.
export function replaceCart(cart) {
  const items = (cart && Array.isArray(cart.items)) ? cart.items : [];
  const updated_at = (cart && cart.updated_at) ? cart.updated_at : new Date().toISOString();
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ items, updated_at }));
  window.dispatchEvent(new CustomEvent('crf:cart-changed'));
}
```

- [ ] **Step 2: Verify the module still parses / no syntax break**

Run: `node --check js/cart.js`
Expected: no output, exit 0 (valid syntax).

- [ ] **Step 3: Run the existing customizer e2e (regression gate)**

Ensure `node serve.mjs` is running, then run: `node scripts/test-customizer-flow.mjs`
Expected: `✅ Done` and localStorage cart shows `1 items` — proves the untouched cart API still works after the edit.

- [ ] **Step 4: Commit**

```bash
git add js/cart.js
git commit -m "Phase 2 WT cart: add replaceCart() (updated_at-preserving whole-cart swap)"
```

---

## Task 4: `js/cart-sync.js` — sync state machine + bootstrap

This adds the sync engine and wires it into `js/cart.js` via a browser-only dynamic import. The behavior is verified end-to-end in Task 5; this task delivers the code and a syntax/regression gate.

**Files:**
- Create: `js/cart-sync.js`
- Modify: `js/cart.js` (append bootstrap import at end of file, after the auto-mount block ~line 139)

- [ ] **Step 1: Write `js/cart-sync.js`**

Create `js/cart-sync.js`:

```js
// =============================================================================
// Country Road Fashions — cart sync (offline-first mirror)
// =============================================================================
// localStorage stays the synchronous working copy (js/cart.js). For signed-in
// users this module mirrors the cart to a server `carts` row and reconciles
// local↔server when auth resolves, so a customer's cart follows them across
// devices — without adding latency to any cart interaction.
//
// Correctness rule: MERGE EXACTLY ONCE, on the genuine guest→account handoff.
// The crf.cart.owner marker distinguishes that handoff from ordinary reloads
// and token refreshes (which take the idempotent last-write-wins path).
//
// Browser-only. Loaded lazily by js/cart.js so all cart.js consumers get sync
// for free with no extra <script> tags.
// =============================================================================

import { getSupabase, onAuthChange } from './auth.js';
import { readCart, replaceCart, clearCart } from './cart.js';
import { mergeCarts } from './cart-merge.js';

const OWNER_KEY = 'crf.cart.owner';
const PUSH_DEBOUNCE_MS = 800;
const MAX_BACKOFF_MS = 30000;

let currentUserId = null;       // null when signed out
let pushTimer = null;
let retryTimer = null;
let dirty = false;              // a server push is owed (pending or failed)
let backoffMs = 1000;
let suppressChange = false;     // guards sync-initiated replaceCart from re-pushing

function getOwner() {
  try { return localStorage.getItem(OWNER_KEY) || 'guest'; } catch { return 'guest'; }
}
function setOwner(v) {
  try { localStorage.setItem(OWNER_KEY, v); } catch {}
}

// --- server IO (never throws) -----------------------------------------------

async function pullServerCart(userId) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('carts').select('items, updated_at').eq('user_id', userId).maybeSingle();
  if (error) return { data: null, error };
  const items = Array.isArray(data?.items) ? data.items : [];
  return { data: { items, updated_at: data?.updated_at || null }, error: null };
}

async function pushServerCart(userId, cart) {
  const sb = getSupabase();
  const row = {
    user_id: userId,
    items: Array.isArray(cart.items) ? cart.items : [],
    updated_at: cart.updated_at || new Date().toISOString(),
  };
  const { error } = await sb.from('carts').upsert(row, { onConflict: 'user_id' });
  return { error };
}

// --- local write that won't re-trigger a push -------------------------------

function replaceLocalQuiet(cart) {
  suppressChange = true;
  replaceCart(cart);                                  // fires crf:cart-changed (sync)
  setTimeout(() => { suppressChange = false; }, 0);   // release after handler runs
}

// --- push scheduling + self-healing retry -----------------------------------

async function pushNow(userId, cart) {
  const { error } = await pushServerCart(userId, cart);
  if (error) { dirty = true; scheduleRetry(); }
  else { dirty = false; backoffMs = 1000; }
}

function schedulePush() {
  if (!currentUserId) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => { pushNow(currentUserId, readCart()); }, PUSH_DEBOUNCE_MS);
}

function scheduleRetry() {
  if (retryTimer || !currentUserId) return;
  retryTimer = setTimeout(async () => {
    retryTimer = null;
    if (dirty && currentUserId) {
      await pushNow(currentUserId, readCart());
      if (dirty) { backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS); scheduleRetry(); }
    }
  }, backoffMs);
}

// --- reconcile on auth resolve ----------------------------------------------

async function reconcile(userId) {
  const owner = getOwner();
  const local = readCart();
  const { data: server, error } = await pullServerCart(userId);

  if (error) {                 // pull failed: keep local, own it, owe a push
    setOwner(userId);
    dirty = true;
    scheduleRetry();
    return;
  }

  if (owner === userId) {      // same-user continuation → last-write-wins
    const localTs  = Date.parse(local.updated_at)  || 0;
    const serverTs = Date.parse(server.updated_at) || 0;
    if (serverTs > localTs) {
      replaceLocalQuiet(server);
    } else if (local.items.length || localTs > serverTs) {
      await pushNow(userId, local);
    }
    return;
  }

  // owner === 'guest' (or a different prior user) → first association.
  if (local.items.length) {    // fold the anonymous cart in, exactly once
    const merged = mergeCarts(local, server);
    replaceLocalQuiet(merged);
    setOwner(userId);
    await pushNow(userId, merged);
  } else {                     // nothing local → adopt the server cart
    replaceLocalQuiet(server);
    setOwner(userId);
  }
}

// --- wiring ------------------------------------------------------------------

function init() {
  onAuthChange((event, session) => {
    const uid = session?.user?.id || null;

    if (event === 'SIGNED_OUT') {
      currentUserId = null;
      clearTimeout(pushTimer);
      clearCart();             // local only; server row is preserved
      setOwner('guest');
      return;
    }
    if (!uid) { currentUserId = null; return; }  // anon INITIAL_SESSION: leave guest cart

    const firstResolve = currentUserId !== uid;
    currentUserId = uid;
    if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || firstResolve) {
      reconcile(uid);
    }
  });

  window.addEventListener('crf:cart-changed', () => {
    if (suppressChange) return;
    if (currentUserId) schedulePush();
  });

  // self-healing: retry an owed push when connectivity/focus returns
  window.addEventListener('online', () => { if (dirty) scheduleRetry(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && dirty) scheduleRetry();
  });
}

init();
```

- [ ] **Step 2: Verify syntax**

Run: `node --check js/cart-sync.js`
Expected: no output, exit 0.

- [ ] **Step 3: Wire the bootstrap into `js/cart.js`**

At the very end of `js/cart.js` (after the auto-mount block, ~line 139), append:

```js
// -----------------------------------------------------------------------------
// Server-sync bootstrap (Phase 2). Browser-only + fire-and-forget: pulls in the
// offline-first mirror so every page importing cart.js gets cross-device sync
// with no extra <script> tags. Guarded so cart.js stays import-safe elsewhere.
// -----------------------------------------------------------------------------
if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
  import('./cart-sync.js').catch((e) => console.warn('[cart] sync unavailable', e?.message || e));
}
```

- [ ] **Step 4: Verify syntax + customizer regression still green**

Run: `node --check js/cart.js && node scripts/test-customizer-flow.mjs`
Expected: `node --check` clean; customizer e2e ends `✅ Done` with `1 items` (anonymous flow unaffected — sync no-ops without a session).

- [ ] **Step 5: Commit**

```bash
git add js/cart-sync.js js/cart.js
git commit -m "Phase 2 WT cart: cart-sync state machine + browser-only bootstrap"
```

---

## Task 5: End-to-end dual-mode test (puppeteer)

**Files:**
- Create: `scripts/test-cart-dual-mode.mjs`

- [ ] **Step 1: Write the end-to-end test**

Create `scripts/test-cart-dual-mode.mjs`:

```js
// Phase 2 end-to-end: offline-first cart sync across guest→login, reload,
// logout, cross-device pull, and handoff dedupe. Requires `node serve.mjs`
// running on :3000. Creates a throwaway user via the admin API.

import puppeteer from 'puppeteer';
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8')
    .split('\n').filter(Boolean)
    .map(l => l.split('=').map(s => s.trim()))
    .map(([k, ...v]) => [k, v.join('=')])
);
const URL  = env.SUPABASE_URL;
const SVC  = env.SUPABASE_SERVICE_ROLE_KEY;
const admin = createClient(URL, SVC, { auth: { persistSession: false } });

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
const email = `cart-e2e-${stamp}@example.test`;
const password = 'Test-Pass-123!';
const ORIGIN = 'http://localhost:3000';

let failed = false;
function step(name, ok, detail = '') {
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) failed = true;
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const LINE = {
  id: 'crfln_seed01',
  item_type_id: 'formal-suit-2-piece',
  fabric_design_id: 'vbc-wool-grey-herringbone',
  price_thb: 20000,
  qty: 1,
  customizations: { 'jacket-lapel': 'jacket-lapel-peak' },
  added_at: '2026-07-07T10:00:00.000Z',
};

async function serverItems(userId) {
  const { data } = await admin.from('carts').select('items').eq('user_id', userId).maybeSingle();
  return Array.isArray(data?.items) ? data.items : [];
}
// Sign in inside the page using the app's own auth module.
async function signIn(page) {
  return page.evaluate(async (email, password) => {
    const auth = await import('/js/auth.js');
    const r = await auth.signInWithPassword({ email, password });
    return !!r.data?.session;
  }, email, password);
}
async function signOut(page) {
  return page.evaluate(async () => { const a = await import('/js/auth.js'); await a.signOut(); });
}
const readLS = (page) => page.evaluate(() => localStorage.getItem('crf.cart.v1'));
const setLS  = (page, cart) => page.evaluate((c) => {
  localStorage.setItem('crf.cart.v1', c);
  localStorage.setItem('crf.cart.owner', 'guest');
}, JSON.stringify(cart));

// Each "device" gets an ISOLATED browser context so localStorage + the auth
// session don't bleed across scenarios (puppeteer pages in one context share
// storage per origin). puppeteer 24.x: createBrowserContext() (incognito API
// was removed).
async function freshDevice(browser) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.goto(`${ORIGIN}/index.html`, { waitUntil: 'networkidle0' });
  return { ctx, page };
}

let user, browser;
try {
  const u = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (u.error) throw new Error(`create user: ${u.error.message}`);
  user = u.data.user;

  browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });

  // --- Scenario A: guest cart merges to server on login (device 1) ---
  const dev1 = await freshDevice(browser);
  const page = dev1.page;
  await setLS(page, { items: [LINE], updated_at: '2026-07-07T10:00:00.000Z' });
  await page.reload({ waitUntil: 'networkidle0' });          // re-init cart-sync with guest cart present
  step('signed in via app auth', await signIn(page));
  await sleep(2500);                                          // reconcile pull+merge+push
  let items = await serverItems(user.id);
  step('A: guest cart pushed to server on login', items.length === 1 && items[0].fabric_design_id === LINE.fabric_design_id,
       `server items=${items.length}`);

  // --- Scenario B: reload keeps cart, no duplication ---
  await page.reload({ waitUntil: 'networkidle0' });
  await sleep(2000);
  const lsB = JSON.parse(await readLS(page) || '{"items":[]}');
  step('B: local cart intact after reload', lsB.items.length === 1, `local=${lsB.items.length}`);
  items = await serverItems(user.id);
  step('B: server not duplicated after reload', items.length === 1, `server=${items.length}`);

  // --- Scenario C: logout clears local, preserves server ---
  await signOut(page);
  await sleep(1200);
  const lsC = JSON.parse(await readLS(page) || '{"items":[]}');
  step('C: local cart cleared on logout', lsC.items.length === 0, `local=${lsC.items.length}`);
  items = await serverItems(user.id);
  step('C: server cart preserved after logout', items.length === 1, `server=${items.length}`);

  // --- Scenario D: fresh "device" pulls server cart on login (device 2) ---
  const dev2 = await freshDevice(browser);   // isolated: empty localStorage, no session
  const page2 = dev2.page;
  step('D: signed in on fresh device', await signIn(page2));
  await sleep(2500);
  const lsD = JSON.parse(await readLS(page2) || '{"items":[]}');
  step('D: server cart pulled to fresh device', lsD.items.length === 1, `local=${lsD.items.length}`);

  // --- Scenario E: handoff dedupe (same config guest-local + server, device 3) ---
  const dev3 = await freshDevice(browser);   // isolated guest with an identical line
  const page3 = dev3.page;
  await setLS(page3, { items: [{ ...LINE, id: 'crfln_local9', qty: 1 }], updated_at: '2026-07-07T11:00:00.000Z' });
  await page3.reload({ waitUntil: 'networkidle0' });
  step('E: signed in for dedupe check', await signIn(page3));
  await sleep(2500);
  items = await serverItems(user.id);
  const deduped = items.length === 1 && items[0].qty === 2;
  step('E: identical guest+server line deduped to one, qty summed', deduped,
       `items=${items.length} qty=${items[0]?.qty}`);

} catch (e) {
  failed = true;
  console.error('Test threw:', e.message);
} finally {
  if (browser) await browser.close();
  if (user) await admin.auth.admin.deleteUser(user.id).catch(() => {});
}

if (failed) { console.error('\n❌ cart dual-mode e2e failed'); process.exit(1); }
console.log('\n✅ cart dual-mode: guest→login merge, reload, logout, cross-device, dedupe');
```

- [ ] **Step 2: Run the test to verify it passes**

Ensure `node serve.mjs` is running, then run: `node scripts/test-cart-dual-mode.mjs`
Expected: PASS — all A–E steps `✔`, ends `✅ cart dual-mode: ...`, exit 0.

> If a timing step flakes, increase the `sleep()` after sign-in (reconcile does a network pull + push; 2500ms is the budget). Do NOT reduce below 2000ms.

- [ ] **Step 3: Commit**

```bash
git add scripts/test-cart-dual-mode.mjs
git commit -m "Phase 2 WT cart: end-to-end dual-mode e2e (merge/reload/logout/cross-device/dedupe)"
```

---

## Task 6: Full regression sweep + PROJECT.md update

**Files:**
- Modify: `PROJECT.md`

- [ ] **Step 1: Run the full regression suite**

With `node serve.mjs` running, run each and confirm exit 0 / success line:

```bash
node scripts/test-cart-merge.mjs
node scripts/test-cart-rls.mjs
node scripts/test-cart-dual-mode.mjs
node scripts/test-customizer-flow.mjs
node scripts/test-layout-mount.mjs
node scripts/test-newsletter-submit.mjs
node scripts/test-token-discipline.mjs
node scripts/test-csp-compliance.mjs
```
Expected: every script prints its `✅` success line and exits 0. (CSP sweep unaffected — `carts` traffic uses the already-allowlisted Supabase origin.)

- [ ] **Step 2: Update PROJECT.md**

In `PROJECT.md`:
1. Update the top "Last session ended" banner to note Phase 2 cart dual-mode shipped and what's next (Stripe checkout).
2. In the Schema §3 block, add `carts` under the IDENTITY/COMMERCE section:
   `carts (Phase 2; user_id pk → profiles on delete cascade, items jsonb, updated_at) — owner-only RLS; localStorage mirror.`
3. Add `carts` to the catalogue/table state list.
4. Add a "Phase 2 — cart dual-mode (SHIPPED)" subsection under §7 summarizing: offline-first mirror, `db/10_carts.sql`, `js/cart-merge.js` + `js/cart-sync.js` + `replaceCart`, the `crf.cart.owner` merge-once marker, logout clears local / preserves server, self-healing push, and the 3 new tests.
5. Add the 3 new test scripts to the §4 test-suite listing.

- [ ] **Step 3: Commit**

```bash
git add PROJECT.md
git commit -m "Phase 2 WT cart: PROJECT.md — cart dual-mode shipped inventory"
```

---

## Verification / Stop Conditions

- [ ] `db/10_carts.sql` applied live; `carts` present with RLS enabled.
- [ ] `test-cart-merge`, `test-cart-rls`, `test-cart-dual-mode` all green.
- [ ] Full regression suite + 12-page CSP sweep green.
- [ ] Diff confined to the 8 files in the File Structure table — no edits to any `cart.js` consumer (`cart.html`, `customizer.js`, `layout.js`, the 6 pages).
- [ ] PROJECT.md updated.
- [ ] Ready to merge to `main` via `superpowers:finishing-a-development-branch`.
```
