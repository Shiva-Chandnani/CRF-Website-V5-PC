import {
  requireAuth, signInWithPassword, signOut, deleteAccount, getUser, getSupabase,
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

async function loadOrders() {
  const el = document.querySelector('[data-orders-list]');
  if (!el) return;
  const sb = getSupabase();
  const { data: orders, error } = await sb.from('orders')
    .select('id,status,total_thb,created_at').order('created_at', { ascending: false });
  if (error) { el.innerHTML = '<p class="orders-empty">Could not load orders.</p>'; return; }
  if (!orders?.length) { el.innerHTML = '<p class="orders-empty">No orders yet.</p>'; return; }
  const fmtTHB = (n) => 'THB ' + Number(n).toLocaleString('en-US');
  const fmtDate = (s) => new Date(s).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' });
  el.innerHTML = orders.map(o => `
    <a class="order-row" href="order-confirmation.html?order=${o.id}">
      <span class="order-row-date">${fmtDate(o.created_at)}</span>
      <span class="order-row-status order-row-status--${o.status}">${o.status}</span>
      <span class="order-row-total">${fmtTHB(o.total_thb)}</span>
    </a>`).join('');
}
loadOrders();
