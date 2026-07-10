// Phase 3 — header typeahead search overlay. Mounts on every page's shared
// header (crf:layout-ready). Debounced quickSearch → ranked product results.
import { quickSearch, fabricImageUrl } from './data-loader.js';

const DEBOUNCE_MS = 200;
const fmtTHB = (n) => 'THB ' + Number(n).toLocaleString('en-US');
// HTML-escape untrusted catalogue text before it touches innerHTML.
const esc = (s) => String(s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
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
               role="combobox" aria-autocomplete="list" aria-expanded="false"
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

// Renders results into the listbox. Returns the option count so the caller
// can reset combobox state. Untrusted text (query, display_name) is escaped.
function renderResults(listbox, seeAll, rows, query) {
  seeAll.setAttribute('href', `shop.html?q=${encodeURIComponent(query)}`);
  if (!query) { listbox.innerHTML = ''; seeAll.hidden = true; return 0; }
  if (!rows.length) {
    // Build the empty state with textContent so a query can never inject markup.
    listbox.innerHTML = '';
    const p = document.createElement('p');
    p.className = 'search-overlay__empty';
    p.textContent = 'No pieces match “' + query + '”. Try a fabric, cut, or number.';
    listbox.appendChild(p);
    seeAll.hidden = true;
    return 0;
  }
  listbox.innerHTML = rows.map((r, i) => {
    const img = fabricImageUrl(r.primary_photo_path, { width: 96 }) || 'https://placehold.co/96x120';
    return `<a class="search-overlay__result" role="option" id="search-opt-${i}" tabindex="-1"
               href="${pdpHref(r)}">
      <img class="search-overlay__thumb" src="${esc(img)}" alt="" loading="lazy" />
      <span class="search-overlay__meta">
        <span class="search-overlay__name">${esc(r.display_name)}</span>
        <span class="search-overlay__price">from ${fmtTHB(r.price)}</span>
      </span>
    </a>`;
  }).join('');
  seeAll.hidden = false;
  return rows.length;
}

function init(trigger) {
  if (trigger.dataset.searchReady === '1') return;
  const overlay = buildOverlay();
  const input   = overlay.querySelector('[data-search-input]');
  const listbox = overlay.querySelector('#search-overlay-results');
  const seeAll  = overlay.querySelector('[data-search-seeall]');
  let timer = null, hideTimer = null, seq = 0, activeIndex = -1;

  const options = () => Array.from(listbox.querySelectorAll('[role="option"]'));
  const setExpanded = (on) => input.setAttribute('aria-expanded', on ? 'true' : 'false');
  const clearActive = () => {
    activeIndex = -1;
    input.removeAttribute('aria-activedescendant');
    options().forEach(o => o.classList.remove('is-active'));
  };
  const setActive = (i) => {
    const opts = options();
    if (!opts.length) return;
    const n = (i + opts.length) % opts.length; // wrap-around
    opts.forEach(o => o.classList.remove('is-active'));
    const opt = opts[n];
    opt.classList.add('is-active');
    input.setAttribute('aria-activedescendant', opt.id);
    opt.scrollIntoView({ block: 'nearest' });
    activeIndex = n;
  };

  const open = () => {
    clearTimeout(hideTimer); // cancel any in-flight fade-out from a prior close
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
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => { overlay.hidden = true; }, 180); // let the fade-out run
    trigger.focus();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); clearActive(); close(); return; }
    if (e.key === 'Tab') {
      const focusables = overlay.querySelectorAll('input, button, a[href]:not([hidden])');
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
    const mySeq = ++seq;
    timer = setTimeout(async () => {
      try {
        const rows = q ? await quickSearch(q, 6) : [];
        if (mySeq !== seq) return; // a newer query superseded this one
        const count = renderResults(listbox, seeAll, rows, q);
        clearActive();
        setExpanded(count > 0);
      } catch (err) {
        if (mySeq !== seq) return;
        listbox.innerHTML = '';
        const p = document.createElement('p');
        p.className = 'search-overlay__empty';
        p.textContent = 'Search is unavailable right now.';
        listbox.appendChild(p);
        clearActive();
        setExpanded(false);
        console.error('[search-overlay]', err);
      }
    }, DEBOUNCE_MS);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      if (options().length) { e.preventDefault(); setActive(activeIndex + 1); }
      return;
    }
    if (e.key === 'ArrowUp') {
      if (options().length) { e.preventDefault(); setActive(activeIndex - 1); }
      return;
    }
    if (e.key === 'Enter') {
      const opts = options();
      if (activeIndex >= 0 && opts[activeIndex]) {
        e.preventDefault();
        location.href = opts[activeIndex].href;
      } else if (input.value.trim()) {
        location.href = `shop.html?q=${encodeURIComponent(input.value.trim())}`;
      }
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
