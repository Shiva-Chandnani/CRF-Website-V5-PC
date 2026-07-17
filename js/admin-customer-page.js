// Phase 5 — admin-customer.html controller. Staff-only customer detail:
// contact, tags, orders, payments, measurements-on-file, and notes, with a
// tag-add/remove and note-add form that round-trip through js/crm.js.
import { requireStaff } from '/js/auth.js';
import { getCustomer, addNote, addTag, removeTag } from '/js/crm.js';

await requireStaff();

const fmtTHB = (n) => 'THB ' + (Number(n) || 0).toLocaleString('en-US');
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const id = new URLSearchParams(location.search).get('id');
const body = document.getElementById('cdBody');

if (!id) {
  body.innerHTML = '<p class="cd-error">No customer id.</p>';
} else {
  await render();
}

async function render() {
  let data;
  try {
    data = await getCustomer(id);
  } catch (e) {
    console.error(e);
    body.innerHTML = '<p class="cd-error">Unable to load this customer.</p>';
    return;
  }
  const p = data.profile || {};
  // Payments are already scoped to this customer's orders in crm.js getCustomer().
  const payments = data.payments;
  document.getElementById('cdName').textContent = p.full_name || p.email || 'Customer';

  body.innerHTML = `
    <section class="cd-section">
      <h2>Contact</h2>
      <div class="cd-box">
        ${row('Email', p.email)}
        ${row('Phone', p.phone || '—')}
        ${row('Newsletter', p.opted_in_newsletter ? 'Opted in' : 'No')}
        ${row('Source', p.source || 'website')}
        ${row('POS ID', p.pos_customer_id || '— not yet linked', !p.pos_customer_id)}
        ${row('Joined', (p.created_at || '').slice(0, 10))}
      </div>
    </section>

    <section class="cd-section">
      <h2>Tags</h2>
      <div class="cd-tags" id="tags">${data.tags.length ? data.tags.map(tagChip).join('') : '<span class="cd-empty">No tags yet</span>'}</div>
      <form id="tagForm" class="cd-form-row">
        <input class="input" id="tagInput" placeholder="Add a tag…" maxlength="40" autocomplete="off" aria-label="Add a tag" />
        <button class="btn btn--ghost" type="submit">Add</button>
      </form>
    </section>

    <section class="cd-section">
      <h2>Orders</h2>
      ${data.orders.length
        ? `<div class="cd-box">${data.orders.map((o) => `
        <div class="cd-row"><span class="k">${esc((o.created_at || '').slice(0, 10))}</span>
        <span class="v">${esc(o.status)} &middot; ${esc(fmtTHB(o.total_thb))}</span></div>`).join('')}</div>`
        : '<p class="cd-empty">No orders yet.</p>'}
    </section>

    <section class="cd-section">
      <h2>Payments</h2>
      ${payments.length
        ? `<div class="cd-box">${payments.map((pm) => `
        <div class="cd-row"><span class="k">${esc((pm.created_at || '').slice(0, 10))}</span>
        <span class="v">${esc(pm.status)} &middot; ${esc(fmtTHB(pm.amount_thb))}</span></div>`).join('')}</div>`
        : '<p class="cd-empty">No payments yet.</p>'}
    </section>

    <section class="cd-section">
      <h2>Measurements</h2>
      <div class="cd-box">
        ${['body', 'jacket', 'shirt', 'pants'].map((k) => `
        <div class="cd-row"><span class="k">${esc(k[0].toUpperCase() + k.slice(1))}</span>
        <span class="v${data.measurements[k] ? '' : ' v--muted'}">${data.measurements[k] ? 'On file' : '—'}</span></div>`).join('')}
      </div>
    </section>

    <section class="cd-section">
      <h2>Notes</h2>
      <form id="noteForm">
        <textarea class="input" id="noteInput" rows="2" placeholder="Add a note…" aria-label="Add a note"></textarea>
        <button class="btn btn--ghost" type="submit">Add note</button>
      </form>
      <div id="notes">${data.notes.length ? data.notes.map(noteRow).join('') : '<p class="cd-empty">No notes yet.</p>'}</div>
    </section>
  `;

  document.getElementById('tagForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = document.getElementById('tagInput').value.trim();
    if (!v) return;
    try {
      await addTag(id, v);
      await render();
    } catch (err) {
      console.error(err);
    }
  });
  document.querySelectorAll('[data-remove-tag]').forEach((b) => b.addEventListener('click', async () => {
    try {
      await removeTag(id, b.getAttribute('data-remove-tag'));
      await render();
    } catch (err) {
      console.error(err);
    }
  }));
  document.getElementById('noteForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = document.getElementById('noteInput').value.trim();
    if (!v) return;
    try {
      await addNote(id, v);
      await render();
    } catch (err) {
      console.error(err);
    }
  });
}

function row(k, v, muted = false) {
  return `<div class="cd-row"><span class="k">${esc(k)}</span><span class="v${muted ? ' v--muted' : ''}">${esc(v)}</span></div>`;
}
function tagChip(t) {
  return `<span class="cd-tag">${esc(t)}<button data-remove-tag="${esc(t)}" aria-label="Remove ${esc(t)} tag">&times;</button></span>`;
}
function noteRow(n) {
  return `<div class="cd-note"><div class="body">${esc(n.body)}</div><div class="meta">${esc((n.created_at || '').slice(0, 16).replace('T', ' '))}</div></div>`;
}
