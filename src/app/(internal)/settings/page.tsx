import Link from "next/link";
import { requireOwner } from "@/platform/auth/actor";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  await requireOwner();
  return (
    <section>
      <h1>Settings</h1>
      <ul>
        <li><Link href="/settings/business-profile">Business profile</Link></li>
        <li><Link href="/settings/catalog">Catalog and care plans</Link></li>
        <li><Link href="/settings/calendar">Business calendar</Link></li>
        <li><Link href="/settings/users">Users</Link></li>
        <li><Link href="/settings/audit-log">Audit log</Link></li>
        <li><Link href="/settings/system-status">System status</Link></li>
      </ul>
    </section>
  );
}
