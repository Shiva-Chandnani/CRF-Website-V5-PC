// =============================================================================
// Country Road Fashions — Newsletter footer-form handler
// =============================================================================
// Listens for crf:layout-ready (fired by js/layout.js after the footer is in
// the DOM). On submit, validates the email client-side, INSERTs into
// newsletter_subscribers via the Supabase REST client. Re-submitting the same
// email produces a unique-violation (23505); we treat that as success so the
// UX is idempotent. The original opted_in_at is always preserved because we
// never UPDATE.
//
// RLS constraint: there is intentionally no anon UPDATE or SELECT policy on
// this table (prevents email enumeration and mass-mutation). A plain INSERT
// is used — PostgREST's `resolution=ignore-duplicates` path requires SELECT
// which we deliberately omit.
// =============================================================================

import { supabase } from './data-loader.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(value) {
  return typeof value === 'string' && EMAIL_RE.test(value.trim());
}

function clearMessages(form) {
  form.querySelectorAll('.newsletter-error').forEach(el => el.remove());
}

function showError(form, message) {
  clearMessages(form);
  const p = document.createElement('p');
  p.className = 'newsletter-error';
  p.setAttribute('role', 'alert');
  p.textContent = message;
  form.appendChild(p);
}

function setBusy(form, busy) {
  const button = form.querySelector('button[type="submit"]');
  const input  = form.querySelector('input[type="email"]');
  if (button) {
    button.disabled = busy;
    button.setAttribute('aria-busy', busy ? 'true' : 'false');
  }
  if (input) input.disabled = busy;
}

function swapToSuccess(form) {
  const success = document.createElement('p');
  success.className = 'newsletter-success';
  success.setAttribute('role', 'status');
  success.textContent = "Thanks — you'll hear from us when the cloth arrives.";
  form.replaceWith(success);
}

async function onSubmit(e) {
  e.preventDefault();
  const form = e.currentTarget;
  clearMessages(form);

  const input = form.querySelector('input[type="email"]');
  if (!input) return;
  const email = input.value.trim().toLowerCase();
  if (!isValidEmail(email)) {
    showError(form, 'Please enter a valid email address.');
    return;
  }

  setBusy(form, true);
  const { error } = await supabase
    .from('newsletter_subscribers')
    .insert({ email, source: 'footer' });
  setBusy(form, false);

  // Unique-violation (23505) means already subscribed — treat as success so
  // re-submission is idempotent from the user's perspective.  The original
  // opted_in_at is preserved because we never UPDATE.
  if (error && error.code !== '23505') {
    console.error('[newsletter] insert failed', error);
    showError(form, "Couldn't reach us — please try again.");
    return;
  }

  swapToSuccess(form);
}

function init() {
  const form = document.querySelector('[data-newsletter-form]');
  if (!form || form.dataset.newsletterBound === '1') return;
  form.dataset.newsletterBound = '1';
  form.addEventListener('submit', onSubmit);
}

// Two paths: footer present at parse time (defensive) OR injected by layout.js.
if (document.querySelector('[data-newsletter-form]')) {
  init();
} else {
  document.addEventListener('crf:layout-ready', init, { once: true });
}
