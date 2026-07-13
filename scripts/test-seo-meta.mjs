// SEO baseline e2e: static-page meta (raw HTML), dynamic-page setMeta, noindex,
// robots.txt, sitemap.xml. Requires serve.mjs on :3000.
import puppeteer from 'puppeteer';

const BASE = 'http://localhost:3000';
let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}: ${msg}`); if (!cond) failures++; };

async function rawHtml(p) {
  const res = await fetch(BASE + p);
  return { status: res.status, ct: res.headers.get('content-type') || '', text: await res.text() };
}

async function main() {
  // --- Static pages: meta present in RAW HTML (no JS) ---
  const staticPages = [
    { p: '/', canon: 'https://countryroadfashions.com/' },
    { p: '/shop.html', canon: 'https://countryroadfashions.com/shop.html' },
    { p: '/book-appointment.html', canon: 'https://countryroadfashions.com/book-appointment.html' },
    { p: '/in-store.html', canon: 'https://countryroadfashions.com/in-store.html' },
    { p: '/privacy.html', canon: 'https://countryroadfashions.com/privacy.html' },
  ];
  for (const s of staticPages) {
    const { text } = await rawHtml(s.p);
    ok(text.includes(`rel="canonical" href="${s.canon}"`), `${s.p} raw canonical`);
    ok(/name="description" content=".{20,}"/.test(text), `${s.p} raw description`);
    ok(text.includes('property="og:title"'), `${s.p} raw og:title`);
    ok(text.includes('name="twitter:card"'), `${s.p} raw twitter:card`);
  }
  // index JSON-LD
  const idx = (await rawHtml('/')).text;
  ok(idx.includes('"@type": "ClothingStore"'), '/ ClothingStore JSON-LD');
  ok(idx.includes('"@type": "WebSite"'), '/ WebSite JSON-LD');
  ok(idx.includes('SearchAction'), '/ SearchAction');
  ok((await rawHtml('/in-store.html')).text.includes('"@type": "ClothingStore"'), '/in-store ClothingStore JSON-LD');

  // --- Private pages: noindex in raw HTML ---
  for (const p of ['/login.html','/signup.html','/forgot-password.html','/reset-password.html','/account.html','/measurements.html','/cart.html','/order-confirmation.html']) {
    ok(/name="robots" content="noindex/.test((await rawHtml(p)).text), `${p} noindex`);
  }

  // --- robots.txt + sitemap.xml ---
  const robots = await rawHtml('/robots.txt');
  ok(robots.status === 200 && robots.ct.includes('text/plain'), 'robots.txt served as text/plain');
  ok(robots.text.includes('Sitemap: https://countryroadfashions.com/sitemap.xml'), 'robots.txt Sitemap line');
  ok(robots.text.includes('Disallow: /account.html'), 'robots.txt disallows account');
  const sm = await rawHtml('/sitemap.xml');
  ok(sm.status === 200 && sm.ct.includes('xml'), 'sitemap.xml served as xml');
  ok((sm.text.match(/<loc>/g) || []).length >= 11, 'sitemap has >=11 urls');
  ok(!sm.text.includes('design='), 'sitemap has no design params');
  ok(sm.text.includes('<loc>https://countryroadfashions.com/</loc>'), 'sitemap includes home');

  // --- Dynamic PDP: setMeta after data load ---
  const browser = await puppeteer.launch();
  try {
    const page = await browser.newPage();
    await page.goto(`${BASE}/product.html?item=formal-suit-2-piece&fabric=vbc-wool&design=vbc-wool-ash-grey-pinstripe`, { waitUntil: 'networkidle0' });
    const title = await page.title();
    ok(/Vitale Barberis Canonico Wool Suit — Country Road Fashions/.test(title), 'PDP title');
    const canon = await page.$eval('link[rel="canonical"]', e => e.getAttribute('href'));
    ok(canon === 'https://countryroadfashions.com/product.html?item=formal-suit-2-piece&fabric=vbc-wool', 'PDP canonical design-stripped');
    const ldTypes = await page.$$eval('script[data-meta-jsonld]', ns => ns.map(n => JSON.parse(n.textContent)['@type']));
    ok(ldTypes.includes('Product') && ldTypes.includes('BreadcrumbList'), 'PDP Product + BreadcrumbList JSON-LD');
    const product = await page.$$eval('script[data-meta-jsonld]', ns => ns.map(n => JSON.parse(n.textContent)).find(o => o['@type'] === 'Product'));
    ok(product.offers.priceCurrency === 'THB' && Number(product.offers.price) > 0, 'PDP Offer price/currency');
    // No duplicate managed tags after render
    const canonCount = await page.$$eval('link[rel="canonical"][data-meta]', ns => ns.length);
    ok(canonCount === 1, 'PDP single managed canonical (upsert, no dupes)');

    // Shop with ?q= → search-aware title + base canonical
    await page.goto(`${BASE}/shop.html?q=wool`, { waitUntil: 'networkidle0' });
    const stitle = await page.title();
    ok(/Search: wool/.test(stitle), 'shop ?q= title');
    const scanon = await page.$eval('link[rel="canonical"]', e => e.getAttribute('href'));
    ok(scanon === 'https://countryroadfashions.com/shop.html', 'shop ?q= canonical consolidates to base');
  } finally {
    await browser.close();
  }

  console.log(failures === 0 ? '\nALL SEO CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch(e => { console.error(e); process.exit(1); });
