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
