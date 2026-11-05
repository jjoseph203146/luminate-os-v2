"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/ui/Icon";
import { DESTINATIONS, isActive } from "./destinations";

/** Bottom bar on phones, vertical list in the desktop sidebar. */
export function NavLinks({ variant }: { variant: "bottom" | "side" }) {
  const pathname = usePathname();
  return (
    <>
      {DESTINATIONS.map((d) => {
        const active = isActive(d, pathname);
        if (variant === "bottom") {
          const cls = `relative flex min-h-12 flex-col items-center justify-center gap-[3px] text-[11px] ${active ? "font-semibold text-ink" : "font-medium text-dim"}`;
          const inner = (
            <>
              <Icon name={d.icon} size={24} filled={active} />
              {d.label}
            </>
          );
          return d.enabled ? (
            <Link key={d.key} href={d.href} aria-current={active ? "page" : undefined} className={cls}>
              {inner}
            </Link>
          ) : (
            <span key={d.key} aria-disabled="true" title="Not built yet" className={`${cls} opacity-50`}>
              {inner}
            </span>
          );
        }
        const cls = `flex h-10 items-center gap-2.5 rounded-[9px] px-2.5 text-[14px] ${active ? "bg-chip font-semibold text-ink" : "font-medium text-dim"}`;
        const inner = (
          <>
            <Icon name={d.icon} size={20} filled={active} />
            <span className="flex-1">{d.label}</span>
          </>
        );
        return d.enabled ? (
          <Link key={d.key} href={d.href} aria-current={active ? "page" : undefined} className={`${cls} hover:bg-hover`}>
            {inner}
          </Link>
        ) : (
          <span key={d.key} aria-disabled="true" title="Not built yet" className={`${cls} opacity-50`}>
            {inner}
          </span>
        );
      })}
    </>
  );
}
