import { supabase } from '/js/data-loader.js';
import { readCart, removeLine, setQty, lineCount, subtotal } from '/js/cart.js';
import '/js/checkout.js';

// Pretty THB
const fmtTHB = (n) => 'THB ' + (Number(n) || 0).toLocaleString('en-US');
const escapeHtml = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// Cache catalog + product info for the duration of this page load
let catalogIndex = null; // { [option_id]: { name, category_name, category_display_order } }
let monogramThreadLabels = {
  'black':    'Black',
  'stone':    'Stone',
  'navy':     'Navy',
  'burgundy': 'Burgundy',
  'ivory':    'Ivory',
};

let catalogLoaded = false;
async function loadCatalogIndex(itemTypeIds) {
  if (catalogLoaded) return;
  const ids = [...new Set(itemTypeIds)].filter(Boolean);
  if (!ids.length) { catalogIndex = {}; catalogLoaded = true; return; }
  const { data, error } = await supabase
    .from('v_customization_catalog')
    .select('category_id, category_name, category_display_order, option_id, option_name')
    .in('item_type_id', ids);
  if (error) { console.error(error); catalogIndex = {}; catalogLoaded = true; return; }
  catalogIndex = {};
  for (const r of data) {
    catalogIndex[r.option_id] = {
      category_id: r.category_id,
      category_name: r.category_name,
      category_display_order: r.category_display_order,
      option_name: r.option_name,
    };
  }
  catalogLoaded = true;
}

async function loadProducts(productIds) {
  if (!productIds.length) return {};
  const { data, error } = await supabase
    .from('v_products')
    .select('product_id, item_type_name, fabric_brand, fabric_family, design_name, fabric_number, hero_image_path, hero_image_hover_path, primary_photo_path')
    .in('product_id', productIds);
  if (error) { console.error(error); return {}; }
  const map = {};
  for (const r of data) map[r.product_id] = r;
  return map;
}

// Storage URLs
const productImageUrl = (p, { width = 360 } = {}) => p
  ? `https://fzgsogdceptjvuahukbn.supabase.co/storage/v1/render/image/public/crf-products/${p}?width=${width}&resize=cover`
  : '';
const fabricImageUrl = (p, { width = 360 } = {}) => p
  ? `https://fzgsogdceptjvuahukbn.supabase.co/storage/v1/render/image/public/crf-fabrics/${p}?width=${width}&resize=cover`
  : '';

function specRowsForLine(line) {
  // Build spec rows from selections, in category display order
  const sel = line.customizations || {};
  const rows = [];
  if (!catalogIndex) return rows;
  const seen = new Set();
  const entries = Object.entries(sel)
    .filter(([k, v]) => catalogIndex[v] && !seen.has(k) && (seen.add(k), true))
    .map(([catId, optId]) => ({
      cat: catalogIndex[optId],
      opt: optId,
    }))
    .sort((a, b) => a.cat.category_display_order - b.cat.category_display_order);
  for (const e of entries) {
    let value = e.cat.option_name;
    // Special: monogram → append text + thread
    if (e.cat.category_id === 'jacket-monogram' && e.opt === 'jacket-monogram-add') {
      const txt = (sel['jacket-monogram-text'] || '').trim();
      const thread = monogramThreadLabels[sel['jacket-monogram-thread']] || 'Black';
      value = txt ? `"${txt}" · ${thread} thread` : `${thread} thread`;
    }
    rows.push({ label: e.cat.category_name, value });
  }
  return rows;
}

function renderLine(line, product) {
  if (!product) {
    return `<div class="cart-line"><div></div><div>Item unavailable — please remove.</div>
      <button class="link-quiet" data-cart-remove="${escapeHtml(line.id)}">Remove</button></div>`;
  }
  // Use design photo (fabric path) for line preview
  const imgUrl = product.primary_photo_path
    ? fabricImageUrl(product.primary_photo_path, { width: 360 })
    : '';
  const title = `The ${product.fabric_brand} ${product.fabric_family} ${product.item_type_name}`;
  const specRows = specRowsForLine(line);

  const specHtml = specRows.length
    ? specRows.map(r => `
        <span class="spec-label">${escapeHtml(r.label)}</span>
        <span class="spec-value is-italic">${escapeHtml(r.value)}</span>
      `).join('')
    : `<span class="spec-value is-italic">(no customizations stored)</span>`;

  return `
    <div class="cart-line" data-line-id="${escapeHtml(line.id)}">
      <div class="cart-line-photo">
        ${imgUrl ? `<img src="${imgUrl}" alt="${escapeHtml(product.design_name)}" />` : ''}
      </div>
      <div class="cart-line-meta">
        <p class="cart-line-eyebrow">${escapeHtml(product.item_type_name)}</p>
        <h2 class="cart-line-title">${escapeHtml(title)}</h2>
        <p class="cart-line-design">${escapeHtml(product.design_name)} <span style="color: var(--color-grey-mid)">· ${escapeHtml(product.fabric_number)}</span></p>
        <div class="cart-line-controls">
          <div class="qty-stepper" aria-label="Quantity">
            <button type="button" data-qty-dec="${escapeHtml(line.id)}" aria-label="Decrease">−</button>
            <span class="qty-val">${line.qty}</span>
            <button type="button" data-qty-inc="${escapeHtml(line.id)}" aria-label="Increase">+</button>
          </div>
          <button class="link-quiet" type="button" data-cart-remove="${escapeHtml(line.id)}">Remove</button>
        </div>
        <details class="cart-spec">
          <summary>Customizations</summary>
          <div class="cart-spec-body">${specHtml}</div>
        </details>
      </div>
      <div class="cart-line-price">
        <span class="from">from</span>
        ${escapeHtml(fmtTHB(line.price_thb * line.qty))}
      </div>
    </div>
  `;
}

async function render() {
  const cart = readCart();
  const root = document.getElementById('cartRoot');

  if (!cart.items.length) {
    root.innerHTML = `
      <div class="cart-empty">
        <p class="cart-empty-text">Your specification is empty.</p>
        <a class="cart-empty-link" href="shop.html">Browse the Collection</a>
      </div>
    `;
    return;
  }

  // Ensure catalog index covers EVERY item type in the cart (mixed carts).
  await loadCatalogIndex(cart.items.map(x => x.item_type_id));

  // Fetch all product rows
  const productIds = cart.items.map(x => `${x.item_type_id}__${x.fabric_design_id}`);
  const products = await loadProducts(productIds);

  const linesHtml = cart.items.map(line => {
    const pid = `${line.item_type_id}__${line.fabric_design_id}`;
    return renderLine(line, products[pid]);
  }).join('');

  root.innerHTML = `
    <div class="cart-lines">${linesHtml}</div>
    <section class="cart-summary">
      <div></div>
      <div>
        <div class="cart-totals">
          <div class="cart-totals-row">
            <span class="cart-totals-label">Subtotal</span>
            <span>${escapeHtml(fmtTHB(subtotal()))}</span>
          </div>
        </div>
        <div class="cart-ctas" style="margin-top: 28px;">
          <button class="btn btn--primary" type="button" data-checkout-button>Proceed to Checkout</button>
          <a class="btn btn--ghost" id="reserveLink" href="#">Reserve Consultation</a>
          <a class="btn btn--ghost" href="shop.html">Continue Shopping</a>
        </div>
        <p class="checkout-error" data-checkout-error role="alert" aria-live="polite"></p>
      </div>
    </section>
  `;

  // Build the spec param for the reserve link
  const specPayload = btoa(unescape(encodeURIComponent(JSON.stringify(cart))));
  document.getElementById('reserveLink').href = `book-appointment.html?spec=${specPayload}`;
}

// Event delegation
document.addEventListener('click', (e) => {
  const t = e.target;
  if (!(t instanceof Element)) return;

  const inc = t.closest('[data-qty-inc]');
  if (inc) {
    const id = inc.getAttribute('data-qty-inc');
    const line = readCart().items.find(x => x.id === id);
    if (line) setQty(id, (line.qty || 1) + 1);
    render();
    return;
  }
  const dec = t.closest('[data-qty-dec]');
  if (dec) {
    const id = dec.getAttribute('data-qty-dec');
    const line = readCart().items.find(x => x.id === id);
    if (line) setQty(id, Math.max(1, (line.qty || 1) - 1));
    render();
    return;
  }
  const rm = t.closest('[data-cart-remove]');
  if (rm) {
    removeLine(rm.getAttribute('data-cart-remove'));
    render();
    return;
  }
});

// Re-render when cart changes from another tab (or from the customizer drawer)
window.addEventListener('crf:cart-changed', render);

render();
