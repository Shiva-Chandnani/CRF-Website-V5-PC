import {
  getCategories, getSubcategoriesFor, fabricImageUrl, productImageUrl, searchProducts, productSearch, supabase
} from '/js/data-loader.js';
import { setMeta, canonicalFor, SITE_ORIGIN } from '/js/meta.js';

// ---------- Item-kind singularised label (for "The Cavani Wool ___") ----------
const ITEM_KIND = {
  'suits':           'Suit',
  'shirts':          'Shirt',
  'pants':           'Trouser',
  'coats':           'Coat',
  'jackets-blazers': 'Jacket',
  'mandarin-collar': 'Vest',
  'accessories':     'Accessory',
};

// ---------- Pattern human labels ----------
const PATTERN_LABEL = {
  'solid': 'Solid',
  'pinstripe': 'Pinstripe',
  'chalk-stripe': 'Chalk Stripe',
  'check': 'Check',
  'windowpane': 'Windowpane',
  'herringbone': 'Herringbone',
  'houndstooth': 'Houndstooth',
  'glen-plaid': 'Glen Plaid',
  'twill': 'Twill',
  'other': 'Other',
};

// ---------- State ----------
const params = new URLSearchParams(location.search);
const state = {
  categoryId:    params.get('category')    || null,
  subcategoryId: params.get('subcategory') || null,
  fabricTypeId:  params.get('fabric')      || null,
  pattern:       params.get('pattern')     || null,
  color:         params.get('color')       || null,
  sort:          'recommended',
  query:         params.get('q') || '',
  products:      [],
  categories:    [],
};

// Generation counter: a superseded async load never assigns/renders (guards
// the stale-response race between text search, filter, and sort reloads).
let loadSeq = 0;
// Hoisted so a filter/sort reload can cancel a queued keystroke debounce.
let searchTimer = null;

// ---------- Helpers ----------
const $  = (sel) => document.querySelector(sel);
const fmtTHB = (n) => 'THB ' + n.toLocaleString('en-US');

function pageTitleFor(category) {
  if (!category) return { title: 'The <em>Bespoke</em> Collection', tagline: 'Made-to-measure tailoring — hand-finished, cloth selected by you.', leaf: 'All Bespoke' };
  const map = {
    'suits':           { title: '<em>Suits</em>',           tagline: 'Two-piece, three-piece, dinner and ceremonial — cut for the wearer.' },
    'shirts':          { title: '<em>Shirts</em>',          tagline: 'Egyptian poplin, Bohemian linen, oxfords — fitted to the millimetre.' },
    'pants':           { title: '<em>Pants</em>',           tagline: 'Trousers, chinos, linens. The foundation of the wardrobe.' },
    'coats':           { title: '<em>Coats</em>',           tagline: 'Peacoats and overcoats for the cooler months.' },
    'jackets-blazers': { title: 'Jackets &amp; <em>Blazers</em>', tagline: 'Soft-shouldered tailoring — formal, summer, hopsack.' },
    'mandarin-collar': { title: '<em>Mandarin Collar</em>',  tagline: 'A signature silhouette — vests and full suits.' },
    'accessories':     { title: '<em>Accessories</em>',     tagline: 'Cufflinks, ties, pocket squares — the finishing notes.' },
  };
  const m = map[category.id] || { title: `<em>${category.name}</em>`, tagline: '' };
  return { ...m, leaf: category.name };
}

function applyShopMeta() {
  const cat = state.categories.find(c => c.id === state.categoryId);
  const label = cat ? cat.name : 'The Bespoke Collection';
  let title, description, canonical;
  if (state.query) {
    title = `Search: ${state.query} — Country Road Fashions`;
    description = `Search results for "${state.query}" across the Country Road Fashions bespoke collection.`;
    canonical = canonicalFor('/shop.html'); // search pages consolidate to the base
  } else {
    title = `${label} — Country Road Fashions`;
    description = cat
      ? `Made-to-measure ${cat.name.toLowerCase()} in premium wool, hand-finished in our Bangkok atelier.`
      : 'Browse made-to-measure suits, jackets and trousers in premium wool. Hand-finished in our Bangkok atelier, cut to your measurements.';
    canonical = canonicalFor('/shop.html' + (state.categoryId ? `?category=${encodeURIComponent(state.categoryId)}` : ''));
  }
  const crumbs = [
    { '@type': 'ListItem', position: 1, name: 'House', item: SITE_ORIGIN + '/' },
    { '@type': 'ListItem', position: 2, name: 'Shop', item: SITE_ORIGIN + '/shop.html' },
  ];
  if (cat && !state.query) {
    crumbs.push({ '@type': 'ListItem', position: 3, name: cat.name, item: canonical });
  }
  const breadcrumbLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs,
  };
  setMeta({ title, description, canonical, jsonLd: breadcrumbLd });
}

// ---------- Load + render ----------
async function init() {
  state.categories = await getCategories();

  // Page title
  const cat = state.categories.find(c => c.id === state.categoryId);
  const t = pageTitleFor(cat);
  $('#shop-title').innerHTML = `${t.title}`.includes('<em>') ? (state.categoryId ? t.title : 'The ' + t.title + ' Collection') : t.title;
  if (!state.categoryId) $('#shop-title').innerHTML = 'The <em>Bespoke</em> Collection';
  $('#shop-tagline').textContent = t.tagline;
  $('#crumb-leaf').textContent = t.leaf;

  // Render the category filter list eagerly (it doesn't depend on products)
  renderCategoryList();

  // Wire grid interactions once (event delegation handles re-renders)
  wireSwatchInteractions();

  // Fetch products with current filters
  if (await loadProducts()) renderAll();

  // Reflect any ?q= into the search box
  $('#searchInput').value = state.query;

  applyShopMeta();

  // Wire interactions
  $('#sortSelect').addEventListener('change', (e) => { state.sort = e.target.value; renderGrid(); });
  $('#searchInput').addEventListener('input', (e) => {
    state.query = e.target.value.trim();
    clearTimeout(searchTimer);
    searchTimer = setTimeout(async () => {
      if (await loadProducts()) renderAll();
      applyShopMeta();
    }, 250);
  });
  $('#filterToggle').addEventListener('click', () => {
    const layout = $('#shopLayout');
    const isOpen = layout.dataset.filters === 'open';
    layout.dataset.filters = isOpen ? 'closed' : 'open';
    $('#filterToggle').setAttribute('aria-expanded', String(!isOpen));
    $('#filterToggle').querySelector('span').textContent = isOpen ? 'Show Filters' : 'Hide Filters';
  });
}

async function loadProducts() {
  const mySeq = ++loadSeq;
  const filters = {
    categoryId:    state.categoryId    || null,
    subcategoryId: state.subcategoryId || null,
    fabricTypeId:  state.fabricTypeId  || null,
    pattern:       state.pattern       || null,
    color:         state.color         || null,
  };
  // productSearch: server-ranked when a query is present; falls back to the
  // filter-only path (searchProducts) when the query is blank.
  const rows = await productSearch(state.query, filters);
  if (mySeq !== loadSeq) return false;   // a newer load superseded this one
  state.products = rows;
  return true;
}

function renderAll() {
  renderCategoryList();
  renderSubcategoryList();
  renderFabricList();
  renderPatternList();
  renderColorList();
  renderGrid();
}

function renderCategoryList() {
  const ul = $('#categoryList');
  ul.innerHTML = '';
  // "All" entry
  ul.appendChild(makeFilterLi('All Bespoke', '', !state.categoryId, () => setFilter('categoryId', null)));
  state.categories.forEach(c => {
    ul.appendChild(makeFilterLi(c.name, '', state.categoryId === c.id, () => setFilter('categoryId', c.id)));
  });
}

function renderSubcategoryList() {
  const ul = $('#subcategoryList');
  ul.innerHTML = '';
  const subs = new Map();
  state.products.forEach(p => {
    if (!subs.has(p.subcategory_id)) subs.set(p.subcategory_id, { id: p.subcategory_id, count: 0 });
    subs.get(p.subcategory_id).count++;
  });
  if (subs.size === 0) { ul.innerHTML = '<li><span style="color:var(--color-grey-mid)">—</span></li>'; return; }
  [...subs.values()].forEach(s => {
    // friendly label from slug
    const label = s.id.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    ul.appendChild(makeFilterLi(label, s.count, state.subcategoryId === s.id, () => setFilter('subcategoryId', state.subcategoryId === s.id ? null : s.id)));
  });
}

function renderFabricList() {
  const ul = $('#fabricList');
  ul.innerHTML = '';
  const map = new Map();
  state.products.forEach(p => {
    const key = p.fabric_type_id;
    if (!map.has(key)) map.set(key, { id: key, label: p.fabric_type_name, count: 0 });
    map.get(key).count++;
  });
  if (map.size === 0) { ul.innerHTML = '<li><span style="color:var(--color-grey-mid)">—</span></li>'; return; }
  [...map.values()].forEach(f => {
    ul.appendChild(makeFilterLi(f.label, f.count, state.fabricTypeId === f.id, () => setFilter('fabricTypeId', state.fabricTypeId === f.id ? null : f.id)));
  });
}

function renderPatternList() {
  const ul = $('#patternList');
  ul.innerHTML = '';
  const map = new Map();
  state.products.forEach(p => {
    if (!map.has(p.pattern)) map.set(p.pattern, 0);
    map.set(p.pattern, map.get(p.pattern) + 1);
  });
  if (map.size === 0) { ul.innerHTML = '<li><span style="color:var(--color-grey-mid)">—</span></li>'; return; }
  [...map.entries()].forEach(([pat, count]) => {
    ul.appendChild(makeFilterLi(PATTERN_LABEL[pat] || pat, count, state.pattern === pat, () => setFilter('pattern', state.pattern === pat ? null : pat)));
  });
}

function renderColorList() {
  const ul = $('#colorList');
  ul.innerHTML = '';
  const map = new Map();
  state.products.forEach(p => {
    (p.color || []).forEach(c => map.set(c, (map.get(c) || 0) + 1));
  });
  if (map.size === 0) { ul.innerHTML = '<li><span style="color:var(--color-grey-mid)">—</span></li>'; return; }
  [...map.entries()].sort((a, b) => b[1] - a[1]).forEach(([c, count]) => {
    const label = c.replace(/\b\w/g, ch => ch.toUpperCase());
    ul.appendChild(makeFilterLi(label, count, state.color === c, () => setFilter('color', state.color === c ? null : c)));
  });
}

function makeFilterLi(label, count, active, onClick) {
  const li = document.createElement('li');
  const btn = document.createElement('button');
  btn.className = 'filter-link' + (active ? ' is-active' : '');
  btn.innerHTML = `<span>${label}</span>${count !== '' && count !== undefined ? `<span class="count">${count}</span>` : ''}`;
  btn.addEventListener('click', onClick);
  li.appendChild(btn);
  return li;
}

function setFilter(key, value) {
  state[key] = value;
  // reflect in URL for shareability
  const p = new URLSearchParams();
  if (state.categoryId)    p.set('category',    state.categoryId);
  if (state.subcategoryId) p.set('subcategory', state.subcategoryId);
  if (state.fabricTypeId)  p.set('fabric',      state.fabricTypeId);
  if (state.pattern)       p.set('pattern',     state.pattern);
  if (state.color)         p.set('color',       state.color);
  const qs = p.toString();
  history.replaceState(null, '', qs ? `?${qs}` : location.pathname);
  refresh();
}

async function refresh() {
  // Cancel any queued keystroke-triggered reload so it can't land stale
  // after this filter/sort-driven reload.
  clearTimeout(searchTimer);
  $('#productCount').textContent = 'Loading…';
  const won = await loadProducts();
  // re-evaluate page title if category changed
  const cat = state.categories.find(c => c.id === state.categoryId);
  const t = pageTitleFor(cat);
  $('#shop-title').innerHTML = state.categoryId ? 'The ' + t.title + ' Collection' : 'The <em>Bespoke</em> Collection';
  $('#shop-tagline').textContent = t.tagline;
  $('#crumb-leaf').textContent = t.leaf;
  applyShopMeta();
  if (won) renderAll();
}

function sortProducts(list) {
  const arr = [...list];
  switch (state.sort) {
    case 'price-asc':  arr.sort((a, b) => a.price - b.price); break;
    case 'price-desc': arr.sort((a, b) => b.price - a.price); break;
    case 'name':       arr.sort((a, b) => a.design_name.localeCompare(b.design_name)); break;
    case 'recommended':
    default:
      if (state.query) break; // active query → keep server relevance order
      arr.sort((a, b) =>
        (a.item_type_id.localeCompare(b.item_type_id)) ||
        (a.fabric_number.localeCompare(b.fabric_number))
      );
  }
  return arr;
}

function renderGrid() {
  const grid = $('#productGrid');
  // state.products is already the server-side (ranked) result set for the
  // current query + filters — no client-side substring filtering here.
  let list = sortProducts(state.products);

  // Group into cards
  const groups = groupForCards(list);
  $('#productCount').textContent = `${groups.length} ${groups.length === 1 ? 'Piece' : 'Pieces'}`;

  if (!groups.length) {
    grid.innerHTML = `<div class="grid-msg">No pieces match — try widening the cloth, pattern, or search terms.</div>`;
    return;
  }
  grid.innerHTML = groups.map(productCard).join('');
}

// ---------- Group flat v_products rows into (item × fabric) cards ----------
function groupForCards(rows) {
  const map = new Map();
  rows.forEach(p => {
    const key = `${p.item_type_id}__${p.fabric_type_id}`;
    if (!map.has(key)) {
      map.set(key, {
        key,
        item_type_id:    p.item_type_id,
        item_type_name:  p.item_type_name,
        fabric_type_id:  p.fabric_type_id,
        fabric_type_name:p.fabric_type_name,
        fabric_brand:    p.fabric_brand,
        fabric_family:   p.fabric_family,
        category_id:     p.category_id,
        subcategory_id:  p.subcategory_id,
        price:           p.price,
        hero_image_path:       p.hero_image_path       || null,
        hero_image_hover_path: p.hero_image_hover_path || null,
        designs:         [],
      });
    }
    map.get(key).designs.push(p);
  });
  return [...map.values()];
}

function productCard(g) {
  const featured = g.designs[0];
  // Hero photos (per item × fabric) override the fabric-design photo on the card
  const heroDefaultUrl = g.hero_image_path       ? productImageUrl(g.hero_image_path,       { width: 900 }) : '';
  const heroHoverUrl   = g.hero_image_hover_path ? productImageUrl(g.hero_image_hover_path, { width: 900 }) : '';
  const fallbackFabricUrl = featured.primary_photo_path
    ? fabricImageUrl(featured.primary_photo_path, { width: 900 })
    : '';
  const photoUrl = heroDefaultUrl || fallbackFabricUrl;
  const swatchesVisible = g.designs.slice(0, 5);
  const swatchesHidden  = Math.max(0, g.designs.length - 5);
  const swatchesHtml = swatchesVisible.map((d, i) => {
    const thumb = d.primary_photo_path ? fabricImageUrl(d.primary_photo_path, { width: 120 }) : '';
    return `<button class="swatch-btn ${i === 0 ? 'is-active' : ''}"
                    data-design="${d.fabric_design_id}"
                    data-product-id="${d.product_id}"
                    data-photo="${d.primary_photo_path ? fabricImageUrl(d.primary_photo_path, { width: 900 }) : ''}"
                    data-name="${d.design_name}"
                    title="${d.design_name} · ${d.fabric_number}"
                    aria-label="${d.design_name}">
              ${thumb ? `<img src="${thumb}" alt="${d.design_name}">` : ''}
            </button>`;
  }).join('');

  // Surface a tasteful badge from real signal (use the featured design's flags)
  let badgeHtml = '';
  if (featured.availability === 'low_stock')        badgeHtml = `<span class="card-badge card-badge--stone">Limited</span>`;
  else if (featured.availability === 'made_to_order') badgeHtml = `<span class="card-badge">Made to Order</span>`;
  else if (featured.has_design_override)             badgeHtml = `<span class="card-badge card-badge--dark">House Exclusive</span>`;

  const kind = ITEM_KIND[g.category_id] || g.item_type_name;
  const title = `The ${g.fabric_brand} ${g.fabric_family} ${kind}`;
  const detailHref = `product.html?item=${encodeURIComponent(g.item_type_id)}&fabric=${encodeURIComponent(g.fabric_type_id)}&design=${encodeURIComponent(featured.fabric_design_id)}`;

  return `
    <article class="product-card${heroDefaultUrl ? ' has-hero' : ''}" data-card-key="${g.key}"
             data-hero-default="${heroDefaultUrl}"
             data-hero-hover="${heroHoverUrl}">
      <a href="${detailHref}" class="card-image-link" data-card-link>
        <div class="img-wrap">
          ${badgeHtml}
          ${photoUrl
            ? `<img class="card-photo" src="${photoUrl}" alt="${title} — ${featured.design_name}" loading="lazy" />`
            : `<div style="height:100%;display:grid;place-items:center;color:var(--color-grey-mid);font-family:var(--font-serif);font-style:italic">Photograph forthcoming</div>`}
          <span class="card-quickview">Reserve Consultation</span>
        </div>
      </a>
      <div class="meta">
        <p class="eyebrow">${g.item_type_name}</p>
        <h3><a href="${detailHref}" data-card-link>${title}</a></h3>
        <p class="sub" data-current-design>${featured.design_name}</p>
        <div class="design-swatches">
          ${swatchesHtml}
          ${swatchesHidden > 0 ? `<span class="swatch-more">+ ${swatchesHidden}</span>` : ''}
        </div>
        <div class="price-row">
          <span class="price"><span class="from">from</span>${fmtTHB(g.price)}</span>
        </div>
      </div>
    </article>
  `;
}

// Event delegation: swatch hover/click updates card + navigates to product page
function wireSwatchInteractions() {
  const grid = $('#productGrid');

  // Swatch hover → preview that design's fabric photo on the card image
  grid.addEventListener('mouseover', (e) => {
    const swatch = e.target.closest('.swatch-btn');
    if (!swatch) return;
    const card = swatch.closest('.product-card');
    if (!card) return;
    card.querySelectorAll('.swatch-btn').forEach(b => b.classList.toggle('is-active', b === swatch));
    const photo = card.querySelector('.card-photo');
    if (photo && swatch.dataset.photo) photo.src = swatch.dataset.photo;
    const currentEl = card.querySelector('[data-current-design]');
    if (currentEl) currentEl.textContent = swatch.dataset.name;
    // Update the card link hrefs so a subsequent click matches the previewed design
    card.querySelectorAll('[data-card-link]').forEach(a => {
      const u = new URL(a.href, location.origin);
      u.searchParams.set('design', swatch.dataset.design);
      a.href = u.pathname + u.search;
    });
  });

  // Image-area mouseenter → swap to hero-hover photo (cards with heroes only)
  // Image-area mouseleave → revert to hero default
  // Both use capture phase since mouseenter/mouseleave don't bubble.
  grid.addEventListener('mouseenter', (e) => {
    const wrap = e.target.classList?.contains('img-wrap') ? e.target : null;
    if (!wrap) return;
    const card = wrap.closest('.product-card');
    const hover = card?.dataset.heroHover;
    if (!hover) return;
    const photo = card.querySelector('.card-photo');
    if (photo) photo.src = hover;
  }, true);

  grid.addEventListener('mouseleave', (e) => {
    const wrap = e.target.classList?.contains('img-wrap') ? e.target : null;
    if (!wrap) return;
    const card = wrap.closest('.product-card');
    const def = card?.dataset.heroDefault;
    const photo = card?.querySelector('.card-photo');
    if (def && photo) photo.src = def;
  }, true);

  // Mouse leaves the card entirely → reset swatch state to the featured design
  grid.addEventListener('mouseleave', (e) => {
    const card = e.target.classList?.contains('product-card') ? e.target : null;
    if (!card) return;
    const swatches = card.querySelectorAll('.swatch-btn');
    if (!swatches.length) return;
    swatches.forEach((b, i) => b.classList.toggle('is-active', i === 0));
    const firstName = swatches[0].dataset.name;
    const currentEl = card.querySelector('[data-current-design]');
    if (currentEl && firstName) currentEl.textContent = firstName;
    const firstDesign = swatches[0].dataset.design;
    if (firstDesign) {
      card.querySelectorAll('[data-card-link]').forEach(a => {
        const u = new URL(a.href, location.origin);
        u.searchParams.set('design', firstDesign);
        a.href = u.pathname + u.search;
      });
    }
  }, true);

  grid.addEventListener('click', (e) => {
    const swatch = e.target.closest('.swatch-btn');
    if (!swatch) return;
    e.preventDefault();
    const card = swatch.closest('.product-card');
    const [itemTypeId, fabricTypeId] = (card?.dataset.cardKey || '').split('__');
    if (!itemTypeId || !fabricTypeId) return;
    location.href = `product.html?item=${encodeURIComponent(itemTypeId)}&fabric=${encodeURIComponent(fabricTypeId)}&design=${encodeURIComponent(swatch.dataset.design)}`;
  });
}

init().catch(err => {
  console.error(err);
  document.getElementById('productGrid').innerHTML =
    `<div class="grid-msg">Unable to load the collection. Please refresh the page.</div>`;
});
