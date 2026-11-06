import { requireOwner } from "@/platform/auth/actor";
import { getMoneyOverview } from "@/domains/money/service";
import { MoneyView } from "./MoneyView";

export const metadata = { title: "Money" };
// Two live Stripe reads per visit; never cached, so the figures are as of now.
export const dynamic = "force-dynamic";

export default async function MoneyPage() {
  const actor = await requireOwner();
  const o = await getMoneyOverview(actor);
  return <MoneyView o={o} now={new Date()} />;
}
