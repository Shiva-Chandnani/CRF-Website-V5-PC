// WT-1 verification: handle_new_user backfills newsletter_subscribers.profile_id.
// 1. Insert an anonymous newsletter_subscribers row (profile_id = null).
// 2. Sign up a user with the same email via admin API (auto-confirmed).
// 3. Re-fetch the newsletter row and assert profile_id is now the new user.id.

import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8')
    .split('\n').filter(Boolean)
    .map(l => l.split('=').map(s => s.trim()))
    .map(([k, ...v]) => [k, v.join('=')])
);

const URL = env.SUPABASE_URL;
const SVC = env.SUPABASE_SERVICE_ROLE_KEY;
const admin = createClient(URL, SVC, { auth: { persistSession: false } });

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
const email = `backfill-${stamp}@example.test`;
const password = 'Test-Pass-123!';

let failed = false;
function step(name, ok, detail = '') {
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) failed = true;
}

let user;

try {
  // 1. Anonymous newsletter row
  const { error: insertErr } = await admin.from('newsletter_subscribers').insert({
    email, source: 'footer', profile_id: null,
  });
  if (insertErr) throw new Error(`seed newsletter: ${insertErr.message}`);
  const { data: pre } = await admin.from('newsletter_subscribers')
    .select('email,profile_id,source').eq('email', email).single();
  step('seeded newsletter row has profile_id=null', pre?.profile_id === null);

  // 2. Signup with same email
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw new Error(`create user: ${created.error.message}`);
  user = created.data.user;

  // 3. Re-fetch (small delay tolerates any trigger lag — should be sync but be safe)
  let post = null;
  for (let i = 0; i < 5 && !post?.profile_id; i++) {
    const r = await admin.from('newsletter_subscribers')
      .select('email,profile_id,source').eq('email', email).single();
    post = r.data;
    if (!post?.profile_id) await new Promise(r2 => setTimeout(r2, 200));
  }
  step('newsletter row exists post-signup', !!post);
  step('newsletter row profile_id backfilled', post?.profile_id === user.id,
       `expected=${user.id} got=${post?.profile_id}`);
  step('newsletter row source unchanged', post?.source === 'footer');
} catch (e) {
  failed = true;
  console.error('Test threw:', e.message);
} finally {
  if (user) await admin.auth.admin.deleteUser(user.id).catch(() => {});
  // Newsletter row's profile_id is now null again (FK on delete set null); remove the row.
  // Supabase query builders are thenables, not Promises — can't chain .catch() directly.
  try { await admin.from('newsletter_subscribers').delete().eq('email', email); } catch {}
}

if (failed) {
  console.error('\n❌ newsletter backfill test failed');
  process.exit(1);
}
console.log('\n✅ trigger backfills newsletter_subscribers.profile_id');
