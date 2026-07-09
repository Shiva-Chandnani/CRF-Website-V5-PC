import { adminClient } from './clients.ts';

export type ResolvedLine = {
  item_type_id: string;
  fabric_design_id: string;
  unit_price_thb: number;
  qty: number;
  line_total_thb: number;
  customizations: Record<string, unknown>;
  display_name: string;
};

export type ResolveResult =
  | { ok: true; items: ResolvedLine[]; total_thb: number }
  | { ok: false; error: string };

// Reads the user's server cart, validates shape, and RE-PRICES every line from
// the catalogue. The client-supplied price_thb is never trusted.
export async function resolveCart(userId: string): Promise<ResolveResult> {
  const db = adminClient();

  const { data: cart, error: cartErr } = await db
    .from('carts').select('items').eq('user_id', userId).maybeSingle();
  if (cartErr) return { ok: false, error: 'cart_read_failed' };
  const rawItems = Array.isArray(cart?.items) ? cart!.items : [];
  if (rawItems.length === 0) return { ok: false, error: 'cart_empty' };

  const resolved: ResolvedLine[] = [];
  let total = 0;

  for (const raw of rawItems) {
    const item_type_id = raw?.item_type_id;
    const fabric_design_id = raw?.fabric_design_id;
    const qty = Math.max(1, Math.min(99, Math.floor(Number(raw?.qty) || 1)));
    if (typeof item_type_id !== 'string' || typeof fabric_design_id !== 'string') {
      return { ok: false, error: 'invalid_line_shape' };
    }

    // v_products carries the resolved price + display name per (design × item type).
    // Verified column names 2026-07-09: price ✓, item_type_name ✓, design_name ✓
    // (v_products also has a pre-built display_name column but we compose our own
    //  so callers get a consistent "Fabric Design — Item Type" format.)
    const { data: prod, error: prodErr } = await db
      .from('v_products')
      .select('price, item_type_name, design_name')
      .eq('item_type_id', item_type_id)
      .eq('fabric_design_id', fabric_design_id)
      .eq('item_status', 'active') // don't let a stale cart line check out a discontinued item
      .maybeSingle();
    if (prodErr) return { ok: false, error: 'price_lookup_failed' };
    if (!prod || prod.price == null) return { ok: false, error: `unknown_product:${item_type_id}/${fabric_design_id}` };

    const unit = Math.round(Number(prod.price));
    const customizations = (raw?.customizations && typeof raw.customizations === 'object') ? raw.customizations : {};
    const line_total = unit * qty;
    total += line_total;
    resolved.push({
      item_type_id, fabric_design_id, unit_price_thb: unit, qty,
      line_total_thb: line_total, customizations,
      display_name: `${prod.design_name} — ${prod.item_type_name}`,
    });
  }
  return { ok: true, items: resolved, total_thb: total };
}
