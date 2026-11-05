import Link from "next/link";
import { requireOwner } from "@/platform/auth/actor";

export const metadata = { title: "Overview" };

export default async function OverviewPage() {
  await requireOwner();
  return (
    <section>
      <h1>Overview</h1>
      <p>
        The business overview (clients, sales, projects, care, money) arrives in Phase 3. For now, set up the
        platform under <Link href="/settings">Settings</Link>.
      </p>
    </section>
  );
}
