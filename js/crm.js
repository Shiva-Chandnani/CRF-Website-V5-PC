// Phase 5 — staff CRM data layer. All reads rely on the additive staff-read
// RLS policies (db/14); non-staff callers get empty/blocked results.
import { getSupabase } from '/js/auth.js';

const db = () => getSupabase();

// Dashboard aggregates (staff-only RPC; throws for non-staff).
export async function getMetrics() {
  const { data, error } = await db().rpc('crm_metrics');
  if (error) throw error;
  return data;
}

// Paginated + searchable customer list. Searches name/email/phone.
export async function listCustomers({ q = '', limit = 25, offset = 0 } = {}) {
  let query = db()
    .from('profiles')
    .select('id, full_name, email, phone, created_at, source, pos_customer_id', { count: 'exact' })
    .eq('role', 'customer')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  const term = q.trim();
  if (term) {
    // Strip LIKE wildcards (%, _) AND PostgREST .or()-grammar delimiters
    // (comma, parens, dot, backslash, asterisk) so the term can't inject extra
    // filter conditions or throw a 400 on unbalanced parens. RLS still gates
    // results regardless — this keeps the search well-formed.
    const safe = term.replace(/[%_,().*\\]/g, '');
    const like = `%${safe}%`;
    query = query.or(`full_name.ilike.${like},email.ilike.${like},phone.ilike.${like}`);
  }
  const { data, error, count } = await query;
  if (error) throw error;
  return { customers: data || [], total: count || 0 };
}

// One customer's full record.
export async function getCustomer(id) {
  const [{ data: profile }, orders, tags, notes] = await Promise.all([
    db().from('profiles').select('*').eq('id', id).single(),
    db().from('orders').select('id, status, total_thb, currency, created_at, items').eq('user_id', id).order('created_at', { ascending: false }),
    db().from('customer_tags').select('tag, created_at').eq('customer_id', id).order('created_at', { ascending: false }),
    db().from('customer_notes').select('id, body, author_id, created_at').eq('customer_id', id).order('created_at', { ascending: false }),
  ]);
  // Scope payments to THIS customer's orders (staff can read all payments, so
  // never fetch the whole table). Empty order set → skip the query entirely.
  const orderIds = (orders.data || []).map(o => o.id);
  let payments = { data: [] };
  if (orderIds.length) {
    payments = await db()
      .from('payments')
      .select('id, order_id, amount_thb, status, created_at')
      .in('order_id', orderIds)
      .order('created_at', { ascending: false });
  }
  const measurements = await getLatestMeasurements(id);
  return {
    profile,
    orders: orders.data || [],
    payments: payments.data || [],
    tags: (tags.data || []).map(t => t.tag),
    notes: notes.data || [],
    measurements,
  };
}

async function getLatestMeasurements(id) {
  const views = {
    body:   'v_latest_body_measurements',
    jacket: 'v_latest_jacket_reference',
    shirt:  'v_latest_shirt_reference',
    pants:  'v_latest_pants_reference',
  };
  const out = {};
  await Promise.all(Object.entries(views).map(async ([kind, view]) => {
    const { data } = await db().from(view).select('*').eq('customer_id', id).maybeSingle();
    out[kind] = data || null;
  }));
  return out;
}

export async function addNote(customerId, body) {
  const { data: userRes } = await db().auth.getUser();
  const author_id = userRes?.user?.id;
  const { data, error } = await db().from('customer_notes')
    .insert({ customer_id: customerId, author_id, body }).select().single();
  if (error) throw error;
  return data;
}

export async function addTag(customerId, tag) {
  const { data: userRes } = await db().auth.getUser();
  const author_id = userRes?.user?.id;
  const clean = tag.trim().slice(0, 40);
  const { data, error } = await db().from('customer_tags')
    .insert({ customer_id: customerId, author_id, tag: clean }).select().single();
  if (error) throw error;
  return data;
}

export async function removeTag(customerId, tag) {
  const { error } = await db().from('customer_tags').delete().eq('customer_id', customerId).eq('tag', tag);
  if (error) throw error;
}
