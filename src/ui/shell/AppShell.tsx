import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "@/ui/Icon";
import { QuickAddProvider } from "@/ui/QuickAddProvider";
import { ToastProvider } from "@/ui/Toast";
import type { ClientOption } from "@/domains/work/types";
import { AccountMenu } from "./AccountMenu";
import { EnvBadge } from "./EnvBadge";
import { NavLinks } from "./NavLinks";
import { PhoneTop } from "./PhoneTop";
import { QuickAddFab, QuickAddHeaderButton } from "./QuickAddButtons";

type Props = {
  children: ReactNode;
  env: string;
  email: string | null;
  signOut: () => Promise<void>;
  clients: ClientOption[];
  clientsError: boolean;
};

const LATER = [
  { icon: "description" as const, label: "Documents", phase: "P3" },
  { icon: "summarize" as const, label: "Reports", phase: "P4" },
];

/**
 * Phone: page content with a bottom bar of the five destinations and a round Quick add button.
 * md and up: 228px sidebar, 60px top bar, content up to 1120px wide.
 */
export function AppShell({ children, env, email, signOut, clients, clientsError }: Props) {
  return (
    <ToastProvider>
    <QuickAddProvider clients={clients} clientsError={clientsError}>
      <div className="min-h-dvh pt-[env(safe-area-inset-top)] md:flex md:pt-0">
        <aside className="hidden h-dvh w-[228px] flex-none flex-col gap-0.5 border-r border-line bg-side px-2.5 pb-3 pt-3.5 md:sticky md:top-0 md:flex">
          <div className="flex items-center gap-2.5 px-2 pb-3.5 pt-1">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="" width={30} height={30} className="h-[30px] w-[30px] rounded-lg object-cover" />
            <div className="min-w-0 flex-1 leading-[1.2]">
              <div className="text-[15px] font-semibold">Luminate OS</div>
              <div className="font-mono text-[11px] text-dim">v2 · M1</div>
            </div>
          </div>
          <Link href="/clients" className="mb-2.5 flex h-9 items-center gap-2 rounded-[9px] border border-line2 bg-surface px-2.5 text-left text-[13px] text-dim">
            <Icon name="search" size={18} />
            <span className="flex-1">Search clients</span>
          </Link>
          <nav aria-label="Main" className="flex flex-col gap-0.5">
            <NavLinks variant="side" />
          </nav>
          <div className="flex-1" />
          <div className="px-2.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[.08em] text-dim">Not built yet</div>
          {LATER.map((n) => (
            <div key={n.label} aria-disabled="true" className="flex h-[34px] items-center gap-2.5 px-2.5 text-[13px] text-dim opacity-70">
              <Icon name={n.icon} size={18} />
              <span className="flex-1">{n.label}</span>
              <span className="font-mono text-[10px]">{n.phase}</span>
            </div>
          ))}
          <AccountMenu email={email} signOut={signOut} variant="side" />
        </aside>

        <div data-shell-content className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-20 hidden h-[60px] flex-none items-center gap-2.5 border-b border-line bg-canvas pl-7 pr-5 md:flex">
            <div id="page-title-slot" className="min-w-0 flex-1" />
            <EnvBadge env={env} />
            <QuickAddHeaderButton />
          </header>
          <div className="px-4 md:hidden">
            <PhoneTop env={env} email={email} signOut={signOut} />
          </div>
          <main className="mx-auto flex w-full max-w-[1120px] flex-1 flex-col px-4 pb-[calc(58px+max(26px,env(safe-area-inset-bottom))+12px)] md:px-7 md:pb-12 md:pt-6">
            {children}
          </main>
        </div>
      </div>

      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-30 grid h-[calc(58px+max(26px,env(safe-area-inset-bottom)))] grid-cols-5 border-t border-line bg-navbg pb-[max(26px,env(safe-area-inset-bottom))] backdrop-blur md:hidden"
      >
        <NavLinks variant="bottom" />
      </nav>
      <QuickAddFab />
    </QuickAddProvider>
    </ToastProvider>
  );
}
