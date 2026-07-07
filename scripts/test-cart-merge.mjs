// Pure unit test for js/cart-merge.js. No browser, no network.
import assert from 'node:assert/strict';
import { lineKey, mergeCarts } from '../js/cart-merge.js';

let failed = false;
function check(name, fn) {
  try { fn(); console.log(`✔ ${name}`); }
  catch (e) { failed = true; console.log(`✘ ${name}  — ${e.message}`); }
}

const item = (over = {}) => ({
  id: 'crfln_' + Math.random().toString(36).slice(2, 8),
  item_type_id: 'formal-suit-2-piece',
  fabric_design_id: 'vbc-wool-grey-herringbone',
  price_thb: 20000,
  qty: 1,
  customizations: { 'jacket-lapel': 'jacket-lapel-notch', 'jacket-vent': 'jacket-vent-double' },
  added_at: '2026-07-07T10:00:00.000Z',
  ...over,
});

check('lineKey is key-order invariant', () => {
  const a = item({ customizations: { x: '1', y: '2' } });
  const b = item({ customizations: { y: '2', x: '1' } });
  assert.equal(lineKey(a), lineKey(b));
});

check('lineKey distinguishes monogram text', () => {
  const a = item({ customizations: { 'jacket-monogram-text': 'ABC' } });
  const b = item({ customizations: { 'jacket-monogram-text': 'XYZ' } });
  assert.notEqual(lineKey(a), lineKey(b));
});

check('lineKey distinguishes fabric design', () => {
  assert.notEqual(
    lineKey(item({ fabric_design_id: 'a' })),
    lineKey(item({ fabric_design_id: 'b' })));
});

check('merge unions disjoint lines', () => {
  const local  = { items: [item({ fabric_design_id: 'a' })] };
  const server = { items: [item({ fabric_design_id: 'b' })] };
  const m = mergeCarts(local, server);
  assert.equal(m.items.length, 2);
});

check('merge dedupes identical lines and sums qty', () => {
  const local  = { items: [item({ qty: 1 })] };
  const server = { items: [item({ qty: 2 })] };
  const m = mergeCarts(local, server);
  assert.equal(m.items.length, 1);
  assert.equal(m.items[0].qty, 3);
});

check('merge clamps summed qty to 99', () => {
  const local  = { items: [item({ qty: 60 })] };
  const server = { items: [item({ qty: 60 })] };
  const m = mergeCarts(local, server);
  assert.equal(m.items[0].qty, 99);
});

check('merge keeps earliest added_at', () => {
  const local  = { items: [item({ added_at: '2026-07-07T12:00:00.000Z' })] };
  const server = { items: [item({ added_at: '2026-07-01T09:00:00.000Z' })] };
  const m = mergeCarts(local, server);
  assert.equal(m.items[0].added_at, '2026-07-01T09:00:00.000Z');
});

check('merge tolerates empty / missing sides', () => {
  assert.equal(mergeCarts({ items: [] }, { items: [item()] }).items.length, 1);
  assert.equal(mergeCarts(null, null).items.length, 0);
  assert.equal(mergeCarts({ items: 'nope' }, { items: [item()] }).items.length, 1);
});

check('merge drops malformed lines (no ids)', () => {
  const m = mergeCarts({ items: [{ qty: 1 }] }, { items: [item()] });
  assert.equal(m.items.length, 1);
});

check('merge stamps a fresh updated_at', () => {
  const m = mergeCarts({ items: [item()] }, { items: [] });
  assert.ok(Date.parse(m.updated_at) > 0);
});

check('merge collapses duplicate lines within one side', () => {
  const local = { items: [item({ qty: 1 }), item({ qty: 1 })] };
  const m = mergeCarts(local, { items: [] });
  assert.equal(m.items.length, 1);
  assert.equal(m.items[0].qty, 2);
});

check('merge normalizes qty<=0 / NaN to >=1', () => {
  const m0  = mergeCarts({ items: [item({ qty: 0 })] }, { items: [] });
  const mNeg = mergeCarts({ items: [item({ qty: -5 })] }, { items: [] });
  const mNaN = mergeCarts({ items: [item({ qty: 'x' })] }, { items: [] });
  assert.equal(m0.items[0].qty, 1);
  assert.equal(mNeg.items[0].qty, 1);
  assert.equal(mNaN.items[0].qty, 1);
});

check('merge keeps server price on a duplicate (server folded first)', () => {
  const server = { items: [item({ price_thb: 20000 })] };
  const local  = { items: [item({ price_thb: 999 })] };
  const m = mergeCarts(local, server);
  assert.equal(m.items.length, 1);
  assert.equal(m.items[0].price_thb, 20000);
});

if (failed) { console.error('\n❌ cart-merge unit test failed'); process.exit(1); }
console.log('\n✅ cart-merge: lineKey + mergeCarts correct');
