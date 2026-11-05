import Link from "next/link";
import type { ReactNode } from "react";
import { requireOwner } from "@/platform/auth/actor";
import { getAppSettings } from "@/platform/env";
import { signOutAction } from "../(auth)/actions";

export default async function InternalLayout({ children }: { children: ReactNode }) {
  const actor = await requireOwner();
  const { appEnv } = getAppSettings();
  return (
    <div>
      <header>
        <strong>Luminate OS</strong> <span aria-label="Environment">[{appEnv}]</span>
        <nav aria-label="Main">
          <Link href="/">Overview</Link> | <Link href="/automations">Automations</Link> | <Link href="/settings">Settings</Link> |{" "}
          <Link href="/mfa/enroll">Security</Link>
        </nav>
        <span>{actor.email}</span>
        <form action={signOutAction}>
          <button type="submit">Sign out</button>
        </form>
      </header>
      <hr />
      <main>{children}</main>
    </div>
  );
}
