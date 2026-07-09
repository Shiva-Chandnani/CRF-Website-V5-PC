import Stripe from 'https://esm.sh/stripe@18.5.0?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2025-08-27.basil',
  httpClient: Stripe.createFetchHttpClient(),
});

// service_role client — bypasses RLS. Used for all order/payment writes.
export function adminClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );
}

// Resolve the caller's user id from the Authorization header (create-session only).
export async function callerUserId(authHeader: string | null): Promise<string | null> {
  if (!authHeader) return null;
  const anon = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } },
  );
  const { data, error } = await anon.auth.getUser();
  if (error) return null;
  return data.user?.id ?? null;
}
