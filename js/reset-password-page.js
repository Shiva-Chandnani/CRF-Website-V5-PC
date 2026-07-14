import { getSession, updatePassword, signOut } from '/js/auth.js';

const form   = document.getElementById('reset-form');
const errBox = document.getElementById('auth-error');

// Supabase auto-detects the recovery token in the URL and creates a session.
// Give the SDK a tick to process it, then verify a session exists.
await new Promise(r => setTimeout(r, 300));
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
