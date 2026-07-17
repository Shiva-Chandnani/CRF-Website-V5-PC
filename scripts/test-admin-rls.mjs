// Phase 5 staff CRM: staff can read every customer's data + write notes/tags;
// a normal customer stays isolated (owner-only) and cannot touch notes/tags;
// anon is locked out. Mirrors test-rls-audit.mjs rigor (non-vacuous readbacks).
// Run twice to confirm idempotency (unique emails + teardown).
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8')
    .split('\n').filter(Boolean)
    .map(l => l.split('=').map(s => s.trim()))
    .map(([k, ...v]) => [k, v.join('=')])
);
const URL = env.SUPABASE_URL, ANON = env.SUPABASE_ANON_KEY, SVC = env.SUPABASE_SERVICE_ROLE_KEY;
const admin = createClient(URL, SVC, { auth: { persistSession: false } });

let failCount = 0;
function step(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? '  (' + detail + ')' : ''}`);
  if (!ok) failCount++;
}
const rows = (res) => res.data?.length ?? 0;

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const pw = 'Test-Pass-123!';
const emailStaff = `admin-rls-staff-${stamp}@test.countryroadfashions.com`;
const emailA = `admin-rls-a-${stamp}@test.countryroadfashions.com`;
const emailB = `admin-rls-b-${stamp}@test.countryroadfashions.com`;

async function mkUser(email, role) {
  const { data, error } = await admin.auth.admin.createUser({ email, password: pw, email_confirm: true });
  if (error) throw error;
  const id = data.user.id;
  if (role !== 'customer') {
    const { error: ue } = await admin.from('profiles').update({ role }).eq('id', id);
    if (ue) throw ue;
  }
  return id;
}
async function signIn(email) {
  const c = createClient(URL, ANON, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password: pw });
  if (error) throw error;
  return c;
}

const idStaff = await mkUser(emailStaff, 'staff');
const idA = await mkUser(emailA, 'customer');
const idB = await mkUser(emailB, 'customer');

// Seed an order for A (service_role bypasses RLS) so staff-read has something to see.
const { error: oe } = await admin.from('orders').insert({
  user_id: idA, status: 'paid', currency: 'thb', total_thb: 20000, items: [],
});
if (oe) throw oe;
// Seed a body measurement for A. (measurement tables key on customer_id.)
const { error: me } = await admin.from('customer_body_measurements').insert({ customer_id: idA });
if (me) console.log('  (note: body measurement seed skipped:', me.message, ')');

const staff = await signIn(emailStaff);
const custA = await signIn(emailA);
const anon  = createClient(URL, ANON, { auth: { persistSession: false } });

// --- staff can read across customers ---
step('staff reads A profile', rows(await staff.from('profiles').select('id').eq('id', idA)) === 1);
step('staff reads B profile', rows(await staff.from('profiles').select('id').eq('id', idB)) === 1);
step('staff reads A orders',  rows(await staff.from('orders').select('id').eq('user_id', idA)) >= 1);
const staffMeas = await staff.from('customer_body_measurements').select('id').eq('customer_id', idA);
step('staff reads A measurements (no RLS error)', !staffMeas.error, staffMeas.error?.message);

// --- staff notes + tags write/readback ---
const noteIns = await staff.from('customer_notes')
  .insert({ customer_id: idA, author_id: idStaff, body: 'VIP — wedding party' }).select();
step('staff inserts note (author=self)', !noteIns.error && rows(noteIns) === 1, noteIns.error?.message);
step('staff reads note back', rows(await staff.from('customer_notes').select('id').eq('customer_id', idA)) === 1);
const tagIns = await staff.from('customer_tags')
  .insert({ customer_id: idA, author_id: idStaff, tag: 'vip' }).select();
step('staff inserts tag', !tagIns.error && rows(tagIns) === 1, tagIns.error?.message);
step('staff reads tag back', rows(await staff.from('customer_tags').select('tag').eq('customer_id', idA)) === 1);

// --- customer A stays isolated ---
step('customer A cannot read B profile', rows(await custA.from('profiles').select('id').eq('id', idB)) === 0);
step('customer A cannot read notes', rows(await custA.from('customer_notes').select('id').eq('customer_id', idA)) === 0);
const custNote = await custA.from('customer_notes')
  .insert({ customer_id: idA, author_id: idA, body: 'x' }).select();
step('customer A cannot write notes', !!custNote.error || rows(custNote) === 0);
step('customer A can still read own profile', rows(await custA.from('profiles').select('id').eq('id', idA)) === 1);

// --- privilege escalation: customer A cannot self-promote to staff (db/16 guard) ---
const escalate = await custA.from('profiles').update({ role: 'staff' }).eq('id', idA).select();
const { data: roleAfter } = await admin.from('profiles').select('role').eq('id', idA).single();
step('customer A cannot self-promote to staff',
  (!!escalate.error || rows(escalate) === 0) && roleAfter?.role === 'customer',
  `err=${escalate.error?.message || 'none'} role=${roleAfter?.role}`);
// and even after attempting it, still cannot read another customer
step('customer A still isolated after escalation attempt',
  rows(await custA.from('profiles').select('id').eq('id', idB)) === 0);

// --- anon locked out ---
step('anon cannot read profiles', rows(await anon.from('profiles').select('id').eq('id', idA)) === 0);
step('anon cannot read notes', rows(await anon.from('customer_notes').select('id')) === 0);

// teardown
for (const id of [idStaff, idA, idB]) await admin.auth.admin.deleteUser(id);
console.log(failCount ? `\nFAIL — ${failCount} check(s)` : '\nPASS — all checks');
process.exit(failCount ? 1 : 0);
