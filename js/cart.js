// =============================================================================
// Country Road Fashions — localStorage Cart (V1)
// =============================================================================
// Anonymous, browser-local cart. Persists across pages via localStorage under
// `crf.cart.v1`. Every page imports this module to keep the header badge in
// sync; the customizer drawer and cart.html call its CRUD methods.
//
// Cart shape:
//   {
//     items: [
//       {
//         id: 'crfln_xyz',          // line id (random)
//         item_type_id: 'formal-suit-2-piece',
//         fabric_design_id: 'vbc-wool-grey-herringbone',
//         price_thb: 20000,         // base price at add time
//         qty: 1,
//         customizations: { 'jacket-lapel': 'jacket-lapel-notch', ... },
//         added_at: '2026-05-28T...'
//       }
//     ],
//     updated_at: '...'
//   }
//
// Events:
//   - window dispatches 'crf:cart-changed' (CustomEvent, no detail) whenever
//     the cart mutates in this tab.
//   - window listens for 'storage' events so changes in other tabs propagate.
// =============================================================================

const STORAGE_KEY = 'crf.cart.v1';

function emptyCart() {
  return { items: [], updated_at: new Date().toISOString() };
}

export function readCart() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyCart();
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.items)) return emptyCart();
    return parsed;
  } catch {
    return emptyCart();
  }
}

function writeCart(cart) {
  cart.updated_at = new Date().toISOString();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cart));
  window.dispatchEvent(new CustomEvent('crf:cart-changed'));
}

function makeLineId() {
  return 'crfln_' + Math.random().toString(36).slice(2, 10);
}

export function addLine({ item_type_id, fabric_design_id, price_thb, customizations }) {
  const cart = readCart();
  cart.items.push({
    id: makeLineId(),
    item_type_id,
    fabric_design_id,
    price_thb: Number(price_thb) || 0,
    qty: 1,
    customizations: { ...customizations },
    added_at: new Date().toISOString(),
  });
  writeCart(cart);
}

export function removeLine(lineId) {
  const cart = readCart();
  cart.items = cart.items.filter(x => x.id !== lineId);
  writeCart(cart);
}

export function setQty(lineId, qty) {
  const n = Math.max(1, Math.min(99, Math.floor(Number(qty) || 1)));
  const cart = readCart();
  const line = cart.items.find(x => x.id === lineId);
  if (!line) return;
  line.qty = n;
  writeCart(cart);
}

export function clearCart() {
  writeCart(emptyCart());
}

export function lineCount() {
  return readCart().items.reduce((sum, x) => sum + (x.qty || 1), 0);
}

export function subtotal() {
  return readCart().items.reduce((sum, x) => sum + (x.price_thb * (x.qty || 1)), 0);
}

// -----------------------------------------------------------------------------
// Header badge — every page calls mountCartBadge() on load. Looks for an
// element with [data-cart-count] and keeps its textContent in sync.
// -----------------------------------------------------------------------------
export function mountCartBadge() {
  if (mountCartBadge._mounted) return;
  const els = document.querySelectorAll('[data-cart-count]');
  if (!els.length) return;
  mountCartBadge._mounted = true;
  const update = () => {
    const n = lineCount();
    els.forEach(el => {
      el.textContent = String(n);
      el.toggleAttribute('hidden', n === 0);
    });
  };
  update();
  window.addEventListener('crf:cart-changed', update);
  // Cross-tab sync
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY) update();
  });
}

// Auto-mount: try immediately; if the badge isn't in the DOM yet (shared
// header injected by js/layout.js at runtime), wait for crf:layout-ready.
// Also keep a DOMContentLoaded fallback for any defensive page that has
// the inline header during a transition. tryMount() is idempotent.
function tryMount() {
  if (document.querySelector('[data-cart-count]')) {
    mountCartBadge();
    return true;
  }
  return false;
}
if (!tryMount()) {
  document.addEventListener('crf:layout-ready', tryMount, { once: true });
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tryMount, { once: true });
  }
}
