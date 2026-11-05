"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "@/ui/Icon";

type Item = { icon: IconName; label: string; href?: string; tag?: string };

const ITEMS: Item[] = [
  { icon: "description", label: "Documents", tag: "Not built" },
  { icon: "summarize", label: "Reports", tag: "Not built" },
  { icon: "bolt", label: "Automations", href: "/automations" },
  { icon: "settings", label: "Settings", href: "/settings" },
];

/** The "Operations" group at the bottom of the desktop sidebar. Items that are not built are shown, but disabled. */
export function OpsLinks() {
  const pathname = usePathname();
  return (
    <>
      <div className="px-2.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[.08em] text-dim">Operations</div>
      {ITEMS.map((n) => {
        const base = "flex h-[38px] items-center gap-2.5 rounded-[9px] px-2.5 text-[13.5px]";
        const inner = (
          <>
            <Icon name={n.icon} size={19} filled={Boolean(n.href && pathname.startsWith(n.href))} />
            <span className="flex-1">{n.label}</span>
            {n.tag && <span className="font-mono text-[10px]">{n.tag}</span>}
          </>
        );
        if (!n.href) {
          return (
            <div key={n.label} aria-disabled="true" title="Not built yet" className={`${base} text-dim opacity-60`}>
              {inner}
            </div>
          );
        }
        const active = pathname === n.href || pathname.startsWith(`${n.href}/`);
        return (
          <Link key={n.label} href={n.href} aria-current={active ? "page" : undefined} className={`${base} hover:bg-hover ${active ? "bg-chip font-semibold text-ink" : "font-medium text-dim"}`}>
            {inner}
          </Link>
        );
      })}
    </>
  );
}
