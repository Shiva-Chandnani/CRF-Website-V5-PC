// Phase 3 e2e: header search overlay — open/close, debounced results, PDP link,
// "See all" handoff, Esc, listbox a11y. Reads no auth (search is public).
import puppeteer from 'puppeteer';

let failed = false;
const must = (c, m) => { if (!c) { console.error('✘', m); failed = true; } else console.log('✓', m); };

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
try {
  await page.goto('http://localhost:3000/index.html', { waitUntil: 'networkidle0' });
  // header mounts async via layout.js — wait for the wired trigger
  await page.waitForSelector('[data-search-btn][data-search-ready="1"]', { timeout: 5000 });

  // 1. Opens on click, input focused
  await page.click('[data-search-btn]');
  await page.waitForSelector('#search-overlay[data-open="1"]', { visible: true });
  const focusedName = await page.evaluate(() => document.activeElement?.getAttribute('data-search-input'));
  must(focusedName === '1', 'overlay opens and focuses the input');

  // 2. Debounced live results appear for "wool"
  await page.type('[data-search-input]', 'wool');
  await page.waitForSelector('#search-overlay [role="option"]', { timeout: 5000 });
  const optionCount = await page.$$eval('#search-overlay [role="option"]', els => els.length);
  must(optionCount > 0 && optionCount <= 6, `results render (got ${optionCount}, ≤6)`);

  // 3. Listbox a11y roles present
  const hasListbox = await page.$('#search-overlay [role="listbox"]');
  must(!!hasListbox, 'results container is a listbox');

  // 4. First result links to a PDP
  const href = await page.$eval('#search-overlay [role="option"] a, #search-overlay a[role="option"]',
    a => a.getAttribute('href')).catch(() => null);
  must(!!href && href.includes('product.html?item='), `result links to PDP → ${href}`);

  // 5. "See all results" → shop.html?q=wool
  const seeAll = await page.$eval('[data-search-seeall]', a => a.getAttribute('href')).catch(() => null);
  must(!!seeAll && /shop\.html\?q=wool/i.test(seeAll), `see-all handoff → ${seeAll}`);

  // 6. Esc closes and restores focus to the trigger
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('#search-overlay')?.getAttribute('data-open') !== '1');
  const backToTrigger = await page.evaluate(() => document.activeElement?.hasAttribute('data-search-btn'));
  must(backToTrigger, 'Esc closes overlay and returns focus to trigger');

  // 6b. Closed overlay is removed from layout + tab order (after the fade-out)
  await page.waitForFunction(() => document.querySelector('#search-overlay')?.hidden === true);
  const closedDisplay = await page.evaluate(() =>
    getComputedStyle(document.querySelector('#search-overlay')).display);
  must(closedDisplay === 'none', `closed overlay display:none (got ${closedDisplay})`);

  // 7. XSS-safety: injection payload in a no-match query must not execute
  await page.evaluate(() => { window.__xss = false; });
  await page.click('[data-search-btn]');
  await page.waitForSelector('#search-overlay[data-open="1"]', { visible: true });
  await page.click('[data-search-input]', { clickCount: 3 });
  await page.type('[data-search-input]', 'zzqxvbwkq<img src=x onerror="window.__xss=true">');
  await new Promise(r => setTimeout(r, 600));
  const xss = await page.evaluate(() => window.__xss === true);
  must(!xss, 'injection payload in query does not execute (no XSS)');

  // 8. Keyboard: ArrowDown activates a result option (combobox pattern)
  await page.click('[data-search-input]', { clickCount: 3 });
  await page.type('[data-search-input]', 'wool');
  await page.waitForSelector('#search-overlay [role="option"]');
  await page.keyboard.press('ArrowDown');
  const active = await page.evaluate(() => {
    const inp = document.querySelector('[data-search-input]');
    const ad = inp.getAttribute('aria-activedescendant');
    return !!ad && !!document.getElementById(ad)?.classList.contains('is-active');
  });
  must(active, 'ArrowDown activates a result option via aria-activedescendant');
} catch (e) {
  must(false, 'unexpected exception: ' + e.message);
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
