import { corsHeaders } from '../_shared/cors.ts';
import { stripe, adminClient, callerUserId } from '../_shared/clients.ts';
import { resolveCart } from '../_shared/resolve-cart.ts';

const SITE_URL = Deno.env.get('SITE_URL') ?? 'http://localhost:3000';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  const userId = await callerUserId(req.headers.get('Authorization'));
  if (!userId) return json({ error: 'unauthorized' }, 401);

  const resolved = await resolveCart(userId);
  if (!resolved.ok) return json({ error: resolved.error }, 400);

  const db = adminClient();
  const { data: order, error: orderErr } = await db.from('orders').insert({
    user_id: userId, status: 'pending', currency: 'thb',
    total_thb: resolved.total_thb, items: resolved.items,
  }).select('id').single();
  if (orderErr || !order) return json({ error: 'order_create_failed' }, 500);

  let session;
  try {
    session = await stripe.checkout.sessions.create({
      mode: 'payment',
      client_reference_id: userId,
      metadata: { order_id: order.id },
      submit_type: 'pay',
      custom_text: { submit: { message: 'Your bespoke order begins after payment — we\'ll arrange your fitting next.' } },
      line_items: resolved.items.map((li) => ({
        quantity: li.qty,
        price_data: {
          currency: 'thb',
          unit_amount: li.unit_price_thb * 100, // THB → satang at the Stripe boundary
          product_data: { name: li.display_name },
        },
      })),
      success_url: `${SITE_URL}/order-confirmation.html?order=${order.id}`,
      cancel_url: `${SITE_URL}/cart.html`,
    });
  } catch (_e) {
    // Don't strand an orphan pending order if Stripe fails (no session → no expiry event).
    await db.from('orders').update({ status: 'canceled', updated_at: new Date().toISOString() }).eq('id', order.id);
    return json({ error: 'stripe_session_failed' }, 502);
  }

  await db.from('orders').update({ stripe_checkout_session_id: session.id, updated_at: new Date().toISOString() }).eq('id', order.id);
  return json({ url: session.url, order_id: order.id });
});
