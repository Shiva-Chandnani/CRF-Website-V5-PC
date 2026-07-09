import { stripe, adminClient } from '../_shared/clients.ts';
import Stripe from 'https://esm.sh/stripe@18.5.0?target=deno';

const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET')!;
const cryptoProvider = Stripe.createSubtleCryptoProvider();

Deno.serve(async (req) => {
  const sig = req.headers.get('Stripe-Signature');
  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, sig!, webhookSecret, undefined, cryptoProvider);
  } catch (err) {
    return new Response(`Bad signature: ${(err as Error).message}`, { status: 400 });
  }

  const db = adminClient();

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    const orderId = session.metadata?.order_id;
    if (!orderId) return new Response('no order_id', { status: 200 });

    const paymentIntentId = typeof session.payment_intent === 'string' ? session.payment_intent : null;
    const amount = Math.round((session.amount_total ?? 0) / 100); // satang → THB
    const now = new Date().toISOString();

    // Record the payment FIRST — the UNIQUE(stripe_event_id) constraint is the
    // idempotency arbiter (race-free, unlike a check-then-insert). A duplicate
    // delivery hits 23505 and is treated as already-processed; any OTHER write
    // error returns non-2xx so Stripe retries — we never leave a paid order with
    // no payment row.
    const { error: payErr } = await db.from('payments').insert({
      order_id: orderId, stripe_payment_intent_id: paymentIntentId, stripe_event_id: event.id,
      amount_thb: amount, currency: session.currency ?? 'thb', status: 'succeeded', raw: event as unknown as Record<string, unknown>,
    });
    const duplicate = payErr?.code === '23505';
    if (payErr && !duplicate) return new Response('payment_write_failed', { status: 500 });

    // Status-guarded + idempotent: safe on retries/duplicates, and heals an order
    // left pending by an earlier partial failure.
    await db.from('orders').update({
      status: 'paid', stripe_payment_intent_id: paymentIntentId, updated_at: now,
    }).eq('id', orderId).eq('status', 'pending');

    // Clear the user's server cart (best-effort).
    if (session.client_reference_id) {
      await db.from('carts').update({ items: [], updated_at: now }).eq('user_id', session.client_reference_id);
    }
    return new Response(duplicate ? 'duplicate' : 'ok', { status: 200 });
  }

  if (event.type === 'checkout.session.expired') {
    const orderId = (event.data.object as Stripe.Checkout.Session).metadata?.order_id;
    if (orderId) await db.from('orders').update({ status: 'canceled', updated_at: new Date().toISOString() }).eq('id', orderId).eq('status', 'pending');
    return new Response('ok', { status: 200 });
  }

  return new Response('ignored', { status: 200 });
});
