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
      existing.qty = clampQty(clampQty(existing.qty) + clampQty(raw.qty));
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
