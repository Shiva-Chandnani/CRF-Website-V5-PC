// Phase 3 — header typeahead search overlay. Mounts on every page's shared
// header (crf:layout-ready). Debounced quickSearch → ranked product results.
import { quickSearch, fabricImageUrl } from './data-loader.js';

const DEBOUNCE_MS = 200;
const fmtTHB = (n) => 'THB ' + Number(n).toLocaleString('en-US');
const pdpHref = (r) =>
  `product.html?item=${encodeURIComponent(r.item_type_id)}` +
  `&fabric=${encodeURIComponent(r.fabric_type_id)}` +
  `&design=${encodeURIComponent(r.fabric_design_id)}`;

function buildOverlay() {
  const el = document.createElement('div');
  el.id = 'search-overlay';
  el.setAttribute('data-open', '0');
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', 'Search products');
  el.hidden = true;
  el.innerHTML = `
    <div class="search-overlay__backdrop" data-search-close></div>
    <div class="search-overlay__panel" role="document">
      <div class="search-overlay__bar">
        <svg class="search-overlay__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.35-4.35"/></svg>
        <input type="search" class="search-overlay__input" data-search-input="1"
               placeholder="Search cloth, cut, or fabric number" autocomplete="off"
               aria-controls="search-overlay-results" aria-label="Search products" />
        <button class="search-overlay__close icon-btn" data-search-close aria-label="Close search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>
        </button>
      </div>
      <div class="search-overlay__results" id="search-overlay-results" role="listbox" aria-label="Search results"></div>
      <a class="search-overlay__seeall" data-search-seeall href="shop.html" hidden>See all results →</a>
    </div>`;
  document.body.appendChild(el);
  return el;
}

function renderResults(listbox, seeAll, rows, query) {
  seeAll.setAttribute('href', `shop.html?q=${encodeURIComponent(query)}`);
  if (!query) { listbox.innerHTML = ''; seeAll.hidden = true; return; }
  if (!rows.length) {
    listbox.innerHTML = `<p class="search-overlay__empty">No pieces match “${query}”. Try a fabric, cut, or number.</p>`;
    seeAll.hidden = true;
    return;
  }
  listbox.innerHTML = rows.map((r, i) => {
    const img = fabricImageUrl(r.primary_photo_path, { width: 96 }) || 'https://placehold.co/96x120';
    return `<a class="search-overlay__result" role="option" id="search-opt-${i}" tabindex="-1"
               href="${pdpHref(r)}">
      <img class="search-overlay__thumb" src="${img}" alt="" loading="lazy" />
      <span class="search-overlay__meta">
        <span class="search-overlay__name">${r.display_name}</span>
        <span class="search-overlay__price">from ${fmtTHB(r.price)}</span>
      </span>
    </a>`;
  }).join('');
  seeAll.hidden = false;
}

function init(trigger) {
  if (trigger.dataset.searchReady === '1') return;
  const overlay = buildOverlay();
  const input   = overlay.querySelector('[data-search-input]');
  const listbox = overlay.querySelector('#search-overlay-results');
  const seeAll  = overlay.querySelector('[data-search-seeall]');
  let timer = null, lastFocus = null;

  const open = () => {
    lastFocus = document.activeElement;
    overlay.hidden = false;
    overlay.setAttribute('data-open', '1');
    trigger.setAttribute('aria-expanded', 'true');
    input.focus();
    document.addEventListener('keydown', onKey);
  };
  const close = () => {
    overlay.setAttribute('data-open', '0');
    trigger.setAttribute('aria-expanded', 'false');
    document.removeEventListener('keydown', onKey);
    setTimeout(() => { overlay.hidden = true; }, 180); // let the fade-out run
    (trigger || lastFocus)?.focus?.();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key === 'Tab') {
      const focusables = overlay.querySelectorAll('input, button, a[href]:not([hidden]), [role="option"]');
      if (!focusables.length) return;
      const first = focusables[0], last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  };

  trigger.addEventListener('click', (e) => { e.preventDefault(); open(); });
  overlay.querySelectorAll('[data-search-close]').forEach(b => b.addEventListener('click', close));
  input.addEventListener('input', () => {
    const q = input.value.trim();
    clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        const rows = q ? await quickSearch(q, 6) : [];
        renderResults(listbox, seeAll, rows, q);
      } catch (err) {
        listbox.innerHTML = `<p class="search-overlay__empty">Search is unavailable right now.</p>`;
        console.error('[search-overlay]', err);
      }
    }, DEBOUNCE_MS);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && input.value.trim()) {
      location.href = `shop.html?q=${encodeURIComponent(input.value.trim())}`;
    }
  });

  trigger.setAttribute('aria-haspopup', 'dialog');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.dataset.searchReady = '1';
}

function mount() {
  const trigger = document.querySelector('[data-search-btn]');
  if (trigger) init(trigger);
}
document.addEventListener('crf:layout-ready', mount);
if (document.querySelector('[data-search-btn]')) mount(); // header already present
