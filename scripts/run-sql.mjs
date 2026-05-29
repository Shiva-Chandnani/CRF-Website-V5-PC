#!/usr/bin/env node
// Run a SQL file against the Supabase Postgres pooler.
// Usage:  node scripts/run-sql.mjs path/to/file.sql
//
// Reads PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD from .env.local.
// Uses TLS (required by Supabase) without strict CA verification — fine for
// admin scripts run locally.

import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

// Load .env.local
const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8')
    .split('\n').filter(Boolean)
    .map(l => l.split('=').map(s => s.trim()))
    .map(([k, ...v]) => [k, v.join('=')])
);

const file = process.argv[2];
if (!file) { console.error('Usage: node scripts/run-sql.mjs <file.sql>'); process.exit(1); }
const sql = fs.readFileSync(file, 'utf8');

const client = new pg.Client({
  host:     env.PGHOST,
  port:     Number(env.PGPORT || 6543),
  database: env.PGDATABASE || 'postgres',
  user:     env.PGUSER,
  password: env.PGPASSWORD,
  ssl:      { rejectUnauthorized: false },
});

console.log(`Connecting to ${env.PGHOST}:${env.PGPORT} as ${env.PGUSER}…`);
await client.connect();
console.log('Connected.');

try {
  console.log(`\nExecuting ${path.basename(file)} (${sql.length} chars)…\n`);
  const res = await client.query(sql);
  // pg returns an array if there are multiple statements
  const results = Array.isArray(res) ? res : [res];
  results.forEach((r, i) => {
    if (r.command) console.log(`  [${i+1}] ${r.command}  (rowCount: ${r.rowCount ?? 0})`);
    if (r.rows && r.rows.length) {
      console.log('     rows:');
      r.rows.forEach(row => console.log('      ', row));
    }
  });
  console.log('\n✅ Done.');
} catch (e) {
  console.error('\n❌ SQL error:', e.message);
  if (e.position) console.error('   position:', e.position);
  process.exit(1);
} finally {
  await client.end();
}
