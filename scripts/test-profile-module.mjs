// WT-2 — node smoke for js/profile.js. Uses the service-role key to seed a test
// user, then signs in with the anon key + that user's password and exercises
// getMyProfile + updateMyProfile against the live profiles table.
//
// Note: this project stores config in .env.local (not .env), so we read it
// manually — matching every other test script — rather than using dotenv.
// js/profile.js lazily imports js/auth.js only when no test client is injected,
// so importing it here in Node does not trip auth.js's browser-only esm.sh import.
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { getMyProfile, updateMyProfile } from '../js/profile.js';

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8')
    .split('\n').filter(Boolean)
    .map(l => l.split('=').map(s => s.trim()))
    .map(([k, ...v]) => [k, v.join('=')])
);
const URL    = env.SUPABASE_URL;
const ANON   = env.SUPABASE_ANON_KEY;
const SVC    = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !ANON || !SVC) { console.error('missing env'); process.exit(2); }

const admin = createClient(URL, SVC, { auth: { persistSession: false } });
const user  = createClient(URL, ANON, { auth: { persistSession: false } });

const email = `wt2-profile-${Date.now()}@example.com`;
const pw    = 'Correct-Horse-Battery-9!';

let failures = 0;
const must = (cond, msg) => { if (!cond) { console.error('✘', msg); failures++; } else console.log('✓', msg); };

// 1. seed user
const { data: created, error: cErr } =
  await admin.auth.admin.createUser({ email, password: pw, email_confirm: true,
    user_metadata: { full_name: 'Jane Test', opted_in_newsletter: false } });
must(!cErr && created?.user?.id, `create user → ${cErr?.message || 'ok'}`);

// 2. sign in as that user (anon client gets a session)
const { data: sess, error: sErr } = await user.auth.signInWithPassword({ email, password: pw });
must(!sErr && sess?.session, `signIn → ${sErr?.message || 'ok'}`);

// 3. getMyProfile must read the profile row created by the trigger
globalThis.__crfSupabaseForTests = user; // js/profile.js reads this in test mode
const profile = await getMyProfile();
must(profile && profile.id === created.user.id, 'getMyProfile returns row for current user');
must(profile?.email === email, 'profile.email mirrors auth.users.email');
must(profile?.full_name === 'Jane Test', 'profile.full_name was populated by the trigger');

// 4. updateMyProfile persists
const upd = await updateMyProfile({ full_name: 'Jane Updated', phone: '+66 81 234 5678', opted_in_newsletter: true });
must(!upd.error, `updateMyProfile no error → ${upd.error?.message || 'ok'}`);
const after = await getMyProfile();
must(after?.full_name === 'Jane Updated', 'full_name persisted');
must(after?.phone === '+66 81 234 5678', 'phone persisted');
must(after?.opted_in_newsletter === true, 'opted_in_newsletter persisted');

// 5. cleanup
await admin.auth.admin.deleteUser(created.user.id);

if (failures) { console.error(`\n❌ ${failures} failure(s)`); process.exit(1); }
console.log('\n✅ test-profile-module clean');
