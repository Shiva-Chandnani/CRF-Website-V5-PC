// WT-1 verification: delete_my_account() RPC cleans up identity rows.
// 1. Admin creates a confirmed user with opted_in_newsletter=true → trigger
//    creates a profiles row AND a newsletter_subscribers row.
// 2. Sign in as the user with the anon key, call rpc('delete_my_account').
// 3. Assert: auth.users row gone (admin getUser returns null user),
//    profiles row gone, newsletter row still exists with profile_id=null.

import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8')
    .split('\n').filter(Boolean)
    .map(l => l.split('=').map(s => s.trim()))
    .map(([k, ...v]) => [k, v.join('=')])
);

const URL  = env.SUPABASE_URL;
const ANON = env.SUPABASE_ANON_KEY;
const SVC  = env.SUPABASE_SERVICE_ROLE_KEY;
const admin = createClient(URL, SVC, { auth: { persistSession: false } });

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
const email = `delete-rpc-${stamp}@example.test`;
const password = 'Test-Pass-123!';

let failed = false;
function step(name, ok, detail = '') {
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) failed = true;
}

let userId;

try {
  // 1. Create user (opted in at signup → newsletter row created by trigger)
  const created = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
    user_metadata: { full_name: 'Delete Test', opted_in_newsletter: true },
  });
  if (created.error) throw new Error(`create: ${created.error.message}`);
  userId = created.data.user.id;

  const { data: profileBefore } = await admin.from('profiles').select('id,email').eq('id', userId).maybeSingle();
  step('profiles row exists pre-delete', profileBefore?.id === userId);

  const { data: newsBefore } = await admin.from('newsletter_subscribers')
    .select('email,profile_id,source').eq('email', email).maybeSingle();
  step('newsletter row exists with profile_id pre-delete', newsBefore?.profile_id === userId,
       `profile_id=${newsBefore?.profile_id} source=${newsBefore?.source}`);

  // 2. Sign in as the user, call RPC
  const anonC = createClient(URL, ANON, { auth: { persistSession: false } });
  const signIn = await anonC.auth.signInWithPassword({ email, password });
  if (signIn.error) throw new Error(`sign in: ${signIn.error.message}`);

  const { error: rpcErr } = await anonC.rpc('delete_my_account');
  step('rpc delete_my_account returned no error', !rpcErr, rpcErr?.message);

  // 3. Assertions via admin client
  const { data: gone } = await admin.auth.admin.getUserById(userId);
  step('auth.users row removed', !gone?.user);

  const { data: profileAfter } = await admin.from('profiles').select('id').eq('id', userId).maybeSingle();
  step('profiles row cascaded', !profileAfter);

  const { data: newsAfter } = await admin.from('newsletter_subscribers')
    .select('email,profile_id').eq('email', email).maybeSingle();
  step('newsletter row preserved', !!newsAfter);
  step('newsletter profile_id NULLed via FK', newsAfter?.profile_id === null,
       `profile_id=${newsAfter?.profile_id}`);

  await anonC.auth.signOut().catch(() => {});
  userId = null; // already deleted
} catch (e) {
  failed = true;
  console.error('Test threw:', e.message);
} finally {
  if (userId) await admin.auth.admin.deleteUser(userId).catch(() => {});
  try { await admin.from('newsletter_subscribers').delete().eq('email', email); } catch {}
}

if (failed) {
  console.error('\n❌ delete RPC test failed');
  process.exit(1);
}
console.log('\n✅ delete_my_account removes identity, preserves newsletter (FK SET NULL)');
