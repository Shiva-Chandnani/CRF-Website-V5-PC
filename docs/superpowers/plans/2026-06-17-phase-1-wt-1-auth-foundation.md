# Phase 1 WT-1: Auth Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the database + JS substrate for customer identity — `profiles` table with RLS, `handle_new_user` trigger that mirrors `auth.users.email` and backfills newsletter, `delete_my_account()` RPC, `js/auth.js` module exposing the public API in spec §6.1, and the header `[data-account-link]` swap — all proven by five puppeteer/Postgres tests before merge.

**Architecture:** A single SQL migration (`db/08_profiles.sql`) wraps profiles + trigger + RPC + newsletter FK alter in one idempotent transaction applied via `scripts/run-sql.mjs`. A new vanilla-ES-module `js/auth.js` wraps `@supabase/supabase-js` (loaded from `esm.sh`, same as `js/data-loader.js`) with a `{data, error}`-shaped API and auto-mounts a `[data-account-link]` href swap on the Phase 0 `crf:layout-ready` event. Tests sit in `scripts/test-*.mjs` and mirror the puppeteer + REST/PG pattern of `scripts/test-newsletter-submit.mjs`.

**Tech Stack:** static HTML/CSS/vanilla-JS, Supabase (project fzgsogdceptjvuahukbn, ap-southeast-1), Postgres via scripts/run-sql.mjs, puppeteer for tests, serve.mjs on localhost:3000

---

## Task 1 — Create the WT-1 worktree off `main`

**Why:** All work happens in an isolated worktree per the agentic workflow plan; `main` stays clean until merge.

- [ ] From the main repo root (`/Users/shivachandnani/Desktop/CRF Website/V5 - ProperCloth`), confirm a clean tree:
  ```bash
  git status
  ```
  Expected: `nothing to commit, working tree clean` on branch `main`.
- [ ] Create the worktree and the feature branch in one step:
  ```bash
  git worktree add ../crf-wt-phase-1-auth-foundation -b phase-1/auth-foundation main
  ```
- [ ] Verify the worktree exists and is on the new branch:
  ```bash
  git worktree list
  cd ../crf-wt-phase-1-auth-foundation && git status && git branch --show-current
  ```
  Expected: branch shows `phase-1/auth-foundation`, status clean.
- [ ] Copy `.env.local` from the main worktree into the WT-1 worktree (it is gitignored and not carried by `git worktree add`):
  ```bash
  cp "/Users/shivachandnani/Desktop/CRF Website/V5 - ProperCloth/.env.local" \
     "/Users/shivachandnani/Desktop/CRF Website/V5 - ProperCloth/../crf-wt-phase-1-auth-foundation/.env.local"
  ```
- [ ] **All subsequent tasks operate inside `../crf-wt-phase-1-auth-foundation`.** Treat that as the working directory root.

---

## Task 2 — Write `db/08_profiles.sql` (profiles + RLS + trigger + RPC + FK alter)

**Why:** Single migration, single transaction. Idempotent so reruns are no-ops. Lifts the entire WT-1 schema surface in one apply.

- [ ] Create the file at `../crf-wt-phase-1-auth-foundation/db/08_profiles.sql` with this exact content:

```sql
-- Phase 1 WT-1 — Identity foundation.
-- - public.profiles mirror table for auth.users (email duplicated to avoid
--   cross-schema joins inside RLS-filtered queries).
-- - touch_updated_at() generic helper used by profiles_set_updated_at.
-- - handle_new_user() trigger on auth.users: creates profiles row, backfills
--   newsletter_subscribers.profile_id if the signup email was already captured
--   anonymously, and inserts a newsletter_subscribers row if the user opted in
--   at signup.
-- - delete_my_account() RPC: caller-scoped delete from auth.users; the cascade
--   on profiles.id and the future measurements tables (WT-3) does the rest.
-- - newsletter_subscribers.profile_id FK altered from ON DELETE SET NULL stays
--   ON DELETE SET NULL (already the Phase 0 default — re-asserted here as the
--   canonical Phase 1 statement and as a safety re-apply).
--
-- All statements are idempotent: drop-if-exists policies/triggers, create-or-
-- replace functions, create-table-if-not-exists. Re-running this file against
-- an already-migrated database is a no-op.

begin;

-- ---------------------------------------------------------------------------
-- 1. profiles table
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  id                   uuid primary key references auth.users(id) on delete cascade,
  email                text not null,
  full_name            text,
  phone                text,
  role                 text not null default 'customer' check (role in ('customer','staff','admin')),
  opted_in_newsletter  boolean not null default false,
  marketing_consent_at timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists profiles_email_idx on public.profiles (email);
create index if not exists profiles_role_idx  on public.profiles (role);

alter table public.profiles enable row level security;

drop policy if exists "profiles_owner_select" on public.profiles;
create policy "profiles_owner_select"
  on public.profiles for select
  to authenticated
  using (auth.uid() = id);

drop policy if exists "profiles_owner_update" on public.profiles;
create policy "profiles_owner_update"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Intentionally NO insert policy: only the handle_new_user trigger inserts.
-- Intentionally NO delete policy: the on-delete cascade from auth.users does it.

-- ---------------------------------------------------------------------------
-- 2. updated_at trigger function (generic, reusable by WT-3)
-- ---------------------------------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row
  execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 3. handle_new_user() — fires on auth.users insert
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, opted_in_newsletter, marketing_consent_at)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    coalesce((new.raw_user_meta_data->>'opted_in_newsletter')::boolean, false),
    case
      when (new.raw_user_meta_data->>'opted_in_newsletter')::boolean then now()
      else null
    end
  );

  -- Backfill: if an anonymous newsletter row already exists for this email,
  -- link it to the new profile.
  update public.newsletter_subscribers
     set profile_id = new.id
   where email = new.email
     and profile_id is null;

  -- If they opted in at signup AND there is no existing newsletter row, create one.
  if coalesce((new.raw_user_meta_data->>'opted_in_newsletter')::boolean, false) then
    insert into public.newsletter_subscribers (email, profile_id, source, opted_in_at)
    values (new.email, new.id, 'signup', now())
    on conflict (email) do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- 4. delete_my_account() RPC
-- ---------------------------------------------------------------------------

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  delete from auth.users where id = auth.uid();
end;
$$;

revoke all on function public.delete_my_account() from public;
grant execute on function public.delete_my_account() to authenticated;

-- ---------------------------------------------------------------------------
-- 5. newsletter_subscribers.profile_id FK — re-assert ON DELETE SET NULL
--    (Phase 0 already declared this; we re-apply defensively in case of drift.)
-- ---------------------------------------------------------------------------

do $$
declare
  fk_name text;
begin
  select conname into fk_name
    from pg_constraint
   where conrelid = 'public.newsletter_subscribers'::regclass
     and contype  = 'f'
     and (select array_agg(attname) from pg_attribute
            where attrelid = conrelid and attnum = any(conkey)) = array['profile_id'];

  if fk_name is not null then
    execute format('alter table public.newsletter_subscribers drop constraint %I', fk_name);
  end if;

  alter table public.newsletter_subscribers
    add constraint newsletter_subscribers_profile_id_fkey
    foreign key (profile_id) references auth.users(id) on delete set null;
end $$;

commit;
```

- [ ] Sanity-check the file is valid SQL by eyeballing for an unmatched `$$` or `begin/commit`.

---

## Task 3 — Apply the migration and smoke-verify via Postgres

**Why:** Migration must apply cleanly and re-apply cleanly (idempotent).

- [ ] From the WT-1 worktree, run the migration:
  ```bash
  node scripts/run-sql.mjs db/08_profiles.sql
  ```
  Expected: `Connecting…`, `Connected.`, multiple `CREATE TABLE / CREATE FUNCTION / CREATE TRIGGER / CREATE POLICY / ALTER TABLE` log lines ending in `✅ Done.`.
- [ ] Run it a second time — must be a no-op (no errors):
  ```bash
  node scripts/run-sql.mjs db/08_profiles.sql
  ```
  Expected: same `✅ Done.` with all DDL re-applied via the `drop-if-exists` / `create-or-replace` / `if not exists` guards.
- [ ] Smoke-verify in Postgres via a one-shot SQL file. Create `db/_check_08.sql` (gitignored — see next step):
  ```sql
  select
    (select count(*) from pg_tables where schemaname='public' and tablename='profiles') as profiles_table,
    (select count(*) from pg_proc  where proname='handle_new_user') as trigger_fn,
    (select count(*) from pg_proc  where proname='delete_my_account') as rpc_fn,
    (select count(*) from pg_proc  where proname='touch_updated_at') as touch_fn,
    (select count(*) from pg_trigger where tgname='on_auth_user_created') as auth_trigger,
    (select count(*) from pg_trigger where tgname='profiles_set_updated_at') as updated_at_trigger,
    (select count(*) from pg_policies where schemaname='public' and tablename='profiles') as profile_policies,
    (select confdeltype from pg_constraint
       where conname='newsletter_subscribers_profile_id_fkey') as newsletter_ondelete;
  ```
- [ ] Add `db/_check_08.sql` to `.gitignore` so it never gets committed:
  ```bash
  echo "db/_check_*.sql" >> .gitignore
  ```
- [ ] Run the check:
  ```bash
  node scripts/run-sql.mjs db/_check_08.sql
  ```
  Expected row: `profiles_table=1, trigger_fn=1, rpc_fn=1, touch_fn=1, auth_trigger=1, updated_at_trigger=1, profile_policies=2, newsletter_ondelete=n` (the `n` in `confdeltype` is Postgres code for `SET NULL`).
- [ ] Commit the migration:
  ```bash
  git add db/08_profiles.sql .gitignore
  git commit -m "Phase 1 WT-1: db/08_profiles.sql — profiles, trigger, delete RPC"
  ```

---

## Task 4 — Write `scripts/test-profile-rls.mjs` and run it (verifies RLS works)

**Why:** Migration-first / verification-after for SQL (per the plan strategy). The trigger already auto-created profiles rows for any test users we make; this proves owner-only SELECT works in practice.

- [ ] Create `scripts/test-profile-rls.mjs`:

```js
// WT-1 verification: profiles RLS isolates one user from another.
// 1. Create user A + user B via the service-role admin API (auto-confirmed).
// 2. The handle_new_user trigger auto-inserts a profiles row for each.
// 3. Sign in as A using the anon key, SELECT from profiles, assert exactly
//    one row returned (A's own) and that A cannot see B.
// 4. Clean up both users (cascade removes their profiles rows).

import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8')
    .split('\n').filter(Boolean)
    .map(l => l.split('=').map(s => s.trim()))
    .map(([k, ...v]) => [k, v.join('=')])
);

const URL   = env.SUPABASE_URL;
const ANON  = env.SUPABASE_ANON_KEY;
const SVC   = env.SUPABASE_SERVICE_ROLE_KEY;

const admin = createClient(URL, SVC, { auth: { persistSession: false } });

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
const emailA = `rls-a-${stamp}@example.test`;
const emailB = `rls-b-${stamp}@example.test`;
const password = 'Test-Pass-123!';

let failed = false;
function step(name, ok, detail = '') {
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) failed = true;
}

let userA, userB;

try {
  // Create both users
  const a = await admin.auth.admin.createUser({ email: emailA, password, email_confirm: true });
  if (a.error) throw new Error(`create A: ${a.error.message}`);
  userA = a.data.user;
  const b = await admin.auth.admin.createUser({ email: emailB, password, email_confirm: true });
  if (b.error) throw new Error(`create B: ${b.error.message}`);
  userB = b.data.user;

  // Trigger should have created both profiles
  const { data: bothProfiles } = await admin.from('profiles').select('id,email').in('id', [userA.id, userB.id]);
  step('trigger created both profiles', bothProfiles?.length === 2,
       `found ${bothProfiles?.length ?? 0}`);

  // Sign in as A with the anon client
  const anonA = createClient(URL, ANON, { auth: { persistSession: false } });
  const signIn = await anonA.auth.signInWithPassword({ email: emailA, password });
  if (signIn.error) throw new Error(`sign in A: ${signIn.error.message}`);
  step('A signed in', !!signIn.data.session);

  // A selects from profiles: must see exactly A's row
  const { data: visible, error: selErr } = await anonA.from('profiles').select('id,email');
  step('A select profiles succeeded', !selErr, selErr?.message);
  step('A sees exactly one row (own)', visible?.length === 1, `len=${visible?.length}`);
  step('A sees row id === A.id', visible?.[0]?.id === userA.id);
  step('A cannot see B', !visible?.some(r => r.id === userB.id));

  // Direct probe for B by id: must return empty
  const { data: probeB } = await anonA.from('profiles').select('id').eq('id', userB.id);
  step('A SELECT WHERE id=B → empty', (probeB?.length ?? 0) === 0);

  await anonA.auth.signOut();
} catch (e) {
  failed = true;
  console.error('Test threw:', e.message);
} finally {
  if (userA) await admin.auth.admin.deleteUser(userA.id).catch(() => {});
  if (userB) await admin.auth.admin.deleteUser(userB.id).catch(() => {});
}

if (failed) {
  console.error('\n❌ profile RLS test failed');
  process.exit(1);
}
console.log('\n✅ profile RLS isolates users');
```

- [ ] The test imports `@supabase/supabase-js` from node_modules — ensure it's installed:
  ```bash
  npm ls @supabase/supabase-js || npm install --no-save @supabase/supabase-js@2
  ```
- [ ] Run it:
  ```bash
  node scripts/test-profile-rls.mjs
  ```
  Expected: all checks pass; final line `✅ profile RLS isolates users`.
- [ ] Commit:
  ```bash
  git add scripts/test-profile-rls.mjs package.json package-lock.json
  git commit -m "Phase 1 WT-1: test-profile-rls verifies owner-only SELECT"
  ```

---

## Task 5 — Write `scripts/test-trigger-newsletter-backfill.mjs` and run it (TDD-style: write test, run, must pass)

**Why:** Proves the trigger's `update newsletter_subscribers set profile_id = new.id where email = new.email` arm works.

- [ ] Create `scripts/test-trigger-newsletter-backfill.mjs`:

```js
// WT-1 verification: handle_new_user backfills newsletter_subscribers.profile_id.
// 1. Insert an anonymous newsletter_subscribers row (profile_id = null).
// 2. Sign up a user with the same email via admin API (auto-confirmed).
// 3. Re-fetch the newsletter row and assert profile_id is now the new user.id.

import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8')
    .split('\n').filter(Boolean)
    .map(l => l.split('=').map(s => s.trim()))
    .map(([k, ...v]) => [k, v.join('=')])
);

const URL = env.SUPABASE_URL;
const SVC = env.SUPABASE_SERVICE_ROLE_KEY;
const admin = createClient(URL, SVC, { auth: { persistSession: false } });

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
const email = `backfill-${stamp}@example.test`;
const password = 'Test-Pass-123!';

let failed = false;
function step(name, ok, detail = '') {
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) failed = true;
}

let user;

try {
  // 1. Anonymous newsletter row
  const { error: insertErr } = await admin.from('newsletter_subscribers').insert({
    email, source: 'footer', profile_id: null,
  });
  if (insertErr) throw new Error(`seed newsletter: ${insertErr.message}`);
  const { data: pre } = await admin.from('newsletter_subscribers')
    .select('email,profile_id,source').eq('email', email).single();
  step('seeded newsletter row has profile_id=null', pre?.profile_id === null);

  // 2. Signup with same email
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw new Error(`create user: ${created.error.message}`);
  user = created.data.user;

  // 3. Re-fetch (small delay tolerates any trigger lag — should be sync but be safe)
  let post = null;
  for (let i = 0; i < 5 && !post?.profile_id; i++) {
    const r = await admin.from('newsletter_subscribers')
      .select('email,profile_id,source').eq('email', email).single();
    post = r.data;
    if (!post?.profile_id) await new Promise(r2 => setTimeout(r2, 200));
  }
  step('newsletter row exists post-signup', !!post);
  step('newsletter row profile_id backfilled', post?.profile_id === user.id,
       `expected=${user.id} got=${post?.profile_id}`);
  step('newsletter row source unchanged', post?.source === 'footer');
} catch (e) {
  failed = true;
  console.error('Test threw:', e.message);
} finally {
  if (user) await admin.auth.admin.deleteUser(user.id).catch(() => {});
  // Newsletter row's profile_id is now null again (FK on delete set null); remove the row.
  await admin.from('newsletter_subscribers').delete().eq('email', email).catch(() => {});
}

if (failed) {
  console.error('\n❌ newsletter backfill test failed');
  process.exit(1);
}
console.log('\n✅ trigger backfills newsletter_subscribers.profile_id');
```

- [ ] Run it:
  ```bash
  node scripts/test-trigger-newsletter-backfill.mjs
  ```
  Expected: green.
- [ ] Commit:
  ```bash
  git add scripts/test-trigger-newsletter-backfill.mjs
  git commit -m "Phase 1 WT-1: test-trigger-newsletter-backfill verifies trigger arm"
  ```

---

## Task 6 — Write `scripts/test-delete-rpc.mjs` and run it

**Why:** Proves `delete_my_account()` removes `auth.users` + `profiles` AND turns the newsletter row's `profile_id` into NULL (per the FK alter). Does NOT seed measurements rows (those tables ship in WT-3).

- [ ] Create `scripts/test-delete-rpc.mjs`:

```js
// WT-1 verification: delete_my_account() RPC cleans up identity rows.
// 1. Admin creates a confirmed user with opted_in_newsletter=true → trigger
//    creates a profiles row AND a newsletter_subscribers row.
// 2. Sign in as the user with the anon key, call rpc('delete_my_account').
// 3. Assert: auth.users row gone (admin getUser returns null user),
//    profiles row gone, newsletter row still exists with profile_id=null.

import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8')
    .split('\n').filter(Boolean)
    .map(l => l.split('=').map(s => s.trim()))
    .map(([k, ...v]) => [k, v.join('=')])
);

const URL  = env.SUPABASE_URL;
const ANON = env.SUPABASE_ANON_KEY;
const SVC  = env.SUPABASE_SERVICE_ROLE_KEY;
const admin = createClient(URL, SVC, { auth: { persistSession: false } });

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
const email = `delete-rpc-${stamp}@example.test`;
const password = 'Test-Pass-123!';

let failed = false;
function step(name, ok, detail = '') {
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) failed = true;
}

let userId;

try {
  // 1. Create user (opted in at signup → newsletter row created by trigger)
  const created = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
    user_metadata: { full_name: 'Delete Test', opted_in_newsletter: true },
  });
  if (created.error) throw new Error(`create: ${created.error.message}`);
  userId = created.data.user.id;

  const { data: profileBefore } = await admin.from('profiles').select('id,email').eq('id', userId).maybeSingle();
  step('profiles row exists pre-delete', profileBefore?.id === userId);

  const { data: newsBefore } = await admin.from('newsletter_subscribers')
    .select('email,profile_id,source').eq('email', email).maybeSingle();
  step('newsletter row exists with profile_id pre-delete', newsBefore?.profile_id === userId,
       `profile_id=${newsBefore?.profile_id} source=${newsBefore?.source}`);

  // 2. Sign in as the user, call RPC
  const anonC = createClient(URL, ANON, { auth: { persistSession: false } });
  const signIn = await anonC.auth.signInWithPassword({ email, password });
  if (signIn.error) throw new Error(`sign in: ${signIn.error.message}`);

  const { error: rpcErr } = await anonC.rpc('delete_my_account');
  step('rpc delete_my_account returned no error', !rpcErr, rpcErr?.message);

  // 3. Assertions via admin client
  const { data: gone } = await admin.auth.admin.getUserById(userId);
  step('auth.users row removed', !gone?.user);

  const { data: profileAfter } = await admin.from('profiles').select('id').eq('id', userId).maybeSingle();
  step('profiles row cascaded', !profileAfter);

  const { data: newsAfter } = await admin.from('newsletter_subscribers')
    .select('email,profile_id').eq('email', email).maybeSingle();
  step('newsletter row preserved', !!newsAfter);
  step('newsletter profile_id NULLed via FK', newsAfter?.profile_id === null,
       `profile_id=${newsAfter?.profile_id}`);

  await anonC.auth.signOut().catch(() => {});
  userId = null; // already deleted
} catch (e) {
  failed = true;
  console.error('Test threw:', e.message);
} finally {
  if (userId) await admin.auth.admin.deleteUser(userId).catch(() => {});
  await admin.from('newsletter_subscribers').delete().eq('email', email).catch(() => {});
}

if (failed) {
  console.error('\n❌ delete RPC test failed');
  process.exit(1);
}
console.log('\n✅ delete_my_account removes identity, preserves newsletter (FK SET NULL)');
```

- [ ] Run it:
  ```bash
  node scripts/test-delete-rpc.mjs
  ```
  Expected: green.
- [ ] Commit:
  ```bash
  git add scripts/test-delete-rpc.mjs
  git commit -m "Phase 1 WT-1: test-delete-rpc verifies RPC + FK SET NULL behaviour"
  ```

---

## Task 7 — Write `js/auth.js` skeleton + ESM exports of every spec §6.1 symbol (no implementation yet)

**Why:** Lock the public API surface first. Subsequent tasks add the real implementations under TDD. The skeleton lets consumers (header swap, future Phase 1 pages) import without breaking.

- [ ] Create `js/auth.js`:

```js
// =============================================================================
// CRF Auth — public API
// =============================================================================
// Wraps @supabase/supabase-js (loaded from esm.sh — same as js/data-loader.js)
// with a stable, documented surface for every auth flow Phase 1 needs.
//
// All auth methods return { data, error } and NEVER throw on auth errors;
// unexpected network errors propagate normally.
//
// On import this module also auto-mounts a header [data-account-link] swap:
// signed-out → /login.html, signed-in → /account.html. The swap waits for the
// Phase 0 'crf:layout-ready' event before binding, and re-paints on every
// auth-state change.
// =============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL  = 'https://fzgsogdceptjvuahukbn.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ6Z3NvZ2RjZXB0anZ1YWh1a2JuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg2MTM3NTUsImV4cCI6MjA5NDE4OTc1NX0.OnVVRW9X79ab730VqNqO_zYrpW2YhuWGteGUxVkfkrA';

export const supabaseAuth = createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: 'sb-fzgsogdceptjvuahukbn-auth-token',
  },
});

// ---------------------------------------------------------------------------
// Client accessor — WT-2's js/profile.js + tests import this.
// ---------------------------------------------------------------------------

export function getSupabase() {
  return supabaseAuth;
}

// ---------------------------------------------------------------------------
// Read-only state
// ---------------------------------------------------------------------------

export async function getSession() {
  const { data } = await supabaseAuth.auth.getSession();
  return data?.session ?? null;
}

export async function getUser() {
  const { data } = await supabaseAuth.auth.getUser();
  return data?.user ?? null;
}

export function onAuthChange(callback) {
  const { data } = supabaseAuth.auth.onAuthStateChange((event, session) => {
    callback(event, session);
  });
  return () => data?.subscription?.unsubscribe?.();
}

// ---------------------------------------------------------------------------
// Mutations — every method returns { data, error }
// ---------------------------------------------------------------------------

export async function signUp({ email, password, full_name, opted_in_newsletter }) {
  return supabaseAuth.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: full_name ?? '',
        opted_in_newsletter: !!opted_in_newsletter,
      },
      emailRedirectTo: `${location.origin}/login.html?confirmed=1`,
    },
  });
}

export async function signInWithPassword({ email, password }) {
  return supabaseAuth.auth.signInWithPassword({ email, password });
}

export async function signOut() {
  return supabaseAuth.auth.signOut();
}

export async function resetPasswordForEmail(email) {
  return supabaseAuth.auth.resetPasswordForEmail(email, {
    redirectTo: `${location.origin}/reset-password.html`,
  });
}

export async function updatePassword(newPassword) {
  return supabaseAuth.auth.updateUser({ password: newPassword });
}

// ---------------------------------------------------------------------------
// Route guards
// ---------------------------------------------------------------------------

export async function requireAuth({ redirectTo = '/login.html' } = {}) {
  const session = await getSession();
  if (!session) {
    const next = encodeURIComponent(location.pathname + location.search);
    location.replace(`${redirectTo}?next=${next}`);
    return null;
  }
  return session;
}

export async function requireGuest({ redirectTo = '/account.html' } = {}) {
  const session = await getSession();
  if (session) {
    location.replace(redirectTo);
    return null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Account management
// ---------------------------------------------------------------------------

export async function deleteAccount() {
  return supabaseAuth.rpc('delete_my_account');
}

// ---------------------------------------------------------------------------
// Header [data-account-link] auto-mount
// ---------------------------------------------------------------------------

function paintAccountLink(session) {
  const link = document.querySelector('[data-account-link]');
  if (!link) return;
  if (session) {
    link.setAttribute('href', '/account.html');
    link.setAttribute('aria-label', 'My account');
    link.dataset.state = 'signed-in';
  } else {
    link.setAttribute('href', '/login.html');
    link.setAttribute('aria-label', 'Sign in');
    link.dataset.state = 'signed-out';
  }
}

function bindHeaderSwap() {
  getSession().then(paintAccountLink);
  onAuthChange((_event, session) => paintAccountLink(session));
}

if (typeof document !== 'undefined') {
  if (document.querySelector('[data-account-link]')) {
    bindHeaderSwap();
  } else {
    document.addEventListener('crf:layout-ready', bindHeaderSwap, { once: true });
  }
}
```

- [ ] Commit the skeleton:
  ```bash
  git add js/auth.js
  git commit -m "Phase 1 WT-1: js/auth.js — public API + header [data-account-link] auto-mount"
  ```

---

## Task 8 — TDD: write `scripts/test-auth-module-shape.mjs` for unit-level guarantees

**Why:** Quick unit test that imports `js/auth.js` via puppeteer (so it gets a DOM + the real esm.sh client) and asserts every exported symbol is present and is a function — and that `getSession()` returns `null` on a fresh page with no session.

- [ ] Create `scripts/test-auth-module-shape.mjs`:

```js
// WT-1 unit test: js/auth.js exports the spec §6.1 surface and getSession()
// returns null in a fresh session.
// Hits a tiny throwaway HTML page served by serve.mjs that just imports auth.js
// and exposes the module on window for inspection.

import puppeteer from 'puppeteer';

const PROBE_URL = 'http://localhost:3000/scripts/__probe-auth.html';

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1024, height: 768 });

let failed = false;
function step(name, ok, detail = '') {
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) failed = true;
}

try {
  await page.goto(PROBE_URL, { waitUntil: 'networkidle0', timeout: 30000 });

  await page.waitForFunction(() => !!window.__auth, { timeout: 10000 });

  const surface = await page.evaluate(() => {
    const m = window.__auth;
    const wanted = [
      'getSession','getUser','onAuthChange',
      'signUp','signInWithPassword','signOut',
      'resetPasswordForEmail','updatePassword',
      'requireAuth','requireGuest',
      'deleteAccount',
    ];
    const out = {};
    for (const k of wanted) out[k] = typeof m[k];
    return out;
  });

  for (const [name, type] of Object.entries(surface)) {
    step(`exports ${name} as function`, type === 'function', `got ${type}`);
  }

  // getSession() in a fresh tab with no auth token in localStorage
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForFunction(() => !!window.__auth);
  const sess = await page.evaluate(async () => await window.__auth.getSession());
  step('getSession() returns null without a session', sess === null, `got ${JSON.stringify(sess)}`);
} catch (e) {
  failed = true;
  console.error('Test threw:', e.message);
} finally {
  await browser.close();
}

if (failed) {
  console.error('\n❌ auth module shape test failed');
  process.exit(1);
}
console.log('\n✅ js/auth.js exports full spec §6.1 surface');
```

- [ ] Create the probe HTML at `scripts/__probe-auth.html` (deliberately under `scripts/` so it's not part of the user-facing site but `serve.mjs` will still serve it):

```html
<!doctype html>
<html><head><meta charset="utf-8"><title>auth probe</title></head>
<body>
<script type="module">
  import * as auth from '/js/auth.js';
  window.__auth = auth;
</script>
</body></html>
```

- [ ] Make sure `serve.mjs` is running in the background. From the WT-1 root:
  ```bash
  (lsof -ti:3000 >/dev/null) || node serve.mjs &
  ```
- [ ] Run the test:
  ```bash
  node scripts/test-auth-module-shape.mjs
  ```
  Expected: green.
- [ ] Commit:
  ```bash
  git add scripts/test-auth-module-shape.mjs scripts/__probe-auth.html
  git commit -m "Phase 1 WT-1: test-auth-module-shape locks public API surface"
  ```

---

## Task 9 — Write `scripts/test-auth-roundtrip.mjs` (puppeteer end-to-end: signup → confirm → sign in → sign out)

**Why:** Spec §9.1 WT-1 gate. Exercises `signUp` / `signInWithPassword` / `getSession` / `signOut` from a real browser.

- [ ] Create `scripts/test-auth-roundtrip.mjs`:

```js
// WT-1 end-to-end: signup → admin auto-confirm → signInWithPassword →
// getSession returns user → signOut → getSession returns null.
// Driven through the real js/auth.js module loaded into the probe page.

import puppeteer from 'puppeteer';
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8')
    .split('\n').filter(Boolean)
    .map(l => l.split('=').map(s => s.trim()))
    .map(([k, ...v]) => [k, v.join('=')])
);
const URL = env.SUPABASE_URL;
const SVC = env.SUPABASE_SERVICE_ROLE_KEY;
const admin = createClient(URL, SVC, { auth: { persistSession: false } });

const PROBE_URL = 'http://localhost:3000/scripts/__probe-auth.html';

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
const email = `roundtrip-${stamp}@example.test`;
const password = 'Test-Pass-123!';

let failed = false;
function step(name, ok, detail = '') {
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) failed = true;
}

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1024, height: 768 });

let userId;

try {
  await page.goto(PROBE_URL, { waitUntil: 'networkidle0', timeout: 30000 });
  await page.waitForFunction(() => !!window.__auth);
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForFunction(() => !!window.__auth);

  // Sign up via auth.js
  const signupRes = await page.evaluate(async (email, password) => {
    const r = await window.__auth.signUp({ email, password, full_name: 'Roundtrip User', opted_in_newsletter: false });
    return { ok: !r.error, error: r.error?.message ?? null, hasUser: !!r.data?.user };
  }, email, password);
  step('signUp returned no error', signupRes.ok, signupRes.error);
  step('signUp returned data.user', signupRes.hasUser);

  // Find the user via admin and confirm them (bypass email click)
  const lookup = await admin.auth.admin.listUsers();
  const found = lookup.data?.users?.find(u => u.email === email);
  step('user exists in auth.users', !!found);
  if (!found) throw new Error('aborting: no user');
  userId = found.id;

  if (!found.email_confirmed_at) {
    const upd = await admin.auth.admin.updateUserById(userId, { email_confirm: true });
    step('admin confirmed email', !upd.error, upd.error?.message);
  }

  // signInWithPassword
  const signInRes = await page.evaluate(async (email, password) => {
    const r = await window.__auth.signInWithPassword({ email, password });
    return { ok: !r.error, error: r.error?.message ?? null, hasSession: !!r.data?.session };
  }, email, password);
  step('signInWithPassword no error', signInRes.ok, signInRes.error);
  step('signInWithPassword returned session', signInRes.hasSession);

  // getSession should now return a user
  const sess = await page.evaluate(async () => {
    const s = await window.__auth.getSession();
    return s ? { hasUser: !!s.user, email: s.user?.email } : null;
  });
  step('getSession returns a session post-signin', !!sess);
  step('session.user.email matches', sess?.email === email, `got ${sess?.email}`);

  // signOut
  const signOutRes = await page.evaluate(async () => {
    const r = await window.__auth.signOut();
    return { ok: !r.error, error: r.error?.message ?? null };
  });
  step('signOut no error', signOutRes.ok, signOutRes.error);

  // getSession null again
  const after = await page.evaluate(async () => await window.__auth.getSession());
  step('getSession returns null post-signout', after === null, `got ${JSON.stringify(after)}`);
} catch (e) {
  failed = true;
  console.error('Test threw:', e.message);
} finally {
  if (userId) await admin.auth.admin.deleteUser(userId).catch(() => {});
  await browser.close();
}

if (failed) {
  console.error('\n❌ auth roundtrip failed');
  process.exit(1);
}
console.log('\n✅ auth roundtrip: signup → confirm → signIn → signOut');
```

- [ ] Confirm `serve.mjs` is running on `:3000`. Run:
  ```bash
  node scripts/test-auth-roundtrip.mjs
  ```
  Expected: green.
- [ ] Commit:
  ```bash
  git add scripts/test-auth-roundtrip.mjs
  git commit -m "Phase 1 WT-1: test-auth-roundtrip end-to-end auth flow"
  ```

---

## Task 10 — Write `scripts/test-auth-guards.mjs` (route-guard unit test) and run it

**Why:** `requireAuth` and `requireGuest` redirect on the wrong session state. Cheap unit verification using the probe page.

- [ ] Create a second probe `scripts/__probe-guard.html` that calls a guard based on a query param so we can test both with one file:

```html
<!doctype html>
<html><head><meta charset="utf-8"><title>guard probe</title></head>
<body>
<script type="module">
  import * as auth from '/js/auth.js';
  const q = new URLSearchParams(location.search);
  const which = q.get('g');                       // 'auth' | 'guest'
  const redirectTo = q.get('to') || (which === 'auth' ? '/login.html' : '/account.html');
  window.__guardResult = null;
  (async () => {
    if (which === 'auth')  window.__guardResult = await auth.requireAuth({ redirectTo });
    if (which === 'guest') window.__guardResult = await auth.requireGuest({ redirectTo });
    window.__guardDone = true;
  })();
</script>
</body></html>
```

- [ ] Create `scripts/test-auth-guards.mjs`:

```js
// WT-1 unit: requireAuth redirects when no session; requireGuest redirects
// when a session exists. We intercept the location.replace call via a
// patched window.location.replace stub so the probe page never actually
// navigates away.

import puppeteer from 'puppeteer';
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8')
    .split('\n').filter(Boolean)
    .map(l => l.split('=').map(s => s.trim()))
    .map(([k, ...v]) => [k, v.join('=')])
);
const URL = env.SUPABASE_URL;
const SVC = env.SUPABASE_SERVICE_ROLE_KEY;
const admin = createClient(URL, SVC, { auth: { persistSession: false } });

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
const email = `guard-${stamp}@example.test`;
const password = 'Test-Pass-123!';

let failed = false;
function step(name, ok, detail = '') {
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) failed = true;
}

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1024, height: 768 });

let userId;

try {
  // Intercept navigations triggered by location.replace by aborting them.
  await page.setRequestInterception(true);
  const seenRedirects = [];
  page.on('request', req => {
    if (req.isNavigationRequest() && req.frame() === page.mainFrame()) {
      const url = req.url();
      // Allow the initial probe load + the same probe with ?g=
      if (url.includes('/scripts/__probe-guard.html')) return req.continue();
      seenRedirects.push(url);
      return req.abort();
    }
    return req.continue();
  });

  // Case 1: signed-out, requireAuth → should attempt /login.html?next=...
  await page.goto('http://localhost:3000/scripts/__probe-guard.html?g=auth', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__guardDone === true, { timeout: 5000 }).catch(() => {});
  // Either guardDone fired with null, OR we aborted on the redirect
  const sawLogin = seenRedirects.some(u => u.includes('/login.html'));
  step('requireAuth without session redirects to /login.html', sawLogin,
       `redirects=${JSON.stringify(seenRedirects)}`);

  // Create + confirm a user, sign them in via the probe, then test requireGuest
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw new Error(created.error.message);
  userId = created.data.user.id;

  seenRedirects.length = 0;

  // Use the auth probe to sign in (writes localStorage on origin)
  await page.goto('http://localhost:3000/scripts/__probe-auth.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__auth);
  await page.evaluate(async (email, password) => {
    await window.__auth.signInWithPassword({ email, password });
  }, email, password);

  seenRedirects.length = 0;

  // Case 2: signed-in, requireGuest → should redirect to /account.html
  await page.goto('http://localhost:3000/scripts/__probe-guard.html?g=guest', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__guardDone === true, { timeout: 5000 }).catch(() => {});
  const sawAccount = seenRedirects.some(u => u.includes('/account.html'));
  step('requireGuest with session redirects to /account.html', sawAccount,
       `redirects=${JSON.stringify(seenRedirects)}`);

  seenRedirects.length = 0;

  // Case 3: signed-in, requireAuth → no redirect, returns a session
  await page.goto('http://localhost:3000/scripts/__probe-guard.html?g=auth', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__guardDone === true, { timeout: 5000 });
  const guardResult = await page.evaluate(() => !!window.__guardResult);
  step('requireAuth with session does NOT redirect', seenRedirects.length === 0,
       `redirects=${JSON.stringify(seenRedirects)}`);
  step('requireAuth with session returns a session', guardResult);
} catch (e) {
  failed = true;
  console.error('Test threw:', e.message);
} finally {
  if (userId) await admin.auth.admin.deleteUser(userId).catch(() => {});
  await browser.close();
}

if (failed) {
  console.error('\n❌ guard test failed');
  process.exit(1);
}
console.log('\n✅ requireAuth / requireGuest behave correctly');
```

- [ ] Run it:
  ```bash
  node scripts/test-auth-guards.mjs
  ```
  Expected: green.
- [ ] Commit:
  ```bash
  git add scripts/__probe-guard.html scripts/test-auth-guards.mjs
  git commit -m "Phase 1 WT-1: test-auth-guards covers requireAuth/requireGuest"
  ```

---

## Task 11 — Smoke-test-first: write `scripts/test-header-account-swap.mjs` (puppeteer screenshot + assertion)

**Why:** Spec §9.1 WT-1 visual gate. Loads `index.html` signed-out and signed-in, screenshots both, and asserts the header `[data-account-link]` `href` and `data-state` toggle.

- [ ] Create `scripts/test-header-account-swap.mjs`:

```js
// WT-1 visual + behavioural: header [data-account-link] href + data-state
// flip with auth state. Two screenshots saved to ./temporary screenshots/.
//
// We import js/auth.js via the homepage (which loads it through a tiny
// inline <script type=module> hook we add for the test). Since the spec
// puts the auto-mount inside js/auth.js itself, any page that loads the
// module gets the swap for free. For this test we load auth.js by
// injecting it after the page navigates.

import puppeteer from 'puppeteer';
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8')
    .split('\n').filter(Boolean)
    .map(l => l.split('=').map(s => s.trim()))
    .map(([k, ...v]) => [k, v.join('=')])
);
const URL = env.SUPABASE_URL;
const SVC = env.SUPABASE_SERVICE_ROLE_KEY;
const admin = createClient(URL, SVC, { auth: { persistSession: false } });

const dir = path.join(process.cwd(), 'temporary screenshots');
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
function nextShot(label) {
  const existing = fs.readdirSync(dir).filter(f => f.endsWith('.png'));
  const nums = existing.map(f => parseInt(f.match(/screenshot-(\d+)/)?.[1] || '0')).filter(Boolean);
  const next = nums.length ? Math.max(...nums) + 1 : 1;
  return path.join(dir, `screenshot-${next}-${label}.png`);
}

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
const email = `headerswap-${stamp}@example.test`;
const password = 'Test-Pass-123!';

let failed = false;
function step(name, ok, detail = '') {
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) failed = true;
}

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });

let userId;

async function loadHomeWithAuth() {
  await page.goto('http://localhost:3000/index.html', { waitUntil: 'networkidle0', timeout: 30000 });
  await page.evaluate(() => new Promise(resolve => {
    if (document.querySelector('[data-account-link]')) return resolve();
    document.addEventListener('crf:layout-ready', () => resolve(), { once: true });
  }));
  // Inject js/auth.js so its auto-mount runs even before WT-2 wires it into pages.
  await page.addScriptTag({ url: 'http://localhost:3000/js/auth.js', type: 'module' });
  // Give the IIFE a tick to settle.
  await new Promise(r => setTimeout(r, 400));
}

try {
  // SIGNED OUT
  await loadHomeWithAuth();
  const out = await page.evaluate(() => {
    const a = document.querySelector('[data-account-link]');
    return { href: a?.getAttribute('href'), state: a?.dataset?.state, label: a?.getAttribute('aria-label') };
  });
  step('signed-out href = /login.html', out.href === '/login.html', `got ${out.href}`);
  step('signed-out data-state = signed-out', out.state === 'signed-out', `got ${out.state}`);
  step('signed-out aria-label = Sign in', out.label === 'Sign in');
  await page.screenshot({ path: nextShot('header-signed-out'), fullPage: false });

  // SIGNED IN — create + confirm user + sign in via auth.js
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw new Error(created.error.message);
  userId = created.data.user.id;

  await page.evaluate(async (email, password) => {
    const m = await import('/js/auth.js');
    await m.signInWithPassword({ email, password });
  }, email, password);
  // Wait one tick for onAuthChange → paint
  await new Promise(r => setTimeout(r, 300));

  // Reload so the page starts already-signed-in (covers both flows)
  await loadHomeWithAuth();
  const inn = await page.evaluate(() => {
    const a = document.querySelector('[data-account-link]');
    return { href: a?.getAttribute('href'), state: a?.dataset?.state, label: a?.getAttribute('aria-label') };
  });
  step('signed-in href = /account.html', inn.href === '/account.html', `got ${inn.href}`);
  step('signed-in data-state = signed-in', inn.state === 'signed-in', `got ${inn.state}`);
  step('signed-in aria-label = My account', inn.label === 'My account');
  await page.screenshot({ path: nextShot('header-signed-in'), fullPage: false });
} catch (e) {
  failed = true;
  console.error('Test threw:', e.message);
} finally {
  if (userId) await admin.auth.admin.deleteUser(userId).catch(() => {});
  await browser.close();
}

if (failed) {
  console.error('\n❌ header account-swap test failed');
  process.exit(1);
}
console.log('\n✅ header [data-account-link] swaps with auth state');
```

- [ ] Run the test (serve.mjs must be running on :3000):
  ```bash
  node scripts/test-header-account-swap.mjs
  ```
  Expected: green. Two screenshots in `temporary screenshots/`.
- [ ] Open both screenshots with the Read tool and eyeball that the account icon is visible in both states.
- [ ] Commit:
  ```bash
  git add scripts/test-header-account-swap.mjs
  git commit -m "Phase 1 WT-1: test-header-account-swap verifies header session UX"
  ```

---

## Task 12 — Re-run the entire Phase 0 + Phase 1 WT-1 test matrix; verify all green

**Why:** Spec §9.1 — "All Phase 0 tests still pass" is part of the gate.

- [ ] Confirm `serve.mjs` is running on `:3000`. If not:
  ```bash
  node serve.mjs &
  ```
- [ ] Run every test sequentially, fail fast:
  ```bash
  node scripts/test-layout-mount.mjs && \
  node scripts/test-newsletter-submit.mjs && \
  node scripts/test-customizer-flow.mjs && \
  node scripts/test-design-hero-rail.mjs && \
  node scripts/test-swatch-prefers-hero.mjs && \
  node scripts/test-token-discipline.mjs && \
  node scripts/test-profile-rls.mjs && \
  node scripts/test-trigger-newsletter-backfill.mjs && \
  node scripts/test-delete-rpc.mjs && \
  node scripts/test-auth-module-shape.mjs && \
  node scripts/test-auth-roundtrip.mjs && \
  node scripts/test-auth-guards.mjs && \
  node scripts/test-header-account-swap.mjs
  ```
  Expected: every script exits 0; final stdout is the last test's `✅` line.
- [ ] If any test fails, do NOT proceed. Use superpowers:systematic-debugging on the failure before continuing.

---

## Task 13 — Update PROJECT.md inventory and write the PR

**Why:** PROJECT.md is the running ledger of what's shipped; WT-1 should self-document.

- [ ] Open `PROJECT.md`, find the "Phase 1 hooks/notes" / "Shipped inventory" section (or equivalent — last edit was commit `c1eda26`). Append a new subsection:
  ```markdown
  ### Phase 1 WT-1 — auth foundation (in flight)

  - **DB** `db/08_profiles.sql` — `profiles` table + RLS (owner-only select/update),
    `handle_new_user` trigger (mirrors `auth.users.email`, backfills
    `newsletter_subscribers.profile_id`, inserts newsletter row on opt-in),
    `delete_my_account()` RPC, `newsletter_subscribers.profile_id` re-asserted as
    `on delete set null`.
  - **JS** `js/auth.js` — public API per Phase 1 spec §6.1: `getSession`,
    `getUser`, `onAuthChange`, `signUp`, `signInWithPassword`, `signOut`,
    `resetPasswordForEmail`, `updatePassword`, `requireAuth`, `requireGuest`,
    `deleteAccount`. Auto-mounts header `[data-account-link]` swap on
    `crf:layout-ready`.
  - **Tests** `test-profile-rls`, `test-trigger-newsletter-backfill`,
    `test-delete-rpc`, `test-auth-module-shape`, `test-auth-roundtrip`,
    `test-auth-guards`, `test-header-account-swap` — all green; Phase 0 suite
    still green.
  ```
- [ ] Commit the doc update:
  ```bash
  git add PROJECT.md
  git commit -m "Phase 1 WT-1: PROJECT.md — record auth-foundation shipped inventory"
  ```
- [ ] Push the branch and open the PR:
  ```bash
  git push -u origin phase-1/auth-foundation
  gh pr create --title "Phase 1 WT-1: auth foundation (profiles, RLS, js/auth.js, header swap)" --body "$(cat <<'EOF'
## Summary
- `db/08_profiles.sql` — `profiles` table, RLS, `handle_new_user` trigger, `delete_my_account` RPC, re-asserted FK on `newsletter_subscribers.profile_id`.
- `js/auth.js` — public API surface per spec §6.1 + auto-mounted header `[data-account-link]` swap.
- 7 new test scripts; full Phase 0 + Phase 1 WT-1 suite green.

## Test plan
- [x] `node scripts/run-sql.mjs db/08_profiles.sql` applies clean, second run is a no-op.
- [x] `node scripts/test-profile-rls.mjs`
- [x] `node scripts/test-trigger-newsletter-backfill.mjs`
- [x] `node scripts/test-delete-rpc.mjs`
- [x] `node scripts/test-auth-module-shape.mjs`
- [x] `node scripts/test-auth-roundtrip.mjs`
- [x] `node scripts/test-auth-guards.mjs`
- [x] `node scripts/test-header-account-swap.mjs`
- [x] Phase 0 suite: `test-layout-mount`, `test-newsletter-submit`, `test-customizer-flow`, `test-design-hero-rail`, `test-swatch-prefers-hero`, `test-token-discipline` — all green.

## Notes for reviewer
- Migration is idempotent (drop-if-exists policies/triggers, create-or-replace functions).
- `js/auth.js` is consumer-agnostic: header swap auto-binds when a `[data-account-link]` element is present. WT-2 will load it from `signup/login/forgot/reset/account` pages; WT-1 ships it inert on existing pages.
- WT-3's measurements cascade is not exercised here — that's covered by `test-measurements-cascade.mjs` in WT-3.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
  ```
- [ ] Capture the PR URL from `gh pr create` output and post it back to the user.

---

## Self-review

**1. Spec coverage check (every WT-1 acceptance criterion has a task):**

| Spec §9.1 WT-1 gate | Plan task |
|---|---|
| `db/08_profiles.sql` applies clean; idempotent re-run | Task 2 + Task 3 |
| `test-auth-roundtrip.mjs` | Task 9 |
| `test-trigger-newsletter-backfill.mjs` | Task 5 |
| `test-profile-rls.mjs` | Task 4 |
| `test-delete-rpc.mjs` | Task 6 |
| Header swap visual | Task 11 |
| All Phase 0 tests still pass | Task 12 |
| `js/auth.js` per §6.1 (getSession/getUser/onAuthChange/signUp/signInWithPassword/signOut/resetPasswordForEmail/updatePassword/requireAuth/requireGuest/deleteAccount) | Task 7 (skeleton) + Task 8 (shape unit) + Task 9 (roundtrip) + Task 10 (guards) |
| Header `[data-account-link]` swap per §6.3 | Task 7 (auto-mount in js/auth.js) + Task 11 (verification) |
| `newsletter_subscribers.profile_id` FK ON DELETE SET NULL | Task 2 (declared) + Task 6 (verified by `test-delete-rpc`) |

**2. Placeholder scan:** zero TBD/TODO/"implement later" — every code block is final.

**3. Type/name consistency:**
- `getSession` (not `getCurrentSession`) — used everywhere.
- `getUser` (not `getCurrentUser`).
- `signInWithPassword` (Supabase canonical name) — used everywhere.
- `signOut` (not `logout`, not `signout`).
- `deleteAccount` on the JS side; `delete_my_account` on the SQL side. Both names appear consistently throughout.
- `[data-account-link]` selector spelled identically in `components/header.html`, `js/auth.js`, and tests.
- `paintAccountLink` is the single name for the swap function.
- All test scripts follow the `scripts/test-<kebab-name>.mjs` convention used by Phase 0.

**4. Cross-cutting check:** No task assumes WT-3 (measurements) is merged. `test-delete-rpc.mjs` explicitly does NOT seed measurement rows; the cross-table cascade verification is deferred to WT-3's `test-measurements-cascade.mjs` per spec §9.1 WT-1.

**5. TDD discipline check:**
- SQL migration: migration written → applied → verification tests (Tasks 4–6) added in separate commits. ✓
- `js/auth.js`: skeleton committed → shape unit test → roundtrip → guards → each in its own commit. The shape test (Task 8) is the failing-first probe; the implementation in Task 7 makes it pass. ✓
- Header swap: dedicated puppeteer smoke test (Task 11) follows the same module that already binds the swap; runs against the homepage. ✓
