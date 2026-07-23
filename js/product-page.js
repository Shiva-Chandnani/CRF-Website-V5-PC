  import { fabricImageUrl, productImageUrl, supabase } from '/js/data-loader.js';
  import { setMeta, canonicalFor, SITE_ORIGIN } from '/js/meta.js';

  const ITEM_KIND = {
    'suits': 'Suit',
    'shirts': 'Shirt',
    'pants': 'Trouser',
    'coats': 'Coat',
    'jackets-blazers': 'Jacket',
    'mandarin-collar': 'Vest',
    'accessories': 'Accessory',
  };
  // Breadcrumb category labels that differ from the slug title-cased form.
  const CATEGORY_LABEL = { 'pants': 'Trousers' };
  const fmtTHB = (n) => 'THB ' + n.toLocaleString('en-US');

  const params = new URLSearchParams(location.search);
  const itemTypeId   = params.get('item');
  const fabricTypeId = params.get('fabric');
  const wantDesignId = params.get('design');

  if (!itemTypeId || !fabricTypeId) {
    document.getElementById('productTitle').textContent = 'Missing product reference';
    document.getElementById('mainImage').alt = '';
    throw new Error('Missing item or fabric URL parameters');
  }

  async function fetchProductBundle() {
    // 1) all v_products rows for this item × fabric (these are the designs)
    const { data: rows, error: err1 } = await supabase
      .from('v_products')
      .select('*')
      .eq('item_type_id',   itemTypeId)
      .eq('fabric_type_id', fabricTypeId)
      .order('design_name');
    if (err1) throw err1;

    // 2) full fabric_types record (for the accordion details)
    const { data: ft, error: err2 } = await supabase
      .from('fabric_types').select('*').eq('id', fabricTypeId).single();
    if (err2) throw err2;

    // 3) other item types offered for this fabric (separates)
    const { data: separates, error: err3 } = await supabase
      .from('v_products')
      .select('item_type_id, item_type_name, fabric_type_id, fabric_design_id, price, primary_photo_path, design_name')
      .eq('fabric_type_id', fabricTypeId)
      .neq('item_type_id', itemTypeId);
    if (err3) throw err3;

    // Dedupe separates so we get one row per item_type
    const sepMap = new Map();
    separates.forEach(s => { if (!sepMap.has(s.item_type_id)) sepMap.set(s.item_type_id, s); });

    return { rows, fabric: ft, separates: [...sepMap.values()] };
  }

  function pickInitialDesign(rows) {
    if (wantDesignId) {
      const found = rows.find(r => r.fabric_design_id === wantDesignId);
      if (found) return found;
    }
    return rows[0];
  }

  function renderBreadcrumb(d) {
    const cat = CATEGORY_LABEL[d.category_id] || (d.category_id || '').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    document.getElementById('crumb-leaf').innerHTML =
      `<a href="shop.html?category=${encodeURIComponent(d.category_id)}">${cat}</a><span class="sep">/</span>${d.item_type_name}`;
  }

  function renderHeader(rows, current) {
    const kind = ITEM_KIND[current.category_id] || current.item_type_name;
    const title = `The <em>${current.fabric_brand} ${current.fabric_family}</em> ${kind}`;
    document.getElementById('itemEyebrow').textContent = current.item_type_name;
    document.getElementById('productTitle').innerHTML = title;
    document.getElementById('productPrice').textContent = fmtTHB(current.price);
    document.getElementById('designLabelRight').textContent = current.design_name;
    // Title/meta are owned by applyPdpMeta() (runs after this in init()).
  }

  function applyPdpMeta(current) {
    const kind = ITEM_KIND[current.category_id] || current.item_type_name;
    const name = `The ${current.fabric_brand} ${current.fabric_family} ${kind}`;
    const title = `${name} — Country Road Fashions`;
    const description =
      `${name} — a bespoke ${current.item_type_name.toLowerCase()} in ${current.fabric_brand} ` +
      `${current.fabric_family}, cut to your measurements and hand-finished in our Bangkok atelier. ` +
      `From ${fmtTHB(current.price)}.`;
    // Canonical is design-stripped: consolidate all design variants onto item x fabric.
    const canonical = canonicalFor(`/product.html?item=${encodeURIComponent(itemTypeId)}&fabric=${encodeURIComponent(fabricTypeId)}`);
    const heroPath = (current.design_hero_paths && current.design_hero_paths[0]) || current.primary_photo_path;
    const ogImage = fabricImageUrl(heroPath, { width: 1200 }) || undefined;

    const productLd = {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name,
      description,
      image: ogImage,
      sku: `${itemTypeId}__${fabricTypeId}`,
      brand: { '@type': 'Brand', name: `${current.fabric_brand} ${current.fabric_family}` },
      offers: {
        '@type': 'Offer',
        price: String(current.price),
        priceCurrency: 'THB',
        availability: 'https://schema.org/InStock',
        url: canonical,
      },
    };
    const breadcrumbLd = {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'House', item: SITE_ORIGIN + '/' },
        { '@type': 'ListItem', position: 2, name: 'Shop', item: SITE_ORIGIN + '/shop.html' },
        { '@type': 'ListItem', position: 3, name: current.item_type_name, item: canonical },
      ],
    };

    setMeta({ title, description, canonical, ogImage, ogType: 'product', jsonLd: [productLd, breadcrumbLd] });
  }

  function renderMainImage(d) {
    const main = document.getElementById('mainImage');
    if (d.primary_photo_path) {
      const newSrc = fabricImageUrl(d.primary_photo_path, { width: 1400 });
      if (main.src !== newSrc) {
        main.style.opacity = '0.5';
        main.src = newSrc;
        main.onload = () => { main.style.opacity = '1'; };
      }
      main.alt = `${d.fabric_brand} ${d.fabric_family} — ${d.design_name}`;
    } else {
      main.src = '';
      main.alt = '';
    }
    document.getElementById('imageCaption').textContent =
      `${d.fabric_brand} ${d.fabric_family} · ${d.design_name} · ${d.fabric_number}`;
  }

  function renderThumbRail(rows, current, activeHeroIdx = -1) {
    // activeHeroIdx: -1 marks the fabric thumb active (default); 0/1/… marks
    // the corresponding hero thumb active. Used by selectDesign() so that
    // clicking a swatch can land on hero #2 with the right thumb highlighted.
    const rail = document.getElementById('thumbRail');
    const heroes = current.design_hero_paths || [];

    // Hero thumbs first (model photos for this design), then the fabric closeup.
    const heroThumbs = heroes.map((p, i) => `
      <button class="${i === activeHeroIdx ? 'is-active' : ''}"
              data-photo-type="hero"
              data-photo="${fabricImageUrl(p, { width: 1400 })}"
              title="${current.design_name} — look ${i + 1}">
        <img src="${fabricImageUrl(p, { width: 200 })}" alt="${current.design_name} look ${i + 1}">
      </button>
    `).join('');

    const fabricThumb = current.primary_photo_path ? `
      <button class="${activeHeroIdx === -1 ? 'is-active' : ''}"
              data-photo-type="design"
              data-design="${current.fabric_design_id}"
              title="${current.design_name}">
        <img src="${fabricImageUrl(current.primary_photo_path, { width: 200 })}" alt="${current.design_name}">
      </button>
    ` : '';

    rail.innerHTML = heroThumbs + fabricThumb;
  }

  function renderSwatches(rows, current) {
    const wrap = document.getElementById('designSwatches');
    wrap.innerHTML = rows.map(d => `
      <button class="swatch-btn ${d.fabric_design_id === current.fabric_design_id ? 'is-active' : ''}"
              data-design="${d.fabric_design_id}"
              title="${d.design_name} · ${d.fabric_number}"
              aria-label="${d.design_name}">
        ${d.primary_photo_path
          ? `<img src="${fabricImageUrl(d.primary_photo_path, { width: 140 })}" alt="${d.design_name}">`
          : ''}
      </button>
    `).join('');
  }

  function renderSizeSelectors(itemTypeName) {
    const wrap = document.getElementById('sizeSelectors');
    const wantsJacket = /suit|jacket|blazer|coat|vest|tuxedo/i.test(itemTypeName);
    const wantsPants  = /suit|pant|trouser|chino|short/i.test(itemTypeName);
    const wantsShirt  = /shirt/i.test(itemTypeName);
    const blocks = [];
    if (wantsJacket) blocks.push(`<select class="size-select" disabled><option>Select Your Jacket Size — discussed in consultation</option></select>`);
    if (wantsPants)  blocks.push(`<select class="size-select" disabled><option>Select Your Trouser Size — discussed in consultation</option></select>`);
    if (wantsShirt)  blocks.push(`<select class="size-select" disabled><option>Select Your Shirt Size — discussed in consultation</option></select>`);
    if (!blocks.length) blocks.push(`<select class="size-select" disabled><option>Sized to your measurements</option></select>`);
    wrap.innerHTML = blocks.join('');
  }

  function renderAccordion(current, fabric, separates) {
    const kind = ITEM_KIND[current.category_id] || current.item_type_name;
    document.getElementById('descBody').innerHTML = `
      <p>The ${current.fabric_brand} ${current.fabric_family} ${kind} is a bespoke commission of Country Road Fashions — every panel cut to your individual measurements, hand-finished in our Bangkok atelier.</p>
      <p>This design — <em>${current.design_name}</em> (fabric No. ${current.fabric_number}) — is one of ${rowsCount(current.fabric_type_id)} cloths in this house. Your selection at consultation may include lining, lapel style, vent style, button stance, and monogram.</p>
    `;
    document.getElementById('designBody').innerHTML = `
      <dl>
        <dt>Construction</dt><dd>Full canvas, hand-padded lapel and chest piece</dd>
        <dt>Lapel</dt><dd>Notch (default) — refined in consultation</dd>
        <dt>Vent</dt><dd>Side vents (default) — refined in consultation</dd>
        <dt>Buttons</dt><dd>Genuine horn, 2-button (default)</dd>
        <dt>Lining</dt><dd>Bemberg cupro, half-canvas (default)</dd>
      </dl>
      <p style="margin-top:14px">Each cut is reviewed in fitting; you are invited to redraw the silhouette to your preference.</p>
    `;
    const seasons = (fabric.season || []).join(', ').replace(/-/g, ' ');
    document.getElementById('fabricBody').innerHTML = `
      <dl>
        <dt>Composition</dt><dd>${fabric.composition || '—'}</dd>
        <dt>Origin</dt><dd>${fabric.origin || '—'}</dd>
        <dt>Weight</dt><dd>${fabric.weight_gsm ? fabric.weight_gsm + ' gsm' : '—'}</dd>
        <dt>Season</dt><dd>${seasons || '—'}</dd>
        <dt>House</dt><dd>${fabric.brand} — ${fabric.family}</dd>
      </dl>
      <p style="margin-top:14px">Dry clean only. Hang on a wide wooden hanger; rest the garment 24 hours between wearings.</p>
    `;
    if (separates && separates.length) {
      document.getElementById('separatesBody').innerHTML = `
        <p>Other garments offered in the same ${fabric.brand} ${fabric.family} cloth:</p>
        <div class="separates-list">
          ${separates.map(s => `
            <a href="product.html?item=${encodeURIComponent(s.item_type_id)}&fabric=${encodeURIComponent(s.fabric_type_id)}&design=${encodeURIComponent(s.fabric_design_id)}">
              <span class="item">${s.item_type_name} <em>· ${fmtTHB(s.price)}</em></span>
              <span class="arrow">→</span>
            </a>
          `).join('')}
        </div>
      `;
    } else {
      document.getElementById('separatesBody').innerHTML = `<p>No other garments offered in this cloth at present.</p>`;
    }
    document.getElementById('shipBody').innerHTML = `
      <p><strong style="color:var(--color-jet);font-weight:400">Consultations.</strong> In-person at our Bangkok atelier (Sukhumvit) or by video. <a href="book-appointment.html" style="text-decoration:underline">Book a visit →</a></p>
      <p><strong style="color:var(--color-jet);font-weight:400">Production.</strong> Hand-finished in 4–6 weeks following first fitting; final fitting and delivery follow.</p>
      <p><strong style="color:var(--color-jet);font-weight:400">Worldwide shipping.</strong> Trunk shows arrive in Singapore, Madrid, New York, London on rotation.</p>
    `;
  }

  // tiny helper to expose row count to descBody
  let rowCountCache = 0;
  function rowsCount() { return rowCountCache; }

  let state = { rows: [], fabric: null, separates: [], current: null };

  function selectDesign(designId, opts = {}) {
    const next = state.rows.find(r => r.fabric_design_id === designId);
    if (!next) return;
    state.current = next;

    // When a swatch is clicked we want to land on the close-up hero (#2),
    // not the fabric photo. Fall back gracefully if a design has fewer hero
    // photos available.
    const heroes = next.design_hero_paths || [];
    const useHero = !!opts.preferHero && heroes.length > 0;
    // Prefer hero #2 (index 1); if only one hero exists, use it.
    const heroIdx = useHero ? Math.min(1, heroes.length - 1) : -1;

    if (useHero) {
      const main = document.getElementById('mainImage');
      const newSrc = fabricImageUrl(heroes[heroIdx], { width: 1400 });
      if (main.src !== newSrc) {
        main.style.opacity = '0.5';
        main.src = newSrc;
        main.onload = () => { main.style.opacity = '1'; };
      }
      main.alt = `${next.fabric_brand} ${next.fabric_family} — ${next.design_name} · look ${heroIdx + 1}`;
      document.getElementById('imageCaption').textContent =
        `${next.fabric_brand} ${next.fabric_family} · ${next.design_name} · look book`;
    } else {
      renderMainImage(next);
    }

    renderSwatches(state.rows, next);
    renderThumbRail(state.rows, next, heroIdx);
    document.getElementById('productPrice').textContent = fmtTHB(next.price);
    document.getElementById('designLabelRight').textContent = next.design_name;
    const u = new URL(location.href);
    u.searchParams.set('design', designId);
    history.replaceState(null, '', u.pathname + '?' + u.searchParams.toString());
  }

  async function init() {
    try {
      const bundle = await fetchProductBundle();
      if (!bundle.rows.length) {
        document.getElementById('productTitle').textContent = 'Garment not found';
        return;
      }
      state.rows = bundle.rows;
      state.fabric = bundle.fabric;
      state.separates = bundle.separates;
      state.current = pickInitialDesign(bundle.rows);
      rowCountCache = bundle.rows.length;
      window.__crfState = state;

      renderBreadcrumb(state.current);
      renderHeader(state.rows, state.current);
      renderMainImage(state.current);
      renderThumbRail(state.rows, state.current);
      renderSwatches(state.rows, state.current);
      renderSizeSelectors(state.current.item_type_name);
      renderAccordion(state.current, state.fabric, state.separates);
      applyPdpMeta(state.current);
      window.dispatchEvent(new CustomEvent('crf:pdp-ready'));

      // Wire interactions
      document.getElementById('designSwatches').addEventListener('click', (e) => {
        const b = e.target.closest('.swatch-btn');
        if (b) selectDesign(b.dataset.design, { preferHero: true });
      });
      document.getElementById('thumbRail').addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        if (b.dataset.photoType === 'hero') {
          // Swap main image to the hero shot, mark this thumb active.
          document.querySelectorAll('#thumbRail button').forEach(x => x.classList.remove('is-active'));
          b.classList.add('is-active');
          const main = document.getElementById('mainImage');
          main.style.opacity = '0.5';
          main.src = b.dataset.photo;
          main.onload = () => { main.style.opacity = '1'; };
          document.getElementById('imageCaption').textContent =
            `${state.current.fabric_brand} ${state.current.fabric_family} — ${state.current.item_type_name} · look book`;
        } else if (b.dataset.photoType === 'design') {
          selectDesign(b.dataset.design);
        }
      });
      document.getElementById('reserveBtn').addEventListener('click', () => {
        const u = new URL('book-appointment.html', location.origin);
        u.searchParams.set('product', state.current.product_id);
        location.href = u.pathname + '?' + u.searchParams.toString();
      });
    } catch (err) {
      console.error(err);
      document.getElementById('productTitle').textContent = 'Unable to load this garment.';
    }
  }

  init();
  import '/js/cart.js';
  // Phase 4: item types that expose the customizer → friendly noun for copy.
  const CUSTOMIZABLE = {
    'formal-suit-2-piece': 'Suit',
    'formal-jacket':       'Jacket',
    'dress-pants':         'Trousers',
  };
  // Customize button: lazy-load drawer module on first click
  const customizeBtn = document.getElementById('customizeBtn');
  if (customizeBtn) {
    customizeBtn.addEventListener('click', async () => {
      // `state` is module-scoped in the script above. Read it via window-attached hook:
      const s = window.__crfState;
      if (!s || !s.current) return;
      const { openCustomizer } = await import('/js/customizer.js');
      const brand = s.fabric?.brand || '';
      const family = s.fabric?.family || '';
      openCustomizer({
        item_type_id: s.current.item_type_id,
        fabric_design_id: s.current.fabric_design_id,
        price_thb: s.current.price,
        fabric_design_name: s.current.design_name,
        fabric_type_name: `${brand} ${family}`.trim(),
        garment_noun: CUSTOMIZABLE[s.current.item_type_id] || 'Garment',
      });
    });
  }
  // Toggle customizer visibility + label based on item type
  window.addEventListener('crf:pdp-ready', () => {
    const s = window.__crfState;
    const btn = document.getElementById('customizeBtn');
    const row = document.getElementById('ctaRow');
    if (!btn || !s?.current) return;
    const noun = CUSTOMIZABLE[s.current.item_type_id];
    if (noun) {
      btn.textContent = `Customize Your ${noun}`;
      btn.hidden = false;
      row?.classList.remove('is-single');
    } else {
      btn.hidden = true;
      row?.classList.add('is-single');
    }
  });
