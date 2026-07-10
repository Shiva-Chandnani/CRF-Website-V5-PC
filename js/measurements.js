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
