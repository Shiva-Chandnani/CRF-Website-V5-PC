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
