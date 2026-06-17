# Phase 1 WT-2: Auth Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the five customer-facing auth pages (`signup.html`, `login.html`, `forgot-password.html`, `reset-password.html`, `account.html`), the `js/profile.js` module, and the self-serve delete-account UI on top of the auth foundation merged by WT-1.

**Architecture:** Five new static HTML pages + one new ES module (`js/profile.js`). All auth state, session handling, and the `data-account-link` header swap come from `js/auth.js` (WT-1). The pages talk to Supabase exclusively through `js/auth.js` (auth) and `js/profile.js` (profile CRUD). Every page carries the Phase 1 CSP `<meta>` baseline (delivered by WT-4) directly in its `<head>` and reuses the Phase 0 `css/base.css` design tokens — no new globals.

**Tech Stack:** static HTML/CSS/vanilla-JS, `css/base.css` tokens from Phase 0, `js/auth.js` from WT-1, puppeteer for tests.

**Spec reference:** [`docs/superpowers/specs/2026-06-16-phase-1-design.md`](../specs/2026-06-16-phase-1-design.md)

---

## Prerequisites — read before Task 1

This worktree (WT-2) is **Wave 2** of Phase 1. It **cannot start** until the following have been merged to `main`:

1. **WT-1 (`phase-1/auth-foundation`)** must be merged. It delivers:
   - `db/08_profiles.sql` — `profiles` table + RLS + `handle_new_user` trigger + `delete_my_account()` RPC.
   - `js/auth.js` — the full public API listed in spec §6.1 (`getSession`, `getUser`, `onAuthChange`, `signUp`, `signInWithPassword`, `signOut`, `resetPasswordForEmail`, `updatePassword`, `requireAuth`, `requireGuest`, `deleteAccount`).
   - The header's `[data-account-link]` hook auto-bound on `crf:layout-ready`.
2. **WT-4 (`phase-1/privacy-csp`)** must be merged (Wave 1, before WT-2 starts). It delivers the CSP `<meta>` block that every page in this plan embeds verbatim.

Before Task 1, run:

```bash
git checkout main
git pull --ff-only
git log --oneline -10
```

Confirm you see the WT-1 and WT-4 squash-merge commits. If either is missing, stop and resolve before continuing — this plan assumes both exist.

**Do not reimplement anything from WT-1.** No new database migrations, no edits to `components/header.html` for the account icon, no `auth.js` additions. If a need arises, file it as a follow-up — WT-2 only ships UI + `js/profile.js`.

---

## File Plan

**Created:**
- `signup.html` — sign-up form (full name + email + password + newsletter)
- `login.html` — sign-in form + status banners + forgot/sign-up links
- `forgot-password.html` — constant-time reset request form
- `reset-password.html` — new-password form keyed off the URL fragment session
- `account.html` — profile edit + measurements stub + danger zone (delete account)
- `js/profile.js` — `getMyProfile`, `updateMyProfile`, `getLatestMeasurements`, `saveMeasurements`
- `scripts/test-profile-module.mjs` — node-level smoke for `js/profile.js` exports + getMyProfile/updateMyProfile against a test user
- `scripts/test-signup-flow.mjs` — full signup → check_email → confirm → confirmed → /account.html puppeteer flow
- `scripts/test-forgot-reset.mjs` — request reset → fetch link via admin API → reset → sign in with new password
- `scripts/test-account-profile-crud.mjs` — sign in → edit profile → save → reload → assert persisted
- `scripts/test-account-delete.mjs` — sign in → delete-account modal → assert `/?account_deleted=1` + signed out + auth.users row gone
- `scripts/test-route-guards.mjs` — `requireAuth` / `requireGuest` redirects

**Modified:**
- None outside the 5 new HTML pages, `js/profile.js`, and the new test scripts. `PROJECT.md` is updated at Phase 1 close-out, not in this worktree.

**Tooling assumed already in place (from WT-1):**
- `.env.local` contains `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (gitignored).
- `scripts/run-sql.mjs` exists for migrations (not used in this worktree).
- Tests already in repo: `scripts/test-customizer-flow.mjs`, `scripts/test-design-hero-rail.mjs`, `scripts/test-swatch-prefers-hero.mjs`, `scripts/test-layout-mount.mjs`, `scripts/test-newsletter-submit.mjs`, `scripts/test-token-discipline.mjs` (Phase 0); `scripts/test-auth-roundtrip.mjs`, `scripts/test-trigger-newsletter-backfill.mjs`, `scripts/test-profile-rls.mjs`, `scripts/test-delete-rpc.mjs` (WT-1); plus WT-3 / WT-4 scripts.

---

## Task 1: Worktree + branch + prerequisite check

**Files:** none yet — worktree creation only.

- [ ] **Step 1: Verify main is clean and has WT-1 + WT-4 merged**

```bash
git status --short
git log --oneline -10
```

Expected: clean working tree on `main`; `git log` shows squash commits for `Phase 1 WT-1` and `Phase 1 WT-4`. If either is missing, stop.

- [ ] **Step 2: Invoke `superpowers:using-git-worktrees`**

Use the `superpowers:using-git-worktrees` skill. Create the worktree:

```bash
git worktree add ../crf-wt-phase-1-auth-pages -b phase-1/auth-pages main
cd ../crf-wt-phase-1-auth-pages
```

All subsequent tasks run from inside that worktree.

- [ ] **Step 3: Verify prerequisites exist in the worktree**

```bash
test -f js/auth.js && echo "auth.js OK" || echo "MISSING auth.js"
test -f db/08_profiles.sql && echo "08_profiles.sql OK" || echo "MISSING"
grep -q "data-account-link" components/header.html && echo "account hook OK" || echo "MISSING"
grep -q "Content-Security-Policy" components/header.html && echo "CSP-in-header OK" || echo "MISSING"
```

All four must print `OK`. If any prints `MISSING`, stop — WT-1 or WT-4 did not land what this plan expects.

- [ ] **Step 4: Confirm dev server**

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000
```

If `200`, the server is up (do not start a second instance per CLAUDE.md). Otherwise:

```bash
node serve.mjs &
sleep 1
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000   # expect 200
```

- [ ] **Step 5: Confirm `.env.local` is reachable from the worktree**

```bash
test -f .env.local && grep -E "^(SUPABASE_URL|SUPABASE_ANON_KEY|SUPABASE_SERVICE_ROLE_KEY)=" .env.local | wc -l
```

Expect `3`. If `0`, copy `.env.local` from the main checkout (it's gitignored and does not propagate via `git worktree add`).

---

## Task 2: Invoke the `frontend-design:frontend-design` skill for the shared auth-page treatment

**Files:** none — this task produces a design mock you reference in Tasks 6–11.

- [ ] **Step 1: Invoke the skill**

Per CLAUDE.md ("Invoke the `frontend-design` skill before writing any frontend code, every session, no exceptions"), call the `frontend-design:frontend-design` skill **once** with the following brief. The output guides the inline `<style>` blocks for the 5 new pages — do not re-invoke per page.

Brief (paste verbatim into the skill prompt):

> Design a shared visual treatment for five Country Road Fashions auth pages: `signup.html`, `login.html`, `forgot-password.html`, `reset-password.html`, and `account.html`. The first four are single-column centered card forms with `max-width: 440px`. `account.html` is a two-column layout at 1440px (left sidebar with section nav: Profile, Measurements, Danger zone; right content area), stacking to one column at 375px.
>
> Brand spine (fixed — do not change):
> - Font stack: Cormorant Garamond (serif, headings) + Raleway (sans, body) — loaded via Google Fonts.
> - Tokens (must use, never override): `--color-jet #0E0F11`, `--color-charcoal #1A1B1F`, `--color-stone #B6ADA5`, `--color-stone-soft #D9D2CA`, `--color-cream #FBF9F6`, `--color-off-white #FAF8F4`, `--color-ink #2A2A2E`, `--color-muted #6B6B70`, `--color-rule rgba(14,15,17,0.08)`.
> - Buttons: `.btn .btn--primary` (jet fill) and `.btn .btn--ghost` (jet outline). Never `.btn-primary`.
> - Form controls: `.field` + `.input` (already defined in `css/base.css` §6).
> - Existing site header is sticky at 72px tall on jet (`var(--color-jet)`); existing footer is full-width charcoal.
>
> Constraints (Phase 0 anti-generic guardrails):
> - No default Tailwind palette. No flat `shadow-md`. No `transition: all`. Only `transform` + `opacity` are animated.
> - All hover / focus-visible / active states present on every interactive element.
> - Page background should remain `var(--color-off-white)` (matches the site body).
>
> Deliver one shared inline `<style>` snippet that defines `.auth-card`, `.auth-card__title`, `.auth-card__sub`, `.auth-card__form`, `.auth-card__row`, `.auth-card__cta`, `.auth-card__foot`, `.auth-status` (for `?check_email=1` / `?confirmed=1` / `?reset=1` banners), and `.danger-zone` (for account.html). Plus the `.account-layout` two-column grid (sidebar 240px + content 1fr) collapsing to one column under 720px. Provide example HTML markup for one signup card showing how `.auth-card` composes with the existing `.field` / `.input` / `.btn--primary` classes.

- [ ] **Step 2: Capture the skill output**

Save the proposed `.auth-card` / `.account-layout` / `.danger-zone` CSS snippet at the top of your notes for this worktree. Subsequent tasks paste it into the inline `<style>` of each page. Spacing tokens, color tokens, and class names must remain identical across all five pages (one visual system, five pages).

- [ ] **Step 3: Sanity-check vs. brand guardrails**

Confirm the proposed CSS:
- Uses zero `#000` / `#fff` hardcodes (only `var(--color-*)` references).
- Uses zero `transition: all`.
- Pairs Cormorant Garamond on headings + Raleway on body.
- Does not introduce a new color outside the spec list.

If any check fails, re-prompt the skill before moving on.

---

## Task 3: TDD `getMyProfile()` in `js/profile.js`

**Files:**
- Create: `scripts/test-profile-module.mjs`
- Create: `js/profile.js`

- [ ] **Step 1: Invoke `superpowers:test-driven-development`**

Confirm the red→green→commit discipline before writing code.

- [ ] **Step 2: Write the failing test**

Create `scripts/test-profile-module.mjs`:

```js
// WT-2 — node smoke for js/profile.js. Uses the service-role key to seed a test
// user, then signs in with the anon key + that user's password and exercises
// getMyProfile + updateMyProfile against the live profiles table.
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { getMyProfile, updateMyProfile } from '../js/profile.js';

const URL    = process.env.SUPABASE_URL;
const ANON   = process.env.SUPABASE_ANON_KEY;
const SVC    = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !ANON || !SVC) { console.error('missing env'); process.exit(2); }

const admin = createClient(URL, SVC, { auth: { persistSession: false } });
const user  = createClient(URL, ANON, { auth: { persistSession: false } });

const email = `wt2-profile-${Date.now()}@example.com`;
const pw    = 'Correct-Horse-Battery-9!';

let failures = 0;
const must = (cond, msg) => { if (!cond) { console.error('✘', msg); failures++; } else console.log('✓', msg); };

// 1. seed user
const { data: created, error: cErr } =
  await admin.auth.admin.createUser({ email, password: pw, email_confirm: true,
    user_metadata: { full_name: 'Jane Test', opted_in_newsletter: false } });
must(!cErr && created?.user?.id, `create user → ${cErr?.message || 'ok'}`);

// 2. sign in as that user (anon client gets a session)
const { data: sess, error: sErr } = await user.auth.signInWithPassword({ email, password: pw });
must(!sErr && sess?.session, `signIn → ${sErr?.message || 'ok'}`);

// 3. getMyProfile must read the profile row created by the trigger
globalThis.__crfSupabaseForTests = user; // js/profile.js reads this in test mode
const profile = await getMyProfile();
must(profile && profile.id === created.user.id, 'getMyProfile returns row for current user');
must(profile?.email === email, 'profile.email mirrors auth.users.email');
must(profile?.full_name === 'Jane Test', 'profile.full_name was populated by the trigger');

// 4. updateMyProfile persists
const upd = await updateMyProfile({ full_name: 'Jane Updated', phone: '+66 81 234 5678', opted_in_newsletter: true });
must(!upd.error, `updateMyProfile no error → ${upd.error?.message || 'ok'}`);
const after = await getMyProfile();
must(after?.full_name === 'Jane Updated', 'full_name persisted');
must(after?.phone === '+66 81 234 5678', 'phone persisted');
must(after?.opted_in_newsletter === true, 'opted_in_newsletter persisted');

// 5. cleanup
await admin.auth.admin.deleteUser(created.user.id);

if (failures) { console.error(`\n❌ ${failures} failure(s)`); process.exit(1); }
console.log('\n✅ test-profile-module clean');
```

Run it and confirm it fails with "Cannot find module '../js/profile.js'":

```bash
node scripts/test-profile-module.mjs
```

Expected: red.

- [ ] **Step 3: Implement just enough for `getMyProfile` to go green**

Create `js/profile.js`:

```js
// =============================================================================
// Country Road Fashions — js/profile.js
// =============================================================================
// Account-page CRUD for the profiles row + (defined-not-wired in Phase 1)
// measurement views/tables. All calls return { data, error } shaped objects
// from Supabase — never throw on REST errors.
//
// Auth dependency: this module assumes js/auth.js has already created the
// Supabase client and a user session exists. We import the same singleton.
// =============================================================================

import { getSupabase } from './auth.js';

// Tests can override the client by setting globalThis.__crfSupabaseForTests
// (used by scripts/test-profile-module.mjs).
function client() {
  return globalThis.__crfSupabaseForTests || getSupabase();
}

const PROFILE_COLUMNS =
  'id, email, full_name, phone, role, opted_in_newsletter, marketing_consent_at, created_at, updated_at';

export async function getMyProfile() {
  const sb = client();
  const { data: u } = await sb.auth.getUser();
  if (!u?.user) return null;
  const { data, error } = await sb
    .from('profiles')
    .select(PROFILE_COLUMNS)
    .eq('id', u.user.id)
    .single();
  if (error) { console.error('[profile] getMyProfile', error); return null; }
  return data;
}
```

Rerun:

```bash
node scripts/test-profile-module.mjs
```

If WT-1's `js/auth.js` does not export `getSupabase`, the test will fail with that import. WT-1 must export it; if not, file as a WT-1 bug — do not branch `js/profile.js` around it.

- [ ] **Step 4: Green — commit**

```bash
git add js/profile.js scripts/test-profile-module.mjs
git commit -m "WT-2: js/profile.js getMyProfile + smoke test"
```

---

## Task 4: TDD `updateMyProfile()`

**Files:**
- Modify: `js/profile.js` (add `updateMyProfile`)
- (Test already exercises it from Task 3.)

- [ ] **Step 1: Confirm the test currently fails on the update step**

```bash
node scripts/test-profile-module.mjs
```

Expected red on `updateMyProfile no error → updateMyProfile is not a function`.

- [ ] **Step 2: Implement**

Append to `js/profile.js`:

```js
export async function updateMyProfile({ full_name, phone, opted_in_newsletter }) {
  const sb = client();
  const { data: u } = await sb.auth.getUser();
  if (!u?.user) return { data: null, error: new Error('not authenticated') };

  // Build the patch object — undefined fields are not sent.
  const patch = {};
  if (full_name !== undefined)           patch.full_name = full_name;
  if (phone !== undefined)               patch.phone = phone;
  if (opted_in_newsletter !== undefined) {
    patch.opted_in_newsletter = !!opted_in_newsletter;
    // Stamp marketing_consent_at the first time they opt in
    if (opted_in_newsletter) patch.marketing_consent_at = new Date().toISOString();
  }

  const { data, error } = await sb
    .from('profiles')
    .update(patch)
    .eq('id', u.user.id)
    .select(PROFILE_COLUMNS)
    .single();
  return { data, error };
}
```

- [ ] **Step 3: Green**

```bash
node scripts/test-profile-module.mjs
```

Expect "✅ test-profile-module clean".

- [ ] **Step 4: Commit**

```bash
git add js/profile.js
git commit -m "WT-2: js/profile.js updateMyProfile"
```

---

## Task 5: Define `getLatestMeasurements` + `saveMeasurements` stubs

These are exported in Phase 1 but no UI calls them (spec §6.4 + Q8). Stubs guarantee Phase 2 can wire UI without touching `js/profile.js` again.

**Files:**
- Modify: `js/profile.js`

- [ ] **Step 1: Append the two functions**

```js
const MEASUREMENT_KINDS = new Set(['body', 'jacket_reference', 'shirt_reference', 'pants_reference']);
const VIEW_BY_KIND = {
  body:              'v_latest_body_measurements',
  jacket_reference:  'v_latest_jacket_reference',
  shirt_reference:   'v_latest_shirt_reference',
  pants_reference:   'v_latest_pants_reference',
};
const TABLE_BY_KIND = {
  body:              'customer_body_measurements',
  jacket_reference:  'customer_jacket_reference',
  shirt_reference:   'customer_shirt_reference',
  pants_reference:   'customer_pants_reference',
};

export async function getLatestMeasurements(kind) {
  if (!MEASUREMENT_KINDS.has(kind)) {
    return { data: null, error: new Error(`unknown measurement kind: ${kind}`) };
  }
  const sb = client();
  const { data: u } = await sb.auth.getUser();
  if (!u?.user) return { data: null, error: new Error('not authenticated') };
  const { data, error } = await sb
    .from(VIEW_BY_KIND[kind])
    .select('*')
    .eq('customer_id', u.user.id)
    .maybeSingle();
  return { data, error };
}

export async function saveMeasurements(kind, fields) {
  if (!MEASUREMENT_KINDS.has(kind)) {
    return { data: null, error: new Error(`unknown measurement kind: ${kind}`) };
  }
  const sb = client();
  const { data: u } = await sb.auth.getUser();
  if (!u?.user) return { data: null, error: new Error('not authenticated') };
  const row = { ...(fields || {}), customer_id: u.user.id };
  const { data, error } = await sb
    .from(TABLE_BY_KIND[kind])
    .insert(row)
    .select('*')
    .single();
  return { data, error };
}
```

- [ ] **Step 2: Verify the existing test still passes**

```bash
node scripts/test-profile-module.mjs
```

Expect clean. No new test — these functions are Phase 2 surface area.

- [ ] **Step 3: Commit**

```bash
git add js/profile.js
git commit -m "WT-2: js/profile.js getLatestMeasurements + saveMeasurements (defined; UI lands in Phase 2)"
```

---

## Task 6: Smoke-test → build `signup.html`

**Files:**
- Create: `scripts/test-signup-flow.mjs`
- Create: `signup.html`

- [ ] **Step 1: Write the puppeteer test (expect 404 first)**

Create `scripts/test-signup-flow.mjs`:

```js
// WT-2 — full signup → check_email → admin confirm → confirmed → /account.html.
import 'dotenv/config';
import puppeteer from 'puppeteer';
import { createClient } from '@supabase/supabase-js';

const URL  = process.env.SUPABASE_URL;
const SVC  = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !SVC) { console.error('missing env'); process.exit(2); }
const admin = createClient(URL, SVC, { auth: { persistSession: false } });

const email = `wt2-signup-${Date.now()}@example.com`;
const pw    = 'Correct-Horse-Battery-9!';
const name  = 'Signup Test';

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
const page    = await browser.newPage();
let failures  = 0;
const must    = (cond, msg) => { if (!cond) { console.error('✘', msg); failures++; } else console.log('✓', msg); };

try {
  // 1. signup.html exists and the form posts
  const r1 = await page.goto('http://localhost:3000/signup.html', { waitUntil: 'networkidle0' });
  must(r1.status() === 200, `GET /signup.html → ${r1.status()}`);

  await page.type('input[name="full_name"]', name);
  await page.type('input[name="email"]', email);
  await page.type('input[name="password"]', pw);
  await page.click('input[name="opted_in_newsletter"]');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle0' }),
    page.click('button[type="submit"]'),
  ]);
  must(page.url().includes('/login.html?check_email=1'), `redirected to login.html?check_email=1 → ${page.url()}`);

  // 2. The banner is visible on /login.html?check_email=1
  const banner = await page.$eval('[data-status="check_email"]', el => el.textContent || '');
  must(/email/i.test(banner), `check_email banner visible → "${banner.trim()}"`);

  // 3. Confirm the user via admin API
  const { data: list } = await admin.auth.admin.listUsers();
  const u = list.users.find(x => x.email === email);
  must(!!u, 'user row exists in auth.users');
  const { error: confErr } = await admin.auth.admin.updateUserById(u.id, { email_confirm: true });
  must(!confErr, `admin confirm email → ${confErr?.message || 'ok'}`);

  // 4. Reload as ?confirmed=1 — page should redirect to account.html if a session exists.
  //    Sign in via the form to simulate the post-confirmation landing.
  await page.goto('http://localhost:3000/login.html?confirmed=1', { waitUntil: 'networkidle0' });
  const confirmedBanner = await page.$eval('[data-status="confirmed"]', el => el.textContent || '');
  must(/confirmed|verified/i.test(confirmedBanner), `confirmed banner visible → "${confirmedBanner.trim()}"`);
  await page.type('input[name="email"]', email);
  await page.type('input[name="password"]', pw);
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle0' }),
    page.click('button[type="submit"]'),
  ]);
  must(page.url().endsWith('/account.html'), `final landing → ${page.url()}`);

  // 5. cleanup
  await admin.auth.admin.deleteUser(u.id);
} finally {
  await browser.close();
}

if (failures) { console.error(`\n❌ ${failures} failure(s)`); process.exit(1); }
console.log('\n✅ test-signup-flow clean');
```

Run it:

```bash
node scripts/test-signup-flow.mjs
```

Expected: red at `GET /signup.html → 404`.

- [ ] **Step 2: Build `signup.html`**

Use the `.auth-card` markup from Task 2. Create `signup.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
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
  frame-ancestors 'none';
  base-uri 'self';
  object-src 'none';
">
<title>Create account — Country Road Fashions</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400;1,500&family=Raleway:wght@200;300;400;500;600;700;800&display=swap" rel="stylesheet" />
<link rel="preload" as="fetch" href="/components/header.html" crossorigin>
<link rel="preload" as="fetch" href="/components/footer.html" crossorigin>
<link rel="stylesheet" href="/css/base.css">
<script type="module" src="/js/layout.js"></script>
<script type="module" src="/js/auth.js"></script>
<style>
  /* === Shared .auth-card pattern (matches login / forgot / reset) === */
  .auth-shell {
    min-height: calc(100vh - var(--header-h));
    display: grid;
    place-items: center;
    padding: var(--space-8) var(--space-4);
    background: var(--color-off-white);
  }
  .auth-card {
    width: 100%;
    max-width: 440px;
    background: var(--color-white);
    border: 1px solid var(--color-rule);
    box-shadow: var(--shadow-2);
    padding: var(--space-7) var(--space-6);
  }
  .auth-card__title {
    font-family: var(--font-serif);
    font-weight: 500;
    font-size: 32px;
    line-height: var(--leading-tight);
    letter-spacing: var(--tracking-tight);
    color: var(--color-jet);
    margin: 0 0 var(--space-2);
  }
  .auth-card__sub {
    font-size: 14px;
    color: var(--color-muted);
    margin: 0 0 var(--space-6);
  }
  .auth-card__form { display: flex; flex-direction: column; gap: var(--space-4); }
  .auth-card__row  { display: flex; align-items: center; gap: var(--space-2); font-size: 13px; color: var(--color-ink); }
  .auth-card__cta  { width: 100%; margin-top: var(--space-2); }
  .auth-card__foot {
    margin-top: var(--space-5);
    padding-top: var(--space-5);
    border-top: 1px solid var(--color-rule);
    font-size: 13px;
    color: var(--color-muted);
    text-align: center;
  }
  .auth-card__foot a { color: var(--color-jet); border-bottom: 1px solid var(--color-rule); }
  .auth-card__foot a:hover { color: var(--color-charcoal); border-color: var(--color-jet); }
  .auth-error {
    font-size: 13px;
    color: #8a1c1c;
    background: rgba(138,28,28,0.06);
    border: 1px solid rgba(138,28,28,0.18);
    padding: var(--space-3);
  }
  .auth-error[hidden] { display: none; }
</style>
</head>
<body>
  <div data-layout="header" style="min-height:72px;background:var(--color-jet);"></div>
  <main class="auth-shell">
    <section class="auth-card" aria-labelledby="signup-title">
      <h1 id="signup-title" class="auth-card__title">Create your account</h1>
      <p class="auth-card__sub">Save your fit, track orders, and book consultations.</p>
      <div class="auth-error" id="auth-error" hidden role="alert"></div>
      <form class="auth-card__form" id="signup-form" novalidate>
        <div class="field">
          <label for="full_name">Full name</label>
          <input class="input" type="text" id="full_name" name="full_name" autocomplete="name" required />
        </div>
        <div class="field">
          <label for="email">Email</label>
          <input class="input" type="email" id="email" name="email" autocomplete="email" required />
        </div>
        <div class="field">
          <label for="password">Password</label>
          <input class="input" type="password" id="password" name="password" autocomplete="new-password" minlength="8" required />
        </div>
        <label class="auth-card__row">
          <input type="checkbox" id="opted_in_newsletter" name="opted_in_newsletter" />
          Send me occasional updates on new fabrics and trunk shows.
        </label>
        <button type="submit" class="btn btn--primary auth-card__cta">Create account</button>
      </form>
      <p class="auth-card__foot">
        Already have an account? <a href="/login.html">Sign in</a>
      </p>
    </section>
  </main>
  <div data-layout="footer"></div>

  <script type="module">
    import { signUp, requireGuest } from '/js/auth.js';

    requireGuest();   // signed-in users get redirected to /account.html

    const form = document.getElementById('signup-form');
    const errBox = document.getElementById('auth-error');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errBox.hidden = true;
      const fd = new FormData(form);
      const payload = {
        full_name:           (fd.get('full_name') || '').toString().trim(),
        email:               (fd.get('email')     || '').toString().trim(),
        password:            (fd.get('password')  || '').toString(),
        opted_in_newsletter: fd.get('opted_in_newsletter') === 'on',
      };
      const btn = form.querySelector('button[type="submit"]');
      btn.setAttribute('aria-busy', 'true');
      btn.disabled = true;
      const { error } = await signUp(payload);
      btn.removeAttribute('aria-busy');
      btn.disabled = false;
      if (error) {
        errBox.textContent = error.message || 'Something went wrong. Please try again.';
        errBox.hidden = false;
        return;
      }
      window.location.assign('/login.html?check_email=1');
    });
  </script>
</body>
</html>
```

- [ ] **Step 3: Run the test again — expect partial pass (login.html still 404 in the redirect step)**

```bash
node scripts/test-signup-flow.mjs
```

The test will pass step 1 (`GET /signup.html → 200`) and reach the redirect, but fail on the `data-status="check_email"` assertion because `login.html` does not yet exist. That is expected — Task 7 builds `login.html` and rerunning the test then will get further.

- [ ] **Step 4: Commit**

```bash
git add signup.html scripts/test-signup-flow.mjs
git commit -m "WT-2: signup.html + test-signup-flow (login.html still pending)"
```

---

## Task 7: Smoke-test → build `login.html`

**Files:**
- Create: `login.html`

- [ ] **Step 1: Confirm the existing signup test fails at the login-page step**

```bash
node scripts/test-signup-flow.mjs
```

Expect failure on `/login.html?check_email=1` 404.

- [ ] **Step 2: Build `login.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
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
  frame-ancestors 'none';
  base-uri 'self';
  object-src 'none';
">
<title>Sign in — Country Road Fashions</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400;1,500&family=Raleway:wght@200;300;400;500;600;700;800&display=swap" rel="stylesheet" />
<link rel="preload" as="fetch" href="/components/header.html" crossorigin>
<link rel="preload" as="fetch" href="/components/footer.html" crossorigin>
<link rel="stylesheet" href="/css/base.css">
<script type="module" src="/js/layout.js"></script>
<script type="module" src="/js/auth.js"></script>
<style>
  .auth-shell {
    min-height: calc(100vh - var(--header-h));
    display: grid;
    place-items: center;
    padding: var(--space-8) var(--space-4);
    background: var(--color-off-white);
  }
  .auth-card {
    width: 100%; max-width: 440px;
    background: var(--color-white);
    border: 1px solid var(--color-rule);
    box-shadow: var(--shadow-2);
    padding: var(--space-7) var(--space-6);
  }
  .auth-card__title {
    font-family: var(--font-serif); font-weight: 500;
    font-size: 32px; line-height: var(--leading-tight);
    letter-spacing: var(--tracking-tight); color: var(--color-jet);
    margin: 0 0 var(--space-2);
  }
  .auth-card__sub { font-size: 14px; color: var(--color-muted); margin: 0 0 var(--space-6); }
  .auth-card__form { display: flex; flex-direction: column; gap: var(--space-4); }
  .auth-card__cta { width: 100%; margin-top: var(--space-2); }
  .auth-card__foot {
    margin-top: var(--space-5); padding-top: var(--space-5);
    border-top: 1px solid var(--color-rule);
    font-size: 13px; color: var(--color-muted); text-align: center;
  }
  .auth-card__foot a { color: var(--color-jet); border-bottom: 1px solid var(--color-rule); }
  .auth-card__foot a:hover { color: var(--color-charcoal); border-color: var(--color-jet); }
  .auth-card__forgot { display: block; text-align: right; font-size: 12px; color: var(--color-muted); }
  .auth-card__forgot:hover { color: var(--color-jet); }
  .auth-status {
    font-family: var(--font-sans); font-size: 13px;
    background: var(--color-cream);
    border: 1px solid var(--color-rule);
    color: var(--color-ink);
    padding: var(--space-3) var(--space-4);
    margin: 0 0 var(--space-5);
  }
  .auth-status[hidden] { display: none; }
  .auth-error {
    font-size: 13px; color: #8a1c1c;
    background: rgba(138,28,28,0.06);
    border: 1px solid rgba(138,28,28,0.18);
    padding: var(--space-3);
  }
  .auth-error[hidden] { display: none; }
</style>
</head>
<body>
  <div data-layout="header" style="min-height:72px;background:var(--color-jet);"></div>
  <main class="auth-shell">
    <section class="auth-card" aria-labelledby="login-title">
      <h1 id="login-title" class="auth-card__title">Sign in</h1>
      <p class="auth-card__sub">Welcome back.</p>

      <div class="auth-status" id="status-check_email" data-status="check_email" hidden>
        Almost there — check your email for a confirmation link.
      </div>
      <div class="auth-status" id="status-confirmed" data-status="confirmed" hidden>
        Email confirmed. Sign in below.
      </div>
      <div class="auth-status" id="status-reset" data-status="reset" hidden>
        Your password was updated. Sign in with the new one.
      </div>

      <div class="auth-error" id="auth-error" hidden role="alert"></div>
      <form class="auth-card__form" id="login-form" novalidate>
        <div class="field">
          <label for="email">Email</label>
          <input class="input" type="email" id="email" name="email" autocomplete="email" required />
        </div>
        <div class="field">
          <label for="password">Password</label>
          <input class="input" type="password" id="password" name="password" autocomplete="current-password" required />
        </div>
        <a class="auth-card__forgot" href="/forgot-password.html">Forgot password?</a>
        <button type="submit" class="btn btn--primary auth-card__cta">Sign in</button>
      </form>
      <p class="auth-card__foot">
        New to Country Road Fashions? <a href="/signup.html">Create an account</a>
      </p>
    </section>
  </main>
  <div data-layout="footer"></div>

  <script type="module">
    import { signInWithPassword, requireGuest } from '/js/auth.js';

    requireGuest();   // already signed-in → /account.html (honors ?next= if present)

    const qs = new URLSearchParams(location.search);
    if (qs.get('check_email')) document.getElementById('status-check_email').hidden = false;
    if (qs.get('confirmed'))   document.getElementById('status-confirmed').hidden   = false;
    if (qs.get('reset'))       document.getElementById('status-reset').hidden       = false;

    const form   = document.getElementById('login-form');
    const errBox = document.getElementById('auth-error');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errBox.hidden = true;
      const fd = new FormData(form);
      const payload = {
        email:    (fd.get('email')    || '').toString().trim(),
        password: (fd.get('password') || '').toString(),
      };
      const btn = form.querySelector('button[type="submit"]');
      btn.setAttribute('aria-busy', 'true');
      btn.disabled = true;
      const { data, error } = await signInWithPassword(payload);
      btn.removeAttribute('aria-busy');
      btn.disabled = false;
      if (error) {
        errBox.textContent = error.message || 'Sign-in failed.';
        errBox.hidden = false;
        return;
      }
      const next = qs.get('next');
      window.location.assign(next || '/account.html');
    });
  </script>
</body>
</html>
```

- [ ] **Step 3: Re-run the signup flow test**

```bash
node scripts/test-signup-flow.mjs
```

Expect "✅ test-signup-flow clean". If not, debug — do NOT continue.

- [ ] **Step 4: Commit**

```bash
git add login.html
git commit -m "WT-2: login.html with status banners + signup flow test passing"
```

---

## Task 8: Smoke-test → build `forgot-password.html`

**Files:**
- Create: a placeholder reference to a test we add in Task 9 (`scripts/test-forgot-reset.mjs`). Build the page first since `forgot-password.html` is the simpler endpoint.
- Create: `forgot-password.html`

- [ ] **Step 1: Build `forgot-password.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
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
  frame-ancestors 'none';
  base-uri 'self';
  object-src 'none';
">
<title>Forgot password — Country Road Fashions</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400;1,500&family=Raleway:wght@200;300;400;500;600;700;800&display=swap" rel="stylesheet" />
<link rel="preload" as="fetch" href="/components/header.html" crossorigin>
<link rel="preload" as="fetch" href="/components/footer.html" crossorigin>
<link rel="stylesheet" href="/css/base.css">
<script type="module" src="/js/layout.js"></script>
<script type="module" src="/js/auth.js"></script>
<style>
  .auth-shell {
    min-height: calc(100vh - var(--header-h));
    display: grid; place-items: center;
    padding: var(--space-8) var(--space-4);
    background: var(--color-off-white);
  }
  .auth-card {
    width: 100%; max-width: 440px;
    background: var(--color-white);
    border: 1px solid var(--color-rule);
    box-shadow: var(--shadow-2);
    padding: var(--space-7) var(--space-6);
  }
  .auth-card__title {
    font-family: var(--font-serif); font-weight: 500;
    font-size: 32px; line-height: var(--leading-tight);
    letter-spacing: var(--tracking-tight); color: var(--color-jet);
    margin: 0 0 var(--space-2);
  }
  .auth-card__sub { font-size: 14px; color: var(--color-muted); margin: 0 0 var(--space-6); }
  .auth-card__form { display: flex; flex-direction: column; gap: var(--space-4); }
  .auth-card__cta { width: 100%; margin-top: var(--space-2); }
  .auth-card__foot {
    margin-top: var(--space-5); padding-top: var(--space-5);
    border-top: 1px solid var(--color-rule);
    font-size: 13px; color: var(--color-muted); text-align: center;
  }
  .auth-card__foot a { color: var(--color-jet); border-bottom: 1px solid var(--color-rule); }
  .auth-card__foot a:hover { color: var(--color-charcoal); border-color: var(--color-jet); }
  .auth-status {
    font-size: 14px; color: var(--color-ink);
    background: var(--color-cream);
    border: 1px solid var(--color-rule);
    padding: var(--space-4);
  }
  .auth-status[hidden] { display: none; }
</style>
</head>
<body>
  <div data-layout="header" style="min-height:72px;background:var(--color-jet);"></div>
  <main class="auth-shell">
    <section class="auth-card" aria-labelledby="forgot-title">
      <h1 id="forgot-title" class="auth-card__title">Reset your password</h1>
      <p class="auth-card__sub">Enter the email you used to sign up. We'll send a reset link.</p>

      <div class="auth-status" id="status-sent" data-status="sent" hidden>
        If that email exists, we've sent a link. Check your inbox.
      </div>

      <form class="auth-card__form" id="forgot-form" novalidate>
        <div class="field">
          <label for="email">Email</label>
          <input class="input" type="email" id="email" name="email" autocomplete="email" required />
        </div>
        <button type="submit" class="btn btn--primary auth-card__cta">Send reset link</button>
      </form>
      <p class="auth-card__foot">
        Remembered it? <a href="/login.html">Sign in</a>
      </p>
    </section>
  </main>
  <div data-layout="footer"></div>

  <script type="module">
    import { resetPasswordForEmail } from '/js/auth.js';

    const form  = document.getElementById('forgot-form');
    const sent  = document.getElementById('status-sent');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const email = (fd.get('email') || '').toString().trim();
      const btn = form.querySelector('button[type="submit"]');
      btn.setAttribute('aria-busy', 'true');
      btn.disabled = true;
      // Constant-time response: we ignore the result and always show "if exists" —
      // never reveal whether the email is registered.
      await resetPasswordForEmail(email).catch(() => {});
      btn.removeAttribute('aria-busy');
      form.reset();
      sent.hidden = false;
    });
  </script>
</body>
</html>
```

- [ ] **Step 2: Smoke check (no full test yet)**

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/forgot-password.html
```

Expect `200`. The full forgot→reset roundtrip is exercised in Task 9.

- [ ] **Step 3: Commit**

```bash
git add forgot-password.html
git commit -m "WT-2: forgot-password.html (constant-time response)"
```

---

## Task 9: Smoke-test → build `reset-password.html`

**Files:**
- Create: `scripts/test-forgot-reset.mjs`
- Create: `reset-password.html`

- [ ] **Step 1: Write the failing test**

Create `scripts/test-forgot-reset.mjs`:

```js
// WT-2 — forgot → admin-fetched link → reset-password.html → new password → sign in.
import 'dotenv/config';
import puppeteer from 'puppeteer';
import { createClient } from '@supabase/supabase-js';

const URL = process.env.SUPABASE_URL;
const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON = process.env.SUPABASE_ANON_KEY;
if (!URL || !SVC || !ANON) { console.error('missing env'); process.exit(2); }

const admin = createClient(URL, SVC, { auth: { persistSession: false } });
const anon  = createClient(URL, ANON, { auth: { persistSession: false } });

const email  = `wt2-reset-${Date.now()}@example.com`;
const oldPw  = 'Old-Pass-Word-9!';
const newPw  = 'New-Pass-Word-9!';

let failures = 0;
const must = (cond, msg) => { if (!cond) { console.error('✘', msg); failures++; } else console.log('✓', msg); };

const { data: created, error: cErr } =
  await admin.auth.admin.createUser({ email, password: oldPw, email_confirm: true });
must(!cErr && created?.user?.id, `seed user → ${cErr?.message || 'ok'}`);

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();

try {
  // 1. submit forgot form
  await page.goto('http://localhost:3000/forgot-password.html', { waitUntil: 'networkidle0' });
  await page.type('input[name="email"]', email);
  await page.click('button[type="submit"]');
  await page.waitForSelector('[data-status="sent"]:not([hidden])');
  must(true, 'forgot-password constant-time banner shown');

  // 2. Fetch a real recovery link via admin API (does not consume the email).
  const { data: link, error: lErr } = await admin.auth.admin.generateLink({
    type: 'recovery',
    email,
    options: { redirectTo: 'http://localhost:3000/reset-password.html' },
  });
  must(!lErr && link?.properties?.action_link, `generateLink → ${lErr?.message || 'ok'}`);
  const actionLink = link.properties.action_link;

  // 3. Visit the recovery link. Supabase JS in the page detects the fragment
  //    and creates a session, then we submit a new password.
  await page.goto(actionLink, { waitUntil: 'networkidle0' });
  // Supabase often redirects through its verify endpoint then back to redirectTo with #access_token
  await page.waitForFunction(() => location.pathname.endsWith('/reset-password.html'), { timeout: 15000 });
  await page.waitForSelector('input[name="password"]', { visible: true });
  await page.type('input[name="password"]', newPw);
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle0' }),
    page.click('button[type="submit"]'),
  ]);
  must(page.url().includes('/login.html?reset=1'), `final landing → ${page.url()}`);

  // 4. Sign in with the new password via the anon client to prove it really changed.
  const { data: sess, error: sErr } = await anon.auth.signInWithPassword({ email, password: newPw });
  must(!sErr && sess?.session, `sign in with new password → ${sErr?.message || 'ok'}`);
} finally {
  await browser.close();
  if (created?.user?.id) await admin.auth.admin.deleteUser(created.user.id);
}

if (failures) { console.error(`\n❌ ${failures} failure(s)`); process.exit(1); }
console.log('\n✅ test-forgot-reset clean');
```

Run:

```bash
node scripts/test-forgot-reset.mjs
```

Expect red at `/reset-password.html` 404.

- [ ] **Step 2: Build `reset-password.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
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
  frame-ancestors 'none';
  base-uri 'self';
  object-src 'none';
">
<title>Set a new password — Country Road Fashions</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400;1,500&family=Raleway:wght@200;300;400;500;600;700;800&display=swap" rel="stylesheet" />
<link rel="preload" as="fetch" href="/components/header.html" crossorigin>
<link rel="preload" as="fetch" href="/components/footer.html" crossorigin>
<link rel="stylesheet" href="/css/base.css">
<script type="module" src="/js/layout.js"></script>
<script type="module" src="/js/auth.js"></script>
<style>
  .auth-shell {
    min-height: calc(100vh - var(--header-h));
    display: grid; place-items: center;
    padding: var(--space-8) var(--space-4);
    background: var(--color-off-white);
  }
  .auth-card {
    width: 100%; max-width: 440px;
    background: var(--color-white);
    border: 1px solid var(--color-rule);
    box-shadow: var(--shadow-2);
    padding: var(--space-7) var(--space-6);
  }
  .auth-card__title {
    font-family: var(--font-serif); font-weight: 500;
    font-size: 32px; line-height: var(--leading-tight);
    letter-spacing: var(--tracking-tight); color: var(--color-jet);
    margin: 0 0 var(--space-2);
  }
  .auth-card__sub { font-size: 14px; color: var(--color-muted); margin: 0 0 var(--space-6); }
  .auth-card__form { display: flex; flex-direction: column; gap: var(--space-4); }
  .auth-card__cta { width: 100%; margin-top: var(--space-2); }
  .auth-error {
    font-size: 13px; color: #8a1c1c;
    background: rgba(138,28,28,0.06);
    border: 1px solid rgba(138,28,28,0.18);
    padding: var(--space-3);
  }
  .auth-error[hidden] { display: none; }
</style>
</head>
<body>
  <div data-layout="header" style="min-height:72px;background:var(--color-jet);"></div>
  <main class="auth-shell">
    <section class="auth-card" aria-labelledby="reset-title">
      <h1 id="reset-title" class="auth-card__title">Set a new password</h1>
      <p class="auth-card__sub">Pick something memorable. Minimum 8 characters.</p>
      <div class="auth-error" id="auth-error" hidden role="alert"></div>
      <form class="auth-card__form" id="reset-form" novalidate>
        <div class="field">
          <label for="password">New password</label>
          <input class="input" type="password" id="password" name="password" autocomplete="new-password" minlength="8" required />
        </div>
        <button type="submit" class="btn btn--primary auth-card__cta">Update password</button>
      </form>
    </section>
  </main>
  <div data-layout="footer"></div>

  <script type="module">
    import { getSession, updatePassword, signOut } from '/js/auth.js';

    const form   = document.getElementById('reset-form');
    const errBox = document.getElementById('auth-error');

    // Supabase auto-detects the #access_token fragment and creates a session.
    // Give the SDK a tick to process it, then verify a session exists.
    await new Promise(r => setTimeout(r, 50));
    const session = await getSession();
    if (!session) {
      errBox.textContent = 'This link has expired. Please request a new one from the forgot-password page.';
      errBox.hidden = false;
      form.querySelector('button').disabled = true;
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errBox.hidden = true;
      const fd = new FormData(form);
      const pw = (fd.get('password') || '').toString();
      const btn = form.querySelector('button[type="submit"]');
      btn.setAttribute('aria-busy', 'true');
      btn.disabled = true;
      const { error } = await updatePassword(pw);
      if (error) {
        errBox.textContent = error.message || 'Could not update password.';
        errBox.hidden = false;
        btn.removeAttribute('aria-busy');
        btn.disabled = false;
        return;
      }
      await signOut();
      window.location.assign('/login.html?reset=1');
    });
  </script>
</body>
</html>
```

- [ ] **Step 3: Re-run**

```bash
node scripts/test-forgot-reset.mjs
```

Expect "✅ test-forgot-reset clean".

- [ ] **Step 4: Commit**

```bash
git add reset-password.html scripts/test-forgot-reset.mjs
git commit -m "WT-2: reset-password.html + forgot/reset roundtrip test"
```

---

## Task 10: Smoke-test → build `account.html` profile section

**Files:**
- Create: `scripts/test-account-profile-crud.mjs`
- Create: `account.html` (profile section only — measurements + danger zone come in Tasks 11–12)

- [ ] **Step 1: Write the failing CRUD test**

Create `scripts/test-account-profile-crud.mjs`:

```js
// WT-2 — sign in → /account.html → edit name/phone/newsletter → save → reload → assert persisted.
import 'dotenv/config';
import puppeteer from 'puppeteer';
import { createClient } from '@supabase/supabase-js';

const URL  = process.env.SUPABASE_URL;
const SVC  = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !SVC) { console.error('missing env'); process.exit(2); }
const admin = createClient(URL, SVC, { auth: { persistSession: false } });

const email = `wt2-account-${Date.now()}@example.com`;
const pw    = 'Correct-Horse-Battery-9!';

let failures = 0;
const must = (cond, msg) => { if (!cond) { console.error('✘', msg); failures++; } else console.log('✓', msg); };

const { data: created } =
  await admin.auth.admin.createUser({ email, password: pw, email_confirm: true,
    user_metadata: { full_name: 'Initial Name', opted_in_newsletter: false } });

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
const page    = await browser.newPage();
try {
  // sign in
  await page.goto('http://localhost:3000/login.html', { waitUntil: 'networkidle0' });
  await page.type('input[name="email"]', email);
  await page.type('input[name="password"]', pw);
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle0' }),
    page.click('button[type="submit"]'),
  ]);
  must(page.url().endsWith('/account.html'), `landed on /account.html → ${page.url()}`);

  // edit profile
  await page.waitForSelector('input[name="full_name"]', { visible: true });
  await page.$eval('input[name="full_name"]', el => { el.value = ''; });
  await page.type('input[name="full_name"]', 'Edited Name');
  await page.$eval('input[name="phone"]', el => { el.value = ''; });
  await page.type('input[name="phone"]', '+66 81 999 1234');
  const checked = await page.$eval('input[name="opted_in_newsletter"]', el => el.checked);
  if (!checked) await page.click('input[name="opted_in_newsletter"]');
  await page.click('#save-profile');
  await page.waitForSelector('#profile-saved:not([hidden])');
  must(true, 'save confirmation visible');

  // reload and assert
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('input[name="full_name"]', { visible: true });
  const fn = await page.$eval('input[name="full_name"]', el => el.value);
  const ph = await page.$eval('input[name="phone"]', el => el.value);
  const nl = await page.$eval('input[name="opted_in_newsletter"]', el => el.checked);
  must(fn === 'Edited Name', `full_name persisted → "${fn}"`);
  must(ph === '+66 81 999 1234', `phone persisted → "${ph}"`);
  must(nl === true, `opted_in_newsletter persisted → ${nl}`);
} finally {
  await browser.close();
  if (created?.user?.id) await admin.auth.admin.deleteUser(created.user.id);
}

if (failures) { console.error(`\n❌ ${failures} failure(s)`); process.exit(1); }
console.log('\n✅ test-account-profile-crud clean');
```

Run:

```bash
node scripts/test-account-profile-crud.mjs
```

Expect red — `/account.html` 404.

- [ ] **Step 2: Build `account.html` (profile section + sidebar shell, measurements + danger placeholders to be filled later in this plan)**

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
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
  frame-ancestors 'none';
  base-uri 'self';
  object-src 'none';
">
<title>My account — Country Road Fashions</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400;1,500&family=Raleway:wght@200;300;400;500;600;700;800&display=swap" rel="stylesheet" />
<link rel="preload" as="fetch" href="/components/header.html" crossorigin>
<link rel="preload" as="fetch" href="/components/footer.html" crossorigin>
<link rel="stylesheet" href="/css/base.css">
<script type="module" src="/js/layout.js"></script>
<script type="module" src="/js/auth.js"></script>
<style>
  .account-shell { max-width: var(--container-max); margin: 0 auto; padding: var(--space-8) var(--space-6); }
  .account-shell h1 {
    font-family: var(--font-serif); font-weight: 500;
    font-size: clamp(36px, 5vw, 56px);
    line-height: var(--leading-tight);
    letter-spacing: var(--tracking-tight);
    color: var(--color-jet);
    margin: 0 0 var(--space-6);
  }
  .account-layout {
    display: grid;
    grid-template-columns: 240px 1fr;
    gap: var(--space-7);
    align-items: start;
  }
  .account-nav {
    position: sticky; top: calc(var(--header-h) + var(--space-5));
    display: flex; flex-direction: column; gap: var(--space-2);
    border-left: 1px solid var(--color-rule);
    padding-left: var(--space-4);
  }
  .account-nav a {
    font-size: 13px; letter-spacing: 0.04em;
    color: var(--color-muted);
    padding: var(--space-2) 0;
    transition: color var(--t-fast) var(--ease-out);
  }
  .account-nav a:hover, .account-nav a[aria-current="true"] { color: var(--color-jet); }
  .account-section {
    background: var(--color-white);
    border: 1px solid var(--color-rule);
    padding: var(--space-6);
    margin-bottom: var(--space-6);
  }
  .account-section h2 {
    font-family: var(--font-serif); font-weight: 500;
    font-size: 24px; color: var(--color-jet);
    margin: 0 0 var(--space-4);
  }
  .account-section .field { margin-bottom: var(--space-4); }
  .account-section .field--readonly input { background: var(--color-cream); color: var(--color-muted); }
  .profile-row { display: flex; align-items: center; gap: var(--space-3); margin-top: var(--space-4); }
  #profile-saved {
    font-size: 13px; color: var(--color-jet);
    background: var(--color-cream);
    border: 1px solid var(--color-rule);
    padding: var(--space-2) var(--space-3);
  }
  #profile-saved[hidden] { display: none; }
  .measurements-grid { display: grid; gap: var(--space-3); }
  .measurement-row {
    display: flex; align-items: center; justify-content: space-between;
    gap: var(--space-4); padding: var(--space-4);
    border: 1px solid var(--color-rule);
  }
  .measurement-row__label { font-size: 14px; color: var(--color-ink); }
  .measurement-row__hint  { font-size: 12px; color: var(--color-muted); display: block; }
  .danger-zone {
    border: 1px solid rgba(138,28,28,0.25);
    background: rgba(138,28,28,0.03);
  }
  .danger-zone h2 { color: #8a1c1c; }
  .danger-zone p  { font-size: 14px; color: var(--color-ink); margin: 0 0 var(--space-4); }
  .danger-zone .btn--danger {
    background: #8a1c1c; color: var(--color-white); border-color: #8a1c1c;
  }
  .danger-zone .btn--danger:hover { background: #6f1414; border-color: #6f1414; transform: translateY(-1px); }

  /* Delete-account modal */
  .modal-backdrop {
    position: fixed; inset: 0;
    background: rgba(14,15,17,0.55);
    display: grid; place-items: center;
    z-index: 100;
  }
  .modal-backdrop[hidden] { display: none; }
  .modal-card {
    width: 100%; max-width: 460px;
    background: var(--color-white);
    border: 1px solid var(--color-rule);
    box-shadow: var(--shadow-3);
    padding: var(--space-6);
  }
  .modal-card h3 {
    font-family: var(--font-serif); font-weight: 500;
    font-size: 24px; color: var(--color-jet); margin: 0 0 var(--space-3);
  }
  .modal-card p { font-size: 14px; color: var(--color-ink); margin: 0 0 var(--space-4); }
  .modal-card .field { margin-bottom: var(--space-3); }
  .modal-actions { display: flex; justify-content: flex-end; gap: var(--space-3); margin-top: var(--space-4); }
  .modal-error {
    font-size: 13px; color: #8a1c1c;
    background: rgba(138,28,28,0.06);
    border: 1px solid rgba(138,28,28,0.18);
    padding: var(--space-3); margin-bottom: var(--space-3);
  }
  .modal-error[hidden] { display: none; }

  @media (max-width: 900px) {
    .account-layout { grid-template-columns: 1fr; }
    .account-nav { position: static; flex-direction: row; flex-wrap: wrap; border-left: 0; padding-left: 0; }
  }
</style>
</head>
<body>
  <div data-layout="header" style="min-height:72px;background:var(--color-jet);"></div>
  <main class="account-shell">
    <h1>My account</h1>
    <div class="account-layout">
      <nav class="account-nav" aria-label="Account sections">
        <a href="#profile" aria-current="true">Profile</a>
        <a href="#measurements">Measurements</a>
        <a href="#danger">Danger zone</a>
        <a href="#" id="signout-link">Sign out</a>
      </nav>
      <div>
        <!-- Profile -->
        <section class="account-section" id="profile" aria-labelledby="profile-title">
          <h2 id="profile-title">Profile</h2>
          <form id="profile-form" novalidate>
            <div class="field field--readonly">
              <label for="email">Email</label>
              <input class="input" type="email" id="email" name="email" disabled />
            </div>
            <div class="field">
              <label for="full_name">Full name</label>
              <input class="input" type="text" id="full_name" name="full_name" autocomplete="name" />
            </div>
            <div class="field">
              <label for="phone">Phone</label>
              <input class="input" type="tel" id="phone" name="phone" autocomplete="tel" />
            </div>
            <label class="profile-row">
              <input type="checkbox" id="opted_in_newsletter" name="opted_in_newsletter" />
              Subscribe to our newsletter
            </label>
            <div class="profile-row">
              <button type="submit" class="btn btn--primary" id="save-profile">Save changes</button>
              <span id="profile-saved" hidden>Saved.</span>
            </div>
          </form>
        </section>

        <!-- Measurements (stub buttons; Phase 2 wires forms) -->
        <section class="account-section" id="measurements" aria-labelledby="measurements-title">
          <h2 id="measurements-title">Measurements</h2>
          <div class="measurements-grid">
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
            <div class="measurement-row">
              <div>
                <span class="measurement-row__label">In-person consultation</span>
                <span class="measurement-row__hint">Book a visit to our atelier.</span>
              </div>
              <a class="btn btn--primary" href="/book-appointment.html">Book</a>
            </div>
          </div>
        </section>

        <!-- Danger zone -->
        <section class="account-section danger-zone" id="danger" aria-labelledby="danger-title">
          <h2 id="danger-title">Delete my account</h2>
          <p>
            This permanently removes your profile, measurements, and sign-in. Tax-mandated
            invoice records may be retained per Thai law. This cannot be undone.
          </p>
          <button class="btn btn--danger" type="button" id="open-delete-modal">Delete my account</button>
        </section>
      </div>
    </div>
  </main>

  <!-- Delete confirmation modal -->
  <div class="modal-backdrop" id="delete-modal" hidden role="dialog" aria-modal="true" aria-labelledby="delete-modal-title">
    <div class="modal-card">
      <h3 id="delete-modal-title">Are you sure?</h3>
      <p>Type <strong>DELETE</strong> and re-enter your password to confirm.</p>
      <div class="modal-error" id="delete-modal-error" hidden role="alert"></div>
      <form id="delete-form" novalidate>
        <div class="field">
          <label for="confirm-text">Type DELETE</label>
          <input class="input" type="text" id="confirm-text" name="confirm-text" autocomplete="off" required />
        </div>
        <div class="field">
          <label for="confirm-password">Password</label>
          <input class="input" type="password" id="confirm-password" name="confirm-password" autocomplete="current-password" required />
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn--ghost" id="cancel-delete">Cancel</button>
          <button type="submit" class="btn btn--danger">Delete forever</button>
        </div>
      </form>
    </div>
  </div>

  <div data-layout="footer"></div>

  <script type="module">
    import {
      requireAuth, signInWithPassword, signOut, deleteAccount, getUser,
    } from '/js/auth.js';
    import { getMyProfile, updateMyProfile } from '/js/profile.js';

    await requireAuth({ redirectTo: '/login.html' });

    // Load profile into the form
    const profile = await getMyProfile();
    if (profile) {
      document.getElementById('email').value               = profile.email || '';
      document.getElementById('full_name').value           = profile.full_name || '';
      document.getElementById('phone').value               = profile.phone || '';
      document.getElementById('opted_in_newsletter').checked = !!profile.opted_in_newsletter;
    }

    // Save profile
    const form   = document.getElementById('profile-form');
    const saved  = document.getElementById('profile-saved');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      saved.hidden = true;
      const fd = new FormData(form);
      const payload = {
        full_name:           (fd.get('full_name') || '').toString().trim(),
        phone:               (fd.get('phone')     || '').toString().trim(),
        opted_in_newsletter: fd.get('opted_in_newsletter') === 'on',
      };
      const { error } = await updateMyProfile(payload);
      if (error) {
        alert('Could not save: ' + (error.message || 'unknown error'));
        return;
      }
      saved.hidden = false;
      setTimeout(() => { saved.hidden = true; }, 2500);
    });

    // Sign out
    document.getElementById('signout-link').addEventListener('click', async (e) => {
      e.preventDefault();
      await signOut();
      window.location.assign('/');
    });

    // Delete-account modal wiring
    const modal       = document.getElementById('delete-modal');
    const openBtn     = document.getElementById('open-delete-modal');
    const cancelBtn   = document.getElementById('cancel-delete');
    const deleteForm  = document.getElementById('delete-form');
    const deleteError = document.getElementById('delete-modal-error');

    openBtn.addEventListener('click', () => {
      deleteError.hidden = true;
      modal.hidden = false;
      document.getElementById('confirm-text').focus();
    });
    cancelBtn.addEventListener('click', () => {
      modal.hidden = true;
      deleteForm.reset();
    });

    deleteForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      deleteError.hidden = true;
      const fd = new FormData(deleteForm);
      const confirmText = (fd.get('confirm-text') || '').toString();
      const password    = (fd.get('confirm-password') || '').toString();
      if (confirmText !== 'DELETE') {
        deleteError.textContent = 'Please type DELETE in all caps to confirm.';
        deleteError.hidden = false;
        return;
      }
      // Re-verify password: sign in again to confirm identity before destructive call.
      const user = await getUser();
      if (!user?.email) {
        deleteError.textContent = 'Session lost. Please sign in again.';
        deleteError.hidden = false;
        return;
      }
      const { error: reErr } = await signInWithPassword({ email: user.email, password });
      if (reErr) {
        deleteError.textContent = 'Password incorrect.';
        deleteError.hidden = false;
        return;
      }
      const { error: dErr } = await deleteAccount();
      if (dErr) {
        deleteError.textContent = dErr.message || 'Could not delete account.';
        deleteError.hidden = false;
        return;
      }
      await signOut();
      window.location.assign('/?account_deleted=1');
    });
  </script>
</body>
</html>
```

- [ ] **Step 3: Re-run CRUD test**

```bash
node scripts/test-account-profile-crud.mjs
```

Expect "✅ test-account-profile-crud clean".

- [ ] **Step 4: Commit**

```bash
git add account.html scripts/test-account-profile-crud.mjs
git commit -m "WT-2: account.html shell + profile CRUD passing"
```

---

## Task 11: Visual pass on account.html measurements stub buttons

The measurements section already exists in the Task 10 markup (3 rows: Body measurements, Reference garment, In-person consultation). This task only verifies the visual treatment and "Available soon" copy match spec §7.2 #2.

**Files:**
- (No new files. May tweak inline styles inside `account.html`.)

- [ ] **Step 1: Read the rendered output**

```bash
curl -s http://localhost:3000/account.html | grep -A1 "measurement-row__label"
```

Expect three rows with the strings "Body measurements", "Reference garment", "In-person consultation".

- [ ] **Step 2: Confirm the disabled buttons are non-interactive**

In a browser DevTools session (or via puppeteer if you prefer), confirm the two "Add" buttons have `disabled` + `aria-disabled="true"` and the "Book" link points to `/book-appointment.html`.

- [ ] **Step 3: Commit if any tweaks were made; otherwise skip**

```bash
git status --short
# If anything changed:
git add account.html
git commit -m "WT-2: account.html measurements stub buttons polished"
```

---

## Task 12: Smoke-test → wire the delete-account flow

**Files:**
- Create: `scripts/test-account-delete.mjs`

The modal markup + JS are already in the Task 10 build. This task adds the puppeteer test and fixes any wiring issues it surfaces.

- [ ] **Step 1: Write the failing test**

Create `scripts/test-account-delete.mjs`:

```js
// WT-2 — sign in → /account.html → open delete modal → confirm → /?account_deleted=1
//        + auth.users row is gone + newsletter_subscribers.profile_id is null for that email.
import 'dotenv/config';
import puppeteer from 'puppeteer';
import { createClient } from '@supabase/supabase-js';

const URL  = process.env.SUPABASE_URL;
const SVC  = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !SVC) { console.error('missing env'); process.exit(2); }
const admin = createClient(URL, SVC, { auth: { persistSession: false } });

const email = `wt2-delete-${Date.now()}@example.com`;
const pw    = 'Correct-Horse-Battery-9!';

let failures = 0;
const must = (cond, msg) => { if (!cond) { console.error('✘', msg); failures++; } else console.log('✓', msg); };

const { data: created } =
  await admin.auth.admin.createUser({ email, password: pw, email_confirm: true,
    user_metadata: { full_name: 'Delete Me', opted_in_newsletter: true } });
const userId = created?.user?.id;
must(!!userId, 'seed user');

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
const page    = await browser.newPage();
try {
  await page.goto('http://localhost:3000/login.html', { waitUntil: 'networkidle0' });
  await page.type('input[name="email"]', email);
  await page.type('input[name="password"]', pw);
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle0' }),
    page.click('button[type="submit"]'),
  ]);
  must(page.url().endsWith('/account.html'), 'on account.html');

  // open modal
  await page.click('#open-delete-modal');
  await page.waitForSelector('#delete-modal:not([hidden])');
  must(true, 'delete modal visible');

  // wrong confirm text
  await page.type('#confirm-text', 'delete');
  await page.type('#confirm-password', pw);
  await page.click('#delete-form button[type="submit"]');
  await page.waitForSelector('#delete-modal-error:not([hidden])');
  must(true, 'lowercase delete rejected');

  // fix it
  await page.$eval('#confirm-text', el => { el.value = ''; });
  await page.type('#confirm-text', 'DELETE');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle0' }),
    page.click('#delete-form button[type="submit"]'),
  ]);
  must(page.url().includes('/?account_deleted=1') || page.url().endsWith('?account_deleted=1'),
       `landed on /?account_deleted=1 → ${page.url()}`);

  // auth.users row is gone
  const { data: list } = await admin.auth.admin.listUsers();
  const stillThere = list.users.find(u => u.email === email);
  must(!stillThere, 'auth.users row deleted');

  // newsletter_subscribers row still exists but profile_id is null
  // (only checked if WT-1's migration altered FK to ON DELETE SET NULL — per spec §5.1)
  const { data: subs } = await admin
    .from('newsletter_subscribers')
    .select('email, profile_id')
    .eq('email', email);
  if (subs && subs.length > 0) {
    must(subs[0].profile_id === null, `newsletter_subscribers.profile_id is null → ${subs[0].profile_id}`);
  } else {
    console.log('• no newsletter row for this email (acceptable — opt-in inserted only if trigger ran)');
  }
} finally {
  await browser.close();
  // belt-and-braces cleanup in case the test failed mid-flow and the user still exists
  if (userId) await admin.auth.admin.deleteUser(userId).catch(() => {});
}

if (failures) { console.error(`\n❌ ${failures} failure(s)`); process.exit(1); }
console.log('\n✅ test-account-delete clean');
```

- [ ] **Step 2: Run**

```bash
node scripts/test-account-delete.mjs
```

Expect green if Task 10's modal JS is correct. If red, fix the failing assertion in `account.html` (most likely candidates: modal open/close wiring, the `confirm-text` validation, the `?account_deleted=1` redirect).

- [ ] **Step 3: Commit**

```bash
git add scripts/test-account-delete.mjs
# include account.html only if you tweaked it
git status --short
git add account.html 2>/dev/null || true
git commit -m "WT-2: test-account-delete + delete-account flow green"
```

---

## Task 13: Route guards test (`requireAuth` / `requireGuest`)

**Files:**
- Create: `scripts/test-route-guards.mjs`

- [ ] **Step 1: Write the test**

Create `scripts/test-route-guards.mjs`:

```js
// WT-2 — Two guard rules:
//   1. signed-out visit to /account.html  → /login.html?next=/account.html
//   2. signed-in  visit to /login.html    → /account.html
import 'dotenv/config';
import puppeteer from 'puppeteer';
import { createClient } from '@supabase/supabase-js';

const URL = process.env.SUPABASE_URL;
const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !SVC) { console.error('missing env'); process.exit(2); }
const admin = createClient(URL, SVC, { auth: { persistSession: false } });

const email = `wt2-guards-${Date.now()}@example.com`;
const pw    = 'Correct-Horse-Battery-9!';

let failures = 0;
const must = (cond, msg) => { if (!cond) { console.error('✘', msg); failures++; } else console.log('✓', msg); };

const { data: created } =
  await admin.auth.admin.createUser({ email, password: pw, email_confirm: true });

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
const page    = await browser.newPage();
try {
  // 1. signed-out → /account.html → /login.html?next=/account.html
  await page.goto('http://localhost:3000/account.html', { waitUntil: 'networkidle0' });
  must(/\/login\.html\?.*next=%2Faccount\.html/.test(page.url()) ||
       page.url().endsWith('/login.html?next=/account.html'),
       `signed-out account → ${page.url()}`);

  // 2. sign in via the form on the redirected page
  await page.type('input[name="email"]', email);
  await page.type('input[name="password"]', pw);
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle0' }),
    page.click('button[type="submit"]'),
  ]);
  must(page.url().endsWith('/account.html'), `?next= honored → ${page.url()}`);

  // 3. signed-in visit to /login.html → /account.html
  await page.goto('http://localhost:3000/login.html', { waitUntil: 'networkidle0' });
  must(page.url().endsWith('/account.html'), `signed-in login → ${page.url()}`);
} finally {
  await browser.close();
  if (created?.user?.id) await admin.auth.admin.deleteUser(created.user.id);
}

if (failures) { console.error(`\n❌ ${failures} failure(s)`); process.exit(1); }
console.log('\n✅ test-route-guards clean');
```

- [ ] **Step 2: Run**

```bash
node scripts/test-route-guards.mjs
```

If `requireGuest` does not honor the `?next=` query param after sign-in (login.html step 2), confirm the inline JS in `login.html` reads `qs.get('next')` and redirects there. Both guard helpers come from `js/auth.js` (WT-1) — if a guard helper itself is broken, file as a WT-1 bug rather than patching here.

- [ ] **Step 3: Commit**

```bash
git add scripts/test-route-guards.mjs
git commit -m "WT-2: route guards test green"
```

---

## Task 14: Visual screenshots at 1440 + 375

**Files:**
- Screenshots in `temporary screenshots/` (auto-numbered by `screenshot.mjs`).

CLAUDE.md mandates `node screenshot.mjs http://localhost:3000` with an optional label. `screenshot.mjs` ships at 1440×900. For 375 we use a tiny inline override script.

- [ ] **Step 1: Five 1440-width screenshots**

```bash
node screenshot.mjs http://localhost:3000/signup.html signup-1440
node screenshot.mjs http://localhost:3000/login.html  login-1440
node screenshot.mjs http://localhost:3000/forgot-password.html forgot-1440
node screenshot.mjs http://localhost:3000/reset-password.html  reset-1440
# account.html requires a session — sign in via puppeteer or skip the 1440 cap here
# and just confirm sign-out → /login.html screen is captured; we capture account at
# 1440 + 375 in step 3.
```

For each, read the saved PNG from `./temporary screenshots/` with the Read tool and compare against the Task 2 mock. If any page differs in spacing, font weight, or color, fix and re-screenshot. **Two comparison rounds minimum per CLAUDE.md.**

- [ ] **Step 2: Five 375-width screenshots**

Create `scripts/screenshot-375.mjs` (one-off helper):

```js
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const url   = process.argv[2];
const label = process.argv[3] || '375';
const dir   = path.join(process.cwd(), 'temporary screenshots');
fs.mkdirSync(dir, { recursive: true });
const existing = fs.readdirSync(dir).filter(f => f.endsWith('.png'));
const nums = existing.map(f => parseInt(f.match(/screenshot-(\d+)/)?.[1] || '0')).filter(Boolean);
const next = nums.length ? Math.max(...nums) + 1 : 1;
const out = path.join(dir, `screenshot-${next}-${label}.png`);

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 375, height: 812, deviceScaleFactor: 2 });
await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
await new Promise(r => setTimeout(r, 300));
await page.screenshot({ path: out, fullPage: true });
await browser.close();
console.log(`Saved: ${out}`);
```

Run:

```bash
node scripts/screenshot-375.mjs http://localhost:3000/signup.html         signup-375
node scripts/screenshot-375.mjs http://localhost:3000/login.html          login-375
node scripts/screenshot-375.mjs http://localhost:3000/forgot-password.html forgot-375
node scripts/screenshot-375.mjs http://localhost:3000/reset-password.html  reset-375
```

Read each PNG with the Read tool. Confirm card stays centered, font sizes don't truncate, footer columns stack.

- [ ] **Step 3: account.html at both widths (signed-in)**

Add a one-off `scripts/screenshot-account.mjs`:

```js
import 'dotenv/config';
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const URL  = process.env.SUPABASE_URL;
const SVC  = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !SVC) { console.error('missing env'); process.exit(2); }
const admin = createClient(URL, SVC, { auth: { persistSession: false } });

const email = `wt2-shot-${Date.now()}@example.com`;
const pw    = 'Shot-Pass-9!';
const { data: created } =
  await admin.auth.admin.createUser({ email, password: pw, email_confirm: true,
    user_metadata: { full_name: 'Visual Tester', opted_in_newsletter: true } });

const dir = path.join(process.cwd(), 'temporary screenshots');
fs.mkdirSync(dir, { recursive: true });
const shot = async (page, label) => {
  const existing = fs.readdirSync(dir).filter(f => f.endsWith('.png'));
  const nums = existing.map(f => parseInt(f.match(/screenshot-(\d+)/)?.[1] || '0')).filter(Boolean);
  const next = nums.length ? Math.max(...nums) + 1 : 1;
  const out = path.join(dir, `screenshot-${next}-${label}.png`);
  await page.screenshot({ path: out, fullPage: true });
  console.log(`Saved: ${out}`);
};

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
try {
  for (const [width, label] of [[1440, 'account-1440'], [375, 'account-375']]) {
    const page = await browser.newPage();
    await page.setViewport({ width, height: width === 1440 ? 900 : 812, deviceScaleFactor: width === 375 ? 2 : 1 });
    await page.goto('http://localhost:3000/login.html', { waitUntil: 'networkidle0' });
    await page.type('input[name="email"]', email);
    await page.type('input[name="password"]', pw);
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle0' }),
      page.click('button[type="submit"]'),
    ]);
    await new Promise(r => setTimeout(r, 400));
    await shot(page, label);
    await page.close();
  }
} finally {
  await browser.close();
  if (created?.user?.id) await admin.auth.admin.deleteUser(created.user.id);
}
```

Run:

```bash
node scripts/screenshot-account.mjs
```

Read both PNGs with the Read tool. Confirm the two-column layout at 1440 and the stacked layout at 375.

- [ ] **Step 4: Commit the helper scripts (not the PNGs — `temporary screenshots/` is gitignored)**

```bash
git status --short
git add scripts/screenshot-375.mjs scripts/screenshot-account.mjs
git commit -m "WT-2: screenshot helpers for 375 + signed-in account"
```

---

## Task 15: Token-discipline regression check

**Files:** none — read-only.

The Phase 0 `scripts/test-token-discipline.mjs` only lints the original 6 pages by name. Extend it (or run an inline check) to cover the 5 new pages.

- [ ] **Step 1: Run the existing lint against the original 6 pages**

```bash
node scripts/test-token-discipline.mjs
```

Expect "✅ token discipline clean across 7 files". WT-2 did not touch those files; this must still pass.

- [ ] **Step 2: Manual lint of the 5 new pages**

```bash
grep -nE "btn-(primary|dark|outline|light|outline-light)" signup.html login.html forgot-password.html reset-password.html account.html || echo "no legacy classes"
grep -nE "transition:\s*all" signup.html login.html forgot-password.html reset-password.html account.html || echo "no transition: all"
grep -nE "(background(-color)?|color|border(-color)?|fill|stroke)\s*:\s*#(000|fff)" signup.html login.html forgot-password.html reset-password.html account.html || echo "no hardcoded #000/#fff"
```

All three must print the "no ..." message. If any prints a match, fix and re-run.

- [ ] **Step 3: No commit unless a fix was applied**

---

## Task 16: All-tests sweep

Run every test that should be passing on `main` after WT-1 + WT-3 + WT-4 + this worktree.

- [ ] **Step 1: Phase 0 suite**

```bash
node scripts/test-customizer-flow.mjs
node scripts/test-design-hero-rail.mjs
node scripts/test-swatch-prefers-hero.mjs
node scripts/test-layout-mount.mjs
node scripts/test-newsletter-submit.mjs
node scripts/test-token-discipline.mjs
```

All six must print their `✅` lines.

- [ ] **Step 2: WT-1 suite (already on `main`)**

```bash
node scripts/test-auth-roundtrip.mjs
node scripts/test-trigger-newsletter-backfill.mjs
node scripts/test-profile-rls.mjs
node scripts/test-delete-rpc.mjs
```

- [ ] **Step 3: WT-3 suite (if merged)**

```bash
node scripts/test-measurements-rls.mjs
node scripts/test-measurements-views.mjs
node scripts/test-measurements-cascade.mjs
```

- [ ] **Step 4: WT-4 suite (if merged) — extend the PAGES array first**

WT-4 shipped `scripts/test-csp-compliance.mjs` with a 7-page PAGES array (the 6 existing pages + `/privacy.html`). The 5 new auth pages need to be added so the sweep covers them too. Edit the file:

```js
// scripts/test-csp-compliance.mjs — update the PAGES const
const PAGES = [
  '/index.html',
  '/shop.html',
  '/product.html',
  '/cart.html',
  '/book-appointment.html',
  '/in-store.html',
  '/privacy.html',
  '/signup.html',
  '/login.html',
  '/forgot-password.html',
  '/reset-password.html',
  '/account.html',
];
```

Then run the sweep:

```bash
node scripts/test-csp-compliance.mjs
```

Expected: zero CSP violations on all 12 pages. If a violation appears on any of the 5 new pages, the CSP block on that page is missing or malformed — fix the page, not the policy.

Stage the edit when committing:

```bash
git add scripts/test-csp-compliance.mjs
```

- [ ] **Step 5: WT-2 suite**

```bash
node scripts/test-profile-module.mjs
node scripts/test-signup-flow.mjs
node scripts/test-forgot-reset.mjs
node scripts/test-account-profile-crud.mjs
node scripts/test-account-delete.mjs
node scripts/test-route-guards.mjs
```

If any test fails, debug — invoking `superpowers:systematic-debugging` is appropriate. Do not move on to Task 17 until every test prints `✅`.

---

## Task 17: PR checklist + commit message

**Files:** none — process step.

- [ ] **Step 1: `git log` review**

```bash
git log --oneline main..HEAD
```

Confirm the commits read as a tidy story (Tasks 3, 4, 5, 6, 7, 8, 9, 10, 12, 13, 14). If any commit is messy (debug noise, half-formed code), use `git rebase` only if you understand the consequences — otherwise leave the history as-is.

- [ ] **Step 2: `git diff` review**

```bash
git diff main...HEAD --stat
```

Expect ~6 new HTML pages, `js/profile.js`, ~6 new test scripts, and the two screenshot helpers. No edits to `js/auth.js`, `js/layout.js`, `components/*`, or any existing page.

- [ ] **Step 3: Invoke `superpowers:verification-before-completion`**

Walk the WT-2 §9.1 checklist from the spec one last time:

1. `scripts/test-signup-flow.mjs` ✅
2. `scripts/test-forgot-reset.mjs` ✅
3. `scripts/test-account-profile-crud.mjs` ✅
4. `scripts/test-account-delete.mjs` ✅
5. Route guards: `scripts/test-route-guards.mjs` ✅
6. Visual gate: 5 pages screenshotted at 1440 + 375 ✅
7. All Phase 0 + WT-1 (+WT-3 +WT-4 if merged) tests pass ✅

- [ ] **Step 4: Push and open PR**

```bash
git push -u origin phase-1/auth-pages
gh pr create --title "Phase 1 WT-2: auth pages (signup, login, forgot, reset, account) + js/profile.js + delete-account UI" --body "$(cat <<'EOF'
## Summary
- New pages: `signup.html`, `login.html`, `forgot-password.html`, `reset-password.html`, `account.html`. Every page carries the Phase 1 CSP `<meta>` from spec §8.2 and reuses `css/base.css` tokens.
- New module: `js/profile.js` with `getMyProfile`, `updateMyProfile`, `getLatestMeasurements`, `saveMeasurements` (the last two are exported but no Phase 1 UI calls them — Phase 2 wires them).
- Self-serve delete-account modal on `account.html` calls `auth.deleteAccount()` (→ `delete_my_account` RPC from WT-1).

## Test plan
- [x] `node scripts/test-profile-module.mjs`
- [x] `node scripts/test-signup-flow.mjs`
- [x] `node scripts/test-forgot-reset.mjs`
- [x] `node scripts/test-account-profile-crud.mjs`
- [x] `node scripts/test-account-delete.mjs`
- [x] `node scripts/test-route-guards.mjs`
- [x] All Phase 0 + WT-1 tests still pass
- [x] Visual screenshots of 5 pages at 1440 + 375

Spec: `docs/superpowers/specs/2026-06-16-phase-1-design.md` §4, §6.4, §7.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 5: Return the PR URL**

---

## Self-review checklist (before declaring this plan ready to execute)

1. **Spec coverage** — every page from §7.1, every flow from §6.2, every `js/profile.js` export from §6.4:
   - §7.1 pages: signup ✅ (Task 6) · login ✅ (Task 7) · forgot ✅ (Task 8) · reset ✅ (Task 9) · account ✅ (Tasks 10–12).
   - §6.2 flows: 1 sign-up ✅ (Task 6+7 test) · 2 sign-in ✅ (Tasks 7, 13) · 3 forgot ✅ (Tasks 8, 9) · 4 reset ✅ (Task 9) · 5 delete ✅ (Task 12).
   - §6.4 exports: `getMyProfile` ✅ (Task 3) · `updateMyProfile` ✅ (Task 4) · `getLatestMeasurements` ✅ (Task 5) · `saveMeasurements` ✅ (Task 5).
2. **Placeholder scan** — there are no `[TO FILL]`, no `// TODO`, no `...`, no "similar to above". Every code block is complete and executable.
3. **Name consistency** — `getMyProfile()` (not `getProfile`), `auth.signUp` / `signUp` (not `signup`), `account.html` (not `/account`), `.btn--primary` (not `.btn-primary`), `requireAuth` / `requireGuest` (not `require_auth`), `crf:layout-ready` (not `layout-ready`), `delete_my_account` (RPC name, snake_case). Token names use the `--color-jet`, `--color-stone`, `--color-cream`, `--color-charcoal`, `--color-off-white` set defined in `css/base.css`.
4. **No drift into WT-1 / WT-3 / WT-4 territory** — no schema changes, no edits to `js/auth.js`, no edits to `components/header.html` or `components/footer.html`, no edits to `privacy.html`.
5. **CSP block matches spec §8.2 verbatim** in all five new pages.
