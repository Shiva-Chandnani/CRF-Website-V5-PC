import { requireAuth, getSupabase } from '/js/auth.js';
await requireAuth({ redirectTo: '/login.html' });
const params = new URLSearchParams(location.search);
const orderId = params.get('order');
const sb = getSupabase();
const titleEl = document.querySelector('[data-order-title]');
const statusEl = document.querySelector('[data-order-status]');
const summaryEl = document.querySelector('[data-order-summary]');
const fmtTHB = (n) => 'THB ' + Number(n).toLocaleString('en-US');
const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function renderSummary(order) {
  summaryEl.hidden = false;
  const body = summaryEl.querySelector('.docket-body');
  body.innerHTML = (order.items || []).map(li => `
    <div class="docket-row">
      <span class="docket-row__name">${esc(li.display_name ?? li.fabric_design_id)} <span class="docket-row__qty">× ${li.qty}</span></span>
      <span class="docket-row__price">${fmtTHB(li.line_total_thb ?? (li.unit_price_thb * li.qty))}</span>
    </div>`).join('') +
    `<div class="docket-row docket-row--total"><span>Total</span><span>${fmtTHB(order.total_thb)}</span></div>`;
}

async function load(attempt = 0) {
  if (!orderId) {
    titleEl.textContent = 'Order not found';
    statusEl.textContent = 'Missing order reference.';
    return;
  }
  const { data: order } = await sb.from('orders').select('status,total_thb,items').eq('id', orderId).maybeSingle();
  if (!order) {
    titleEl.textContent = 'Order not found';
    statusEl.textContent = 'We could not find this order on your account.';
    return;
  }
  if (order.status === 'paid') {
    renderSummary(order);
    titleEl.innerHTML = 'Your order is <em>confirmed</em>';
    statusEl.textContent = 'We\'ve received your payment and will be in touch to arrange your fitting.';
  } else if (order.status === 'pending' && attempt < 5) {
    setTimeout(() => load(attempt + 1), 1500); // webhook lag
  } else if (order.status === 'pending') {
    renderSummary(order);
    titleEl.textContent = 'Payment processing';
    statusEl.textContent = 'Your payment is still processing. We\'ll email you once it\'s confirmed.';
  } else {
    titleEl.textContent = 'Payment not completed';
    statusEl.textContent = 'This order was not paid. You can try checking out again from your cart.';
  }
}
load();
