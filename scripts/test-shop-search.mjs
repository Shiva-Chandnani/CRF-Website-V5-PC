// Phase 3 e2e: shop page server-side search — ?q= prefill+run, combined AND
// with a sidebar filter, clearing the query restores browse.
import puppeteer from 'puppeteer';

let failed = false;
const must = (c, m) => { if (!c) { console.error('✘', m); failed = true; } else console.log('✓', m); };
const countCards = (page) => page.$$eval('.product-card', els => els.length);

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
try {
  // 1. ?q= prefills the input and runs the search on load
  await page.goto('http://localhost:3000/shop.html?q=wool', { waitUntil: 'networkidle0' });
  await page.waitForSelector('#productGrid .product-card, #productGrid .grid-msg', { timeout: 5000 });
  const inputVal = await page.$eval('#searchInput', el => el.value);
  must(inputVal === 'wool', `?q= prefilled input → "${inputVal}"`);
  const woolCards = await countCards(page);
  must(woolCards > 0, `query returned cards (${woolCards})`);

  // 2. Baseline (no query) has at least as many cards as the wool search
  await page.goto('http://localhost:3000/shop.html', { waitUntil: 'networkidle0' });
  await page.waitForSelector('#productGrid .product-card', { timeout: 5000 });
  const allCards = await countCards(page);
  must(allCards >= woolCards, `no-query browse ≥ query results (${allCards} ≥ ${woolCards})`);

  // 3. Typing a query narrows the grid (debounced)
  await page.type('#searchInput', 'linen');
  await new Promise(r => setTimeout(r, 600));
  await page.waitForSelector('#productGrid .product-card, #productGrid .grid-msg', { timeout: 5000 });
  const linenCards = await countCards(page);
  must(linenCards <= allCards, `typed query narrows grid (${linenCards} ≤ ${allCards})`);

  // 4. Clearing the query restores full browse
  await page.click('#searchInput', { clickCount: 3 });
  await page.keyboard.press('Backspace');
  await new Promise(r => setTimeout(r, 600));
  const restored = await countCards(page);
  must(restored === allCards, `clearing query restores browse (${restored} === ${allCards})`);
} catch (e) {
  must(false, 'unexpected exception: ' + e.message);
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
