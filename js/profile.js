// =============================================================================
// Country Road Fashions — js/profile.js
// =============================================================================
// Account-page CRUD for the profiles row + (defined-not-wired in Phase 1)
// measurement views/tables. All calls return { data, error } shaped objects
// from Supabase — never throw on REST errors.
//
// Auth dependency: this module reuses the singleton Supabase client created by
// js/auth.js. That module imports @supabase/supabase-js from esm.sh, which only
// resolves in a browser — so we import it LAZILY (dynamic import inside client())
// rather than at module top level. This keeps js/profile.js importable in Node
// for tests, which inject their own client via globalThis.__crfSupabaseForTests.
// =============================================================================

// Tests can override the client by setting globalThis.__crfSupabaseForTests
// (used by scripts/test-profile-module.mjs). Otherwise we lazily pull the
// singleton from js/auth.js — only in a browser, where esm.sh resolves.
async function client() {
  if (globalThis.__crfSupabaseForTests) return globalThis.__crfSupabaseForTests;
  const { getSupabase } = await import('./auth.js');
  return getSupabase();
}

const PROFILE_COLUMNS =
  'id, email, full_name, phone, role, opted_in_newsletter, marketing_consent_at, created_at, updated_at';

export async function getMyProfile() {
  const sb = await client();
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

export async function updateMyProfile({ full_name, phone, opted_in_newsletter }) {
  const sb = await client();
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

// ---------------------------------------------------------------------------
// Measurements — defined in Phase 1, wired to UI in Phase 2 (spec §6.4 + Q8).
// ---------------------------------------------------------------------------

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
  const sb = await client();
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
  const sb = await client();
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
