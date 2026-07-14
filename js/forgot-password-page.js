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
