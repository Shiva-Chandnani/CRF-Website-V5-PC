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
  const { data, error } = await signUp(payload);
  btn.removeAttribute('aria-busy');
  btn.disabled = false;
  if (error) {
    errBox.textContent = error.message || 'Something went wrong. Please try again.';
    errBox.hidden = false;
    return;
  }
  // If email confirmation is disabled (current project config), signUp returns
  // a live session and the user is already signed in → go straight to account.
  // When confirmation is re-enabled before launch, no session comes back yet →
  // send them to sign in with the "check your email" prompt.
  if (data?.session) {
    window.location.assign('/account.html');
  } else {
    window.location.assign('/login.html?check_email=1');
  }
});
