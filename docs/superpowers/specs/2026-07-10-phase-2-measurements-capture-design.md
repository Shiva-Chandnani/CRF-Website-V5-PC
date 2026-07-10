# Phase 2 — Measurements Capture UX — Design

**Date:** 2026-07-10
**Phase:** 2 (Commerce) — final sub-project
**Status:** Approved, ready for planning
**Depends on:** Phase 1 WT-3 measurements schema (`db/09_measurements.sql`) and Phase 1 WT-2 `js/profile.js` (`getLatestMeasurements` / `saveMeasurements`), both shipped to `main`.

## Summary

A signed-in customer can self-enter their own tailoring measurements on a new
dedicated page, `/measurements.html`. The page covers all four measurement
kinds already modelled in the schema — body measurements plus three
reference-garment kinds (jacket, shirt, trousers) — with fully editable forms
that prefill from the customer's latest saved values and save a fresh snapshot
on submit. This is the last remaining Phase 2 sub-project; cart dual-mode and
Stripe checkout already shipped.

The DB schema, RLS, and the `js/profile.js` data layer already exist and are
Node-tested. This project is **UI + wiring only** — no schema changes.

## Decisions (from brainstorming)

| # | Question | Decision |
|---|---|---|
| D1 | Primary purpose | **Customer self-entry** — editable forms where customers type their own measurements as a starting reference for the atelier. Not a read-only display of atelier records; not a narrow reference-garment-only flow. |
| D2 | Which kinds in V1 | **Body + all three reference kinds** (body, jacket, shirt, pants) — full coverage of the schema. Four forms. |
| D3 | Form surface | **Dedicated `/measurements.html` page** with its own sub-nav for the four kinds. Not inline accordion on account.html; not modals. |
| D4 | Units | **Fixed, labelled units** — each field shows its stored unit as a fixed suffix (in / cm / kg). No conversion, no toggle. Toggle deferred. |
| D5 | Form definition approach | **Approach A — data-driven field schema.** A single JS config describes every kind's field groups; one render function builds all forms, one save handler reads any form generically. Chosen over hand-authored HTML (54 inputs to hand-maintain, drift-prone) and runtime DB introspection (over-engineered, no room for human labels/hints/grouping). |

## Architecture

Three new front-end files plus edits to two existing files and one test file.

```
NEW  measurements.html            # dedicated page; requireAuth; dark header; CSP block
NEW  js/measurement-schema.js     # SINGLE SOURCE OF TRUTH: 4 kind defs, field groups,
                                  #   labels, units, hints. Node-importable (no browser deps).
NEW  js/measurements.js           # browser-only: render forms from schema, prefill via
                                  #   getLatestMeasurements, save via saveMeasurements
EDIT account.html                 # two measurement stubs → enabled links to /measurements.html
EDIT scripts/test-csp-compliance.mjs   # add /measurements.html to PAGES
     # (footer "Online Measurements" is NOT touched — see §5; it points at the
     #  online-consultation booking, a distinct concept from self-entry.)
NEW  scripts/test-measurements-page.mjs      # puppeteer e2e
NEW  scripts/test-measurement-schema.mjs     # pure-Node drift guard
```

The existing data layer (`js/profile.js`: `getLatestMeasurements(kind)` /
`saveMeasurements(kind, fields)`) is reused unchanged. `MEASUREMENT_KINDS` in
`profile.js` is `{ body, jacket_reference, shirt_reference, pants_reference }`
— the schema module's `kind` values MUST use these exact strings.

### 1. `/measurements.html` — page & route

- `requireAuth`-gated. Guests bounce to `/login.html?next=/measurements.html`
  (reuse the existing `requireAuth(next)` pattern from account.html).
- Dark header (default `css/base.css` header), shared footer via `data-layout`
  slots, per-page `<head>` CSP block copied from account.html (no
  `frame-ancestors`, per WT-4).
- Two-column layout mirroring account.html: **sticky left sub-nav** listing the
  four kinds (Body · Jacket · Shirt · Trousers) + a content column showing one
  form at a time. Anchor-driven (`#body`, `#jacket`, `#shirt`, `#pants`),
  deep-linkable; sub-nav marks the active kind. Collapses to stacked below the
  same breakpoint account.html uses (~900px).
- Page header follows the brand pattern with an italic stone-accent word:
  "Your *Measurements*". Intro line: "Enter what you know — every field is
  optional; our tailor confirms everything at your fitting."

### 2. `js/measurement-schema.js` — field schema (Approach A)

Exports a single array of four kind definitions. Shape:

```js
export const MEASUREMENT_SCHEMA = [
  {
    kind: 'body',                         // MUST match profile.js MEASUREMENT_KINDS
    label: 'Body',
    navLabel: 'Body',
    groups: [
      { heading: 'Jacket & Coat', fields: [
        { key: 'chest_in', label: 'Chest', unit: 'in', hint: 'Around the fullest part' },
        // …
      ]},
      { heading: 'Trousers', fields: [ /* trouser_* fields */ ]},
      { heading: 'Height & Weight', fields: [
        { key: 'height_cm', label: 'Height', unit: 'cm' },
        { key: 'weight_kg', label: 'Weight', unit: 'kg' },
      ]},
    ],
    hasNotes: true,
  },
  { kind: 'jacket_reference', label: 'Jacket', groups: [ /* single group, 15 fields */ ], hasNotes: true },
  { kind: 'shirt_reference',  label: 'Shirt',  groups: [ /* single group, 10 fields */ ], hasNotes: true },
  { kind: 'pants_reference',  label: 'Trousers', groups: [ /* single group, 8 fields */ ], hasNotes: true },
];
```

Rules:
- Every `key` matches a DB column in the corresponding table **exactly** (guarded
  by `test-measurement-schema.mjs`).
- Body fields split into three groups mirroring the schema comments (Jacket &
  Coat body / Trouser body / Height & Weight). The three reference kinds are a
  single group each.
- `unit` is one of `in` | `cm` | `kg`, rendered as a fixed suffix inside each
  input. Everything except height/weight is `in`.
- Module has **no browser-only imports** so it is importable in Node tests.

### 3. `js/measurements.js` — render + wire (browser-only)

- On `DOMContentLoaded` / after `crf:layout-ready`: `requireAuth`, then render
  the sub-nav and build all four `<form>`s from `MEASUREMENT_SCHEMA` into the
  content column. Only the active kind is visible (anchor-driven show/hide).
- Each input: `type="number"`, `inputmode="decimal"`, `min="0"`, `max="999.99"`,
  `step="0.01"`, unit suffix, optional hint text. `notes` renders as a
  `<textarea>`.
- **Prefill:** for a kind, call `getLatestMeasurements(kind)`; populate inputs
  from the returned row (each `key`). If `data` is null → blank inputs + empty
  state note ("No measurements saved yet — add yours below."). Prefill on first
  view of each kind (lazy) or all up-front; either is acceptable, lazy preferred
  to avoid four queries on load.
- **Save (per-form button):** collect that form's field values; blank string →
  `null`; otherwise `parseFloat`. `notes` → trimmed string or `null`. Call
  `saveMeasurements(kind, fields)`. This INSERTs a new row (append-only history
  preserved by design). On success: inline success note ("Saved · just now") and
  re-prefill from the returned row. On error: inline error message, entered
  values retained, nothing lost. No page reload.
- Saves are per-kind independent — saving Body does not touch the reference
  forms.

### 4. Validation

Client-side, light and forgiving (UX only — server RLS is the trust boundary):
- Numeric inputs constrained by `min`/`max`/`step` matching `numeric(5,2)`
  (0–999.99, two decimals).
- Non-numeric or out-of-range → field-level message; the affected form's save is
  blocked until fixed. Other forms unaffected.
- **Blank is always valid** — partial saves are a feature (all columns nullable).
- No cross-field validation in V1.

### 5. Account page + footer wiring

- `account.html`: the two disabled stubs ("Body measurements", "Reference
  garment", both currently `disabled aria-disabled="true"`) become **enabled**
  `<a class="btn btn--ghost">` links → `/measurements.html#body` and
  `/measurements.html#jacket` respectively. Update the hint copy away from
  "Available soon". The "In-person consultation → Book" row is unchanged.
- **Footer is left unchanged.** The footer "Online Measurements" link
  (`components/footer.html`) points at `book-appointment.html#online` — an
  *online consultation* (a tailor guiding the customer through measuring over
  video), which is a distinct concept from this self-entry form. It is
  intentionally NOT repointed. The new page is reached via the account-page
  links above. (If a footer entry point is later wanted, it should be a new,
  separately-labelled link — out of scope for V1.)

### 6. CSP + tests

- Add `/measurements.html` to the `PAGES` array in
  `scripts/test-csp-compliance.mjs` (13-page sweep → 14).
- **`scripts/test-measurement-schema.mjs`** (pure Node, no server): import
  `MEASUREMENT_SCHEMA`; for each kind, assert every `key` exists as a column in
  the matching table. Source-of-truth for column names is `db/09_measurements.sql`
  (parse it or maintain an inline expected-columns map). Guards schema/UI drift.
  Also assert each `kind` is one of `profile.js`'s `MEASUREMENT_KINDS`.
- **`scripts/test-measurements-page.mjs`** (puppeteer e2e, server up): guest
  bounce to login; signed-in load; sub-nav switches active kind; save round-trip
  (enter values → save → reload → values persist); append-only (two saves create
  two rows, latest wins on prefill); partial save (some blank fields OK). Reuse
  the admin-`createUser` test-user pattern from existing auth tests; read
  `.env.local` manually (project convention, no dotenv).

## Out of scope (V1)

- Unit toggle (in/cm) — deferred; fixed labelled units for now.
- Measurement history browser — only the latest snapshot is shown/edited (the
  `v_latest_*` views). History rows accumulate but aren't surfaced.
- Per-field diagrams / illustrations — hints are text only.
- PDP / checkout inline measurement capture.
- Tailor-side / admin measurement entry (Phase 5 operations).

## Acceptance criteria

1. `/measurements.html` renders all four kinds' forms from `MEASUREMENT_SCHEMA`,
   sub-nav switches between them, and the page is `requireAuth`-gated.
2. Each form prefills from the customer's latest saved values and saves a fresh
   snapshot; latest values survive a reload.
3. Partial (some-fields-blank) saves succeed; blank is never an error.
4. `account.html` measurement stubs are enabled links into the new page. (Footer
   is intentionally unchanged — see §5.)
5. `test-measurement-schema.mjs` and `test-measurements-page.mjs` pass; the
   updated 14-page CSP sweep passes; the full existing regression suite stays
   green.
6. PROJECT.md updated with the shipped inventory; committed to a
   `phase-2/measurements-capture` branch and merged to main per the finishing
   skill.
