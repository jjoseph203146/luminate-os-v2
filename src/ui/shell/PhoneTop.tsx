"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/ui/Icon";
import { AccountMenu } from "./AccountMenu";
import { EnvBadge } from "./EnvBadge";

/** Phone-only top row: logo, environment marker, search and account. Hidden on a client's own page. */
export function PhoneTop({ env, email, signOut }: { env: string; email: string | null; signOut: () => Promise<void> }) {
  const pathname = usePathname();
  if (/^\/clients\/[^/]+/.test(pathname)) return null;
  return (
    <div className="mb-3 flex items-center justify-between pt-1.5 md:hidden">
      <div className="flex items-center gap-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="Luminate" width={28} height={28} className="h-7 w-7 rounded-[7px] object-cover" />
        <EnvBadge env={env} />
      </div>
      <div className="flex items-center">
        <Link href="/clients" aria-label="Search clients" className="grid h-11 w-11 place-items-center text-ink">
          <Icon name="search" size={24} />
        </Link>
        <AccountMenu email={email} signOut={signOut} variant="phone" />
      </div>
    </div>
  );
}
