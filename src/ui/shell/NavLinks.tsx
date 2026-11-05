"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { DESTINATIONS, isActive } from "./destinations";

const base = "flex items-center justify-center gap-2 rounded-lg text-sm font-medium min-h-11";

/** Bottom bar on phones, vertical list in the desktop sidebar. */
export function NavLinks({ variant }: { variant: "bottom" | "side" }) {
  const pathname = usePathname();
  const layout =
    variant === "bottom" ? "flex-col flex-1 py-2 text-xs" : "justify-start px-3 py-2";
  return (
    <>
      {DESTINATIONS.map((d) => {
        const active = isActive(d, pathname);
        const tone = active ? "bg-surface-muted text-brand" : "text-muted";
        if (!d.enabled) {
          return (
            <span key={d.key} aria-disabled="true" title="Not built yet" className={`${base} ${layout} text-muted opacity-50`}>
              {d.label}
            </span>
          );
        }
        return (
          <Link key={d.key} href={d.href} aria-current={active ? "page" : undefined} className={`${base} ${layout} ${tone}`}>
            {d.label}
          </Link>
        );
      })}
    </>
  );
}
