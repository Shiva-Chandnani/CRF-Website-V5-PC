// Phase 5: crm_metrics() returns aggregate tiles + by-month series to STAFF only.
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8').split('\n').filter(Boolean)
    .map(l => l.split('=').map(s => s.trim())).map(([k, ...v]) => [k, v.join('=')])
);
const URL = env.SUPABASE_URL, ANON = env.SUPABASE_ANON_KEY, SVC = env.SUPABASE_SERVICE_ROLE_KEY;
const admin = createClient(URL, SVC, { auth: { persistSession: false } });
let failCount = 0;
const step = (n, ok, d = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} — ${n}${d ? '  (' + d + ')' : ''}`); if (!ok) failCount++; };
const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, pw = 'Test-Pass-123!';
const emailStaff = `crm-metrics-staff-${stamp}@test.countryroadfashions.com`;
const emailCust = `crm-metrics-cust-${stamp}@test.countryroadfashions.com`;
async function mkUser(email, role) {
  const { data, error } = await admin.auth.admin.createUser({ email, password: pw, email_confirm: true });
  if (error) throw error;
  if (role !== 'customer') await admin.from('profiles').update({ role }).eq('id', data.user.id);
  return data.user.id;
}
async function signIn(email) {
  const c = createClient(URL, ANON, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password: pw });
  if (error) throw error; return c;
}
const idStaff = await mkUser(emailStaff, 'staff');
const idCust = await mkUser(emailCust, 'customer');
await admin.from('orders').insert({ user_id: idCust, status: 'paid', currency: 'thb', total_thb: 15000, items: [] });

const staff = await signIn(emailStaff);
const cust = await signIn(emailCust);

const asStaff = await staff.rpc('crm_metrics');
step('staff gets metrics object', !asStaff.error && asStaff.data && typeof asStaff.data === 'object', asStaff.error?.message);
step('metrics has total_customers', typeof asStaff.data?.total_customers === 'number');
step('metrics has revenue_thb', typeof asStaff.data?.revenue_thb === 'number');
step('metrics has by_month array', Array.isArray(asStaff.data?.by_month));

const asCust = await cust.rpc('crm_metrics');
step('customer is blocked from metrics', !!asCust.error, asCust.error ? 'errored as expected' : 'LEAK');

for (const id of [idStaff, idCust]) await admin.auth.admin.deleteUser(id);
console.log(failCount ? `\nFAIL — ${failCount} check(s)` : '\nPASS — all checks');
process.exit(failCount ? 1 : 0);
