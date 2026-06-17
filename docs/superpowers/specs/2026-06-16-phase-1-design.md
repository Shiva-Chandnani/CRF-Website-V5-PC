# Phase 1 — Identity & Personal Data

**Date:** 2026-06-16
**Status:** Design approved, ready for implementation plan
**Workflow context:** Second phase of the 14-feature backlog defined in [PROJECT.md](../../../PROJECT.md) §7 and the per-feature agentic cycle in [~/.claude/plans/just-to-revamp-the-agile-sundae.md](file:///Users/shivachandnani/.claude/plans/just-to-revamp-the-agile-sundae.md). Pre-requisite for every later phase that touches personal data (Phase 2 commerce, Phase 5 admin/CRM). Phase 0 ([2026-05-29 design](2026-05-29-phase-0-shared-layout-design.md)) shipped the shared spine; Phase 1 lights up customer identity on top of it.

---

## 1. Goal

Customers can create accounts, sign in, view and edit their profile, and delete their account. The database schema can store measurements they later provide (body measurements + three reference-garment kinds). Every page carries a Content Security Policy meta tag. A PDPA-compliant privacy notice exists and is linked from the footer of every page.

## 2. Non-goals

- **No Google OAuth.** Email/password only in this phase. Deferred to a later phase (see §3 Q6).
- **No measurement capture UI.** Schema ships; account-page measurements section shows three placeholder buttons. Forms are Phase 2 work (Q8).
- **No cart/book-appointment profile prefill.** `js/auth.js` exposes `getUser()` so Phase 2 can wire it; no prefill UI in Phase 1.
- **No email change flow.** Customers delete + re-signup if they need to change addresses. Real email-change with re-verification is Phase 5+.
- **No CSP hardening.** Permissive baseline (`'unsafe-inline'` allowed) — matches the existing inline-script/style reality. Phase 3 tightens.
- **No admin role UI.** `role` column exists on `profiles` with allowed values; the admin dashboard is Phase 5.
- **No orders, payments, addresses tables.** Phase 2 schema work.

## 3. Decisions

| # | Question | Value |
|---|---|---|
| Q1 | Worktree breakdown | **Four worktrees**: WT-1 auth-foundation, WT-2 auth-pages, WT-3 measurements-schema, WT-4 privacy-csp. Wave 1 = {WT-1, WT-3, WT-4} in parallel. Wave 2 = WT-2 after WT-1 merges. |
| Q2 | Signup form scope | **Balanced** — full name + email + password + newsletter checkbox. Email verification required. |
| Q3 | Auth surface scope | **Signup + login + forgot-password + reset-password + account view/edit + self-serve delete-account**. No email change in this phase. |
| Q4a | Measurement units | **Inches for body and reference measurements; cm for height; kg for weight.** UI unit toggle deferred to Phase 2. |
| Q4b | History strategy | **Append-only.** Every save inserts a new row; `v_latest_*` views surface the most recent per `(customer_id, kind)`. |
| Q4c | Reference garment storage | **Absolute target measurements only** (not "received + change-to" deltas). |
| Q4d | "Book appointment" mode | **Link button** to existing `book-appointment.html`. No DB row. |
| Q5 | Schema shape | **Four narrow typed tables** (`customer_body_measurements`, `customer_jacket_reference`, `customer_shirt_reference`, `customer_pants_reference`). One RLS policy pattern, four "latest" views. |
| Q6 | Google OAuth | **Deferred.** Email/password only in Phase 1. |
| Q7a | Privacy page depth | **Full PDPA-compliant.** 12 sections; ~3–4 viewports. |
| Q7b | CSP strictness | **Permissive baseline.** `'unsafe-inline'` allowed for scripts and styles. Phase 3 hardens. |
| Q8 | Account-page measurements section in Phase 1 | **Stub buttons only.** Body / Reference garment buttons disabled with "Coming soon"; In-person consultation links to `book-appointment.html`. Forms in Phase 2. |
| — | Order retention statement | **Indefinite** while account is active. Account deletion removes most personal data; tax-mandated invoice records may be retained per Thai Revenue Code. |
| — | Session persistence | Supabase default (localStorage). No cookies set in V1; no consent banner required for strictly-necessary auth tokens. |
| — | Role column | `text check (role in ('customer','staff','admin'))` default `'customer'`. Not a Postgres enum (cheaper to extend). |
| — | Email storage on `profiles` | Mirrored from `auth.users.email` by the trigger. Avoids cross-schema joins in RLS-filtered queries. |

## 4. Worktree breakdown & execution order

```
Wave 1 (parallel) — foundation
┌────────────────────────────────────────────────────────────┐
│  WT-1 auth-foundation       WT-3 measurements-schema       │
│   profiles table             4 measurement tables          │
│   handle_new_user trigger    4 v_latest_* views            │
│   delete_my_account RPC      RLS owner-only                │
│   js/auth.js                 db/09_measurements.sql        │
│   header session swap                                      │
│   db/08_profiles.sql         WT-4 privacy-csp              │
│                              privacy.html (PDPA)           │
│                              CSP <meta> wired              │
│                              footer Privacy link           │
└────────────────────────────────────────────────────────────┘
                              ↓ (merge WT-1, WT-3, WT-4)
                              ↓
Wave 2 — pages (depends on WT-1 only)
┌────────────────────────────────────────────────────────────┐
│  WT-2 auth-pages                                           │
│   signup.html · login.html · account.html                  │
│   forgot-password.html · reset-password.html               │
│   js/profile.js                                            │
│   "Delete my account" UI                                   │
└────────────────────────────────────────────────────────────┘
```

| Worktree | Scope | Depends on | Branch |
|---|---|---|---|
| **WT-1** auth-foundation | `profiles` table + trigger + RPC, `js/auth.js`, header session swap, `data-account-link` hook | Phase 0 (shipped) | `phase-1/auth-foundation` |
| **WT-2** auth-pages | signup, login, forgot-password, reset-password, account; `js/profile.js`; delete-account UI | WT-1 merged to `main` | `phase-1/auth-pages` |
| **WT-3** measurements-schema | 4 tables, 4 views, RLS, cascade-delete | `profiles` table existing (WT-1 migration) — can run after WT-1 merge, or be designed in parallel and applied after | `phase-1/measurements-schema` |
| **WT-4** privacy-csp | `privacy.html`, CSP `<meta>` into 12 pages + `components/header.html`, footer Privacy link | Phase 0 only | `phase-1/privacy-csp` |

**Choreography:**

1. This spec lands first on `main` as `docs/superpowers/specs/2026-06-16-phase-1-design.md`.
2. WT-1, WT-3, WT-4 each get their own worktree (via `superpowers:using-git-worktrees`), brainstorm, plan, execute, verify, review, merge. WT-4 is fully independent of WT-1. **WT-3 can be designed/implemented in parallel with WT-1, but its migration must be applied after WT-1's migration** (WT-3 tables FK to `profiles`). Practical effect: WT-3 can open its PR in parallel; its CI/applied-migration step runs after WT-1 merges.
3. After WT-1 merges, WT-2 starts — it depends on the merged `js/auth.js` and the `profiles` RLS.
4. Phase 1 merges to `main` after WT-2 lands and the Phase 1 exit gates pass (§9).

## 5. Schema

Two migration files, applied via `node scripts/run-sql.mjs db/<file>`.

### 5.1 `db/08_profiles.sql` (WT-1)

```sql
create table public.profiles (
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

alter table profiles enable row level security;
create policy "profiles_owner_select" on profiles for select using (auth.uid() = id);
create policy "profiles_owner_update" on profiles for update using (auth.uid() = id);
-- No insert policy: only the trigger inserts. No delete policy: only the cascade from auth.users.

-- updated_at trigger (hand-rolled; avoids contrib moddatetime dependency)
create function public.touch_updated_at() returns trigger
language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

create trigger profiles_set_updated_at
  before update on profiles
  for each row execute function public.touch_updated_at();
```

**`handle_new_user()` trigger:**

```sql
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, email, full_name, opted_in_newsletter, marketing_consent_at)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    coalesce((new.raw_user_meta_data->>'opted_in_newsletter')::boolean, false),
    case when (new.raw_user_meta_data->>'opted_in_newsletter')::boolean
         then now() else null end
  );

  -- Phase 0 hook: backfill profile_id on newsletter_subscribers if email already captured
  update newsletter_subscribers set profile_id = new.id where email = new.email;

  -- If they opted in at signup and don't already have a newsletter row, insert one
  if (new.raw_user_meta_data->>'opted_in_newsletter')::boolean then
    insert into newsletter_subscribers (email, profile_id, source, opted_in_at)
    values (new.email, new.id, 'signup', now())
    on conflict (email) do nothing;
  end if;

  return new;
end; $$;

create trigger on_auth_user_created
  after insert on auth.users for each row execute function public.handle_new_user();
```

**`delete_my_account()` RPC:**

```sql
create function public.delete_my_account() returns void
language plpgsql security definer set search_path = public, auth as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  delete from auth.users where id = auth.uid();
end; $$;
revoke all on function public.delete_my_account() from public;
grant execute on function public.delete_my_account() to authenticated;
```

**`newsletter_subscribers.profile_id` FK update:** alter to `on delete set null` so deleting an account preserves the subscription (separate consent surface) but removes the link.

### 5.2 `db/09_measurements.sql` (WT-3)

Four tables, same shape pattern. All numeric measurement fields are `numeric(5,2)` (range 0–999.99, two decimal places) and nullable, supporting partial saves. RLS is owner-only on all four; cascade from `profiles` on delete.

**Tables:**

- `customer_body_measurements` — 19 fields + height/weight + notes:
  - Jacket+coat body fields: `chest_in, stomach_in, hips_in, shoulders_in, arm_length_in, bicep_in, arm_hole_in, front_in, back_in, length_in, neck_in`
  - Trouser body fields: `trouser_waist_in, trouser_hips_in, trouser_crotch_in, trouser_thigh_in, trouser_knee_in, trouser_calf_in, trouser_cuff_in, trouser_length_in`
  - Common: `height_cm, weight_kg, notes`
- `customer_jacket_reference` — 15 fields: `collar_in, shoulder_in, half_armhole_in, sleeve_length_in, sleeve_inseam_in, sleeve_width_in, length_lower_in, length_upper_in, back_length_in, half_chest_in, half_waist_in, bottom_hem_in, yoke_in, half_girth_in, half_back_width_in` + notes
- `customer_shirt_reference` — 10 fields: `collar_in, chest_in, waist_in, hips_in, length_in, sleeve_length_in, shoulders_in, armhole_in, bicep_in, cuff_in` + notes
- `customer_pants_reference` — 8 fields: `waist_in, hips_in, length_in, crotch_front_in, crotch_back_in, thigh_in, calf_in, bottom_in` + notes

Each table also has: `id uuid pk default gen_random_uuid()`, `customer_id uuid not null references profiles(id) on delete cascade`, `captured_at timestamptz not null default now()`, `created_at timestamptz not null default now()`.

**RLS pattern (repeats verbatim on all four tables):**

```sql
alter table customer_body_measurements enable row level security;
create policy "owner_select" on customer_body_measurements for select using (auth.uid() = customer_id);
create policy "owner_insert" on customer_body_measurements for insert with check (auth.uid() = customer_id);
create policy "owner_update" on customer_body_measurements for update using (auth.uid() = customer_id);
create policy "owner_delete" on customer_body_measurements for delete using (auth.uid() = customer_id);
```

**Append-only convention:** the `js/profile.js` `saveMeasurements(kind, fields)` API always INSERTs (every save = new row, history preserved). The UPDATE policy is permissive — kept so Phase 2 can support narrow corrections (e.g., editing a `notes` field on the latest row) without re-saving the whole set. Schema does not strictly enforce append-only; that's intentional flexibility.

**Four "latest" views — for the account page:**

```sql
create view v_latest_body_measurements as
  select distinct on (customer_id) * from customer_body_measurements
  order by customer_id, captured_at desc;
-- Same pattern for v_latest_jacket_reference, v_latest_shirt_reference, v_latest_pants_reference.
-- Views inherit RLS from base tables.
```

**Idempotency:** both migrations wrap in `begin … commit`, use `create table if not exists`, `drop trigger if exists` before recreation, `create or replace function` for functions.

## 6. Auth flows & JS modules

### 6.1 `js/auth.js` — public API

```
// Read-only state
getSession()                          → Promise<Session | null>
getUser()                             → Promise<User | null>
onAuthChange(callback)                → unsubscribe fn (SIGNED_IN/SIGNED_OUT/USER_UPDATED)

// Mutations
signUp({ email, password, full_name, opted_in_newsletter })
signInWithPassword({ email, password })
signOut()
resetPasswordForEmail(email)
updatePassword(newPassword)

// Route guards
requireAuth({ redirectTo = '/login.html' })
requireGuest({ redirectTo = '/account.html' })

// Account management
deleteAccount()                       // calls supabase.rpc('delete_my_account')
```

All Supabase calls return `{ data, error }` — never throw on auth errors. Network/unexpected errors throw normally.

**Auto-mount behavior:** on import, the module listens for the Phase 0 `crf:layout-ready` event, then binds the header's `[data-account-link]` swap (signed-out → `/login.html`, signed-in → `/account.html`) and subscribes to `onAuthChange` to keep it current.

### 6.2 The five auth flows

**1. Sign-up (email/password)**
```
signup.html form submit
  → auth.signUp({ email, password, full_name, opted_in_newsletter })
    → Supabase: insert into auth.users (email_confirmed=false)
    → trigger: insert profiles row + upsert newsletter_subscribers (if opted in)
    → Supabase: send confirmation email
  ← { data: { user, session: null }, error: null }
  → redirect to /login.html?check_email=1
  → user clicks email link → lands on /login.html?confirmed=1, session live
  → login.html sees confirmed=1 + valid session → redirect to /account.html
```

**2. Sign-in**
```
login.html form submit
  → auth.signInWithPassword({ email, password })
  ← { data: { session }, error } — on error, render inline (no redirect)
  on success → redirect to ?next=<path> if present, else /account.html
```

**3. Forgot password**
```
forgot-password.html form submit
  → auth.resetPasswordForEmail(email)
     (Supabase config: redirectTo = http://localhost:3000/reset-password.html
       and the live origin once deployed)
  ← { error: null } — always show "If that email exists, we've sent a link"
     (don't leak account existence)
```

**4. Reset password (from email link)**
```
reset-password.html loads
  → Supabase auto-detects #access_token in URL fragment and creates a session
  → page checks getSession() — if null, show "link expired" error
  → new password form → auth.updatePassword(newPassword)
  → on success: signOut + redirect to /login.html?reset=1
```

**5. Delete account**
```
account.html "Delete my account" button
  → confirmation modal: type DELETE to confirm + password re-entry
  → auth.deleteAccount() → supabase.rpc('delete_my_account')
     (cascade removes profiles + 4 measurement tables; nulls newsletter_subscribers.profile_id)
  → auth.signOut() → redirect to /?account_deleted=1
  → homepage shows a quiet toast acknowledging deletion
```

### 6.3 Header session UX (auto-attached by `js/auth.js`)

```js
const link = document.querySelector('[data-account-link]');

function paint(session) {
  if (!link) return;
  if (session) {
    link.href = '/account.html';
    link.setAttribute('aria-label', 'My account');
    link.dataset.state = 'signed-in';
  } else {
    link.href = '/login.html';
    link.setAttribute('aria-label', 'Sign in');
    link.dataset.state = 'signed-out';
  }
}

document.addEventListener('crf:layout-ready', () => {
  getSession().then(paint);
});
onAuthChange((_event, session) => paint(session));
```

### 6.4 `js/profile.js` — account-page CRUD (WT-2)

```
getMyProfile()                                      → { id, email, full_name, phone, opted_in_newsletter, ... }
updateMyProfile({ full_name, phone, opted_in_newsletter })
getLatestMeasurements(kind)                         // reads v_latest_<kind>
saveMeasurements(kind, fields)                      // INSERT (append-only)

// kind ∈ { 'body', 'jacket_reference', 'shirt_reference', 'pants_reference' }
```

The measurement endpoints are defined and exported in Phase 1 but not wired to any UI (Q8 = A); they're ready for Phase 2 to consume.

### 6.5 Session persistence

- Supabase default: localStorage. Tokens stored under `sb-fzgsogdceptjvuahukbn-auth-token`. Auto-refreshed every ~50 min while a tab is open.
- No cookies set in V1. PDPA: strictly-necessary auth tokens; no consent banner required.
- Cross-tab sync via the storage event. Sign-out in one tab signs out the others via `onAuthChange`.

## 7. Pages & header changes

### 7.1 Page inventory

| File | Purpose | Worktree | Auth guard |
|---|---|---|---|
| `signup.html` | Name + email + password + newsletter | WT-2 | `requireGuest()` |
| `login.html` | Email + password + forgot link + status banners (`?check_email`, `?confirmed`, `?reset`) | WT-2 | `requireGuest()` |
| `forgot-password.html` | Email form; constant-time response | WT-2 | Either state |
| `reset-password.html` | New password form; reads session from URL fragment | WT-2 | Session from reset link |
| `account.html` | Profile edit + measurements stub + sign out + delete account | WT-2 | `requireAuth()` |
| `privacy.html` | PDPA-compliant privacy notice (§8) | WT-4 | Public |

### 7.2 account.html structure

Two-column layout at 1440 (sidebar nav + content), stacks at 375. Sections:

1. **Profile** — editable: full name, phone, newsletter toggle. Email field shown but disabled (read-only). Save button updates `profiles` row.
2. **Measurements** — three buttons:
   - "Body measurements" → disabled, "Available soon — coming in our next release"
   - "Reference garment" → disabled, same copy
   - "In-person consultation" → links to `/book-appointment.html`
3. **Danger zone** — "Delete my account" button → confirmation modal (type DELETE + password re-entry) → `auth.deleteAccount()`.

### 7.3 Shared infrastructure changes

- **`components/header.html`** — Account icon gets `data-account-link href="/login.html"`. CSP `<meta>` tag added near the top of the fragment.
- **`components/footer.html`** — existing Privacy link gets `href="/privacy.html"` (currently `#`).
- **`css/base.css`** — add `.account-layout` grid + `.danger-zone` styles. Form-input styles from Phase 0 are adequate for all five new auth pages; no new tokens needed.
- **`js/layout.js`** — no changes. The `crf:layout-ready` event already fires after the header mounts.
- **Existing pages** — no edits required for the auth wiring. **Exception:** each of the 6 existing pages gets the CSP `<meta>` tag added directly to its `<head>` per §8 (WT-4 mechanical edit).

## 8. Privacy page outline & CSP baseline

### 8.1 `privacy.html` — 12-section PDPA-compliant outline

Editorial register matching the rest of the site (Cormorant Garamond + Raleway, generous spacing). Single-column max 720px. Estimated length: ~3–4 viewport heights.

1. **Header banner** — "Privacy Notice" + "Last updated: [date]" + "Effective: [date]".
2. **Intro paragraph** — single line of brand voice.
3. **Who we are** — `[TO FILL]` exact registered business entity + Bangkok address.
4. **What we collect** — data classes: identity/contact, account credentials, measurements + fit preferences, communication preferences, consultation bookings, cart contents (local), technical (auth tokens, server logs).
5. **Why we collect it** (lawful basis under PDPA) — contract performance, consent, legitimate interest.
6. **Who we share it with** (sub-processors) — Supabase (Singapore region), Calendly (US). No advertiser sharing.
7. **How long we keep it** — account + measurements: until account deletion. Order history: indefinite while account is active; tax-mandated records may be retained per Thai Revenue Code on otherwise-deleted accounts. Newsletter: until unsubscribe. Server logs: 90 days rolling.
8. **Your rights** (PDPA §§30–37) — access, correction, deletion via account.html, withdraw newsletter consent, complaint to PDPC Thailand.
9. **Cookies & local storage** — no tracking cookies; auth token in localStorage; cart in localStorage; no consent banner required.
10. **Cross-border transfer** — Singapore region; PDPA §28 protections; Supabase contractual commitment.
11. **Changes to this notice** — email account holders before material changes.
12. **Contact us** — `[TO FILL]` data-request contact email; (optional) DPO name.

**Styling:** reuse `css/base.css` tokens; page-specific layout inline. Anchor links per section (`#what-we-collect`, `#your-rights`, etc.) for deep-linking. Print-friendly `@media print` rule. Last-updated/Effective dates in HTML5 `<time datetime="...">`.

**Placeholders to fill at WT-4 execution time** (not blocking design approval):

- Exact registered business entity name + Bangkok address (§3 of the page)
- Data-request contact email (§12 of the page)
- (Optional) DPO name

### 8.2 CSP baseline meta tag

External resources audited against current HTML/JS: Google Fonts, esm.sh, *.supabase.co, placehold.co, Calendly. No Tailwind CDN today. No Google OAuth (deferred). No Stripe (Phase 2). The policy lists only what's actually loaded; Phase 2/3 expand the policy as those land.

```html
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
```

### 8.3 Where the CSP `<meta>` lives

- **Primary location:** directly in each page's `<head>` — needed because external resources start loading before the runtime-mounted header fragment is parsed.
- **Also in `components/header.html`** as a safety belt. Browsers intersect duplicate CSPs (both must allow) — duplicate identical policies are tolerated.
- **WT-4 edits**: all 6 existing pages (`index.html`, `shop.html`, `product.html`, `cart.html`, `book-appointment.html`, `in-store.html`) + 6 new pages (signup, login, forgot-password, reset-password, account, privacy). Mechanical edit; verified by visiting each page with DevTools open and confirming zero CSP violations.

## 9. Verification gates

### 9.1 Per-worktree gates (block PR merge)

**WT-1 — auth-foundation:**

- `node scripts/run-sql.mjs db/08_profiles.sql` applies clean; idempotent rerun is a no-op.
- `scripts/test-auth-roundtrip.mjs` — puppeteer: signup via direct Supabase call → confirm email via admin API → signInWithPassword → `getSession` returns user → signOut → `getSession` returns null.
- `scripts/test-trigger-newsletter-backfill.mjs` — pre-insert anonymous newsletter row → signup with same email → assert `profile_id` is now populated.
- `scripts/test-profile-rls.mjs` — create two users via service-role, sign in as A, attempt to SELECT B's profile → returns empty.
- `scripts/test-delete-rpc.mjs` — create user → call `delete_my_account()` → assert `auth.users` + `profiles` rows gone; `newsletter_subscribers.profile_id` is NULL for that email. Does NOT seed measurements rows (those tables ship in WT-3); the full cross-table cascade is verified in WT-3's `test-measurements-cascade.mjs`.
- **Header swap visual** — screenshot home page in signed-out and signed-in states; account icon href differs.
- All Phase 0 tests still pass.

**WT-2 — auth-pages:**

- `scripts/test-signup-flow.mjs` — puppeteer: `/signup.html` → fill form (newsletter checked) → submit → land on `/login.html?check_email=1` → confirm via admin API → reload `/login.html?confirmed=1` → assert redirect to `/account.html`.
- `scripts/test-forgot-reset.mjs` — request reset → fetch reset link via admin API → visit `reset-password.html#...` → set new password → assert sign-in with new password works.
- `scripts/test-account-profile-crud.mjs` — sign in → `/account.html` → edit name/phone/newsletter → save → reload → assert persisted.
- `scripts/test-account-delete.mjs` — sign in → `/account.html` → click Delete → confirmation modal → confirm → assert `/?account_deleted=1` + signed out + `auth.users` row gone.
- **Route guards**: signed-out visit to `/account.html` → redirect to `/login.html?next=/account.html`. Signed-in visit to `/login.html` → redirect to `/account.html`.
- **Visual gate** — screenshots of signup / login / forgot / reset / account at 1440 + 375 widths; compare to design + brand voice.
- All Phase 0 + WT-1 tests still pass.

**WT-3 — measurements-schema:**

- `node scripts/run-sql.mjs db/09_measurements.sql` applies clean.
- `scripts/test-measurements-rls.mjs` — create 2 users, seed rows for each (service-role), sign in as A, attempt to SELECT B's rows from all 4 tables → empty.
- `scripts/test-measurements-views.mjs` — insert 3 successive body-measurement rows for one user with different `captured_at` → assert `v_latest_body_measurements` returns the newest only.
- `scripts/test-measurements-cascade.mjs` — seed measurements → delete `auth.users` row → assert all 4 measurement tables empty for that user.
- All Phase 0 (+ WT-1 if merged) tests still pass.

**WT-4 — privacy-csp:**

- `privacy.html` renders and validates as HTML5; all internal anchor links resolve.
- `scripts/test-csp-compliance.mjs` — puppeteer: visit every page (6 existing + 6 new); collect CSP violations from `page.on('console')` + `page.on('pageerror')`; assert zero violations.
- Footer Privacy link click from each page lands on `/privacy.html`.
- **Visual gate** — privacy.html screenshot at 1440 + 375; brand voice intact; section anchors work.
- All Phase 0 (+ any merged WT) tests still pass.

### 9.2 Phase 1 exit gates (block Phase 2 start)

1. All Phase 0 tests green: `test-customizer-flow`, `test-design-hero-rail`, `test-swatch-prefers-hero`, `test-layout-mount`, `test-newsletter-submit`, `test-token-discipline`.
2. All Phase 1 tests green (10 new scripts above).
3. **End-to-end smoke** of the new-user journey:
   - Homepage → Account icon → `/login.html` → "Create one" → fill signup → submit → land on `/login.html?check_email=1`.
   - Confirm via email link → land on `/account.html` signed in.
   - Edit profile, save, reload → persists.
   - Click Privacy link in footer → reads notice → returns.
   - Click "Delete my account" → confirms → `/?account_deleted=1` signed out.
4. Cross-user isolation manually verified via two real accounts (sign in as each, observe data separation).
5. CSP zero-violation sweep across all 12 pages.
6. `PROJECT.md` updated with Phase 1 shipped inventory + Phase 2 hooks/notes.
7. Each worktree merged to `main` with a clear squash commit message (e.g. "Phase 1 WT-1: auth foundation (profiles, RLS, js/auth.js, header swap)").

## 10. Acceptance criteria mapping (vs. PROJECT.md spec carryover)

| Original PROJECT.md acceptance criterion | Status in this spec |
|---|---|
| New user signs up with email/password → profile row created → newsletter row created if opted in. | **Verified** by `test-signup-flow` + `test-trigger-newsletter-backfill`. |
| Google OAuth signup also creates profile. | **Deferred** (Q6 = C). Removed from Phase 1. |
| Logged-in user can view + edit profile + measurements on `/account.html`. | **Profile: verified** (`test-account-profile-crud`). **Measurements UI: Phase 2** (Q8 = A); placeholder stub buttons present. |
| Logged-in user's name appears on cart + book-appointment pages. | **Removed from Phase 1.** Prefill belongs to Phase 2; `js/auth.js` exposes `getUser` so Phase 2 can read it. |
| `/privacy.html` accessible from every page footer. | **Verified** by WT-4 footer-link click test. |
| `test-auth-roundtrip` + `test-profile-rls` pass. | **Verified** by WT-1 scripts. |
| All Phase 0 tests still pass. | **Exit gate item #1.** |

### Scope changes from PROJECT.md carryover (for the record)

1. **Google OAuth deferred** (Q6 = C). Phase 1 ships email/password only.
2. **Cart/book-appointment profile prefill moved to Phase 2.** JS hook present in WT-1; UI wiring is Phase 2.
3. **Measurements UI deferred to Phase 2** (Q8 = A). Schema ships in WT-3; account.html shows placeholder buttons.
4. **Order retention is indefinite**, not 7 years. Thai tax law may force retention of invoice records on otherwise-deleted accounts; the cascade design for orders is Phase 2 work.
5. **Auth surface expanded** beyond PROJECT.md carryover: forgot/reset password pages + delete-account flow added per Q3 = B. PDPA compliance is the driver for delete-account.
6. **Measurements schema expanded** to four narrow typed tables (body + 3 reference kinds) supporting the 3-mode capture model (body / reference garment / in-person), per Q4 + Q5. PROJECT.md's single-table sketch is superseded.

## 11. Open items / placeholders

These do not block the design approval. They are filled in at WT-4 execution time:

- Exact registered business entity name + Bangkok address (privacy page §3).
- Data-request contact email (privacy page §12).
- (Optional) DPO name (privacy page §12). Default: business owner.

## 12. Things I want to flag for later phases

- **`profiles.email` is a denormalized mirror** of `auth.users.email`. An email-change flow (Phase 5+) needs to update both rows in a transaction.
- **The `role` enum lives as a check constraint**, not a Postgres enum — extending it (e.g., adding `'wholesale'` for Phase 5) is a non-blocking ALTER and a re-deploy. No migration of existing rows.
- **`newsletter_subscribers.profile_id` becomes nullable on delete** (alter from cascade to set null in WT-1 migration). Deleting an account does not silently revoke a separately-given marketing consent.
- **Measurements append-only** means rapid resubmissions create churn. If this is observed in Phase 2 UX, consider de-duplicating saves identical to the previous row.
- **CSP `'unsafe-inline'`** is intentional permissive baseline for Phase 1. Phase 3 hardens by either extracting inline scripts/styles to files or moving to a nonce-based policy with build-step.
- **`delete_my_account()` is single-RPC and synchronous.** For users with large measurement histories this is fine (small data). If order history grows large in Phase 2, consider an async job queue.
- **No SECURITY DEFINER audit yet.** The `handle_new_user` trigger and `delete_my_account` RPC both run as the function owner. The `search_path` is set explicitly to prevent search-path attacks. Phase 3's security review should re-audit.
