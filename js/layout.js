// =============================================================================
// Country Road Fashions — layout mounter
// =============================================================================
// Fetches components/header.html and components/footer.html and injects them
// into the page's <div data-layout="header"> and <div data-layout="footer">
// slots, then dispatches a `crf:layout-ready` event on document. Consumer
// modules (js/cart.js, js/newsletter.js, page scripts) listen for this event
// before binding to header/footer elements.
//
// Active-nav decoration: links with [data-nav="..."] in the header are
// matched against (location.pathname + location.hash). A data-nav value
// without a fragment matches any hash on the same path; a value WITH a
// fragment must match exactly. data-nav="/" matches both "/" and
// "/index.html" routes.
// =============================================================================

const HEADER_URL = '/components/header.html';
const FOOTER_URL = '/components/footer.html';

async function fetchFragment(url) {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`[layout] ${url} → ${res.status}`);
  return res.text();
}

function navMatches(navValue, pathname, hash) {
  if (!navValue) return false;
  if (navValue === '/') {
    return pathname === '/' || pathname.endsWith('/index.html');
  }
  const hashIdx = navValue.indexOf('#');
  if (hashIdx === -1) {
    return navValue === pathname;
  }
  return navValue === pathname + hash;
}

function decorateActiveNav(root) {
  if (!root) return;
  const here = location.pathname || '/';
  const hash = location.hash || '';
  const links = root.querySelectorAll('[data-nav]');
  for (const a of links) {
    const target = a.getAttribute('data-nav');
    if (navMatches(target, here, hash)) {
      a.setAttribute('aria-current', 'page');
    }
  }
}

function clearReservation(slot) {
  if (!slot) return;
  slot.style.minHeight = '';
  slot.style.background = '';
  if (slot.getAttribute('style') === '' || slot.style.cssText === '') {
    slot.removeAttribute('style');
  }
}

async function mount() {
  const headerSlot = document.querySelector('[data-layout="header"]');
  const footerSlot = document.querySelector('[data-layout="footer"]');

  const tasks = [];
  if (headerSlot) {
    tasks.push(
      fetchFragment(HEADER_URL).then(html => {
        headerSlot.innerHTML = html;
        clearReservation(headerSlot);
      })
    );
  }
  if (footerSlot) {
    tasks.push(
      fetchFragment(FOOTER_URL).then(html => {
        footerSlot.innerHTML = html;
        clearReservation(footerSlot);
      })
    );
  }

  if (!tasks.length) return;
  const results = await Promise.allSettled(tasks);
  const failed = results.filter(r => r.status === 'rejected');
  if (failed.length) {
    for (const r of failed) console.error('[layout] fragment failed', r.reason);
  }

  // Fire layout-ready if at least one slot is now populated. A page with a
  // broken footer fetch but a healthy header should still let cart.js + page
  // scripts bind to the header.
  const anyMounted =
    (headerSlot && headerSlot.children.length > 0) ||
    (footerSlot && footerSlot.children.length > 0);

  if (!anyMounted) return;
  if (headerSlot && headerSlot.children.length > 0) decorateActiveNav(headerSlot);
  document.dispatchEvent(new CustomEvent('crf:layout-ready', { detail: null }));
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount, { once: true });
} else {
  mount();
}
