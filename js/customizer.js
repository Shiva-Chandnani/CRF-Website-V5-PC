// =============================================================================
// Country Road Fashions — Suit Customizer Drawer
// =============================================================================
// A slide-in drawer that renders the customization catalogue for a single
// item type (V1: formal-suit-2-piece). The drawer has two view states:
//   • list   — the 21 categories, each row shows label + current value
//   • detail — grid of variant cards for one category, with description
//
// State lives entirely in this module. On "Add to Cart" the current selections
// are passed to cart.js and persisted to localStorage.
//
// Public API: openCustomizer({ item_type_id, fabric_design_id, price_thb,
//                              fabric_design_name, fabric_type_name })
// =============================================================================

import { supabase } from './data-loader.js';
import { addLine } from './cart.js';

// -----------------------------------------------------------------------------
// State
// -----------------------------------------------------------------------------
let catalog = null;           // [{ category_id, options: [...], ... }]
let catalogItemTypeId = null; // item_type_id the catalog was loaded for
let selections = {};          // { category_id: option_id, monogram extras }
let view = 'list';            // 'list' | 'detail'
let currentCategoryId = null;
let context = null;           // { item_type_id, fabric_design_id, price_thb, fabric_design_name, fabric_type_name }
let showAdvanced = false;

// Monogram thread colors (V1: hardcoded, not in DB)
const MONOGRAM_THREADS = [
  { id: 'black',    label: 'Black',    hex: '#1a1a1a' },
  { id: 'stone',    label: 'Stone',    hex: '#b6ada5' },
  { id: 'navy',     label: 'Navy',     hex: '#1f2c4c' },
  { id: 'burgundy', label: 'Burgundy', hex: '#6b1f1f' },
  { id: 'ivory',    label: 'Ivory',    hex: '#f7f3eb' },
];

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------
const escapeHtml = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const fmtTHB = (n) => 'THB ' + (Number(n) || 0).toLocaleString('en-US');

function findCategory(id) {
  return catalog?.find(c => c.category_id === id) || null;
}

function selectedOption(catId) {
  const cat = findCategory(catId);
  if (!cat) return null;
  return cat.options.find(o => o.id === selections[catId]) || cat.options[0];
}

function currentValueLabel(catId) {
  if (catId === 'jacket-monogram') {
    const opt = selections['jacket-monogram'];
    if (opt === 'jacket-monogram-add') {
      const t = (selections['jacket-monogram-text'] || '').trim();
      return t ? `"${t}"` : 'Add';
    }
    return 'None';
  }
  return selectedOption(catId)?.name || '—';
}

function nextCategoryAfter(catId) {
  const list = visibleCategories();
  const idx = list.findIndex(c => c.category_id === catId);
  return idx >= 0 && idx + 1 < list.length ? list[idx + 1] : null;
}

function visibleCategories() {
  if (!catalog) return [];
  return catalog.filter(c => !c.is_advanced || showAdvanced);
}

// -----------------------------------------------------------------------------
// Data load
// -----------------------------------------------------------------------------
async function loadCatalog(itemTypeId) {
  const { data, error } = await supabase
    .from('v_customization_catalog')
    .select('*')
    .eq('item_type_id', itemTypeId);
  if (error) throw error;

  const map = new Map();
  for (const r of data) {
    if (!map.has(r.category_id)) {
      map.set(r.category_id, {
        category_id: r.category_id,
        category_name: r.category_name,
        category_group: r.category_group,
        category_display_order: r.category_display_order,
        category_description: r.category_description,
        is_advanced: r.is_advanced,
        is_tuxedo_only: r.is_tuxedo_only,
        options: [],
      });
    }
    map.get(r.category_id).options.push({
      id: r.option_id,
      name: r.option_name,
      description: r.option_description,
      svg_path: r.svg_path,
      is_default: r.is_default,
      display_order: r.option_display_order,
      price_delta_thb: r.price_delta_thb,
    });
  }
  const cats = [...map.values()]
    .sort((a, b) => a.category_display_order - b.category_display_order);
  cats.forEach(c => c.options.sort((a, b) => a.display_order - b.display_order));
  return cats;
}

function makeDefaultSelections(cats) {
  const sel = {};
  for (const c of cats) {
    const def = c.options.find(o => o.is_default) || c.options[0];
    sel[c.category_id] = def.id;
  }
  sel['jacket-monogram-text'] = '';
  sel['jacket-monogram-thread'] = 'black';
  return sel;
}

// -----------------------------------------------------------------------------
// Render — list view
// -----------------------------------------------------------------------------
function renderListView() {
  const drawer = document.getElementById('customizerDrawer');
  if (!drawer) return;

  const cats = visibleCategories();
  const hasAdvanced = catalog.some(c => c.is_advanced);

  // Group rows by jacket vs pants
  const jacket = cats.filter(c => c.category_group === 'jacket');
  const pants  = cats.filter(c => c.category_group === 'pants');

  const rowHtml = (c) => `
    <button type="button" class="cz-row" data-cz-row="${c.category_id}">
      <span class="cz-row-label">${escapeHtml(c.category_name)}</span>
      <span class="cz-row-value">${escapeHtml(currentValueLabel(c.category_id))}</span>
      <svg class="cz-row-chev" width="6" height="12" viewBox="0 0 6 12" fill="none" stroke="currentColor" stroke-width="1"><path d="M0.5 10.7L5 6L0.5 1.3"/></svg>
    </button>
  `;

  drawer.innerHTML = `
    <div class="cz-panels" data-cz-view="list">
      <section class="cz-panel cz-panel--list">
        <header class="cz-header">
          <h2 class="cz-title">Customize Your Suit</h2>
          <button type="button" class="cz-close" aria-label="Close" data-cz-close>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M1 1L13 13M13 1L1 13"/></svg>
          </button>
        </header>
        <div class="cz-context">
          <p class="cz-context-eyebrow">Fabric</p>
          <p class="cz-context-value">${escapeHtml(context.fabric_design_name || context.fabric_type_name || '')}</p>
        </div>
        <div class="cz-rows">
          <p class="cz-group">Jacket</p>
          ${jacket.map(rowHtml).join('')}
          <p class="cz-group">Trouser</p>
          ${pants.map(rowHtml).join('')}
          ${hasAdvanced ? `
            <button type="button" class="cz-toggle-advanced" data-cz-toggle-advanced>
              ${showAdvanced ? 'Hide Additional Options' : 'Show Additional Options'}
            </button>
          ` : ''}
        </div>
        <footer class="cz-footer">
          <span class="cz-price">${escapeHtml(fmtTHB(context.price_thb))}</span>
          <button type="button" class="cz-cta" data-cz-add-to-cart>Add to Spec</button>
        </footer>
      </section>
    </div>
  `;
}

// -----------------------------------------------------------------------------
// Render — detail view
// -----------------------------------------------------------------------------
function renderDetailView() {
  const drawer = document.getElementById('customizerDrawer');
  if (!drawer) return;
  const cat = findCategory(currentCategoryId);
  if (!cat) { view = 'list'; return renderListView(); }

  const selectedId = selections[cat.category_id];
  const selOption = cat.options.find(o => o.id === selectedId);
  const next = nextCategoryAfter(cat.category_id);
  const isMonogram = cat.category_id === 'jacket-monogram';

  const cardHtml = (o) => `
    <button type="button" class="cz-card${o.id === selectedId ? ' is-selected' : ''}"
            data-cz-option="${o.id}" data-cz-category="${cat.category_id}">
      ${o.id === selectedId ? `<span class="cz-card-check" aria-hidden="true">
        <svg width="10" height="8" viewBox="0 0 10 8" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M1 4L4 7L9 1"/></svg>
      </span>` : ''}
      <span class="cz-card-illust">
        <img src="${escapeHtml(o.svg_path)}" alt="" loading="lazy" />
      </span>
      <span class="cz-card-label">${escapeHtml(o.name)}</span>
    </button>
  `;

  const monogramExtras = isMonogram && selectedId === 'jacket-monogram-add' ? `
    <div class="cz-monogram">
      <label class="cz-monogram-field">
        <span class="cz-monogram-label">Initials (up to 3)</span>
        <input type="text" maxlength="3" autocomplete="off" spellcheck="false"
               value="${escapeHtml(selections['jacket-monogram-text'] || '')}"
               class="cz-monogram-input" data-cz-monogram-text>
      </label>
      <div class="cz-monogram-field">
        <span class="cz-monogram-label">Thread colour</span>
        <div class="cz-thread-row">
          ${MONOGRAM_THREADS.map(t => `
            <button type="button"
                    class="cz-thread${selections['jacket-monogram-thread'] === t.id ? ' is-selected' : ''}"
                    style="--thread-color: ${t.hex}"
                    title="${escapeHtml(t.label)}"
                    data-cz-thread="${t.id}"
                    aria-label="${escapeHtml(t.label)}"></button>
          `).join('')}
        </div>
      </div>
    </div>
  ` : '';

  drawer.innerHTML = `
    <div class="cz-panels" data-cz-view="detail">
      <section class="cz-panel cz-panel--detail">
        <header class="cz-header cz-header--detail">
          <button type="button" class="cz-back" aria-label="Back" data-cz-back>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M9 1L3 7L9 13"/></svg>
          </button>
          <h2 class="cz-title">${escapeHtml(cat.category_name)}</h2>
          <button type="button" class="cz-close" aria-label="Close" data-cz-close>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M1 1L13 13M13 1L1 13"/></svg>
          </button>
        </header>
        ${cat.category_description ? `<p class="cz-cat-desc">${escapeHtml(cat.category_description)}</p>` : ''}
        <div class="cz-grid">
          ${cat.options.map(cardHtml).join('')}
        </div>
        ${monogramExtras}
        ${selOption ? `
          <div class="cz-option-detail">
            <p class="cz-option-name">${escapeHtml(selOption.name)}</p>
            <p class="cz-option-desc">${escapeHtml(selOption.description || '')}</p>
          </div>
        ` : ''}
        <footer class="cz-footer">
          <span class="cz-price">${escapeHtml(fmtTHB(context.price_thb))}</span>
          ${next
            ? `<button type="button" class="cz-cta" data-cz-next="${next.category_id}">Next</button>`
            : `<button type="button" class="cz-cta" data-cz-done>Done</button>`
          }
        </footer>
      </section>
    </div>
  `;
}

function render() {
  if (view === 'list') renderListView();
  else renderDetailView();
}

// -----------------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------------
export async function openCustomizer(ctx) {
  context = { ...ctx };

  // Lazy-load + cache catalog per item type
  if (!catalog || catalogItemTypeId !== ctx.item_type_id) {
    try {
      catalog = await loadCatalog(ctx.item_type_id);
    } catch (err) {
      console.error('Failed to load customization catalog:', err);
      return;
    }
    catalogItemTypeId = ctx.item_type_id;
    selections = makeDefaultSelections(catalog);
  }
  view = 'list';
  currentCategoryId = null;
  document.body.classList.add('is-customizing');
  render();
}

export function closeCustomizer() {
  document.body.classList.remove('is-customizing');
}

// -----------------------------------------------------------------------------
// Event delegation (global; safe to bind once at module load)
// -----------------------------------------------------------------------------
document.addEventListener('click', (e) => {
  const t = e.target;
  if (!(t instanceof Element)) return;

  if (t.closest('[data-cz-close]')) {
    closeCustomizer();
    return;
  }

  if (t.closest('[data-cz-back]')) {
    view = 'list';
    currentCategoryId = null;
    render();
    return;
  }

  const rowBtn = t.closest('[data-cz-row]');
  if (rowBtn) {
    currentCategoryId = rowBtn.getAttribute('data-cz-row');
    view = 'detail';
    render();
    return;
  }

  const optBtn = t.closest('[data-cz-option]');
  if (optBtn) {
    const optId = optBtn.getAttribute('data-cz-option');
    const catId = optBtn.getAttribute('data-cz-category');
    selections[catId] = optId;
    render();
    return;
  }

  const threadBtn = t.closest('[data-cz-thread]');
  if (threadBtn) {
    selections['jacket-monogram-thread'] = threadBtn.getAttribute('data-cz-thread');
    render();
    return;
  }

  const nextBtn = t.closest('[data-cz-next]');
  if (nextBtn) {
    currentCategoryId = nextBtn.getAttribute('data-cz-next');
    view = 'detail';
    render();
    return;
  }

  if (t.closest('[data-cz-done]')) {
    view = 'list';
    currentCategoryId = null;
    render();
    return;
  }

  if (t.closest('[data-cz-toggle-advanced]')) {
    showAdvanced = !showAdvanced;
    render();
    return;
  }

  if (t.closest('[data-cz-add-to-cart]')) {
    handleAddToCart();
    return;
  }

  // Click on backdrop (the drawer wrapper, not its content) closes
  if (t.id === 'customizerBackdrop') {
    closeCustomizer();
    return;
  }
});

// Monogram text input
document.addEventListener('input', (e) => {
  const t = e.target;
  if (!(t instanceof HTMLInputElement)) return;
  if (t.matches('[data-cz-monogram-text]')) {
    // Letters only, uppercase
    const cleaned = t.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3);
    selections['jacket-monogram-text'] = cleaned;
    if (t.value !== cleaned) t.value = cleaned;
  }
});

// Escape closes
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.body.classList.contains('is-customizing')) {
    closeCustomizer();
  }
});

// -----------------------------------------------------------------------------
// Add to cart + toast
// -----------------------------------------------------------------------------
function handleAddToCart() {
  if (!context) return;
  addLine({
    item_type_id: context.item_type_id,
    fabric_design_id: context.fabric_design_id,
    price_thb: context.price_thb,
    customizations: { ...selections },
  });
  closeCustomizer();
  showToast('Added to your specification.');
}

let toastTimer = null;
function showToast(message) {
  let el = document.getElementById('crfToast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'crfToast';
    el.className = 'crf-toast';
    document.body.appendChild(el);
  }
  el.innerHTML = `
    <span class="crf-toast-text">${escapeHtml(message)}</span>
    <a class="crf-toast-link" href="cart.html">View Spec</a>
  `;
  el.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('is-visible'), 3500);
}
