# Measurements Capture UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a `requireAuth`-gated `/measurements.html` where a signed-in customer self-enters their tailoring measurements across all four schema kinds (body + jacket/shirt/pants reference), prefilled from their latest saved values and saved as a fresh snapshot.

**Architecture:** A data-driven field schema (`js/measurement-schema.js`) is the single source of truth mirroring `db/09_measurements.sql`. A browser-only render module (`js/measurements.js`) builds all four forms from it, prefills via the existing `getLatestMeasurements(kind)`, and saves via `saveMeasurements(kind, fields)` (both already in `js/profile.js`). No schema/DB changes. Fixed labelled units (in/cm/kg), no toggle.

**Tech Stack:** Static HTML + vanilla ES modules, `@supabase/supabase-js` (via `js/auth.js`/`js/profile.js`), Puppeteer for e2e, Node for the pure drift-guard test. `serve.mjs` on `localhost:3000`.

**Spec:** [docs/superpowers/specs/2026-07-10-phase-2-measurements-capture-design.md](../specs/2026-07-10-phase-2-measurements-capture-design.md)

**Pre-flight (execution session):**
- Invoke `frontend-design:frontend-design` before writing `measurements.html` (UI-heavy; project rule).
- Work in a dedicated worktree/branch `phase-2/measurements-capture` (`superpowers:using-git-worktrees`).
- Start `node serve.mjs` (background) before any screenshot or puppeteer step; don't start a second instance.
- Tests read `.env.local` manually (project convention — no dotenv). Test users are created via `admin.auth.admin.createUser` (bypasses the reserved-domain blocklist, so `@example.com` is fine).

---

## File Structure

```
NEW  js/measurement-schema.js            # source of truth: 4 kinds, groups, keys, labels, units, hints
NEW  scripts/test-measurement-schema.mjs # pure-Node drift guard (schema keys ⇔ SQL numeric columns)
NEW  measurements.html                   # dedicated page: head/CSP, layout, sub-nav + forms mount, footer
NEW  js/measurements.js                  # browser-only: render forms, prefill, validate, save
EDIT account.html                        # 2 disabled measurement stubs → enabled links
EDIT scripts/test-csp-compliance.mjs     # add '/measurements.html' to PAGES
NEW  scripts/test-measurements-page.mjs   # puppeteer e2e (bounce, switch, prefill, save round-trip, append-only, partial)
EDIT PROJECT.md                          # shipped inventory
```

`js/profile.js` `MEASUREMENT_KINDS` is `{ body, jacket_reference, shirt_reference, pants_reference }` — the schema module's `kind` values MUST be exactly these. `TABLE_BY_KIND` / `VIEW_BY_KIND` already map them in profile.js; do not duplicate that logic in the UI.

---

## Task 1: Field schema module + drift guard (TDD)

**Files:**
- Create: `js/measurement-schema.js`
- Test: `scripts/test-measurement-schema.mjs`

- [ ] **Step 1: Write the failing drift-guard test**

Create `scripts/test-measurement-schema.mjs`:

```js
// Pure-Node drift guard: every MEASUREMENT_SCHEMA field key must exist as a
// numeric column in the matching db/09_measurements.sql table, and every
// numeric column must be surfaced in the UI schema. No server needed.
import fs from 'node:fs';
import { MEASUREMENT_SCHEMA, fieldKeysForKind } from '../js/measurement-schema.js';

// Mirror of js/profile.js MEASUREMENT_KINDS / TABLE_BY_KIND (kept in sync by this test).
const TABLE_BY_KIND = {
  body:             'customer_body_measurements',
  jacket_reference: 'customer_jacket_reference',
  shirt_reference:  'customer_shirt_reference',
  pants_reference:  'customer_pants_reference',
};
const VALID_KINDS = new Set(Object.keys(TABLE_BY_KIND));

const sql = fs.readFileSync('db/09_measurements.sql', 'utf8');

function numericColumns(table) {
  const start = sql.indexOf(`create table if not exists ${table}`);
  if (start === -1) throw new Error(`table not found in SQL: ${table}`);
  const end = sql.indexOf(');', start);
  const block = sql.slice(start, end);
  const cols = [];
  for (const line of block.split('\n')) {
    const m = line.match(/^\s{2,}([a-z_]+)\s+numeric/);
    if (m) cols.push(m[1]);
  }
  return cols;
}

let failures = 0;
const must = (c, m) => { if (!c) { console.error('✘', m); failures++; } else console.log('✓', m); };

must(MEASUREMENT_SCHEMA.length === 4, `schema has 4 kinds (got ${MEASUREMENT_SCHEMA.length})`);

for (const def of MEASUREMENT_SCHEMA) {
  must(VALID_KINDS.has(def.kind), `kind "${def.kind}" is a valid profile.js MEASUREMENT_KIND`);
  const table = TABLE_BY_KIND[def.kind];
  if (!table) continue;
  const cols = new Set(numericColumns(table));
  const keys = fieldKeysForKind(def.kind);
  const keySet = new Set(keys);
  must(keys.length === new Set(keys).size, `${def.kind}: no duplicate keys`);
  for (const key of keys) must(cols.has(key), `${def.kind}: schema key "${key}" exists in ${table}`);
  for (const col of cols)  must(keySet.has(col), `${def.kind}: column "${col}" surfaced in UI schema`);
}

if (failures) { console.error(`\n❌ ${failures} failure(s)`); process.exit(1); }
console.log('\n✅ test-measurement-schema clean');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/test-measurement-schema.mjs`
Expected: FAIL — `Cannot find module '.../js/measurement-schema.js'` (module not created yet).

- [ ] **Step 3: Create the schema module**

Create `js/measurement-schema.js` (every `key` copied verbatim from `db/09_measurements.sql`):

```js
// js/measurement-schema.js
// Single source of truth for the measurements-capture UI. Each `key` matches a
// numeric column in the corresponding db/09_measurements.sql table EXACTLY.
// No browser-only imports — importable in Node for the drift-guard test.

export const MEASUREMENT_SCHEMA = [
  {
    kind: 'body',
    label: 'Body',
    groups: [
      { heading: 'Jacket & Coat', fields: [
        { key: 'chest_in',      label: 'Chest',       unit: 'in', hint: 'Around the fullest part of the chest' },
        { key: 'stomach_in',    label: 'Stomach',     unit: 'in' },
        { key: 'hips_in',       label: 'Hips',        unit: 'in' },
        { key: 'shoulders_in',  label: 'Shoulders',   unit: 'in', hint: 'Seam to seam across the back' },
        { key: 'arm_length_in', label: 'Arm length',  unit: 'in' },
        { key: 'bicep_in',      label: 'Bicep',       unit: 'in' },
        { key: 'arm_hole_in',   label: 'Arm hole',    unit: 'in' },
        { key: 'front_in',      label: 'Front',       unit: 'in' },
        { key: 'back_in',       label: 'Back',        unit: 'in' },
        { key: 'length_in',     label: 'Length',      unit: 'in' },
        { key: 'neck_in',       label: 'Neck',        unit: 'in' },
      ]},
      { heading: 'Trousers', fields: [
        { key: 'trouser_waist_in',  label: 'Waist',  unit: 'in' },
        { key: 'trouser_hips_in',   label: 'Hips',   unit: 'in' },
        { key: 'trouser_crotch_in', label: 'Crotch', unit: 'in' },
        { key: 'trouser_thigh_in',  label: 'Thigh',  unit: 'in' },
        { key: 'trouser_knee_in',   label: 'Knee',   unit: 'in' },
        { key: 'trouser_calf_in',   label: 'Calf',   unit: 'in' },
        { key: 'trouser_cuff_in',   label: 'Cuff',   unit: 'in' },
        { key: 'trouser_length_in', label: 'Length', unit: 'in' },
      ]},
      { heading: 'Height & Weight', fields: [
        { key: 'height_cm', label: 'Height', unit: 'cm' },
        { key: 'weight_kg', label: 'Weight', unit: 'kg' },
      ]},
    ],
    hasNotes: true,
  },
  {
    kind: 'jacket_reference',
    label: 'Jacket',
    groups: [
      { heading: 'Jacket reference garment', fields: [
        { key: 'collar_in',          label: 'Collar',          unit: 'in' },
        { key: 'shoulder_in',        label: 'Shoulder',        unit: 'in' },
        { key: 'half_armhole_in',    label: 'Half armhole',    unit: 'in' },
        { key: 'sleeve_length_in',   label: 'Sleeve length',   unit: 'in' },
        { key: 'sleeve_inseam_in',   label: 'Sleeve inseam',   unit: 'in' },
        { key: 'sleeve_width_in',    label: 'Sleeve width',    unit: 'in' },
        { key: 'length_lower_in',    label: 'Length (lower)',  unit: 'in' },
        { key: 'length_upper_in',    label: 'Length (upper)',  unit: 'in' },
        { key: 'back_length_in',     label: 'Back length',     unit: 'in' },
        { key: 'half_chest_in',      label: 'Half chest',      unit: 'in' },
        { key: 'half_waist_in',      label: 'Half waist',      unit: 'in' },
        { key: 'bottom_hem_in',      label: 'Bottom hem',      unit: 'in' },
        { key: 'yoke_in',            label: 'Yoke',            unit: 'in' },
        { key: 'half_girth_in',      label: 'Half girth',      unit: 'in' },
        { key: 'half_back_width_in', label: 'Half back width', unit: 'in' },
      ]},
    ],
    hasNotes: true,
  },
  {
    kind: 'shirt_reference',
    label: 'Shirt',
    groups: [
      { heading: 'Shirt reference garment', fields: [
        { key: 'collar_in',        label: 'Collar',        unit: 'in' },
        { key: 'chest_in',         label: 'Chest',         unit: 'in' },
        { key: 'waist_in',         label: 'Waist',         unit: 'in' },
        { key: 'hips_in',          label: 'Hips',          unit: 'in' },
        { key: 'length_in',        label: 'Length',        unit: 'in' },
        { key: 'sleeve_length_in', label: 'Sleeve length', unit: 'in' },
        { key: 'shoulders_in',     label: 'Shoulders',     unit: 'in' },
        { key: 'armhole_in',       label: 'Armhole',       unit: 'in' },
        { key: 'bicep_in',         label: 'Bicep',         unit: 'in' },
        { key: 'cuff_in',          label: 'Cuff',          unit: 'in' },
      ]},
    ],
    hasNotes: true,
  },
  {
    kind: 'pants_reference',
    label: 'Trousers',
    groups: [
      { heading: 'Trouser reference garment', fields: [
        { key: 'waist_in',        label: 'Waist',          unit: 'in' },
        { key: 'hips_in',         label: 'Hips',           unit: 'in' },
        { key: 'length_in',       label: 'Length',         unit: 'in' },
        { key: 'crotch_front_in', label: 'Crotch (front)', unit: 'in' },
        { key: 'crotch_back_in',  label: 'Crotch (back)',  unit: 'in' },
        { key: 'thigh_in',        label: 'Thigh',          unit: 'in' },
        { key: 'calf_in',         label: 'Calf',           unit: 'in' },
        { key: 'bottom_in',       label: 'Bottom',         unit: 'in' },
      ]},
    ],
    hasNotes: true,
  },
];

// Flat list of field keys for a kind (excludes the free-text `notes`).
export function fieldKeysForKind(kind) {
  const def = MEASUREMENT_SCHEMA.find(k => k.kind === kind);
  if (!def) return [];
  return def.groups.flatMap(g => g.fields.map(f => f.key));
}

// Anchor <-> kind mapping used by the page nav (short hashes).
export const ANCHOR_BY_KIND = { body: 'body', jacket_reference: 'jacket', shirt_reference: 'shirt', pants_reference: 'pants' };
export const KIND_BY_ANCHOR = { body: 'body', jacket: 'jacket_reference', shirt: 'shirt_reference', pants: 'pants_reference' };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node scripts/test-measurement-schema.mjs`
Expected: PASS — `✅ test-measurement-schema clean`. If a `column ... surfaced` assertion fails, a key was mistyped vs the SQL — fix the schema key, not the test.

- [ ] **Step 5: Commit**

```bash
git add js/measurement-schema.js scripts/test-measurement-schema.mjs
git commit -m "feat(measurements): field schema module + SQL drift guard"
```

---

## Task 2: The `/measurements.html` page + render module

**Files:**
- Create: `measurements.html`
- Create: `js/measurements.js`

> Invoke `frontend-design:frontend-design` first. The markup below is the functional skeleton (slots, mounts, ids the JS and tests depend on) + baseline styling consistent with `account.html`. Refine spacing/type/craft during the frontend-design pass, but keep every `id`/`data-*` hook intact.

- [ ] **Step 1: Create `js/measurements.js`**

```js
// js/measurements.js — browser-only. Renders the four measurement forms from
// MEASUREMENT_SCHEMA, prefills each from the customer's latest saved values,
// validates lightly, and saves a fresh snapshot on submit. requireAuth-gated.
import { requireAuth } from '/js/auth.js';
import { getLatestMeasurements, saveMeasurements } from '/js/profile.js';
import { MEASUREMENT_SCHEMA, ANCHOR_BY_KIND, KIND_BY_ANCHOR } from '/js/measurement-schema.js';

const KINDS = MEASUREMENT_SCHEMA.map(k => k.kind);
const prefilled = new Set();   // kinds already loaded from the server (lazy)

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v);
  }
  for (const c of children) if (c) node.append(c);
  return node;
}

function fieldControl(kind, f) {
  const id = `m-${kind}-${f.key}`;
  const wrap = el('div', { class: 'measure-field' });
  wrap.append(el('label', { class: 'measure-field__label', for: id, text: f.label }));
  const control = el('div', { class: 'measure-field__control' });
  control.append(el('input', {
    id, name: f.key, type: 'number', inputmode: 'decimal',
    min: '0', max: '999.99', step: '0.01', class: 'input',
  }));
  control.append(el('span', { class: 'measure-field__unit', text: f.unit }));
  wrap.append(control);
  if (f.hint) wrap.append(el('span', { class: 'measure-field__hint', text: f.hint }));
  return wrap;
}

function buildForm(def) {
  const form = el('form', { class: 'measure-form', id: `form-${def.kind}`, 'data-kind': def.kind, novalidate: 'novalidate' });
  for (const group of def.groups) {
    const set = el('fieldset', { class: 'measure-group' });
    set.append(el('legend', { class: 'measure-group__legend', text: group.heading }));
    const grid = el('div', { class: 'measure-grid' });
    for (const f of group.fields) grid.append(fieldControl(def.kind, f));
    set.append(grid);
    form.append(set);
  }
  if (def.hasNotes) {
    const wrap = el('div', { class: 'measure-field measure-field--notes' });
    const id = `m-${def.kind}-notes`;
    wrap.append(el('label', { class: 'measure-field__label', for: id, text: 'Notes' }));
    wrap.append(el('textarea', { id, name: 'notes', class: 'input', rows: '3' }));
    form.append(wrap);
  }
  const actions = el('div', { class: 'measure-actions' });
  const btn = el('button', { type: 'submit', class: 'btn btn--primary', id: `save-${def.kind}`, text: 'Save measurements' });
  const status = el('p', { class: 'measure-status', id: `status-${def.kind}`, 'aria-live': 'polite', hidden: 'hidden' });
  actions.append(btn, status);
  form.append(actions);
  form.addEventListener('submit', (e) => onSave(e, def, status, btn));
  return form;
}

function fill(form, def, row) {
  if (!row) return;
  for (const group of def.groups) {
    for (const f of group.fields) {
      const v = row[f.key];
      form.elements[f.key].value = (v === null || v === undefined) ? '' : v;
    }
  }
  if (def.hasNotes) form.elements['notes'].value = row.notes ?? '';
}

function validate(form, def) {
  let ok = true;
  for (const group of def.groups) {
    for (const f of group.fields) {
      const input = form.elements[f.key];
      input.classList.remove('input--error');
      const raw = (input.value || '').trim();
      if (raw === '') continue;                // blank is always valid
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0 || n > 999.99) { input.classList.add('input--error'); ok = false; }
    }
  }
  return ok;
}

function collect(form, def) {
  const fields = {};
  for (const group of def.groups) {
    for (const f of group.fields) {
      const raw = (form.elements[f.key].value || '').trim();
      fields[f.key] = raw === '' ? null : Number.parseFloat(raw);
    }
  }
  if (def.hasNotes) {
    const raw = (form.elements['notes'].value || '').trim();
    fields.notes = raw === '' ? null : raw;
  }
  return fields;
}

async function loadKind(def) {
  if (prefilled.has(def.kind)) return;
  const form  = document.getElementById(`form-${def.kind}`);
  const empty = document.getElementById(`empty-${def.kind}`);
  const { data, error } = await getLatestMeasurements(def.kind);
  if (error) { console.error('[measurements] load', def.kind, error); return; }
  if (data) { fill(form, def, data); if (empty) empty.hidden = true; }
  else if (empty) empty.hidden = false;
  prefilled.add(def.kind);
}

async function onSave(e, def, status, btn) {
  e.preventDefault();
  const form = e.currentTarget;
  status.hidden = true;
  status.classList.remove('measure-status--error', 'measure-status--ok');
  if (!validate(form, def)) {
    status.textContent = 'Please correct the highlighted fields (0–999.99).';
    status.classList.add('measure-status--error');
    status.hidden = false;
    return;
  }
  btn.disabled = true;
  const { data, error } = await saveMeasurements(def.kind, collect(form, def));
  btn.disabled = false;
  if (error) {
    status.textContent = 'Could not save — ' + (error.message || 'please try again.');
    status.classList.add('measure-status--error');
    status.hidden = false;
    return;
  }
  fill(form, def, data);                       // re-prefill from the fresh snapshot
  const empty = document.getElementById(`empty-${def.kind}`);
  if (empty) empty.hidden = true;
  status.textContent = 'Saved · just now';
  status.classList.add('measure-status--ok');
  status.hidden = false;
}

function activeKind() {
  const anchor = (location.hash || '').replace('#', '');
  return KIND_BY_ANCHOR[anchor] || 'body';
}

function showKind(kind) {
  for (const k of KINDS) {
    const panel = document.getElementById(`panel-${k}`);
    if (panel) panel.hidden = (k !== kind);
  }
  document.querySelectorAll('[data-kind-link]').forEach(a =>
    a.setAttribute('aria-current', a.dataset.kindLink === kind ? 'true' : 'false'));
  const def = MEASUREMENT_SCHEMA.find(d => d.kind === kind);
  if (def) loadKind(def);
}

async function init() {
  await requireAuth({ redirectTo: '/login.html' });
  const nav   = document.getElementById('measure-nav');
  const mount = document.getElementById('measure-forms');
  for (const def of MEASUREMENT_SCHEMA) {
    const anchor = ANCHOR_BY_KIND[def.kind];
    nav.append(el('a', { href: `#${anchor}`, class: 'measure-nav__link', 'data-kind-link': def.kind, text: def.label }));
    const panel = el('section', { class: 'measure-panel', id: `panel-${def.kind}`, hidden: 'hidden', 'aria-label': `${def.label} measurements` });
    panel.append(el('p', { class: 'measure-empty', id: `empty-${def.kind}`, hidden: 'hidden', text: 'No measurements saved yet — add yours below.' }));
    panel.append(buildForm(def));
    mount.append(panel);
  }
  window.addEventListener('hashchange', () => showKind(activeKind()));
  showKind(activeKind());
  document.body.dataset.measurementsReady = '1';   // test/readiness hook
}

init();
```

- [ ] **Step 2: Create `measurements.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="
  default-src 'self';
  script-src 'self' 'unsafe-inline' https://esm.sh https://assets.calendly.com;
  style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://assets.calendly.com;
  font-src 'self' https://fonts.gstatic.com;
  img-src 'self' data: https://*.supabase.co https://placehold.co;
  media-src 'self';
  connect-src 'self' https://*.supabase.co wss://*.supabase.co;
  frame-src https://calendly.com;
  form-action 'self';
  base-uri 'self';
  object-src 'none';
">
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Your measurements — Country Road Fashions</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400;1,500&family=Raleway:wght@200;300;400;500;600;700;800&display=swap" rel="stylesheet" />
<link rel="preload" as="fetch" href="/components/header.html" crossorigin>
<link rel="preload" as="fetch" href="/components/footer.html" crossorigin>
<link rel="stylesheet" href="/css/base.css">
<style>
  :root { --color-jet:#0E0F11; --color-charcoal:#1A1B1F; }
</style>
<script type="module" src="/js/layout.js"></script>
<script type="module" src="/js/auth.js"></script>
<style>
  .measure-shell { max-width: var(--container-max); margin: 0 auto; padding: var(--space-8) var(--space-6); background: var(--color-off-white); }
  .measure-shell h1 {
    font-family: var(--font-serif); font-weight: 500;
    font-size: clamp(36px, 5vw, 56px); line-height: var(--leading-tight);
    letter-spacing: var(--tracking-tight); color: var(--color-jet); margin: 0 0 var(--space-2);
  }
  .measure-shell h1 em { font-style: italic; border-bottom: 1px solid var(--color-stone); }
  .measure-intro { color: var(--color-muted); max-width: 60ch; margin: 0 0 var(--space-6); line-height: 1.7; }
  .measure-layout { display: grid; grid-template-columns: 220px 1fr; gap: var(--space-7); align-items: start; }
  .measure-nav {
    position: sticky; top: calc(var(--header-h) + var(--space-5));
    display: flex; flex-direction: column; gap: var(--space-2);
    border-left: 1px solid var(--color-rule); padding-left: var(--space-4);
  }
  .measure-nav__link {
    font-size: 13px; letter-spacing: 0.04em; color: var(--color-muted);
    padding: var(--space-2) 0; width: fit-content;
    border-bottom: 1px solid transparent; transition: color var(--t-fast) var(--ease-out);
  }
  .measure-nav__link:hover, .measure-nav__link:focus-visible, .measure-nav__link[aria-current="true"] { color: var(--color-jet); }
  .measure-panel { max-width: 720px; }
  .measure-empty { color: var(--color-muted); font-style: italic; margin: 0 0 var(--space-5); }
  .measure-group { border: 0; margin: 0 0 var(--space-6); padding: 0; }
  .measure-group__legend {
    font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--color-muted); padding: 0 0 var(--space-3); border-bottom: 1px solid var(--color-rule); width: 100%;
  }
  .measure-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: var(--space-4); margin-top: var(--space-4); }
  .measure-field { display: flex; flex-direction: column; gap: 6px; }
  .measure-field--notes { margin-top: var(--space-4); }
  .measure-field__label { font-size: 13px; color: var(--color-ink); }
  .measure-field__control { position: relative; display: flex; align-items: center; }
  .measure-field__control .input { width: 100%; padding-right: 42px; }
  .measure-field__unit { position: absolute; right: 12px; font-size: 12px; color: var(--color-muted); pointer-events: none; }
  .measure-field__hint { font-size: 12px; color: var(--color-muted); }
  .input--error { border-color: #b3261e !important; }
  .measure-actions { display: flex; align-items: center; gap: var(--space-4); margin-top: var(--space-6); }
  .measure-status { font-size: 13px; margin: 0; }
  .measure-status--ok { color: #1a7f4b; }
  .measure-status--error { color: #b3261e; }
  @media (max-width: 900px) {
    .measure-layout { grid-template-columns: 1fr; }
    .measure-nav { position: static; flex-direction: row; flex-wrap: wrap; gap: var(--space-4); border-left: 0; padding-left: 0; }
  }
</style>
</head>
<body>
  <div data-layout="header" style="min-height:72px;background:var(--color-jet);"></div>
  <main class="measure-shell">
    <h1>Your <em>Measurements</em></h1>
    <p class="measure-intro">Enter what you know — every field is optional; our tailor confirms everything at your fitting.</p>
    <div class="measure-layout">
      <nav class="measure-nav" id="measure-nav" aria-label="Measurement kinds"></nav>
      <div id="measure-forms"></div>
    </div>
  </main>
  <div data-layout="footer"></div>
  <script type="module" src="/js/measurements.js"></script>
</body>
</html>
```

- [ ] **Step 3: Manual smoke via screenshot (signed-out → bounce)**

Run (server already up): `node screenshot.mjs http://localhost:3000/measurements.html measure-guest`
Then `Read` the PNG. Expected: redirected to the Sign in card (requireAuth bounced the guest). This confirms the gate and that the module loaded without console errors.

- [ ] **Step 4: Verify token discipline still holds**

Run: `node scripts/test-token-discipline.mjs`
Expected: PASS — no hardcoded `#000`/`#fff` drift introduced. (The `#b3261e`/`#1a7f4b` status colors are intentional semantic error/success, not greys; if the test flags them, move them into a page-local `--color-danger`/`--color-success` var or accept per the test's allowance — confirm against how `.btn--danger` already handles its red in base.css and mirror that.)

- [ ] **Step 5: Commit**

```bash
git add measurements.html js/measurements.js
git commit -m "feat(measurements): dedicated /measurements.html self-entry page + render module"
```

---

## Task 3: Enable the account-page measurement links

**Files:**
- Modify: `account.html` (the two disabled `.measurement-row` stubs, ~lines 285–298)

- [ ] **Step 1: Replace the two disabled stubs**

Find in `account.html`:

```html
            <div class="measurement-row">
              <div>
                <span class="measurement-row__label">Body measurements</span>
                <span class="measurement-row__hint">Available soon — coming in our next release.</span>
              </div>
              <button class="btn btn--ghost" type="button" disabled aria-disabled="true">Add</button>
            </div>
            <div class="measurement-row">
              <div>
                <span class="measurement-row__label">Reference garment</span>
                <span class="measurement-row__hint">Available soon — coming in our next release.</span>
              </div>
              <button class="btn btn--ghost" type="button" disabled aria-disabled="true">Add</button>
            </div>
```

Replace with:

```html
            <div class="measurement-row">
              <div>
                <span class="measurement-row__label">Body measurements</span>
                <span class="measurement-row__hint">Enter your body measurements for our tailor.</span>
              </div>
              <a class="btn btn--ghost" href="/measurements.html#body">Add</a>
            </div>
            <div class="measurement-row">
              <div>
                <span class="measurement-row__label">Reference garment</span>
                <span class="measurement-row__hint">Measure a jacket, shirt, or trousers that fit you well.</span>
              </div>
              <a class="btn btn--ghost" href="/measurements.html#jacket">Add</a>
            </div>
```

(The `.measurement-row .btn[disabled]` CSS rule in the `<head>` can stay — harmless once no disabled buttons remain. Leave it.)

- [ ] **Step 2: Commit**

```bash
git add account.html
git commit -m "feat(measurements): enable account-page links into /measurements.html"
```

---

## Task 4: Add the page to the CSP sweep

**Files:**
- Modify: `scripts/test-csp-compliance.mjs` (the `PAGES` array, lines 12–26)

- [ ] **Step 1: Add the route**

Change the end of the `PAGES` array from:

```js
  '/account.html',
  '/order-confirmation.html',
];
```

to:

```js
  '/account.html',
  '/order-confirmation.html',
  '/measurements.html',
];
```

- [ ] **Step 2: Run the sweep**

Run (server up): `node scripts/test-csp-compliance.mjs`
Expected: PASS — 14 pages, zero CSP violations. `/measurements.html` bounces to `/login.html` for the guest crawler, which is CSP-clean; the sweep asserts no CSP console violations, so the redirect is fine.

- [ ] **Step 3: Commit**

```bash
git add scripts/test-csp-compliance.mjs
git commit -m "test(measurements): add /measurements.html to CSP sweep (14 pages)"
```

---

## Task 5: End-to-end save round-trip test

**Files:**
- Create: `scripts/test-measurements-page.mjs`

- [ ] **Step 1: Write the e2e test**

Create `scripts/test-measurements-page.mjs`:

```js
// e2e: guest bounce, sub-nav switch, save round-trip, append-only, partial save.
// Reads .env.local manually (project convention; no dotenv). Admin createUser
// bypasses the reserved-domain blocklist, so @example.com is fine.
import fs from 'node:fs';
import puppeteer from 'puppeteer';
import { createClient } from '@supabase/supabase-js';

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8').split('\n').filter(Boolean)
    .map(l => l.split('=').map(s => s.trim())).map(([k, ...v]) => [k, v.join('=')])
);
const URL = env.SUPABASE_URL, SVC = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !SVC) { console.error('missing env'); process.exit(2); }
const admin = createClient(URL, SVC, { auth: { persistSession: false } });

const email = `measure-${Date.now()}@example.com`;
const pw = 'Correct-Horse-Battery-9!';
let failures = 0;
const must = (c, m) => { if (!c) { console.error('✘', m); failures++; } else console.log('✓', m); };

const { data: created } = await admin.auth.admin.createUser({ email, password: pw, email_confirm: true });
const uid = created?.user?.id;

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
try {
  // 1. Guest bounce
  await page.goto('http://localhost:3000/measurements.html', { waitUntil: 'networkidle0' });
  must(page.url().includes('/login.html'), `guest bounced to login → ${page.url()}`);

  // sign in
  await page.type('input[name="email"]', email);
  await page.type('input[name="password"]', pw);
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), page.click('button[type="submit"]')]);

  // 2. Load measurements page + wait for render
  await page.goto('http://localhost:3000/measurements.html#body', { waitUntil: 'networkidle0' });
  await page.waitForSelector('body[data-measurements-ready="1"]');
  await page.waitForSelector('#form-body input[name="chest_in"]', { visible: true });
  must(true, 'body form rendered');

  // empty state visible for a fresh user
  const emptyShown = await page.$eval('#empty-body', el => !el.hidden);
  must(emptyShown, 'empty-state note shown for fresh user');

  // 3. Fill a few body fields (partial save — most left blank) + notes, save
  await page.type('#form-body input[name="chest_in"]', '40.5');
  await page.type('#form-body input[name="shoulders_in"]', '18.25');
  await page.type('#form-body textarea[name="notes"]', 'left shoulder slightly lower');
  await page.click('#save-body');
  await page.waitForSelector('#status-body.measure-status--ok:not([hidden])');
  must(true, 'save confirmation shown');

  // 4. Reload → values persist (round-trip through v_latest view)
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('body[data-measurements-ready="1"]');
  await page.waitForSelector('#form-body input[name="chest_in"]');
  // give lazy prefill a tick
  await page.waitForFunction(() => document.querySelector('#form-body input[name="chest_in"]').value !== '');
  const chest = await page.$eval('#form-body input[name="chest_in"]', el => el.value);
  const notes = await page.$eval('#form-body textarea[name="notes"]', el => el.value);
  must(parseFloat(chest) === 40.5, `chest persisted → "${chest}"`);
  must(notes === 'left shoulder slightly lower', `notes persisted → "${notes}"`);

  // 5. Sub-nav switch to a reference kind renders its form
  await page.click('[data-kind-link="jacket_reference"]');
  await page.waitForSelector('#form-jacket_reference input[name="collar_in"]', { visible: true });
  const bodyHidden = await page.$eval('#panel-body', el => el.hidden);
  must(bodyHidden, 'switching kinds hides the body panel');

  // 6. Append-only: second body save creates a new row (2 rows total)
  await page.goto('http://localhost:3000/measurements.html#body', { waitUntil: 'networkidle0' });
  await page.waitForSelector('body[data-measurements-ready="1"]');
  await page.waitForFunction(() => document.querySelector('#form-body input[name="chest_in"]').value !== '');
  await page.$eval('#form-body input[name="chest_in"]', el => { el.value = ''; });
  await page.type('#form-body input[name="chest_in"]', '41');
  await page.click('#save-body');
  await page.waitForSelector('#status-body.measure-status--ok:not([hidden])');

  const { count } = await admin.from('customer_body_measurements')
    .select('id', { count: 'exact', head: true }).eq('customer_id', uid);
  must(count === 2, `append-only: 2 body rows after 2 saves → ${count}`);
} finally {
  await browser.close();
  if (uid) await admin.auth.admin.deleteUser(uid);   // cascade clears measurement rows
}

if (failures) { console.error(`\n❌ ${failures} failure(s)`); process.exit(1); }
console.log('\n✅ test-measurements-page clean');
```

- [ ] **Step 2: Run the test**

Run (server up): `node scripts/test-measurements-page.mjs`
Expected: PASS — `✅ test-measurements-page clean`. If prefill assertions flake, the `waitForFunction` guards should absorb webhook-free latency; if a real failure, debug with `superpowers:systematic-debugging` before proceeding.

- [ ] **Step 3: Commit**

```bash
git add scripts/test-measurements-page.mjs
git commit -m "test(measurements): e2e save round-trip + append-only + partial save"
```

---

## Task 6: Screenshot polish pass + full regression + PROJECT.md

**Files:**
- Modify: `PROJECT.md`

- [ ] **Step 1: Signed-in screenshot review (frontend-design gate)**

Sign in as any test user in the puppeteer session (or reuse the e2e flow with `headless:false` briefly), then capture the page while authenticated. Because `requireAuth` blocks a bare `screenshot.mjs` hit, add a tiny throwaway capture script under `scripts/` that: signs in via admin-created user + `signInWithPassword` in-page, navigates to `/measurements.html#body`, waits for `body[data-measurements-ready="1"]`, and screenshots to `temporary screenshots/`. `Read` the PNG. Compare against `account.html` for type/spacing/hairline consistency; fix visible mismatches, re-screenshot (≥2 rounds per CLAUDE.md). Delete the throwaway script when done (do not commit it).

- [ ] **Step 2: Full regression suite**

Run each (server up), expect all green:

```bash
node scripts/test-measurement-schema.mjs
node scripts/test-measurements-page.mjs
node scripts/test-csp-compliance.mjs
node scripts/test-account-profile-crud.mjs
node scripts/test-measurements-rls.mjs
node scripts/test-measurements-views.mjs
node scripts/test-layout-mount.mjs
node scripts/test-token-discipline.mjs
```

Expected: every script prints its `✅ ... clean` / pass line. Fix any regression before continuing.

- [ ] **Step 3: Update PROJECT.md**

Add a `### Phase 2 — measurements-capture UX (SHIPPED 2026-07-10)` subsection under the other Phase 2 entries summarizing: new `/measurements.html` (requireAuth, four kinds via `js/measurement-schema.js` + `js/measurements.js`), reuses `getLatestMeasurements`/`saveMeasurements`, fixed labelled units, account-page stubs now enabled links, footer left unchanged (online-consultation is a distinct concept), new tests (`test-measurement-schema`, `test-measurements-page`) + CSP sweep now 14 pages. Update: the top banner "Last remaining Phase 2 sub-project" line (Phase 2 now complete), the live-pages table (add `/measurements.html` row), the §4 layout tree (add the 3 new files), the backlog feature #6 status → ✅ done, and the Phase 2 phasing row. Flip the top-of-file "Last session ended" banner to note Phase 2 is fully shipped and Phase 3 (Discovery + SEO + privacy hardening) is next.

- [ ] **Step 4: Commit**

```bash
git add PROJECT.md
git commit -m "docs: PROJECT.md — measurements-capture UX shipped (Phase 2 complete)"
```

- [ ] **Step 5: Finish the branch**

Use `superpowers:requesting-code-review` then `superpowers:finishing-a-development-branch` to merge `phase-2/measurements-capture` to `main`.

---

## Self-Review notes (author)

- **Spec coverage:** page/route (T2), field schema Approach A (T1), render+prefill+save (T2), validation (T2), account links (T3), CSP + tests (T4/T5), footer intentionally unchanged (T3 note). All spec sections map to a task.
- **Type consistency:** `kind` values `body|jacket_reference|shirt_reference|pants_reference` are identical across schema module, profile.js, drift test, and e2e. Anchor map (`body|jacket|shirt|pants`) centralised in `measurement-schema.js` (`ANCHOR_BY_KIND`/`KIND_BY_ANCHOR`) and reused by `measurements.js` — no divergent copies. `data-measurements-ready` hook set in `init()` and awaited by the e2e test. Element ids (`form-<kind>`, `panel-<kind>`, `empty-<kind>`, `status-<kind>`, `save-<kind>`) are consistent between `measurements.js` and the test selectors.
- **Append-only:** relies on `saveMeasurements` always INSERTing (confirmed in `js/profile.js`); T5 asserts 2 rows after 2 saves.
