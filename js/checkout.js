// =============================================================================
// Country Road Fashions — checkout entry (Phase 2)
// =============================================================================
// Signed-in only: requireAuth bounces guests to login, then invokes the
// create-checkout-session Edge Function and redirects to Stripe's hosted page.
// =============================================================================
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

// Document-level delegation: the cart page rebuilds its CTAs (and this button)
// on every render(), so binding to the element directly would miss re-renders.
// Delegation matches cart.js's own qty/remove handling and survives re-renders.
export function mountCheckout() {
  if (mountCheckout._bound) return;
  mountCheckout._bound = true;
  document.addEventListener('click', (e) => {
    const btn = e.target instanceof Element ? e.target.closest('[data-checkout-button]') : null;
    if (!btn || btn.hasAttribute('disabled')) return;
    e.preventDefault();
    startCheckout(btn);
  });
}

mountCheckout();
