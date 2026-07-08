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
let reconcileChain = Promise.resolve();   // serializes reconcile() so it runs one-at-a-time

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

// Suppressing the push during a sync-initiated write is a re-entrancy guard:
// replaceLocalQuiet fires crf:cart-changed, and without this the listener would
// echo the just-synced state straight back to the server. In the rare case a
// genuine user edit lands in that same tick, it self-heals — the next mutation,
// 'online', or 'visibilitychange' trigger schedules the owed push.
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
  // SIGNED_OUT resets the marker to 'guest', which is why a different user
  // signing in on the same browser safely re-enters this handoff branch.
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

// Serialize reconciles: a second auth event for the same user then sees
// owner===userId (set by the first) and takes the idempotent LWW path,
// so the guest→account merge can never run twice.
function enqueueReconcile(userId) {
  reconcileChain = reconcileChain
    .then(() => reconcile(userId))
    .catch((e) => console.warn('[cart] reconcile failed', e?.message || e));
}

function init() {
  onAuthChange((event, session) => {
    const uid = session?.user?.id || null;

    if (event === 'SIGNED_OUT') {
      currentUserId = null;
      clearTimeout(pushTimer);
      clearTimeout(retryTimer); retryTimer = null;
      dirty = false; backoffMs = 1000;
      clearCart();             // local only; server row is preserved
      setOwner('guest');
      return;
    }
    if (!uid) { currentUserId = null; return; }  // anon INITIAL_SESSION: leave guest cart

    const firstResolve = currentUserId !== uid;
    currentUserId = uid;
    if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || firstResolve) {
      enqueueReconcile(uid);
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
