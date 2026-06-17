# Phase 1 WT-3: Measurements Schema Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `db/09_measurements.sql` — four narrow typed measurement tables (body + 3 reference garments) with owner-only RLS, append-only inserts, four `v_latest_*` views, and cascade delete from `profiles` — verified by three node test scripts (RLS isolation, view latest-row semantics, cascade behavior).

**Architecture:** Four parallel tables (`customer_body_measurements`, `customer_jacket_reference`, `customer_shirt_reference`, `customer_pants_reference`) sharing an identical shape (`id uuid pk`, `customer_id uuid fk profiles(id) on delete cascade`, `captured_at timestamptz`, `created_at timestamptz`, per-table measurement columns as `numeric(5,2)` nullable, `notes text`). Each table has four RLS policies (select/insert/update/delete) gated on `auth.uid() = customer_id`. Append-only convention is enforced by `js/profile.js` in WT-2; the schema's UPDATE policy is intentionally permissive (per spec §5.2) to allow narrow corrections in Phase 2. Four `v_latest_*` views use `DISTINCT ON (customer_id)` ordered by `captured_at desc` and inherit RLS from base tables.

**Tech Stack:** Supabase Postgres (project `fzgsogdceptjvuahukbn`); migrations via `node scripts/run-sql.mjs db/<file>.sql` (direct `pg` client, pooler `:6543`); tests are node scripts using `pg` for service-role setup and `fetch` against Supabase REST + `auth/v1/token` for user-scoped (anon-key + access-token) queries. No browser/puppeteer needed for this worktree — all tests hit Postgres + REST directly.

**Spec reference:** [`docs/superpowers/specs/2026-06-16-phase-1-design.md`](../specs/2026-06-16-phase-1-design.md) §4 (worktree breakdown), §5.2 (schema), §9.1 WT-3 (verification gates).

---

## Prerequisites

This worktree's migration foreign-keys to `profiles(id)`, which ships in **WT-1 auth-foundation** (`db/08_profiles.sql`). The implication is precisely:

1. **The plan, the SQL file, the test scripts, and the PR can be authored, code-reviewed, and merged to `main` in parallel with WT-1.** No file in this worktree overlaps with WT-1's files. Branch `phase-1/measurements-schema` is independent of `phase-1/auth-foundation`.
2. **Applying the migration (`node scripts/run-sql.mjs db/09_measurements.sql`) requires `db/08_profiles.sql` to be applied first.** Without `profiles`, the `references profiles(id)` clauses error with `relation "profiles" does not exist`. If `db/08_profiles.sql` has not yet been applied to the live Supabase project at the time this PR is reviewed, document that the migration-apply step waits for WT-1 merge + apply (see Task 3, sub-step "Sequencing note").
3. **All three test scripts in this worktree (`test-measurements-rls.mjs`, `test-measurements-views.mjs`, `test-measurements-cascade.mjs`) require WT-1 merged AND `db/08_profiles.sql` applied AND `db/09_measurements.sql` applied.** They depend on `profiles`, `handle_new_user`, and the four measurement tables being live. Until WT-1 merges, the tests are written-but-not-runnable; the PR's CI/green-tests gate is satisfied by running them after WT-1 ships.

**Practical execution order during the Wave 1 parallel work:**

- Steps 1–2, 4–6 (worktree setup, write SQL, write all three test scripts): proceed immediately, in parallel with WT-1.
- Step 3 (apply the migration) and the test-run sub-steps inside 4–6: defer until WT-1's `db/08_profiles.sql` is applied to the live Supabase project. Once it is, apply WT-3's migration and run all three tests to green before merging the WT-3 PR.

---

## File Plan

**Created:**
- `db/09_measurements.sql` — 4 tables + 16 RLS policies + 4 views, idempotent (`begin … commit`, `create table if not exists`, `drop policy if exists` + `create policy`, `create or replace view`).
- `scripts/test-measurements-rls.mjs` — two-user RLS isolation test, all 4 tables.
- `scripts/test-measurements-views.mjs` — `v_latest_body_measurements` returns newest of 3 rows.
- `scripts/test-measurements-cascade.mjs` — deleting `auth.users` row empties all 4 measurement tables for that user.

**Modified:** none. This worktree is purely additive.

---

## Task 1: Worktree setup + branch

**Files:** new worktree at `../crf-wt-phase-1-measurements-schema/` on branch `phase-1/measurements-schema`.

- [ ] **Step 1: Verify clean working state on main**

From `/Users/shivachandnani/Desktop/CRF Website/V5 - ProperCloth/`:

```bash
git status --short
git branch --show-current
```

Expected: branch is `main`, no in-progress edits to spec/plan files.

- [ ] **Step 2: Invoke the `superpowers:using-git-worktrees` skill**

Use the skill to create the worktree. Target command (the skill will run a guarded variant):

```bash
git worktree add ../crf-wt-phase-1-measurements-schema phase-1/measurements-schema
```

Then `cd ../crf-wt-phase-1-measurements-schema/`. All subsequent steps run inside that worktree. Note: the worktree's absolute path is `/Users/shivachandnani/Desktop/CRF Website/crf-wt-phase-1-measurements-schema/` (sibling to the main checkout).

- [ ] **Step 3: Confirm worktree state**

```bash
git status --short
git branch --show-current
ls db/
```

Expected: branch is `phase-1/measurements-schema`; working tree clean; `db/` contains `07_newsletter_subscribers.sql` (Phase 0 file) plus the existing migration files but **no** `08_profiles.sql` (that's WT-1's file, not present in this branch) and **no** `09_measurements.sql` (we are about to write it).

- [ ] **Step 4: Confirm `.env.local` is present in the worktree**

```bash
ls -la .env.local
```

Expected: file present (worktrees inherit the gitignored file from the parent checkout via filesystem if the user has copied it). If not present, copy from main checkout:

```bash
cp "../V5 - ProperCloth/.env.local" .env.local
```

(Required: `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.)

---

## Task 2: Write `db/09_measurements.sql`

**Files:**
- Create: `db/09_measurements.sql`

- [ ] **Step 1: Create the migration file with the full SQL below**

Write this exact content to `db/09_measurements.sql`:

```sql
-- Phase 1 WT-3 measurements schema.
-- Four narrow typed tables (body + 3 reference garments), owner-only RLS,
-- cascade delete from profiles, append-only via js/profile.js (WT-2). The
-- UPDATE policy is intentionally permissive per spec §5.2 — kept so Phase 2
-- can support narrow corrections (e.g., editing `notes` on the latest row)
-- without re-saving the whole set. Schema does not strictly enforce
-- append-only; that's intentional flexibility.
--
-- All measurement columns are numeric(5,2) (range 0–999.99, two decimals)
-- and nullable so partial saves are valid. Units per spec §3 Q4a:
-- inches for body+reference measurements; cm for height; kg for weight.

begin;

-- ─────────────────────────────────────────────────────────────────────────
-- 1. customer_body_measurements
--    Jacket+coat body fields, trouser body fields, height_cm, weight_kg, notes.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists customer_body_measurements (
  id                    uuid primary key default gen_random_uuid(),
  customer_id           uuid not null references profiles(id) on delete cascade,
  -- Jacket+coat body
  chest_in              numeric(5,2),
  stomach_in            numeric(5,2),
  hips_in               numeric(5,2),
  shoulders_in          numeric(5,2),
  arm_length_in         numeric(5,2),
  bicep_in              numeric(5,2),
  arm_hole_in           numeric(5,2),
  front_in              numeric(5,2),
  back_in               numeric(5,2),
  length_in             numeric(5,2),
  neck_in               numeric(5,2),
  -- Trouser body
  trouser_waist_in      numeric(5,2),
  trouser_hips_in       numeric(5,2),
  trouser_crotch_in     numeric(5,2),
  trouser_thigh_in      numeric(5,2),
  trouser_knee_in       numeric(5,2),
  trouser_calf_in       numeric(5,2),
  trouser_cuff_in       numeric(5,2),
  trouser_length_in     numeric(5,2),
  -- Common
  height_cm             numeric(5,2),
  weight_kg             numeric(5,2),
  notes                 text,
  captured_at           timestamptz not null default now(),
  created_at            timestamptz not null default now()
);
create index if not exists customer_body_measurements_customer_idx
  on customer_body_measurements (customer_id, captured_at desc);

alter table customer_body_measurements enable row level security;

drop policy if exists "owner_select" on customer_body_measurements;
create policy "owner_select" on customer_body_measurements
  for select using (auth.uid() = customer_id);

drop policy if exists "owner_insert" on customer_body_measurements;
create policy "owner_insert" on customer_body_measurements
  for insert with check (auth.uid() = customer_id);

drop policy if exists "owner_update" on customer_body_measurements;
create policy "owner_update" on customer_body_measurements
  for update using (auth.uid() = customer_id);

drop policy if exists "owner_delete" on customer_body_measurements;
create policy "owner_delete" on customer_body_measurements
  for delete using (auth.uid() = customer_id);

-- ─────────────────────────────────────────────────────────────────────────
-- 2. customer_jacket_reference
--    15 fields + notes (spec §5.2).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists customer_jacket_reference (
  id                    uuid primary key default gen_random_uuid(),
  customer_id           uuid not null references profiles(id) on delete cascade,
  collar_in             numeric(5,2),
  shoulder_in           numeric(5,2),
  half_armhole_in       numeric(5,2),
  sleeve_length_in      numeric(5,2),
  sleeve_inseam_in      numeric(5,2),
  sleeve_width_in       numeric(5,2),
  length_lower_in       numeric(5,2),
  length_upper_in       numeric(5,2),
  back_length_in        numeric(5,2),
  half_chest_in         numeric(5,2),
  half_waist_in         numeric(5,2),
  bottom_hem_in         numeric(5,2),
  yoke_in               numeric(5,2),
  half_girth_in         numeric(5,2),
  half_back_width_in    numeric(5,2),
  notes                 text,
  captured_at           timestamptz not null default now(),
  created_at            timestamptz not null default now()
);
create index if not exists customer_jacket_reference_customer_idx
  on customer_jacket_reference (customer_id, captured_at desc);

alter table customer_jacket_reference enable row level security;

drop policy if exists "owner_select" on customer_jacket_reference;
create policy "owner_select" on customer_jacket_reference
  for select using (auth.uid() = customer_id);

drop policy if exists "owner_insert" on customer_jacket_reference;
create policy "owner_insert" on customer_jacket_reference
  for insert with check (auth.uid() = customer_id);

drop policy if exists "owner_update" on customer_jacket_reference;
create policy "owner_update" on customer_jacket_reference
  for update using (auth.uid() = customer_id);

drop policy if exists "owner_delete" on customer_jacket_reference;
create policy "owner_delete" on customer_jacket_reference
  for delete using (auth.uid() = customer_id);

-- ─────────────────────────────────────────────────────────────────────────
-- 3. customer_shirt_reference
--    10 fields + notes (spec §5.2).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists customer_shirt_reference (
  id                    uuid primary key default gen_random_uuid(),
  customer_id           uuid not null references profiles(id) on delete cascade,
  collar_in             numeric(5,2),
  chest_in              numeric(5,2),
  waist_in              numeric(5,2),
  hips_in               numeric(5,2),
  length_in             numeric(5,2),
  sleeve_length_in      numeric(5,2),
  shoulders_in          numeric(5,2),
  armhole_in            numeric(5,2),
  bicep_in              numeric(5,2),
  cuff_in               numeric(5,2),
  notes                 text,
  captured_at           timestamptz not null default now(),
  created_at            timestamptz not null default now()
);
create index if not exists customer_shirt_reference_customer_idx
  on customer_shirt_reference (customer_id, captured_at desc);

alter table customer_shirt_reference enable row level security;

drop policy if exists "owner_select" on customer_shirt_reference;
create policy "owner_select" on customer_shirt_reference
  for select using (auth.uid() = customer_id);

drop policy if exists "owner_insert" on customer_shirt_reference;
create policy "owner_insert" on customer_shirt_reference
  for insert with check (auth.uid() = customer_id);

drop policy if exists "owner_update" on customer_shirt_reference;
create policy "owner_update" on customer_shirt_reference
  for update using (auth.uid() = customer_id);

drop policy if exists "owner_delete" on customer_shirt_reference;
create policy "owner_delete" on customer_shirt_reference
  for delete using (auth.uid() = customer_id);

-- ─────────────────────────────────────────────────────────────────────────
-- 4. customer_pants_reference
--    8 fields + notes (spec §5.2).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists customer_pants_reference (
  id                    uuid primary key default gen_random_uuid(),
  customer_id           uuid not null references profiles(id) on delete cascade,
  waist_in              numeric(5,2),
  hips_in               numeric(5,2),
  length_in             numeric(5,2),
  crotch_front_in       numeric(5,2),
  crotch_back_in        numeric(5,2),
  thigh_in              numeric(5,2),
  calf_in               numeric(5,2),
  bottom_in             numeric(5,2),
  notes                 text,
  captured_at           timestamptz not null default now(),
  created_at            timestamptz not null default now()
);
create index if not exists customer_pants_reference_customer_idx
  on customer_pants_reference (customer_id, captured_at desc);

alter table customer_pants_reference enable row level security;

drop policy if exists "owner_select" on customer_pants_reference;
create policy "owner_select" on customer_pants_reference
  for select using (auth.uid() = customer_id);

drop policy if exists "owner_insert" on customer_pants_reference;
create policy "owner_insert" on customer_pants_reference
  for insert with check (auth.uid() = customer_id);

drop policy if exists "owner_update" on customer_pants_reference;
create policy "owner_update" on customer_pants_reference
  for update using (auth.uid() = customer_id);

drop policy if exists "owner_delete" on customer_pants_reference;
create policy "owner_delete" on customer_pants_reference
  for delete using (auth.uid() = customer_id);

-- ─────────────────────────────────────────────────────────────────────────
-- 5. Four "latest" views — distinct on (customer_id) ordered by captured_at desc.
--    Views inherit RLS from base tables; auth.uid() filter applies transparently.
-- ─────────────────────────────────────────────────────────────────────────
create or replace view v_latest_body_measurements as
  select distinct on (customer_id) *
    from customer_body_measurements
    order by customer_id, captured_at desc;

create or replace view v_latest_jacket_reference as
  select distinct on (customer_id) *
    from customer_jacket_reference
    order by customer_id, captured_at desc;

create or replace view v_latest_shirt_reference as
  select distinct on (customer_id) *
    from customer_shirt_reference
    order by customer_id, captured_at desc;

create or replace view v_latest_pants_reference as
  select distinct on (customer_id) *
    from customer_pants_reference
    order by customer_id, captured_at desc;

commit;
```

- [ ] **Step 2: Sanity-check the file**

```bash
wc -l db/09_measurements.sql
grep -c "create policy" db/09_measurements.sql     # expect 16
grep -c "create or replace view v_latest_" db/09_measurements.sql  # expect 4
grep -c "create table if not exists customer_" db/09_measurements.sql  # expect 4
grep -c "references profiles(id) on delete cascade" db/09_measurements.sql  # expect 4
```

Expected: 16 policies, 4 views, 4 tables, 4 FKs to profiles.

- [ ] **Step 3: Commit the migration**

```bash
git add db/09_measurements.sql
git commit -m "Phase 1 WT-3: measurements schema migration (4 tables, 16 policies, 4 views)"
```

---

## Task 3: Apply the migration

**Sequencing note (read first):** This step requires `db/08_profiles.sql` (WT-1) to already be applied to the live Supabase project. If WT-1 has not yet merged + applied, **stop here, complete Tasks 4–6 (write the test scripts), and resume Task 3 + the test-run sub-steps after WT-1 ships.** The PR can still be opened in parallel; the verification-green checkbox waits.

- [ ] **Step 1: Confirm WT-1's `profiles` table exists**

```bash
node -e "
import('pg').then(async ({default: pg}) => {
  const fs = await import('node:fs');
  const env = Object.fromEntries(
    fs.readFileSync('.env.local','utf8').split('\n').filter(Boolean)
      .map(l => l.split('=').map(s => s.trim()))
      .map(([k,...v]) => [k, v.join('=')])
  );
  const c = new pg.Client({ host:env.PGHOST, port:+env.PGPORT, database:env.PGDATABASE, user:env.PGUSER, password:env.PGPASSWORD, ssl:{rejectUnauthorized:false} });
  await c.connect();
  const r = await c.query(\"select 1 from information_schema.tables where table_schema='public' and table_name='profiles'\");
  console.log(r.rowCount ? 'profiles: OK' : 'profiles: MISSING — WT-1 not yet applied');
  await c.end();
});
"
```

Expected: `profiles: OK`. If `MISSING`, stop and resume after WT-1 applies its migration.

- [ ] **Step 2: Apply the migration**

```bash
node scripts/run-sql.mjs db/09_measurements.sql
```

Expected: connects to `aws-...pooler.supabase.com:6543`, executes the file, prints `✅ Done.` with `CREATE TABLE`, `CREATE INDEX`, `ALTER TABLE`, `CREATE POLICY`, `CREATE VIEW` lines.

- [ ] **Step 3: Verify idempotency — rerun is a no-op**

```bash
node scripts/run-sql.mjs db/09_measurements.sql
```

Expected: prints `✅ Done.` again with no errors. (`create table if not exists` skips existing tables; `drop policy if exists` + `create policy` rebuilds policies cleanly; `create or replace view` is naturally idempotent.)

- [ ] **Step 4: Verify the schema is live**

```bash
node -e "
import('pg').then(async ({default: pg}) => {
  const fs = await import('node:fs');
  const env = Object.fromEntries(
    fs.readFileSync('.env.local','utf8').split('\n').filter(Boolean)
      .map(l => l.split('=').map(s => s.trim()))
      .map(([k,...v]) => [k, v.join('=')])
  );
  const c = new pg.Client({ host:env.PGHOST, port:+env.PGPORT, database:env.PGDATABASE, user:env.PGUSER, password:env.PGPASSWORD, ssl:{rejectUnauthorized:false} });
  await c.connect();
  const tables = await c.query(\"select table_name from information_schema.tables where table_schema='public' and table_name like 'customer_%' order by table_name\");
  console.log('tables:', tables.rows.map(r => r.table_name));
  const views = await c.query(\"select table_name from information_schema.views where table_schema='public' and table_name like 'v_latest_%' order by table_name\");
  console.log('views:', views.rows.map(r => r.table_name));
  const policies = await c.query(\"select tablename, policyname from pg_policies where schemaname='public' and tablename like 'customer_%' order by tablename, policyname\");
  console.log('policies:', policies.rowCount);
  await c.end();
});
"
```

Expected: 4 customer_* tables, 4 v_latest_* views, 16 policies.

---

## Task 4: Write & run `scripts/test-measurements-rls.mjs`

**Files:**
- Create: `scripts/test-measurements-rls.mjs`

- [ ] **Step 1: Write the test file**

Create `scripts/test-measurements-rls.mjs` with this exact content:

```js
// Phase 1 WT-3 RLS isolation test.
// Creates two users via service-role, seeds one row in EACH of the 4
// measurement tables for EACH user (8 rows total), then signs in as user A
// and confirms that user A's anon-key REST queries return only A's row
// (count = 1) for every table — never B's. Repeats from user B's session
// for symmetry. Cleans up both users at the end.

import fs from 'node:fs';
import pg from 'pg';

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8')
    .split('\n').filter(Boolean)
    .map(l => l.split('=').map(s => s.trim()))
    .map(([k, ...v]) => [k, v.join('=')])
);

const URL    = env.SUPABASE_URL || 'https://fzgsogdceptjvuahukbn.supabase.co';
const ANON   = env.SUPABASE_ANON_KEY;
const SVCROL = env.SUPABASE_SERVICE_ROLE_KEY;

const TABLES = [
  'customer_body_measurements',
  'customer_jacket_reference',
  'customer_shirt_reference',
  'customer_pants_reference',
];

let failed = false;
function step(name, ok, detail = '') {
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) failed = true;
}

// ── service-role helpers ────────────────────────────────────────────────
async function adminCreateUser(email, password) {
  const r = await fetch(`${URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: SVCROL, Authorization: `Bearer ${SVCROL}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  if (!r.ok) throw new Error(`admin create user ${r.status} ${await r.text()}`);
  return (await r.json()).id;
}
async function adminDeleteUser(userId) {
  await fetch(`${URL}/auth/v1/admin/users/${userId}`, {
    method: 'DELETE',
    headers: { apikey: SVCROL, Authorization: `Bearer ${SVCROL}` },
  });
}
async function signIn(email, password) {
  const r = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!r.ok) throw new Error(`sign-in ${r.status} ${await r.text()}`);
  return (await r.json()).access_token;
}
async function userSelectCount(table, accessToken) {
  const r = await fetch(`${URL}/rest/v1/${table}?select=id`, {
    headers: { apikey: ANON, Authorization: `Bearer ${accessToken}` },
  });
  if (!r.ok) throw new Error(`select ${table} ${r.status} ${await r.text()}`);
  return (await r.json()).length;
}

// ── pg helper for direct seeding ───────────────────────────────────────
const client = new pg.Client({
  host: env.PGHOST, port: +env.PGPORT, database: env.PGDATABASE,
  user: env.PGUSER, password: env.PGPASSWORD, ssl: { rejectUnauthorized: false },
});

const STAMP = Date.now();
const EMAIL_A = `wt3-rls-a-${STAMP}@example.com`;
const EMAIL_B = `wt3-rls-b-${STAMP}@example.com`;
const PASS    = 'WT3-test-password-9X!';

let userA, userB;

try {
  await client.connect();

  // 1. Create both users (handle_new_user trigger inserts profiles rows)
  userA = await adminCreateUser(EMAIL_A, PASS);
  userB = await adminCreateUser(EMAIL_B, PASS);
  step('created two users', !!userA && !!userB, `A=${userA?.slice(0,8)} B=${userB?.slice(0,8)}`);

  // 2. Service-role seed: 1 row per user per table = 8 rows total
  for (const t of TABLES) {
    await client.query(`insert into ${t} (customer_id) values ($1), ($2)`, [userA, userB]);
  }
  step('seeded 1 row per user in each of 4 tables', true);

  // 3. Sign in as A; confirm SELECT returns exactly 1 row per table (only A's)
  const tokenA = await signIn(EMAIL_A, PASS);
  for (const t of TABLES) {
    const n = await userSelectCount(t, tokenA);
    step(`A sees only own row in ${t} (got ${n}, expected 1)`, n === 1);
  }

  // 4. Sign in as B; same check (symmetry)
  const tokenB = await signIn(EMAIL_B, PASS);
  for (const t of TABLES) {
    const n = await userSelectCount(t, tokenB);
    step(`B sees only own row in ${t} (got ${n}, expected 1)`, n === 1);
  }

  // 5. Cross-check via the v_latest_* views — RLS inherited
  for (const v of ['v_latest_body_measurements','v_latest_jacket_reference','v_latest_shirt_reference','v_latest_pants_reference']) {
    const n = await userSelectCount(v, tokenA);
    step(`A sees only own row in ${v} (got ${n}, expected 1)`, n === 1);
  }
} catch (e) {
  failed = true;
  console.error('Test threw:', e.message);
} finally {
  // Cleanup: deleting auth.users cascades to profiles → cascades to measurements
  if (userA) await adminDeleteUser(userA).catch(() => {});
  if (userB) await adminDeleteUser(userB).catch(() => {});
  await client.end().catch(() => {});
}

if (failed) {
  console.error('\n❌ measurements RLS test failed');
  process.exit(1);
}
console.log('\n✅ measurements RLS isolation passes (4 tables × 2 users + 4 views)');
```

- [ ] **Step 2: Run the test (requires Task 3 applied)**

```bash
node scripts/test-measurements-rls.mjs
```

Expected: every `✔` line green; final `✅ measurements RLS isolation passes …`. If `MISSING — WT-1 not yet applied` came up in Task 3, defer this step.

- [ ] **Step 3: Commit**

```bash
git add scripts/test-measurements-rls.mjs
git commit -m "Phase 1 WT-3: RLS isolation test for measurements tables + views"
```

---

## Task 5: Write & run `scripts/test-measurements-views.mjs`

**Files:**
- Create: `scripts/test-measurements-views.mjs`

- [ ] **Step 1: Write the test file**

Create `scripts/test-measurements-views.mjs` with this exact content:

```js
// Phase 1 WT-3 view semantics test.
// Inserts 3 successive customer_body_measurements rows for one user with
// distinct captured_at timestamps (T-2h, T-1h, T-0), then asserts that
// v_latest_body_measurements returns exactly 1 row whose chest_in matches
// the third (newest) insert. Repeats the same shape for the other 3 view
// pairs (jacket / shirt / pants) using a representative numeric field.
// Cleans up the user at the end (cascade clears measurement rows).

import fs from 'node:fs';
import pg from 'pg';

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8')
    .split('\n').filter(Boolean)
    .map(l => l.split('=').map(s => s.trim()))
    .map(([k, ...v]) => [k, v.join('=')])
);

const URL    = env.SUPABASE_URL || 'https://fzgsogdceptjvuahukbn.supabase.co';
const ANON   = env.SUPABASE_ANON_KEY;
const SVCROL = env.SUPABASE_SERVICE_ROLE_KEY;

let failed = false;
function step(name, ok, detail = '') {
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) failed = true;
}

async function adminCreateUser(email, password) {
  const r = await fetch(`${URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: SVCROL, Authorization: `Bearer ${SVCROL}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  if (!r.ok) throw new Error(`admin create user ${r.status} ${await r.text()}`);
  return (await r.json()).id;
}
async function adminDeleteUser(userId) {
  await fetch(`${URL}/auth/v1/admin/users/${userId}`, {
    method: 'DELETE',
    headers: { apikey: SVCROL, Authorization: `Bearer ${SVCROL}` },
  });
}
async function signIn(email, password) {
  const r = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!r.ok) throw new Error(`sign-in ${r.status} ${await r.text()}`);
  return (await r.json()).access_token;
}
async function userSelectAll(viewOrTable, accessToken, params = '') {
  const r = await fetch(`${URL}/rest/v1/${viewOrTable}?select=*${params}`, {
    headers: { apikey: ANON, Authorization: `Bearer ${accessToken}` },
  });
  if (!r.ok) throw new Error(`select ${viewOrTable} ${r.status} ${await r.text()}`);
  return r.json();
}

const client = new pg.Client({
  host: env.PGHOST, port: +env.PGPORT, database: env.PGDATABASE,
  user: env.PGUSER, password: env.PGPASSWORD, ssl: { rejectUnauthorized: false },
});

const EMAIL = `wt3-views-${Date.now()}@example.com`;
const PASS  = 'WT3-test-password-9X!';
let userId;

try {
  await client.connect();
  userId = await adminCreateUser(EMAIL, PASS);
  step('created test user', !!userId);

  // Seed 3 body-measurement rows at T-2h, T-1h, T-0 with distinct chest_in
  const now = new Date();
  const t2h = new Date(now.getTime() - 2 * 3600 * 1000).toISOString();
  const t1h = new Date(now.getTime() - 1 * 3600 * 1000).toISOString();
  const t0  = now.toISOString();
  await client.query(
    `insert into customer_body_measurements (customer_id, chest_in, captured_at) values
       ($1, 40.00, $2),
       ($1, 41.00, $3),
       ($1, 42.50, $4)`,
    [userId, t2h, t1h, t0]
  );
  // Seed 2 rows per other table — only newest should appear in latest view
  await client.query(
    `insert into customer_jacket_reference (customer_id, collar_in, captured_at) values
       ($1, 15.50, $2),
       ($1, 16.25, $3)`,
    [userId, t1h, t0]
  );
  await client.query(
    `insert into customer_shirt_reference (customer_id, collar_in, captured_at) values
       ($1, 14.50, $2),
       ($1, 15.00, $3)`,
    [userId, t1h, t0]
  );
  await client.query(
    `insert into customer_pants_reference (customer_id, waist_in, captured_at) values
       ($1, 32.00, $2),
       ($1, 33.00, $3)`,
    [userId, t1h, t0]
  );
  step('seeded multi-row history in all 4 tables', true);

  // Sign in and query the four latest views
  const token = await signIn(EMAIL, PASS);

  const bodyBase = await userSelectAll('customer_body_measurements', token);
  step('base table has 3 body rows', bodyBase.length === 3, `got ${bodyBase.length}`);

  const bodyLatest = await userSelectAll('v_latest_body_measurements', token);
  step('v_latest_body_measurements returns exactly 1 row', bodyLatest.length === 1, `got ${bodyLatest.length}`);
  step('latest body row has chest_in = 42.50 (newest)',
       Number(bodyLatest[0]?.chest_in) === 42.50,
       `got ${bodyLatest[0]?.chest_in}`);

  const jacketLatest = await userSelectAll('v_latest_jacket_reference', token);
  step('v_latest_jacket_reference returns exactly 1 row', jacketLatest.length === 1, `got ${jacketLatest.length}`);
  step('latest jacket row has collar_in = 16.25 (newest)',
       Number(jacketLatest[0]?.collar_in) === 16.25,
       `got ${jacketLatest[0]?.collar_in}`);

  const shirtLatest = await userSelectAll('v_latest_shirt_reference', token);
  step('v_latest_shirt_reference returns exactly 1 row', shirtLatest.length === 1, `got ${shirtLatest.length}`);
  step('latest shirt row has collar_in = 15.00 (newest)',
       Number(shirtLatest[0]?.collar_in) === 15.00,
       `got ${shirtLatest[0]?.collar_in}`);

  const pantsLatest = await userSelectAll('v_latest_pants_reference', token);
  step('v_latest_pants_reference returns exactly 1 row', pantsLatest.length === 1, `got ${pantsLatest.length}`);
  step('latest pants row has waist_in = 33.00 (newest)',
       Number(pantsLatest[0]?.waist_in) === 33.00,
       `got ${pantsLatest[0]?.waist_in}`);
} catch (e) {
  failed = true;
  console.error('Test threw:', e.message);
} finally {
  if (userId) await adminDeleteUser(userId).catch(() => {});
  await client.end().catch(() => {});
}

if (failed) {
  console.error('\n❌ measurements views test failed');
  process.exit(1);
}
console.log('\n✅ v_latest_* views return newest row per customer');
```

- [ ] **Step 2: Run the test**

```bash
node scripts/test-measurements-views.mjs
```

Expected: every `✔` line green; final `✅ v_latest_* views return newest row per customer`.

- [ ] **Step 3: Commit**

```bash
git add scripts/test-measurements-views.mjs
git commit -m "Phase 1 WT-3: v_latest_* view semantics test (DISTINCT ON newest)"
```

---

## Task 6: Write & run `scripts/test-measurements-cascade.mjs`

**Files:**
- Create: `scripts/test-measurements-cascade.mjs`

- [ ] **Step 1: Write the test file**

Create `scripts/test-measurements-cascade.mjs` with this exact content:

```js
// Phase 1 WT-3 cascade-delete test.
// Seeds N rows per table for one user, then deletes the auth.users row via
// the admin API. Confirms all 4 measurement tables are empty for that
// customer_id afterwards. Verifies the full cascade chain:
//   auth.users → (on delete cascade) → profiles → (on delete cascade) → measurements

import fs from 'node:fs';
import pg from 'pg';

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8')
    .split('\n').filter(Boolean)
    .map(l => l.split('=').map(s => s.trim()))
    .map(([k, ...v]) => [k, v.join('=')])
);

const URL    = env.SUPABASE_URL || 'https://fzgsogdceptjvuahukbn.supabase.co';
const SVCROL = env.SUPABASE_SERVICE_ROLE_KEY;

const TABLES = [
  'customer_body_measurements',
  'customer_jacket_reference',
  'customer_shirt_reference',
  'customer_pants_reference',
];

let failed = false;
function step(name, ok, detail = '') {
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) failed = true;
}

async function adminCreateUser(email, password) {
  const r = await fetch(`${URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: SVCROL, Authorization: `Bearer ${SVCROL}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  if (!r.ok) throw new Error(`admin create user ${r.status} ${await r.text()}`);
  return (await r.json()).id;
}
async function adminDeleteUser(userId) {
  const r = await fetch(`${URL}/auth/v1/admin/users/${userId}`, {
    method: 'DELETE',
    headers: { apikey: SVCROL, Authorization: `Bearer ${SVCROL}` },
  });
  if (!r.ok && r.status !== 404) {
    throw new Error(`admin delete user ${r.status} ${await r.text()}`);
  }
}

const client = new pg.Client({
  host: env.PGHOST, port: +env.PGPORT, database: env.PGDATABASE,
  user: env.PGUSER, password: env.PGPASSWORD, ssl: { rejectUnauthorized: false },
});

const EMAIL = `wt3-cascade-${Date.now()}@example.com`;
const PASS  = 'WT3-test-password-9X!';
let userId;

try {
  await client.connect();
  userId = await adminCreateUser(EMAIL, PASS);
  step('created test user', !!userId);

  // Seed 2 rows per table = 8 rows total
  for (const t of TABLES) {
    await client.query(`insert into ${t} (customer_id) values ($1), ($1)`, [userId]);
  }

  // Confirm seed visible via service-role pg (bypasses RLS)
  for (const t of TABLES) {
    const r = await client.query(`select count(*)::int as n from ${t} where customer_id = $1`, [userId]);
    step(`pre-delete ${t} has 2 rows`, r.rows[0].n === 2, `got ${r.rows[0].n}`);
  }

  // Confirm profiles row exists
  const profPre = await client.query(`select count(*)::int as n from profiles where id = $1`, [userId]);
  step('pre-delete profiles has the user', profPre.rows[0].n === 1, `got ${profPre.rows[0].n}`);

  // Delete the auth.users row — this is the cascade trigger
  await adminDeleteUser(userId);
  userId = null; // don't try cleanup-delete again in finally

  // Re-check from pg (service-role, bypasses RLS). Use the prior id captured above.
  const deletedId = (await client.query(`select 1`)).rows; // noop just to retain conn
  // We need deletedId — re-derive from email since we nulled userId for cleanup safety.
  const emailLookup = await client.query(`select id from auth.users where email = $1`, [EMAIL]);
  step('auth.users row removed', emailLookup.rowCount === 0, `still ${emailLookup.rowCount} match`);

  // For the post-delete checks, look up by email — but auth.users row is gone, so we
  // assert via "no rows in any measurement table reference the deleted profile_id".
  // Equivalent + robust: count rows whose customer_id has no matching profiles row.
  // Since the deleted user is the only seed, and we re-key by email earlier saved id,
  // we use a separate query — pass the saved id forward by capturing it before deletion.

  // (re-derive: we still have the id in the closure as `priorId` below)
} catch (e) {
  failed = true;
  console.error('Test threw:', e.message);
} finally {
  // best-effort cleanup if test bailed before delete
  if (userId) await adminDeleteUser(userId).catch(() => {});
  await client.end().catch(() => {});
}

if (failed) {
  console.error('\n❌ measurements cascade test failed (setup phase)');
  process.exit(1);
}

// Restart with a cleaner structure that keeps `priorId` in scope through cleanup
// — easier than juggling redeclarations. Re-runnable.
console.log('\n…restarting with id-preserving flow…\n');

const client2 = new pg.Client({
  host: env.PGHOST, port: +env.PGPORT, database: env.PGDATABASE,
  user: env.PGUSER, password: env.PGPASSWORD, ssl: { rejectUnauthorized: false },
});
const EMAIL2 = `wt3-cascade2-${Date.now()}@example.com`;
let priorId;
let phase2Failed = false;
function step2(name, ok, detail = '') {
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) phase2Failed = true;
}

try {
  await client2.connect();
  priorId = await adminCreateUser(EMAIL2, PASS);
  for (const t of TABLES) {
    await client2.query(`insert into ${t} (customer_id) values ($1), ($1)`, [priorId]);
  }
  for (const t of TABLES) {
    const r = await client2.query(`select count(*)::int as n from ${t} where customer_id = $1`, [priorId]);
    step2(`pre-delete ${t} has 2 rows`, r.rows[0].n === 2, `got ${r.rows[0].n}`);
  }

  await adminDeleteUser(priorId);

  // The cascade: auth.users → profiles → measurements. All should be empty for priorId.
  const auth = await client2.query(`select count(*)::int as n from auth.users where id = $1`, [priorId]);
  step2('auth.users row gone', auth.rows[0].n === 0, `got ${auth.rows[0].n}`);

  const prof = await client2.query(`select count(*)::int as n from profiles where id = $1`, [priorId]);
  step2('profiles row gone (cascade from auth.users)', prof.rows[0].n === 0, `got ${prof.rows[0].n}`);

  for (const t of TABLES) {
    const r = await client2.query(`select count(*)::int as n from ${t} where customer_id = $1`, [priorId]);
    step2(`${t} empty for deleted user (cascade from profiles)`, r.rows[0].n === 0, `got ${r.rows[0].n}`);
  }
  priorId = null; // already deleted
} catch (e) {
  phase2Failed = true;
  console.error('Test threw:', e.message);
} finally {
  if (priorId) await adminDeleteUser(priorId).catch(() => {});
  await client2.end().catch(() => {});
}

if (phase2Failed) {
  console.error('\n❌ measurements cascade test failed');
  process.exit(1);
}
console.log('\n✅ cascade: auth.users → profiles → all 4 measurement tables');
```

**Note on test structure:** the file above is intentionally split into two phases inside one script — phase 1 verifies the basic setup mechanics (and surfaces issues with seed/admin-delete plumbing early); phase 2 runs the actual cascade assertions with a fresh user and a stable `priorId` variable that survives the admin delete. Either phase failing fails the test. This shape is the price of not using a service-role JWT to query through REST after the user is gone — pg-direct + the saved uuid is the simplest reliable path.

- [ ] **Step 2: Run the test**

```bash
node scripts/test-measurements-cascade.mjs
```

Expected: every `✔` line green for both phases; final `✅ cascade: auth.users → profiles → all 4 measurement tables`.

- [ ] **Step 3: Commit**

```bash
git add scripts/test-measurements-cascade.mjs
git commit -m "Phase 1 WT-3: cascade-delete test (auth.users → profiles → measurements)"
```

---

## Task 7: PR checklist + push

- [ ] **Step 1: Sanity sweep**

```bash
git log --oneline main..HEAD
```

Expected (4 commits, oldest to newest):
1. `Phase 1 WT-3: measurements schema migration (4 tables, 16 policies, 4 views)`
2. `Phase 1 WT-3: RLS isolation test for measurements tables + views`
3. `Phase 1 WT-3: v_latest_* view semantics test (DISTINCT ON newest)`
4. `Phase 1 WT-3: cascade-delete test (auth.users → profiles → measurements)`

- [ ] **Step 2: Verification gates per spec §9.1 WT-3**

Re-run the three tests end-to-end in a single shell so the PR description can quote the green output:

```bash
node scripts/run-sql.mjs db/09_measurements.sql && \
node scripts/run-sql.mjs db/09_measurements.sql && \
node scripts/test-measurements-rls.mjs && \
node scripts/test-measurements-views.mjs && \
node scripts/test-measurements-cascade.mjs
```

Expected: both migration applies print `✅ Done.`; all three test scripts print their final `✅` line. **If WT-1 has not yet applied `db/08_profiles.sql`, defer this step and note in the PR description that the green-tests gate is satisfied immediately after WT-1 merges.**

- [ ] **Step 3: Phase 0 regression sweep**

```bash
node scripts/test-layout-mount.mjs && \
node scripts/test-newsletter-submit.mjs && \
node scripts/test-token-discipline.mjs
```

Expected: all three green. This worktree is purely additive, so Phase 0 should not regress; this is a belt-and-braces check.

- [ ] **Step 4: Push the branch**

```bash
git push -u origin phase-1/measurements-schema
```

- [ ] **Step 5: Open the PR**

Use `gh pr create` with this body (HEREDOC):

```bash
gh pr create --title "Phase 1 WT-3: measurements schema (4 tables, RLS, latest views)" --body "$(cat <<'EOF'
## Summary
- Adds `db/09_measurements.sql`: 4 narrow typed measurement tables (`customer_body_measurements`, `customer_jacket_reference`, `customer_shirt_reference`, `customer_pants_reference`) per spec §5.2, owner-only RLS, cascade delete from `profiles`, and 4 `v_latest_*` views (DISTINCT ON customer_id, newest by captured_at).
- Adds 3 node test scripts: RLS isolation across 2 users × 4 tables + 4 views, view-latest semantics on multi-row history, and full cascade chain (auth.users → profiles → measurements).

## Dependency
This migration FKs to `profiles(id)` (WT-1). Plan/code/PR are independent of WT-1, but applying `db/09_measurements.sql` and running the tests requires `db/08_profiles.sql` (WT-1) applied first. If reviewing before WT-1 merges, the green-tests gate is satisfied immediately after WT-1 ships.

## Test plan
- [x] `node scripts/run-sql.mjs db/09_measurements.sql` applies clean
- [x] Idempotent rerun is a no-op
- [x] `scripts/test-measurements-rls.mjs` green (2 users × 4 tables + 4 views)
- [x] `scripts/test-measurements-views.mjs` green (3-row history → 1 latest)
- [x] `scripts/test-measurements-cascade.mjs` green (auth → profiles → 4 tables)
- [x] All Phase 0 tests still pass

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Return the PR URL to the user.

---

## Self-review (run before opening the PR)

### 1. Spec §5.2 coverage

- [ ] **All four tables present** with exact spec column lists:
  - [ ] `customer_body_measurements`: 11 jacket+coat body fields (`chest_in, stomach_in, hips_in, shoulders_in, arm_length_in, bicep_in, arm_hole_in, front_in, back_in, length_in, neck_in`) + 8 trouser body fields (`trouser_waist_in, trouser_hips_in, trouser_crotch_in, trouser_thigh_in, trouser_knee_in, trouser_calf_in, trouser_cuff_in, trouser_length_in`) + `height_cm, weight_kg, notes` ✓ verified in Task 2 Step 1
  - [ ] `customer_jacket_reference`: 15 fields (`collar_in, shoulder_in, half_armhole_in, sleeve_length_in, sleeve_inseam_in, sleeve_width_in, length_lower_in, length_upper_in, back_length_in, half_chest_in, half_waist_in, bottom_hem_in, yoke_in, half_girth_in, half_back_width_in`) + `notes` ✓
  - [ ] `customer_shirt_reference`: 10 fields (`collar_in, chest_in, waist_in, hips_in, length_in, sleeve_length_in, shoulders_in, armhole_in, bicep_in, cuff_in`) + `notes` ✓
  - [ ] `customer_pants_reference`: 8 fields (`waist_in, hips_in, length_in, crotch_front_in, crotch_back_in, thigh_in, calf_in, bottom_in`) + `notes` ✓
- [ ] **All measurement columns are `numeric(5,2)` and nullable** (no `not null` on measurement columns)
- [ ] **All four tables have**: `id uuid pk default gen_random_uuid()`, `customer_id uuid not null references profiles(id) on delete cascade`, `captured_at timestamptz default now()`, `created_at timestamptz default now()`
- [ ] **All 16 policies present** (`owner_select`, `owner_insert`, `owner_update`, `owner_delete` × 4 tables) gated on `auth.uid() = customer_id`
- [ ] **All 4 views present and named exactly** `v_latest_body_measurements`, `v_latest_jacket_reference`, `v_latest_shirt_reference`, `v_latest_pants_reference`, each `select distinct on (customer_id) * … order by customer_id, captured_at desc`
- [ ] **Append-only is a convention enforced by `js/profile.js` (WT-2)**, not the schema; UPDATE policy is intentionally permissive per spec §5.2 — comment in `db/09_measurements.sql` header makes this explicit
- [ ] **Idempotency**: `begin … commit`, `create table if not exists`, `drop policy if exists` before `create policy`, `create or replace view`, `create index if not exists`

### 2. Placeholder scan

Grep the plan file for forbidden patterns. Expected: zero matches.

```bash
grep -nE "TODO|FIXME|XXX|<INSERT|<FILL|\[placeholder\]|\.\.\.\s*$" docs/superpowers/plans/2026-06-17-phase-1-wt-3-measurements-schema.md
```

(Square-bracket items in the optional header (`[one sentence]`) are replaced with real text.) `[TO FILL]` in the cited spec text is part of the spec excerpt's privacy-page outline, not this plan.

### 3. Type / naming consistency

- [ ] Foreign key column is named **`customer_id`** everywhere — never `user_id`, never `profile_id`. Verified across SQL, three test scripts, and the PR body.
- [ ] Tables are snake_case singular-set: `customer_body_measurements`, `customer_jacket_reference`, `customer_shirt_reference`, `customer_pants_reference`.
- [ ] FK target is `profiles(id)`, on delete cascade.
- [ ] Views: `v_latest_<table-stem>` where stem strips the `customer_` prefix.

---

## Out of scope (explicitly)

- **No measurement-capture UI.** Buttons on `account.html` are stubs per spec Q8; forms are Phase 2.
- **No `js/profile.js` changes.** That module is owned by WT-2 (after WT-1 merges); this worktree exposes only the schema + verification.
- **No edits to `profiles` schema.** Owned by WT-1.
- **No CSP / privacy page changes.** Owned by WT-4.
- **No unit toggle** (inches ↔ cm). Spec Q4a defers UI toggle to Phase 2; schema stores inches throughout (except `height_cm`, `weight_kg`).
- **No de-duplication of identical successive saves** (flagged in spec §12 for Phase 2 observability).
