# Phase 5 — Internal Staff CRM (Sub-project A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A staff-only website CRM to search/view/manage online customers (orders, payments, measurements, notes, tags, lightweight metrics), built on additive staff-read RLS, with a minimal POS integration seam.

**Architecture:** Additive RLS — an `is_staff()` SECURITY DEFINER helper + staff `SELECT` policies added alongside the existing owner-only policies (RLS SELECT policies OR-combine, so customers are unaffected). Two `requireStaff`-gated static pages use the existing browser Supabase client. A minimal seam (`pos_customer_id`/`source`/`last_synced_at`) links to the future central POS; the connector itself is out of scope.

**Tech Stack:** Supabase Postgres (RLS + SQL functions), static HTML + vanilla ES modules (browser `@supabase/supabase-js` from esm.sh), `scripts/run-sql.mjs` for migrations, puppeteer + Node tests. No build step. CSP `script-src 'self'` (all page scripts externalized).

**Design doc:** `docs/superpowers/specs/2026-07-15-phase-5-staff-crm-design.md`

**Prereq for testing:** dev server running — `node serve.mjs` (port 3000). Don't start a second instance if already up.

**Reference facts (verified against the codebase):**
- `profiles` columns: `id uuid pk → auth.users`, `email text not null`, `full_name text`, `phone text`, `role text not null default 'customer' check (role in ('customer','staff','admin'))`, `opted_in_newsletter bool`, `marketing_consent_at timestamptz`, `created_at`, `updated_at`. Owner-only policies: `profiles_owner_select` / `profiles_owner_update`.
- `orders`: `id uuid pk`, `user_id uuid → profiles`, `status` in `('pending','paid','failed','canceled')`, `total_thb integer`, `items jsonb`, `created_at`. Policy `orders_select_own` (`auth.uid() = user_id`).
- `payments`: `id uuid pk`, `order_id → orders`, `amount_thb`, `status`, `created_at`. Policy `payments_select_own` (join to orders).
- Measurement tables: `customer_body_measurements`, `customer_jacket_reference`, `customer_shirt_reference`, `customer_pants_reference` — each `owner_{select,insert,update,delete}`; views `v_latest_body_measurements` / `v_latest_jacket_reference` / `v_latest_shirt_reference` / `v_latest_pants_reference` (security_invoker).
- RLS policy syntax in this repo: `create policy "name" on public.tbl for select to authenticated using (<expr>);`
- Node tests read `.env.local` manually; seed users via `admin = createClient(URL, SVC, {auth:{persistSession:false}})` and `admin.auth.admin.createUser({email, password, email_confirm:true})`; sign in with anon client. Test emails use `@test.countryroadfashions.com` (blocklist-safe). `step(name, ok, detail)` helper; `process.exit(failCount ? 1 : 0)`.
- Gated page pattern: an externalized `/js/<name>-page.js` module calls `await requireAuth({redirectTo:'/login.html'})` at the top; the HTML carries `<meta name="robots" content="noindex, nofollow" />`, `data-layout` header/footer slots, and `<script type="module" src="/js/layout.js|auth.js|<name>-page.js">`.
- `js/auth.js` exports include `getSession`, `getUser`, `getSupabase`, `requireAuth`, `requireGuest`. `getSupabase()` returns the browser client.
- CSP test `scripts/test-csp-compliance.mjs` has a `const PAGES = [ … ]` array (currently 14 entries).

---

## Task 1: DB access layer — is_staff(), staff-read policies, POS seam, notes/tags

**Files:**
- Create: `db/14_staff_crm.sql`
- Create (test): `scripts/test-admin-rls.mjs`

- [ ] **Step 1: Write the failing test**

Create `scripts/test-admin-rls.mjs`:

```js
// Phase 5 staff CRM: staff can read every customer's data + write notes/tags;
// a normal customer stays isolated (owner-only) and cannot touch notes/tags;
// anon is locked out. Mirrors test-rls-audit.mjs rigor (non-vacuous readbacks).
// Run twice to confirm idempotency (unique emails + teardown).
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8')
    .split('\n').filter(Boolean)
    .map(l => l.split('=').map(s => s.trim()))
    .map(([k, ...v]) => [k, v.join('=')])
);
const URL = env.SUPABASE_URL, ANON = env.SUPABASE_ANON_KEY, SVC = env.SUPABASE_SERVICE_ROLE_KEY;
const admin = createClient(URL, SVC, { auth: { persistSession: false } });

let failCount = 0;
function step(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? '  (' + detail + ')' : ''}`);
  if (!ok) failCount++;
}
const rows = (res) => res.data?.length ?? 0;

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const pw = 'Test-Pass-123!';
const emailStaff = `admin-rls-staff-${stamp}@test.countryroadfashions.com`;
const emailA = `admin-rls-a-${stamp}@test.countryroadfashions.com`;
const emailB = `admin-rls-b-${stamp}@test.countryroadfashions.com`;

async function mkUser(email, role) {
  const { data, error } = await admin.auth.admin.createUser({ email, password: pw, email_confirm: true });
  if (error) throw error;
  const id = data.user.id;
  if (role !== 'customer') {
    const { error: ue } = await admin.from('profiles').update({ role }).eq('id', id);
    if (ue) throw ue;
  }
  return id;
}
async function signIn(email) {
  const c = createClient(URL, ANON, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password: pw });
  if (error) throw error;
  return c;
}

const idStaff = await mkUser(emailStaff, 'staff');
const idA = await mkUser(emailA, 'customer');
const idB = await mkUser(emailB, 'customer');

// Seed an order for A (service_role bypasses RLS) so staff-read has something to see.
const { error: oe } = await admin.from('orders').insert({
  user_id: idA, status: 'paid', currency: 'thb', total_thb: 20000, items: [],
});
if (oe) throw oe;
// Seed a body measurement for A. (measurement tables key on customer_id.)
const { error: me } = await admin.from('customer_body_measurements').insert({ customer_id: idA });
if (me) console.log('  (note: body measurement seed skipped:', me.message, ')');

const staff = await signIn(emailStaff);
const custA = await signIn(emailA);
const anon  = createClient(URL, ANON, { auth: { persistSession: false } });

// --- staff can read across customers ---
step('staff reads A profile', rows(await staff.from('profiles').select('id').eq('id', idA)) === 1);
step('staff reads B profile', rows(await staff.from('profiles').select('id').eq('id', idB)) === 1);
step('staff reads A orders',  rows(await staff.from('orders').select('id').eq('user_id', idA)) >= 1);
const staffMeas = await staff.from('customer_body_measurements').select('id').eq('customer_id', idA);
step('staff reads A measurements (no RLS error)', !staffMeas.error, staffMeas.error?.message);

// --- staff notes + tags write/readback ---
const noteIns = await staff.from('customer_notes')
  .insert({ customer_id: idA, author_id: idStaff, body: 'VIP — wedding party' }).select();
step('staff inserts note (author=self)', !noteIns.error && rows(noteIns) === 1, noteIns.error?.message);
step('staff reads note back', rows(await staff.from('customer_notes').select('id').eq('customer_id', idA)) === 1);
const tagIns = await staff.from('customer_tags')
  .insert({ customer_id: idA, author_id: idStaff, tag: 'vip' }).select();
step('staff inserts tag', !tagIns.error && rows(tagIns) === 1, tagIns.error?.message);
step('staff reads tag back', rows(await staff.from('customer_tags').select('tag').eq('customer_id', idA)) === 1);

// --- customer A stays isolated ---
step('customer A cannot read B profile', rows(await custA.from('profiles').select('id').eq('id', idB)) === 0);
step('customer A cannot read notes', rows(await custA.from('customer_notes').select('id').eq('customer_id', idA)) === 0);
const custNote = await custA.from('customer_notes')
  .insert({ customer_id: idA, author_id: idA, body: 'x' }).select();
step('customer A cannot write notes', !!custNote.error || rows(custNote) === 0);
step('customer A can still read own profile', rows(await custA.from('profiles').select('id').eq('id', idA)) === 1);

// --- anon locked out ---
step('anon cannot read profiles', rows(await anon.from('profiles').select('id').eq('id', idA)) === 0);
step('anon cannot read notes', rows(await anon.from('customer_notes').select('id')) === 0);

// teardown
for (const id of [idStaff, idA, idB]) await admin.auth.admin.deleteUser(id);
console.log(failCount ? `\nFAIL — ${failCount} check(s)` : '\nPASS — all checks');
process.exit(failCount ? 1 : 0);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node scripts/test-admin-rls.mjs`
Expected: FAIL — "staff reads A profile" and the notes/tags checks fail (no staff policies, no `customer_notes`/`customer_tags` tables yet).

- [ ] **Step 3: Write the migration**

Create `db/14_staff_crm.sql`:

```sql
-- Phase 5 — internal staff CRM (sub-project A).
-- Additive staff-read RLS (owner-only policies stay; SELECT policies OR-combine),
-- POS integration seam on profiles, and staff-only notes + tags.
-- Idempotent + transaction-wrapped. Apply via: node scripts/run-sql.mjs db/14_staff_crm.sql
begin;

-- 1. is_staff(): SECURITY DEFINER so it reads the caller's own role WITHOUT
--    tripping RLS recursion on profiles. search_path pinned for safety.
create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('staff','admin')
  );
$$;
revoke all on function public.is_staff() from public;
grant execute on function public.is_staff() to authenticated;

-- 2. Staff-read policies (additive; owner-only policies remain untouched).
drop policy if exists "profiles_staff_select" on public.profiles;
create policy "profiles_staff_select" on public.profiles
  for select to authenticated using (public.is_staff());

drop policy if exists "orders_staff_select" on public.orders;
create policy "orders_staff_select" on public.orders
  for select to authenticated using (public.is_staff());

drop policy if exists "payments_staff_select" on public.payments;
create policy "payments_staff_select" on public.payments
  for select to authenticated using (public.is_staff());

drop policy if exists "cbm_staff_select" on public.customer_body_measurements;
create policy "cbm_staff_select" on public.customer_body_measurements
  for select to authenticated using (public.is_staff());
drop policy if exists "cjr_staff_select" on public.customer_jacket_reference;
create policy "cjr_staff_select" on public.customer_jacket_reference
  for select to authenticated using (public.is_staff());
drop policy if exists "csr_staff_select" on public.customer_shirt_reference;
create policy "csr_staff_select" on public.customer_shirt_reference
  for select to authenticated using (public.is_staff());
drop policy if exists "cpr_staff_select" on public.customer_pants_reference;
create policy "cpr_staff_select" on public.customer_pants_reference
  for select to authenticated using (public.is_staff());

-- 3. POS integration seam on profiles (bridge to the future central POS).
alter table public.profiles add column if not exists pos_customer_id text unique;
alter table public.profiles add column if not exists source text not null default 'website'
  check (source in ('website','pos','manual','import'));
alter table public.profiles add column if not exists last_synced_at timestamptz;

-- 4. Staff notes (richer than the POS single-text field; connector ingests POS notes as source='pos').
create table if not exists public.customer_notes (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles(id) on delete cascade,
  author_id   uuid references public.profiles(id) on delete set null,
  body        text not null,
  source      text not null default 'website' check (source in ('website','pos','manual','import')),
  created_at  timestamptz not null default now()
);
create index if not exists customer_notes_customer_idx on public.customer_notes (customer_id, created_at desc);
alter table public.customer_notes enable row level security;
drop policy if exists "customer_notes_staff_select" on public.customer_notes;
create policy "customer_notes_staff_select" on public.customer_notes
  for select to authenticated using (public.is_staff());
drop policy if exists "customer_notes_staff_insert" on public.customer_notes;
create policy "customer_notes_staff_insert" on public.customer_notes
  for insert to authenticated with check (public.is_staff() and author_id = auth.uid());

-- 5. Staff tags (freeform, no catalog in V1).
create table if not exists public.customer_tags (
  customer_id uuid not null references public.profiles(id) on delete cascade,
  tag         text not null check (char_length(tag) between 1 and 40),
  author_id   uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  primary key (customer_id, tag)
);
alter table public.customer_tags enable row level security;
drop policy if exists "customer_tags_staff_select" on public.customer_tags;
create policy "customer_tags_staff_select" on public.customer_tags
  for select to authenticated using (public.is_staff());
drop policy if exists "customer_tags_staff_insert" on public.customer_tags;
create policy "customer_tags_staff_insert" on public.customer_tags
  for insert to authenticated with check (public.is_staff() and author_id = auth.uid());
drop policy if exists "customer_tags_staff_delete" on public.customer_tags;
create policy "customer_tags_staff_delete" on public.customer_tags
  for delete to authenticated using (public.is_staff());

commit;
```

- [ ] **Step 4: Apply the migration**

Run: `node scripts/run-sql.mjs db/14_staff_crm.sql`
Expected: statements succeed, transaction commits, no errors.

- [ ] **Step 5: Run the test to verify it passes**

Run: `node scripts/test-admin-rls.mjs`
Expected: `PASS — all checks`. Run it a second time to confirm idempotency (fresh emails, teardown) — still PASS.

- [ ] **Step 6: Commit**

```bash
git add db/14_staff_crm.sql scripts/test-admin-rls.mjs
git commit -m "feat(crm): staff-read RLS + is_staff() + POS seam + customer notes/tags"
```

---

## Task 2: crm_metrics() RPC + test

**Files:**
- Create: `db/15_crm_metrics.sql`
- Create (test): `scripts/test-crm-metrics.mjs`

- [ ] **Step 1: Write the failing test**

Create `scripts/test-crm-metrics.mjs`:

```js
// Phase 5: crm_metrics() returns aggregate tiles + by-month series to STAFF only.
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8').split('\n').filter(Boolean)
    .map(l => l.split('=').map(s => s.trim())).map(([k, ...v]) => [k, v.join('=')])
);
const URL = env.SUPABASE_URL, ANON = env.SUPABASE_ANON_KEY, SVC = env.SUPABASE_SERVICE_ROLE_KEY;
const admin = createClient(URL, SVC, { auth: { persistSession: false } });
let failCount = 0;
const step = (n, ok, d = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} — ${n}${d ? '  (' + d + ')' : ''}`); if (!ok) failCount++; };
const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, pw = 'Test-Pass-123!';
const emailStaff = `crm-metrics-staff-${stamp}@test.countryroadfashions.com`;
const emailCust = `crm-metrics-cust-${stamp}@test.countryroadfashions.com`;
async function mkUser(email, role) {
  const { data, error } = await admin.auth.admin.createUser({ email, password: pw, email_confirm: true });
  if (error) throw error;
  if (role !== 'customer') await admin.from('profiles').update({ role }).eq('id', data.user.id);
  return data.user.id;
}
async function signIn(email) {
  const c = createClient(URL, ANON, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password: pw });
  if (error) throw error; return c;
}
const idStaff = await mkUser(emailStaff, 'staff');
const idCust = await mkUser(emailCust, 'customer');
await admin.from('orders').insert({ user_id: idCust, status: 'paid', currency: 'thb', total_thb: 15000, items: [] });

const staff = await signIn(emailStaff);
const cust = await signIn(emailCust);

const asStaff = await staff.rpc('crm_metrics');
step('staff gets metrics object', !asStaff.error && asStaff.data && typeof asStaff.data === 'object', asStaff.error?.message);
step('metrics has total_customers', typeof asStaff.data?.total_customers === 'number');
step('metrics has revenue_thb', typeof asStaff.data?.revenue_thb === 'number');
step('metrics has by_month array', Array.isArray(asStaff.data?.by_month));

const asCust = await cust.rpc('crm_metrics');
step('customer is blocked from metrics', !!asCust.error, asCust.error ? 'errored as expected' : 'LEAK');

for (const id of [idStaff, idCust]) await admin.auth.admin.deleteUser(id);
console.log(failCount ? `\nFAIL — ${failCount} check(s)` : '\nPASS — all checks');
process.exit(failCount ? 1 : 0);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node scripts/test-crm-metrics.mjs`
Expected: FAIL — "staff gets metrics object" (function `crm_metrics` does not exist).

- [ ] **Step 3: Write the migration**

Create `db/15_crm_metrics.sql`:

```sql
-- Phase 5 — staff CRM lightweight metrics. Staff-only aggregate tiles + 12-month series.
begin;
create or replace function public.crm_metrics()
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result json;
begin
  if not public.is_staff() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select json_build_object(
    'total_customers', (select count(*) from public.profiles where role = 'customer'),
    'new_this_month',  (select count(*) from public.profiles
                          where role = 'customer' and created_at >= date_trunc('month', now())),
    'paid_orders',     (select count(*) from public.orders where status = 'paid'),
    'revenue_thb',     (select coalesce(sum(total_thb), 0) from public.orders where status = 'paid'),
    'aov_thb',         (select case when count(*) = 0 then 0
                          else round(coalesce(sum(total_thb),0)::numeric / count(*)) end
                          from public.orders where status = 'paid'),
    'by_month', (
      select coalesce(json_agg(row_to_json(m) order by m.month), '[]'::json)
      from (
        select to_char(d.month, 'YYYY-MM') as month,
          (select count(*) from public.profiles p
             where p.role = 'customer' and date_trunc('month', p.created_at) = d.month) as new_customers,
          (select coalesce(sum(o.total_thb),0) from public.orders o
             where o.status = 'paid' and date_trunc('month', o.created_at) = d.month) as revenue_thb
        from generate_series(date_trunc('month', now()) - interval '11 months',
                             date_trunc('month', now()), interval '1 month') as d(month)
      ) m
    )
  ) into result;
  return result;
end;
$$;
revoke all on function public.crm_metrics() from public;
grant execute on function public.crm_metrics() to authenticated;
commit;
```

- [ ] **Step 4: Apply the migration**

Run: `node scripts/run-sql.mjs db/15_crm_metrics.sql`
Expected: commits with no errors.

- [ ] **Step 5: Run the test to verify it passes**

Run: `node scripts/test-crm-metrics.mjs`
Expected: `PASS — all checks`.

- [ ] **Step 6: Commit**

```bash
git add db/15_crm_metrics.sql scripts/test-crm-metrics.mjs
git commit -m "feat(crm): staff-only crm_metrics() RPC — aggregate tiles + 12-month series"
```

---

## Task 3: requireStaff() gate in auth.js

**Files:**
- Modify: `js/auth.js` (add export after `requireGuest`)

- [ ] **Step 1: Add `requireStaff()`**

In `js/auth.js`, immediately after the `requireGuest` function, add:

```js
export async function requireStaff({ redirectTo = '/login.html', denyTo = '/' } = {}) {
  const session = await getSession();
  if (!session) {
    const next = encodeURIComponent(location.pathname + location.search);
    location.replace(`${redirectTo}?next=${next}`);
    return null;
  }
  const { data, error } = await getSupabase()
    .from('profiles').select('role').eq('id', session.user.id).single();
  if (error || !data || !['staff', 'admin'].includes(data.role)) {
    location.replace(denyTo);
    return null;
  }
  return session;
}
```

- [ ] **Step 2: Sanity-check the module still parses**

Run: `node --input-type=module -e "import('./js/auth.js').catch(e=>{if(String(e).includes('window')||String(e).includes('location')||String(e).includes('esm.sh')||String(e).includes('fetch')){console.log('OK (browser-only deps, expected)');process.exit(0)}console.error(e);process.exit(1)})"`
Expected: prints `OK (browser-only deps, expected)` OR a browser-API/network error (auth.js imports supabase from esm.sh and touches `window`; a syntax error would look different). The real gate test is Task 6's puppeteer run.

- [ ] **Step 3: Commit**

```bash
git add js/auth.js
git commit -m "feat(auth): add requireStaff() gate (session + staff/admin role check)"
```

---

## Task 4: js/crm.js staff data layer

**Files:**
- Create: `js/crm.js`

This module wraps every staff query so the page controllers stay thin. It uses the existing browser client via `getSupabase()` from `js/auth.js`.

- [ ] **Step 1: Create `js/crm.js`**

```js
// Phase 5 — staff CRM data layer. All reads rely on the additive staff-read
// RLS policies (db/14); non-staff callers get empty/blocked results.
import { getSupabase } from '/js/auth.js';

const db = () => getSupabase();

// Dashboard aggregates (staff-only RPC; throws for non-staff).
export async function getMetrics() {
  const { data, error } = await db().rpc('crm_metrics');
  if (error) throw error;
  return data;
}

// Paginated + searchable customer list. Searches name/email/phone.
export async function listCustomers({ q = '', limit = 25, offset = 0 } = {}) {
  let query = db()
    .from('profiles')
    .select('id, full_name, email, phone, created_at, source, pos_customer_id', { count: 'exact' })
    .eq('role', 'customer')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  const term = q.trim();
  if (term) {
    const like = `%${term.replace(/[%_]/g, '')}%`;
    query = query.or(`full_name.ilike.${like},email.ilike.${like},phone.ilike.${like}`);
  }
  const { data, error, count } = await query;
  if (error) throw error;
  return { customers: data || [], total: count || 0 };
}

// One customer's full record.
export async function getCustomer(id) {
  const [{ data: profile }, orders, payments, tags, notes] = await Promise.all([
    db().from('profiles').select('*').eq('id', id).single(),
    db().from('orders').select('id, status, total_thb, currency, created_at, items').eq('user_id', id).order('created_at', { ascending: false }),
    db().from('payments').select('id, order_id, amount_thb, status, created_at').order('created_at', { ascending: false }),
    db().from('customer_tags').select('tag, created_at').eq('customer_id', id).order('created_at', { ascending: false }),
    db().from('customer_notes').select('id, body, author_id, created_at').eq('customer_id', id).order('created_at', { ascending: false }),
  ]);
  const measurements = await getLatestMeasurements(id);
  return {
    profile,
    orders: orders.data || [],
    payments: payments.data || [],
    tags: (tags.data || []).map(t => t.tag),
    notes: notes.data || [],
    measurements,
  };
}

async function getLatestMeasurements(id) {
  const views = {
    body:   'v_latest_body_measurements',
    jacket: 'v_latest_jacket_reference',
    shirt:  'v_latest_shirt_reference',
    pants:  'v_latest_pants_reference',
  };
  const out = {};
  await Promise.all(Object.entries(views).map(async ([kind, view]) => {
    const { data } = await db().from(view).select('*').eq('customer_id', id).maybeSingle();
    out[kind] = data || null;
  }));
  return out;
}

export async function addNote(customerId, body) {
  const { data: userRes } = await db().auth.getUser();
  const author_id = userRes?.user?.id;
  const { data, error } = await db().from('customer_notes')
    .insert({ customer_id: customerId, author_id, body }).select().single();
  if (error) throw error;
  return data;
}

export async function addTag(customerId, tag) {
  const { data: userRes } = await db().auth.getUser();
  const author_id = userRes?.user?.id;
  const clean = tag.trim().slice(0, 40);
  const { data, error } = await db().from('customer_tags')
    .insert({ customer_id: customerId, author_id, tag: clean }).select().single();
  if (error) throw error;
  return data;
}

export async function removeTag(customerId, tag) {
  const { error } = await db().from('customer_tags').delete().eq('customer_id', customerId).eq('tag', tag);
  if (error) throw error;
}
```

- [ ] **Step 2: Commit**

```bash
git add js/crm.js
git commit -m "feat(crm): js/crm.js staff data layer (customers, detail, notes, tags, metrics)"
```

(Behavior is exercised end-to-end by Task 6's puppeteer test.)

---

## Task 5: admin-customers.html — CRM home (metrics + customer table)

**Files:**
- Create: `admin-customers.html`
- Create: `js/admin-customers-page.js`

> **UI craft:** invoke the `frontend-design` skill before writing markup, and the `dataviz` skill for the trend chart. Use `css/base.css` tokens + `.btn--*`; dark header; NO default Tailwind palette; theme-consistent. The code below is the functional skeleton — apply the house style on top, don't regress it.

- [ ] **Step 1: Create `admin-customers.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<!-- CSP: script-src is 'self'-only (all inline scripts externalized to js/*). style-src keeps 'unsafe-inline' — many inline <style> blocks, no build step. Rationale: docs/superpowers/specs/2026-07-14-csp-rls-hardening-design.md -->
<meta http-equiv="Content-Security-Policy" content="
  default-src 'self';
  script-src 'self' https://esm.sh https://assets.calendly.com;
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
<meta name="robots" content="noindex, nofollow" />
<title>Customers — CRF Staff</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400;1,500&family=Raleway:wght@200;300;400;500;600;700;800&display=swap" rel="stylesheet" />
<link rel="stylesheet" href="/css/base.css" />
<script type="module" src="/js/layout.js"></script>
<script type="module" src="/js/search-overlay.js"></script>
<script type="module" src="/js/auth.js"></script>
<style>
  .crm-wrap { max-width: 1200px; margin: 0 auto; padding: 2rem 1.25rem 4rem; }
  .crm-metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 1rem; margin-bottom: 2rem; }
  .crm-tile { background: var(--color-off-white); border: 1px solid rgba(14,15,17,.08); border-radius: 10px; padding: 1rem 1.1rem; }
  .crm-tile .n { font-family: var(--font-display, 'Cormorant Garamond', serif); font-size: 1.9rem; line-height: 1.1; }
  .crm-tile .l { font-size: .72rem; letter-spacing: .08em; text-transform: uppercase; color: var(--color-grey-mid, #6b6b6b); margin-top: .25rem; }
  .crm-search { width: 100%; max-width: 420px; margin-bottom: 1rem; }
  .crm-table { width: 100%; border-collapse: collapse; font-size: .9rem; }
  .crm-table th, .crm-table td { text-align: left; padding: .6rem .5rem; border-bottom: 1px solid rgba(14,15,17,.07); }
  .crm-table tbody tr { cursor: pointer; }
  .crm-table tbody tr:hover { background: var(--color-off-white); }
  .crm-chart { margin-bottom: 2rem; }
</style>
</head>
<body>
<div data-layout="header" style="min-height:72px;background:var(--color-jet);"></div>
<main class="crm-wrap">
  <h1 class="crm-title">Customers</h1>
  <div class="crm-metrics" id="metrics"></div>
  <div class="crm-chart" id="chart"></div>
  <input class="input crm-search" id="search" type="search" placeholder="Search name, email, or phone…" autocomplete="off" />
  <div id="tableWrap"></div>
</main>
<div data-layout="footer"></div>
<script type="module" src="/js/admin-customers-page.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create `js/admin-customers-page.js`**

```js
import { requireStaff } from '/js/auth.js';
import { getMetrics, listCustomers } from '/js/crm.js';

await requireStaff();

const fmtTHB = (n) => 'THB ' + (Number(n) || 0).toLocaleString('en-US');
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// --- metrics tiles ---
try {
  const m = await getMetrics();
  document.getElementById('metrics').innerHTML = [
    ['Total customers', m.total_customers],
    ['New this month', m.new_this_month],
    ['Paid orders', m.paid_orders],
    ['Revenue', fmtTHB(m.revenue_thb)],
    ['Avg order value', fmtTHB(m.aov_thb)],
  ].map(([l, n]) => `<div class="crm-tile"><div class="n">${esc(n)}</div><div class="l">${esc(l)}</div></div>`).join('');
  renderChart(m.by_month || []);
} catch (e) { console.error(e); document.getElementById('metrics').textContent = 'Metrics unavailable.'; }

// --- simple by-month trend (inline SVG bars; dataviz skill refines palette/craft) ---
function renderChart(series) {
  if (!series.length) return;
  const w = 640, h = 140, pad = 24, max = Math.max(1, ...series.map(s => s.new_customers));
  const bw = (w - pad * 2) / series.length;
  const bars = series.map((s, i) => {
    const bh = Math.round((s.new_customers / max) * (h - pad * 2));
    const x = pad + i * bw, y = h - pad - bh;
    return `<rect x="${x + 3}" y="${y}" width="${bw - 6}" height="${bh}" rx="2" fill="var(--color-stone,#b6ada5)"><title>${esc(s.month)}: ${s.new_customers} new</title></rect>`;
  }).join('');
  document.getElementById('chart').innerHTML =
    `<p class="crm-tile-l" style="font-size:.72rem;letter-spacing:.08em;text-transform:uppercase;color:var(--color-grey-mid,#6b6b6b);margin-bottom:.4rem">New customers · last 12 months</p>` +
    `<svg viewBox="0 0 ${w} ${h}" width="100%" role="img" aria-label="New customers per month, last 12 months">${bars}</svg>`;
}

// --- searchable customer table (debounce + stale-response generation guard) ---
const searchEl = document.getElementById('search');
const wrap = document.getElementById('tableWrap');
let gen = 0, timer = null;

async function load(q) {
  const my = ++gen;
  const { customers, total } = await listCustomers({ q });
  if (my !== gen) return; // stale
  wrap.innerHTML = `
    <p style="font-size:.8rem;color:var(--color-grey-mid,#6b6b6b);margin:.25rem 0 .5rem">${total} customer${total === 1 ? '' : 's'}</p>
    <table class="crm-table">
      <thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Joined</th><th>Source</th></tr></thead>
      <tbody>
        ${customers.map(c => `
          <tr data-id="${esc(c.id)}">
            <td>${esc(c.full_name || '—')}</td>
            <td>${esc(c.email || '')}</td>
            <td>${esc(c.phone || '—')}</td>
            <td>${esc((c.created_at || '').slice(0, 10))}</td>
            <td>${esc(c.source || 'website')}</td>
          </tr>`).join('') || `<tr><td colspan="5">No customers found.</td></tr>`}
      </tbody>
    </table>`;
  wrap.querySelectorAll('tr[data-id]').forEach(tr => {
    tr.addEventListener('click', () => { location.href = `/admin-customer.html?id=${encodeURIComponent(tr.getAttribute('data-id'))}`; });
  });
}

searchEl.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => load(searchEl.value), 220); });
await load('');
```

- [ ] **Step 3: Manual smoke** (needs a staff user — Task 6's test creates one; for a quick check, temporarily set your own test account to `role='staff'` via `run-sql`, or just proceed — Task 6 covers it). Load `http://localhost:3000/admin-customers.html` while signed in as staff: tiles render, chart shows, table lists customers, typing filters.

- [ ] **Step 4: Commit**

```bash
git add admin-customers.html js/admin-customers-page.js
git commit -m "feat(crm): admin-customers page — metrics strip, trend chart, searchable customer table"
```

---

## Task 6: admin-customer.html — detail page + puppeteer e2e + robots + CSP

**Files:**
- Create: `admin-customer.html`
- Create: `js/admin-customer-page.js`
- Create (test): `scripts/test-admin-pages.mjs`
- Modify: `robots.txt`
- Modify: `scripts/test-csp-compliance.mjs`

> **UI craft:** same as Task 5 — `frontend-design` skill, `css/base.css` tokens, dark header.

- [ ] **Step 1: Create `admin-customer.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<!-- CSP: script-src is 'self'-only (all inline scripts externalized to js/*). style-src keeps 'unsafe-inline' — many inline <style> blocks, no build step. Rationale: docs/superpowers/specs/2026-07-14-csp-rls-hardening-design.md -->
<meta http-equiv="Content-Security-Policy" content="
  default-src 'self';
  script-src 'self' https://esm.sh https://assets.calendly.com;
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
<meta name="robots" content="noindex, nofollow" />
<title>Customer — CRF Staff</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400;1,500&family=Raleway:wght@200;300;400;500;600;700;800&display=swap" rel="stylesheet" />
<link rel="stylesheet" href="/css/base.css" />
<script type="module" src="/js/layout.js"></script>
<script type="module" src="/js/search-overlay.js"></script>
<script type="module" src="/js/auth.js"></script>
<style>
  .cd-wrap { max-width: 960px; margin: 0 auto; padding: 2rem 1.25rem 4rem; }
  .cd-section { margin: 1.75rem 0; }
  .cd-section h2 { font-size: .78rem; letter-spacing: .1em; text-transform: uppercase; color: var(--color-grey-mid,#6b6b6b); margin-bottom: .6rem; }
  .cd-row { display: flex; gap: 1rem; padding: .35rem 0; border-bottom: 1px solid rgba(14,15,17,.06); }
  .cd-row .k { width: 160px; color: var(--color-grey-mid,#6b6b6b); font-size: .85rem; }
  .cd-tags { display: flex; flex-wrap: wrap; gap: .4rem; }
  .cd-tag { background: var(--color-off-white); border: 1px solid rgba(14,15,17,.12); border-radius: 999px; padding: .2rem .6rem; font-size: .8rem; }
  .cd-tag button { background: none; border: none; cursor: pointer; margin-left: .3rem; }
  .cd-note { padding: .5rem 0; border-bottom: 1px solid rgba(14,15,17,.06); font-size: .9rem; }
  .cd-note .meta { font-size: .72rem; color: var(--color-grey-mid,#6b6b6b); }
</style>
</head>
<body>
<div data-layout="header" style="min-height:72px;background:var(--color-jet);"></div>
<main class="cd-wrap">
  <p><a href="/admin-customers.html">← All customers</a></p>
  <h1 id="cdName">Customer</h1>
  <div id="cdBody"></div>
</main>
<div data-layout="footer"></div>
<script type="module" src="/js/admin-customer-page.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create `js/admin-customer-page.js`**

```js
import { requireStaff } from '/js/auth.js';
import { getCustomer, addNote, addTag, removeTag } from '/js/crm.js';

await requireStaff();

const fmtTHB = (n) => 'THB ' + (Number(n) || 0).toLocaleString('en-US');
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const id = new URLSearchParams(location.search).get('id');
const body = document.getElementById('cdBody');

if (!id) { body.textContent = 'No customer id.'; }
else { await render(); }

async function render() {
  let data;
  try { data = await getCustomer(id); }
  catch (e) { console.error(e); body.textContent = 'Unable to load this customer.'; return; }
  const p = data.profile || {};
  const orderIds = new Set(data.orders.map(o => o.id));
  const payments = data.payments.filter(pm => orderIds.has(pm.order_id)); // owner-join already scopes, this is display-tidy
  document.getElementById('cdName').textContent = p.full_name || p.email || 'Customer';

  body.innerHTML = `
    <section class="cd-section">
      <h2>Contact</h2>
      ${row('Email', p.email)}
      ${row('Phone', p.phone || '—')}
      ${row('Newsletter', p.opted_in_newsletter ? 'Opted in' : 'No')}
      ${row('Source', p.source || 'website')}
      ${row('POS id', p.pos_customer_id || '— (not yet linked)')}
      ${row('Joined', (p.created_at || '').slice(0, 10))}
    </section>

    <section class="cd-section">
      <h2>Tags</h2>
      <div class="cd-tags" id="tags">${data.tags.map(tagChip).join('') || '<span style="color:var(--color-grey-mid,#6b6b6b)">No tags</span>'}</div>
      <form id="tagForm" style="margin-top:.6rem;display:flex;gap:.5rem">
        <input class="input" id="tagInput" placeholder="Add tag…" maxlength="40" autocomplete="off" />
        <button class="btn btn--ghost" type="submit">Add</button>
      </form>
    </section>

    <section class="cd-section">
      <h2>Orders</h2>
      ${data.orders.length ? data.orders.map(o => `
        <div class="cd-row"><span class="k">${esc((o.created_at || '').slice(0,10))}</span>
        <span>${esc(o.status)} · ${esc(fmtTHB(o.total_thb))}</span></div>`).join('') : '<p style="color:var(--color-grey-mid,#6b6b6b)">No orders.</p>'}
    </section>

    <section class="cd-section">
      <h2>Payments</h2>
      ${payments.length ? payments.map(pm => `
        <div class="cd-row"><span class="k">${esc((pm.created_at || '').slice(0,10))}</span>
        <span>${esc(pm.status)} · ${esc(fmtTHB(pm.amount_thb))}</span></div>`).join('') : '<p style="color:var(--color-grey-mid,#6b6b6b)">No payments.</p>'}
    </section>

    <section class="cd-section">
      <h2>Measurements</h2>
      ${['body','jacket','shirt','pants'].map(k => `<div class="cd-row"><span class="k">${k}</span><span>${data.measurements[k] ? 'On file' : '—'}</span></div>`).join('')}
    </section>

    <section class="cd-section">
      <h2>Notes</h2>
      <form id="noteForm" style="margin-bottom:.75rem">
        <textarea class="input" id="noteInput" rows="2" placeholder="Add a note…"></textarea>
        <button class="btn btn--ghost" type="submit" style="margin-top:.4rem">Add note</button>
      </form>
      <div id="notes">${data.notes.map(noteRow).join('') || '<p style="color:var(--color-grey-mid,#6b6b6b)">No notes.</p>'}</div>
    </section>
  `;

  document.getElementById('tagForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = document.getElementById('tagInput').value.trim();
    if (!v) return;
    try { await addTag(id, v); await render(); } catch (err) { console.error(err); }
  });
  document.querySelectorAll('[data-remove-tag]').forEach(b => b.addEventListener('click', async () => {
    try { await removeTag(id, b.getAttribute('data-remove-tag')); await render(); } catch (err) { console.error(err); }
  }));
  document.getElementById('noteForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = document.getElementById('noteInput').value.trim();
    if (!v) return;
    try { await addNote(id, v); await render(); } catch (err) { console.error(err); }
  });
}

function row(k, v) { return `<div class="cd-row"><span class="k">${esc(k)}</span><span>${esc(v)}</span></div>`; }
function tagChip(t) { return `<span class="cd-tag">${esc(t)}<button data-remove-tag="${esc(t)}" aria-label="Remove ${esc(t)}">×</button></span>`; }
function noteRow(n) { return `<div class="cd-note"><div>${esc(n.body)}</div><div class="meta">${esc((n.created_at || '').slice(0,16).replace('T',' '))}</div></div>`; }
```

- [ ] **Step 3: Add both admin pages to `robots.txt`**

In `robots.txt`, add after the existing `Disallow:` lines (before the blank line + `Sitemap:`):

```
Disallow: /admin-customers.html
Disallow: /admin-customer.html
```

- [ ] **Step 4: Add both pages to the CSP test**

In `scripts/test-csp-compliance.mjs`, add to the `PAGES` array (after `'/measurements.html'`):

```js
  '/admin-customers.html',
  '/admin-customer.html',
```

- [ ] **Step 5: Write the puppeteer e2e test**

Create `scripts/test-admin-pages.mjs`:

```js
// Phase 5 e2e: non-staff is bounced from admin pages; staff sees the list,
// search filters, detail loads, and a note + tag round-trip in the UI.
import puppeteer from 'puppeteer';
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8').split('\n').filter(Boolean)
    .map(l => l.split('=').map(s => s.trim())).map(([k, ...v]) => [k, v.join('=')])
);
const URL = env.SUPABASE_URL, ANON = env.SUPABASE_ANON_KEY, SVC = env.SUPABASE_SERVICE_ROLE_KEY;
const BASE = 'http://localhost:3000';
const admin = createClient(URL, SVC, { auth: { persistSession: false } });
let failCount = 0;
const step = (n, ok, d = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} — ${n}${d ? '  (' + d + ')' : ''}`); if (!ok) failCount++; };
const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, pw = 'Test-Pass-123!';
const staffEmail = `admin-pg-staff-${stamp}@test.countryroadfashions.com`;
const custEmail = `admin-pg-cust-${stamp}@test.countryroadfashions.com`;

async function mkUser(email, role) {
  const { data, error } = await admin.auth.admin.createUser({ email, password: pw, email_confirm: true });
  if (error) throw error;
  if (role !== 'customer') await admin.from('profiles').update({ role }).eq('id', data.user.id);
  return data.user.id;
}
const idStaff = await mkUser(staffEmail, 'staff');
const idCust = await mkUser(custEmail, 'customer');
await admin.from('profiles').update({ full_name: `Zed Test ${stamp}` }).eq('id', idCust);

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });

async function loginAs(page, email) {
  // Sign in via the browser client and persist the session the app reads.
  await page.goto(`${BASE}/login.html`, { waitUntil: 'networkidle0' });
  await page.evaluate(async (email, pw, URL, ANON) => {
    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
    const c = createClient(URL, ANON);
    await c.auth.signInWithPassword({ email, password: pw });
  }, email, pw, URL, ANON);
}

// 1. customer is bounced from admin-customers
{
  const page = await browser.newPage();
  await loginAs(page, custEmail);
  await page.goto(`${BASE}/admin-customers.html`, { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 800));
  step('customer bounced from admin-customers', !page.url().includes('admin-customers'), page.url());
  await page.close();
}

// 2. staff sees the list, can search, open detail, add note + tag
{
  const page = await browser.newPage();
  await loginAs(page, staffEmail);
  await page.goto(`${BASE}/admin-customers.html`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.crm-table', { timeout: 8000 });
  step('staff sees customer table', await page.$('.crm-table') !== null);
  await page.type('#search', `Zed Test ${stamp}`);
  await new Promise(r => setTimeout(r, 700));
  const rowCount = await page.$$eval('tr[data-id]', els => els.length);
  step('search filters to the seeded customer', rowCount >= 1, `rows=${rowCount}`);

  await page.goto(`${BASE}/admin-customer.html?id=${idCust}`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#tagForm', { timeout: 8000 });
  await page.type('#tagInput', 'vip');
  await page.click('#tagForm button[type=submit]');
  await new Promise(r => setTimeout(r, 700));
  step('tag added + shown', (await page.$$eval('.cd-tag', els => els.map(e => e.textContent))).some(t => t.includes('vip')));

  await page.type('#noteInput', 'Called about wedding suit');
  await page.click('#noteForm button[type=submit]');
  await new Promise(r => setTimeout(r, 700));
  step('note added + shown', (await page.$eval('#notes', el => el.textContent)).includes('wedding suit'));
  await page.close();
}

await browser.close();
for (const id of [idStaff, idCust]) await admin.auth.admin.deleteUser(id);
console.log(failCount ? `\nFAIL — ${failCount} check(s)` : '\nPASS — all checks');
process.exit(failCount ? 1 : 0);
```

- [ ] **Step 6: Run the e2e + CSP tests**

Run: `node scripts/test-admin-pages.mjs`
Expected: `PASS — all checks` (customer bounced; staff sees table, search filters, tag + note round-trip).
Run: `node scripts/test-csp-compliance.mjs`
Expected: all 16 pages clean, headers present.

If `loginAs` proves flaky (session not shared with the page's own client), fall back to signing in through the actual login form (`#email`/`#password` inputs + submit) — the app persists the session to localStorage, which the admin pages then read. Do NOT weaken the assertions.

- [ ] **Step 7: Commit**

```bash
git add admin-customer.html js/admin-customer-page.js scripts/test-admin-pages.mjs robots.txt scripts/test-csp-compliance.mjs
git commit -m "feat(crm): admin-customer detail page + notes/tags + e2e + robots/CSP coverage"
```

---

## Task 7: Bug-scan, regression, visual verification, docs

**Files:**
- Modify: `PROJECT.md`

- [ ] **Step 1: Deliberate bug-scan of the touched surface**

Per the standing request to hunt latent bugs each phase:
- Re-verify the additive RLS did not weaken customer isolation: run `node scripts/test-rls-audit.mjs` — MUST still pass (owner-only unaffected).
- Confirm `is_staff()` and `crm_metrics()` are `security definer` with `set search_path = public` (search_path injection guard). Grep: `grep -n "security definer\|search_path" db/14_staff_crm.sql db/15_crm_metrics.sql`.
- Confirm no admin page is reachable by a signed-out user or a customer (covered by test-admin-pages; eyeball the redirect in `requireStaff`).
- Confirm the `.or()` search term in `js/crm.js` strips `%`/`_` (it does) so a customer-supplied-looking term can't broaden the ilike unexpectedly.
- Log any bug that can't be fixed in-phase into `PROJECT.md` §7; fix quick ones inline (new commit).

- [ ] **Step 2: Run the full regression suite**

```bash
node scripts/test-admin-rls.mjs
node scripts/test-crm-metrics.mjs
node scripts/test-admin-pages.mjs
node scripts/test-rls-audit.mjs
node scripts/test-token-discipline.mjs
node scripts/test-layout-mount.mjs
node scripts/test-csp-compliance.mjs
```

Expected: all pass.

- [ ] **Step 3: Visual verification (2 rounds, 1440 + 375)**

Temporarily promote a known test account to staff (`update profiles set role='staff' where email='…'` via run-sql), sign in, then:
```bash
node screenshot.mjs "http://localhost:3000/admin-customers.html" admin-list
node screenshot.mjs "http://localhost:3000/admin-customer.html?id=<a real customer id>" admin-detail
```
`Read` the PNGs. Check: dark header consistent, tokens/typography match the site (Cormorant + Raleway), metric tiles + chart legible in light/dark, table readable, tags/notes forms clean. Fix mismatches, re-screenshot. ≥2 rounds. (Revert the temporary role change afterward if it was a real account.)

- [ ] **Step 4: Update PROJECT.md**

- Add `admin-customers.html` + `admin-customer.html` to the live-pages table (§2), noting `requireStaff` gate + `noindex`.
- Add `db/14_staff_crm.sql`, `db/15_crm_metrics.sql`, `js/crm.js`, the 2 admin pages/controllers, and the 3 new tests to the file-layout (§4) + Supabase schema (§3: new `customer_notes`/`customer_tags` tables, profiles seam columns, `is_staff()`/`crm_metrics()`).
- Backlog: mark #9 (CRM) V1 done + the "customers" half of #8; note POS connector + sub-project B deferred.
- Phasing table: Phase 5 — CRM sub-project A shipped.
- Update the top "Last session ended" banner.

- [ ] **Step 5: Commit**

```bash
git add PROJECT.md
git commit -m "docs(project): Phase 5 staff CRM (sub-project A) shipped"
```

---

## Done-when (stop conditions)

1. `db/14` + `db/15` applied; `test-admin-rls.mjs`, `test-crm-metrics.mjs` green (staff read across customers + notes/tags; customer isolated; anon blocked; metrics staff-only).
2. `test-rls-audit.mjs` STILL green (additive policies didn't weaken owner-only isolation).
3. `requireStaff()` gates both admin pages; non-staff bounced (`test-admin-pages.mjs`).
4. admin-customers (metrics + trend + searchable table) and admin-customer (contact/orders/payments/measurements/notes/tags) work end-to-end.
5. Full regression + 16-page CSP sweep green; robots.txt disallows both admin pages.
6. Visual verification done (≥2 rounds, 1440 + 375), house style applied.
7. Bug-scan complete; deferred bugs (if any) logged in PROJECT.md §7.
8. PROJECT.md updated; branch merged to main per `superpowers:finishing-a-development-branch`.
```
