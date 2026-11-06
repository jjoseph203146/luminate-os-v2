// Database reads for the Money page. Called only from service.ts, with the owner's own (admin-only RLS) client.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { MoneyClient } from "./types";

type Db = SupabaseClient<Database>;

/** Paid payments since `sinceIso` (unassigned ones included: they are real money). */
export async function paidPaymentsSince(db: Db, sinceIso: string): Promise<{ amount: number; paid_at: string | null }[]> {
  const { data, error } = await db.from("revenue_events").select("amount,paid_at").eq("status", "paid").gte("paid_at", sinceIso).limit(5000);
  if (error) throw new Error("Could not read payments");
  return (data ?? []).map((r) => ({ amount: Number(r.amount), paid_at: r.paid_at ?? null }));
}

export async function listMoneyClients(db: Db): Promise<MoneyClient[]> {
  const { data, error } = await db.from("clients").select("id,business_name,stripe_customer_id,status,subscription_price,archived_at");
  if (error) throw new Error("Could not read clients");
  return (data ?? []).map((c) => ({
    id: c.id,
    name: c.business_name,
    stripeCustomerId: c.stripe_customer_id ?? null,
    status: c.status,
    subscriptionPrice: Number(c.subscription_price ?? 0),
    archived: c.archived_at !== null,
  }));
}

/** When the Stripe webhook last processed an event, or null (never, or the ledger could not be read). */
export async function lastStripeEventAt(db: Db): Promise<string | null> {
  // integration_events is not in the generated types yet (migration 0007).
  const { data, error } = await (db as unknown as SupabaseClient)
    .from("integration_events")
    .select("processed_at")
    .eq("status", "processed")
    .not("processed_at", "is", null)
    .order("processed_at", { ascending: false })
    .limit(1);
  if (error) return null;
  return (data?.[0]?.processed_at as string | undefined) ?? null;
}
