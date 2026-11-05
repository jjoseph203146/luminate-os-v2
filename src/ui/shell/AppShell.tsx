import Link from "next/link";
import type { ReactNode } from "react";
import { QuickAdd } from "@/ui/QuickAdd";
import type { ClientOption } from "@/domains/work/types";
import { NavLinks } from "./NavLinks";

type Props = {
  children: ReactNode;
  env: string;
  email: string | null;
  signOut: () => Promise<void>;
  clients: ClientOption[];
  clientsError: boolean;
};

/**
 * Phone: top bar + content + bottom bar with the five destinations.
 * Desktop (md and up): sidebar on the left, content on the right.
 */
export function AppShell({ children, env, email, signOut, clients, clientsError }: Props) {
  const isProd = env === "production";
  return (
    <div className="min-h-dvh md:grid md:grid-cols-[14rem_1fr]">
      <aside className="hidden md:flex md:flex-col gap-1 border-r border-line bg-surface p-3">
        <div className="px-3 py-2 text-lg font-bold">Luminate OS</div>
        <nav aria-label="Main" className="flex flex-col gap-1">
          <NavLinks variant="side" />
        </nav>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-line bg-surface px-4 pt-[env(safe-area-inset-top)] min-h-14">
          <div className="flex items-center gap-2 md:hidden font-bold">Luminate OS</div>
          <span
            aria-label="Environment"
            className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${isProd ? "bg-bad-bg text-bad" : "bg-warn-bg text-warn"}`}
          >
            {isProd ? "Production" : env === "staging" ? "Staging" : env}
          </span>
          <details className="relative ml-auto">
            <summary className="flex min-h-11 min-w-11 cursor-pointer list-none items-center justify-center rounded-lg px-3 text-sm font-medium">
              Menu
            </summary>
            <div className="absolute right-0 mt-1 w-56 rounded-xl border border-line bg-surface p-2 shadow-lg">
              {email && <p className="truncate px-3 py-2 text-xs text-muted">{email}</p>}
              <Link className="block rounded-lg px-3 py-3 text-sm" href="/settings">Settings</Link>
              <Link className="block rounded-lg px-3 py-3 text-sm" href="/automations">Automations</Link>
              <Link className="block rounded-lg px-3 py-3 text-sm" href="/mfa/enroll">Security</Link>
              <form action={signOut}>
                <button type="submit" className="block w-full rounded-lg px-3 py-3 text-left text-sm">Sign out</button>
              </form>
            </div>
          </details>
        </header>

        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-4 pb-28 md:pb-8">{children}</main>
      </div>

      <QuickAdd clients={clients} clientsError={clientsError} />

      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-30 flex border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        <NavLinks variant="bottom" />
      </nav>
    </div>
  );
}
