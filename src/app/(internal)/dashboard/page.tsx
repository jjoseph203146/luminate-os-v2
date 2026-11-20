import { requireOwner } from "@/platform/auth/actor";
import { getOwnerDashboard } from "@/domains/dashboard/service";
import { DashboardView } from "./DashboardView";

export const metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const actor = await requireOwner();
  const dash = await getOwnerDashboard(actor);
  return <DashboardView dash={dash} />;
}
