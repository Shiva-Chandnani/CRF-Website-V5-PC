/* Country Road Fashions — Shop mega menu.
   Finds the "Shop" link in .nav-left on every page, mounts a
   dropdown panel under the site header, and wires hover /
   focus / click / Escape behavior. No deps. */
(function () {
  'use strict';

  /* ---------- Directory data ---------- */
  /* Sections with `href` on the title get a clickable heading that
     lands on the category-filtered shop page. Non-product sections
     omit href and render the heading as plain text. */
  const SECTIONS = [
    {
      title: 'Collections',
      items: [
        { label: 'New Arrivals',           href: 'shop.html' },
        { label: 'Classics',               href: 'shop.html' },
        { label: 'Trending',               href: 'shop.html' },
        { label: 'Linen',                  href: 'shop.html' },
        { label: 'Loro Piana Collection',  href: 'shop.html' },
        { label: 'Wedding Collection',     href: 'shop.html' },
      ],
    },
    {
      title: 'Suits',
      href: 'shop.html?category=suits',
      items: [
        { label: 'Formal Suits', href: 'shop.html?category=suits&subcategory=formal-suits' },
        { label: 'Summer Suits', href: 'shop.html?category=suits&subcategory=summer-suits' },
        { label: 'Winter Suits', href: 'shop.html?category=suits&subcategory=winter-suits' },
        { label: 'Tuxedos',      href: 'shop.html?category=suits&subcategory=tuxedos' },
      ],
    },
    {
      title: 'Mandarin Collar Suits & Vests',
      href: 'shop.html?category=mandarin-collar',
      items: [
        { label: 'Mandarin Collar Vests', href: 'shop.html?category=mandarin-collar&subcategory=mandarin-vests' },
        { label: 'Mandarin Collar Suits', href: 'shop.html?category=mandarin-collar&subcategory=mandarin-suits' },
      ],
    },
    {
      title: 'Shirts',
      href: 'shop.html?category=shirts',
      items: [
        { label: 'Dress Shirts',  href: 'shop.html?category=shirts&subcategory=dress-shirts' },
        { label: 'Casual Shirts', href: 'shop.html?category=shirts&subcategory=casual-shirts' },
        { label: 'Linen Shirts',  href: 'shop.html?category=shirts&subcategory=linen-shirts' },
        { label: 'All Fabrics',   href: 'shop.html?category=shirts&subcategory=all-fabrics' },
      ],
    },
    {
      title: 'Coats',
      href: 'shop.html?category=coats',
      items: [
        { label: 'Peacoats',  href: 'shop.html?category=coats&subcategory=peacoats' },
        { label: 'Overcoats', href: 'shop.html?category=coats&subcategory=overcoats' },
      ],
    },
    {
      title: 'Pants',
      href: 'shop.html?category=pants',
      items: [
        { label: 'Dress Pants', href: 'shop.html?category=pants&subcategory=dress-pants' },
        { label: 'Chinos',      href: 'shop.html?category=pants&subcategory=chinos' },
        { label: 'Linen Pants', href: 'shop.html?category=pants&subcategory=linen-pants' },
        { label: 'Shorts',      href: 'shop.html?category=pants&subcategory=shorts' },
      ],
    },
    {
      title: 'Jackets & Blazers',
      href: 'shop.html?category=jackets-blazers',
      items: [
        { label: 'Formal Jackets',  href: 'shop.html?category=jackets-blazers&subcategory=formal-jackets' },
        { label: 'Summer Jackets',  href: 'shop.html?category=jackets-blazers&subcategory=summer-jackets' },
        { label: 'Hopsack Jackets', href: 'shop.html?category=jackets-blazers&subcategory=hopsack-jackets' },
      ],
    },
    {
      title: 'Accessories',
      href: 'shop.html?category=accessories',
      items: [
        { label: 'Cufflinks',      href: 'shop.html?category=accessories&subcategory=cufflinks' },
        { label: 'Ties',           href: 'shop.html?category=accessories&subcategory=ties' },
        { label: 'Pocket Squares', href: 'shop.html?category=accessories&subcategory=pocket-squares' },
      ],
    },
    {
      title: 'Meet with us',
      items: [
        { label: 'In-store Consultation', href: 'in-store.html#bangkok' },
        { label: 'Online Consultation',   href: 'book-appointment.html' },
        { label: 'Trunk Show',            href: 'in-store.html#trunk-shows' },
      ],
    },
    {
      title: 'About us',
      items: [
        { label: 'Times Magazine', href: '#' },
        { label: 'Our Story',      href: '#' },
        { label: 'Our Fit Promise', href: '#' },
        { label: 'Blog',           href: '#' },
      ],
    },
  ];

  /* Column groupings — 5 columns, sections placed in order shown. */
  const COLUMNS = [
    ['Collections'],
    ['Suits', 'Mandarin Collar Suits & Vests'],
    ['Shirts', 'Coats'],
    ['Pants', 'Jackets & Blazers'],
    ['Accessories', 'Meet with us', 'About us'],
  ];

  /* Featured-tile sidebar */
  const FEATURED = {
    large: {
      eyebrow: 'Hero Fabric',
      title:   'The Cavani Wool Collection',
      img:     'https://placehold.co/640x800/2C2E33/2C2E33',
      href:    'shop.html?fabric=cavani-wool',
    },
    small: [
      { eyebrow: 'Edits',  title: 'Wedding Suits',  img: 'https://placehold.co/320x320/1F2A3D/1F2A3D', href: 'shop.html' },
      { eyebrow: 'Visit',  title: 'Book a Visit',   img: 'https://placehold.co/320x320/B6ADA5/B6ADA5', href: 'book-appointment.html' },
    ],
  };

  /* ---------- Helpers ---------- */
  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.startsWith('on') && typeof attrs[k] === 'function') {
          node.addEventListener(k.slice(2), attrs[k]);
        } else {
          node.setAttribute(k, attrs[k]);
        }
      }
    }
    if (children) {
      for (const c of children) {
        if (c == null) continue;
        node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
      }
    }
    return node;
  }

  function findShopTrigger() {
    const links = document.querySelectorAll('.nav-left a');
    for (const a of links) {
      if (a.textContent.trim().toLowerCase() === 'shop') return a;
    }
    return null;
  }

  function buildSection(section) {
    const heading = section.href
      ? el('h4', { class: 'is-link' }, [
          el('a', { href: section.href, class: 'mega-section-link' }, [section.title]),
        ])
      : el('h4', null, [section.title]);
    return el('div', { class: 'mega-section' }, [
      heading,
      el('ul', null, section.items.map(item =>
        el('li', null, [
          el('a', { href: item.href }, [item.label]),
        ])
      )),
    ]);
  }

  function buildTile(tile, size /* 'large'|'small' */) {
    return el('a', { class: 'mega-tile is-' + size, href: tile.href }, [
      el('div', { class: 'mega-tile-image' }, [
        el('img', { src: tile.img, alt: tile.title, loading: 'lazy' }),
      ]),
      el('div', { class: 'mega-tile-caption' }, [
        tile.eyebrow ? el('span', { class: 'mega-tile-eyebrow' }, [tile.eyebrow]) : null,
        el('p', { class: 'mega-tile-title' }, [tile.title]),
      ]),
    ]);
  }

  function buildPanel() {
    const grid = el('div', { class: 'mega-grid' },
      COLUMNS.map(colTitles => {
        const col = el('div', { class: 'mega-column' });
        colTitles.forEach(title => {
          const section = SECTIONS.find(s => s.title === title);
          if (section) col.appendChild(buildSection(section));
        });
        return col;
      })
    );

    const search = el('div', { class: 'mega-search' }, [
      el('input', { type: 'search', placeholder: 'Search products', 'aria-label': 'Search products' }),
      (function () {
        const ns = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(ns, 'svg');
        svg.setAttribute('class', 'mega-search-icon');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('fill', 'none');
        svg.setAttribute('stroke', 'currentColor');
        svg.setAttribute('stroke-width', '1.6');
        svg.setAttribute('aria-hidden', 'true');
        const circle = document.createElementNS(ns, 'circle');
        circle.setAttribute('cx', '11'); circle.setAttribute('cy', '11'); circle.setAttribute('r', '7');
        const line = document.createElementNS(ns, 'path');
        line.setAttribute('d', 'm21 21-4.35-4.35');
        svg.appendChild(circle); svg.appendChild(line);
        return svg;
      })(),
    ]);

    const categories = el('div', { class: 'mega-categories' }, [search, grid]);

    const featured = el('div', { class: 'mega-featured' }, [
      buildTile(FEATURED.large, 'large'),
      el('div', { class: 'mega-featured-row' },
        FEATURED.small.map(t => buildTile(t, 'small'))
      ),
    ]);

    return el('nav', {
      class: 'mega-menu',
      id: 'mega-menu',
      role: 'navigation',
      'aria-label': 'Shop directory',
      'aria-hidden': 'true',
    }, [
      el('div', { class: 'mega-inner' }, [categories, featured]),
    ]);
  }

  function positionPanel(panel) {
    const header = document.querySelector('.site-header');
    if (!header) return;
    const rect = header.getBoundingClientRect();
    panel.style.top = rect.bottom + 'px';
    /* Bottom of panel sits at most 75% down the viewport */
    const maxBottom = window.innerHeight * 0.75;
    panel.style.maxHeight = Math.max(320, maxBottom - rect.bottom) + 'px';
  }

  /* ---------- Mount + behavior ---------- */
  function init() {
    /* Tag every .nav-left link for the hover-bold treatment (CSS uses
       data-nav-label to reserve the bold width via a pseudo-element). */
    document.querySelectorAll('.nav-left a').forEach((a) => {
      a.setAttribute('data-nav-bold', '');
      a.setAttribute('data-nav-label', a.textContent.trim());
    });

    const trigger = findShopTrigger();
    if (!trigger) return;

    const panel = buildPanel();
    document.body.appendChild(panel);
    positionPanel(panel);

    trigger.setAttribute('data-mega-trigger', '');
    trigger.setAttribute('aria-haspopup', 'true');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-controls', 'mega-menu');

    let closeTimer = null;
    let isOpen = false;

    function open() {
      if (isOpen) return;
      clearTimeout(closeTimer);
      positionPanel(panel);
      panel.setAttribute('data-open', 'true');
      panel.setAttribute('aria-hidden', 'false');
      trigger.setAttribute('aria-expanded', 'true');
      isOpen = true;
    }

    function close(immediate) {
      clearTimeout(closeTimer);
      const doClose = () => {
        panel.setAttribute('data-open', 'false');
        panel.setAttribute('aria-hidden', 'true');
        trigger.setAttribute('aria-expanded', 'false');
        isOpen = false;
      };
      if (immediate) doClose();
      else closeTimer = setTimeout(doClose, 150);
    }

    /* Hover intent — open on mouseenter of trigger or panel, close 150ms after leaving both */
    trigger.addEventListener('mouseenter', open);
    trigger.addEventListener('mouseleave', () => close(false));
    panel.addEventListener('mouseenter', () => { clearTimeout(closeTimer); });
    panel.addEventListener('mouseleave', () => close(false));

    /* Keyboard: focus opens, Escape closes and restores focus */
    trigger.addEventListener('focus', open);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && isOpen) {
        close(true);
        trigger.focus();
      }
    });

    /* Click trigger toggles (and for keyboard users, Enter triggers click) */
    trigger.addEventListener('click', (e) => {
      e.preventDefault();
      if (isOpen) close(true);
      else open();
    });

    /* Click outside closes */
    document.addEventListener('click', (e) => {
      if (!isOpen) return;
      if (panel.contains(e.target) || trigger.contains(e.target)) return;
      close(true);
    });

    /* Clicking any link in the panel closes (lets navigation happen) */
    panel.addEventListener('click', (e) => {
      const a = e.target.closest('a');
      if (a) close(true);
    });

    /* Reposition on resize/scroll */
    window.addEventListener('resize', () => positionPanel(panel));
    window.addEventListener('scroll', () => { if (isOpen) positionPanel(panel); }, { passive: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
